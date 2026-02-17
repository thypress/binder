// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS)
// SPDX-License-Identifier: MPL-2.0

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * SecurityManager - Centralized security implementation for THYPRESS
 *
 * Features:
 * - IP-based permaban + rate limiting
 * - CSRF protection via Origin validation
 * - Host header validation (anti-DNS rebinding)
 * - Session management (in-memory, expires on restart)
 * - Magic link HMAC authentication
 * - PIN + Proof-of-Work authentication
 * - Traffic analysis countermeasures (padding, jitter)
 * - Honeypot routes for automated attack detection
 */
export class SecurityManager {
  constructor(siteConfig = {}) {
    this.siteConfig = siteConfig;

    // IP ban and rate limiting
    this.bannedIPs = new Set();
    this.rateLimits = new Map(); // IP -> { attempts: number, lastAttempt: timestamp, backoffUntil: timestamp }

    // Session management (in-memory, persists until server restart)
    // Reasoning: THYPRESS is a dev tool where restarts are common, single admin user.
    // Session stays valid until Ctrl+C - simpler than time-based expiry.
    this.sessions = new Map(); // sessionId -> { ip: string, createdAt: timestamp }

    // One-time magic link tokens
    this.magicTokens = new Set();

    // Proof-of-Work challenges
    this.powChallenges = new Map(); // IP -> { salt: string, createdAt: timestamp }

    // Admin secret (random path component)
    this.adminSecret = this.loadOrGenerateAdminSecret();

    // HMAC secret for magic links
    this.hmacSecret = this.loadOrGenerateHMACSecret();

    // PIN (if configured)
    this.pin = this.loadPIN();

    // Trust proxy configuration
    this.trustProxy = siteConfig.trustProxy === true;
  }

  /**
   * Load or generate the admin path secret
   */
  loadOrGenerateAdminSecret() {
    const configDir = path.join(process.cwd(), '.thypress');
    const secretPath = path.join(configDir, 'admin_secret');

    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, 'utf-8').trim();
    }

    // Generate new random secret (12 chars)
    const secret = crypto.randomBytes(9).toString('base64url').slice(0, 12);

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(secretPath, secret, 'utf-8');
    return secret;
  }

  /**
   * Load or generate HMAC secret for magic links
   */
  loadOrGenerateHMACSecret() {
    const configDir = path.join(process.cwd(), '.thypress');
    const secretPath = path.join(configDir, 'hmac_secret');

    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, 'utf-8').trim();
    }

    const secret = crypto.randomBytes(32).toString('hex');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(secretPath, secret, 'utf-8');
    return secret;
  }

  /**
   * Load PIN from .thypress/pin
   */
  loadPIN() {
    const pinPath = path.join(process.cwd(), '.thypress', 'pin');

    if (fs.existsSync(pinPath)) {
      const pin = fs.readFileSync(pinPath, 'utf-8').trim();
      // Validate PIN is 4 digits
      if (/^\d{4}$/.test(pin)) {
        return pin;
      }
    }

    return null;
  }

  /**
   * Set/update PIN
   */
  setPIN(newPIN) {
    if (!/^\d{4}$/.test(newPIN)) {
      throw new Error('PIN must be exactly 4 digits');
    }

    const configDir = path.join(process.cwd(), '.thypress');
    const pinPath = path.join(configDir, 'pin');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(pinPath, newPIN, 'utf-8');
    this.pin = newPIN;
  }

  /**
   * Extract client IP from request
   */
  getClientIP(request) {
    if (this.trustProxy) {
      const forwarded = request.headers.get('x-forwarded-for');
      if (forwarded) {
        // Take first IP in chain
        return forwarded.split(',')[0].trim();
      }
    }

    // Fallback: connection remote address (not available in Bun fetch API)
    // Use a placeholder - in practice this will be 'unknown' for most cases
    return 'unknown';
  }

  /**
   * Check if IP is banned
   */
  isIPBanned(ip) {
    return this.bannedIPs.has(ip);
  }

  /**
   * Ban an IP permanently
   */
  banIP(ip, reason = 'honeypot') {
    this.bannedIPs.add(ip);
    console.log(`[SECURITY] Banned IP ${ip} (reason: ${reason})`);
  }

  /**
   * Check rate limit for IP
   * Returns { allowed: boolean, backoffMs: number }
   */
  checkRateLimit(ip) {
    const now = Date.now();
    const limit = this.rateLimits.get(ip);

    if (!limit) {
      return { allowed: true, backoffMs: 0 };
    }

    // Check if still in backoff period
    if (limit.backoffUntil && now < limit.backoffUntil) {
      return { allowed: false, backoffMs: limit.backoffUntil - now };
    }

    return { allowed: true, backoffMs: 0 };
  }

  /**
   * Record failed auth attempt and apply exponential backoff
   */
  recordFailedAttempt(ip) {
    const now = Date.now();
    const limit = this.rateLimits.get(ip) || { attempts: 0, lastAttempt: 0, backoffUntil: 0 };

    limit.attempts++;
    limit.lastAttempt = now;

    // Exponential backoff: 2^attempts seconds (capped at 1 hour)
    const backoffSeconds = Math.min(Math.pow(2, limit.attempts), 3600);
    limit.backoffUntil = now + (backoffSeconds * 1000);

    this.rateLimits.set(ip, limit);

    console.log(`[SECURITY] Failed auth from ${ip} (${limit.attempts} attempts, backoff: ${backoffSeconds}s)`);
  }

  /**
   * Reset rate limit for IP (after successful auth)
   */
  resetRateLimit(ip) {
    this.rateLimits.delete(ip);
  }

  /**
   * Validate request headers for security
   * Returns { valid: boolean, error: string }
   */
  validateRequest(request) {
    const method = request.method;
    const url = new URL(request.url);

    // Normalize headers by stripping IPv6 brackets
    let host = request.headers.get('host') || '';
    let origin = request.headers.get('origin') || '';

    host = host.replace(/^\[|\]$/g, '');
    origin = origin.replace(/^\[|\]$/g, '');

    // Host header validation (anti-DNS rebinding)
    if (!host) {
      return { valid: false, error: 'Missing Host header' };
    }

    // If bound to localhost, strictly validate Host
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';

    if (isLocalhost) {
      const validLocalHosts = ['localhost', '127.0.0.1', '::1'];
      const hostWithoutPort = host.split(':')[0];

      if (!validLocalHosts.includes(hostWithoutPort)) {
        return { valid: false, error: 'Invalid Host header for localhost binding' };
      }
    }

    // CSRF protection: Origin must match Host for state-changing methods
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      if (origin) {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return { valid: false, error: 'CSRF: Origin does not match Host' };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Generate magic link token (HMAC-signed, one-time use)
   */
  generateMagicToken() {
    const payload = crypto.randomBytes(16).toString('hex');
    const hmac = crypto.createHmac('sha256', this.hmacSecret);
    hmac.update(payload);
    const signature = hmac.digest('hex');

    const token = `${payload}.${signature}`;
    this.magicTokens.add(token);

    return token;
  }

  /**
   * Verify and consume magic link token (one-time use)
   */
  verifyMagicToken(token) {
    if (!token || typeof token !== 'string') return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [payload, signature] = parts;

    // Verify HMAC
    const hmac = crypto.createHmac('sha256', this.hmacSecret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    // Timing-safe comparison
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
      return false;
    }

    // Check if token was already used
    if (!this.magicTokens.has(token)) {
      return false;
    }

    // Consume token (one-time use)
    this.magicTokens.delete(token);

    return true;
  }

  /**
   * Generate Proof-of-Work challenge
   */
  generatePowChallenge(ip) {
    const salt = crypto.randomBytes(16).toString('hex');

    this.powChallenges.set(ip, {
      salt,
      createdAt: Date.now()
    });

    // Clean up old challenges (older than 5 minutes)
    const now = Date.now();
    for (const [challengeIP, challenge] of this.powChallenges) {
      if (now - challenge.createdAt > 5 * 60 * 1000) {
        this.powChallenges.delete(challengeIP);
      }
    }

    return salt;
  }

  /**
   * Verify Proof-of-Work solution
   * Client must find nonce where SHA256(salt + nonce) starts with '0000'
   */
  verifyPowSolution(ip, nonce) {
    const challenge = this.powChallenges.get(ip);
    if (!challenge) return false;

    const hash = crypto.createHash('sha256');
    hash.update(challenge.salt + nonce);
    const result = hash.digest('hex');

    const valid = result.startsWith('0000');

    if (valid) {
      // Consume challenge
      this.powChallenges.delete(ip);
    }

    return valid;
  }

  /**
   * Verify PIN (timing-safe comparison)
   */
  verifyPIN(inputPIN) {
    if (!this.pin || !inputPIN) return false;

    const pinBuffer = Buffer.from(this.pin);
    const inputBuffer = Buffer.from(inputPIN);

    if (pinBuffer.length !== inputBuffer.length) return false;

    return crypto.timingSafeEqual(pinBuffer, inputBuffer);
  }

  /**
   * Create authenticated session
   */
  createSession(ip) {
    const sessionId = crypto.randomBytes(32).toString('hex');

    this.sessions.set(sessionId, {
      ip,
      createdAt: Date.now()
    });

    return sessionId;
  }

  /**
   * Verify session cookie
   */
  verifySession(request) {
    const cookies = request.headers.get('cookie') || '';
    const sessionMatch = cookies.match(/thypress_session=([^;]+)/);

    if (!sessionMatch) return false;

    const sessionId = sessionMatch[1];
    const session = this.sessions.get(sessionId);

    if (!session) return false;

    // Optional: verify IP matches (prevent session hijacking)
    const currentIP = this.getClientIP(request);
    if (currentIP !== 'unknown' && session.ip !== currentIP) {
      return false;
    }

    return true;
  }

  /**
   * Apply traffic analysis countermeasures
   * - Padding to fixed block size (4KB)
   * - Random jitter delay
   */
  async applyCountermeasures(body, contentType = 'application/json') {
    // Padding
    const targetSize = Math.ceil(body.length / 4096) * 4096;
    const padding = targetSize - body.length;

    let paddedBody = body;

    if (contentType.includes('json')) {
      paddedBody = body + ' '.repeat(padding);
    } else if (contentType.includes('html')) {
      paddedBody = body + `<!-- ${' '.repeat(padding - 10)} -->`;
    }

    // Jitter delay (10-50ms)
    const jitterMs = 10 + Math.random() * 40;
    await new Promise(resolve => setTimeout(resolve, jitterMs));

    return paddedBody;
  }

  /**
   * Apply security headers to response
   */
  applySecurityHeaders(headers = {}) {
    return {
      ...headers,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Server': 'Apache/2.4.41 (Unix)', // Masquerade
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    };
  }

  /**
   * Create session cookie
   */
  createSessionCookie(sessionId) {
    return `thypress_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
  }
}
