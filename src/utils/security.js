// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS <https://thypress.org>)
// SPDX-License-Identifier: MPL-2.0

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isIP } from 'node:net';

// ============================================================================
// IP NORMALIZATION & LOOPBACK DETECTION
//
// This module provides the AUTHORIZATION path for local-only feature gates.
// It is deliberately decoupled from SecurityManager.getClientIP(), which
// serves the IDENTIFICATION path (banning, rate-limiting, logging).
//
// The two paths have opposite failure semantics:
//   - Identification (getClientIP):  fails OPEN  → 'unknown' (safe: worst case = can't ban)
//   - Authorization  (isLocalRequest): fails CLOSED → false    (safe: worst case = denied)
//
// DO NOT merge these paths. DO NOT call getClientIP from isLocalRequest.
// ============================================================================

/**
 * Expand an IPv6 address string into an array of 8 numeric groups (0–0xFFFF).
 * Handles :: shorthand, fully-expanded, and mixed forms.
 *
 * @param {string} ip - A valid IPv6 address string
 * @returns {number[]|null} Array of 8 group values, or null if unparseable
 *
 * INTERNAL — only safe for inputs that have already passed through normalizeIP().
 * Does NOT handle mixed notation (::ffff:127.0.0.1) — normalizeIP strips those
 * to plain IPv4 before this function is ever reached. Do not use standalone.
*/
function expandIPv6(ip) {
  const halves = ip.split('::');

  // A valid IPv6 has at most one :: (two halves)
  if (halves.length > 2) return null;

  let groups;

  if (halves.length === 2) {
    // Has :: — expand the gap
    const left  = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;

    if (missing < 0) return null;

    groups = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    // No :: — must have exactly 8 groups
    groups = ip.split(':');
  }

  if (groups.length !== 8) return null;

  const parsed = groups.map(g => parseInt(g, 16));

  if (parsed.some(v => isNaN(v) || v < 0 || v > 0xFFFF)) return null;

  return parsed;
}

/**
 * Normalize an IP address for consistent comparison.
 *
 * - Strips IPv4-mapped IPv6 prefix when the mapped part is dotted-decimal
 *   (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
 * - Validates the result with node:net isIP()
 * - Returns empty string on invalid, missing, or non-string input
 *
 * NOTE: IPv4-mapped addresses in pure-hex form (::ffff:7f00:1) are left as
 * valid IPv6 and handled downstream by isLoopback's hex-mapped detection.
 *
 * @param {string} raw - Raw IP address from any source
 * @returns {string} Normalized IP, or '' if invalid
 */
export function normalizeIP(raw) {
  if (!raw || typeof raw !== 'string') return '';

  const ip = raw.trim();

  // Strip IPv4-mapped IPv6 prefix when payload is dotted-decimal IPv4
  // Covers: ::ffff:127.0.0.1, ::FFFF:192.168.1.1, etc.
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const v4Part = ip.substring(7);
    if (isIP(v4Part) === 4) return v4Part;
    // Hex-form mapped addresses (::ffff:7f00:1) fall through as valid IPv6
  }

  if (isIP(ip) === 0) return '';

  return ip;
}

/**
 * Determine whether an IP address is in the loopback range.
 *
 * Covers:
 *   IPv4:  entire 127.0.0.0/8 block (RFC 1122 §3.2.1.3)
 *   IPv6:  ::1 in any notation (compact, expanded, mixed-case)
 *   IPv6:  IPv4-mapped loopback in hex form (::ffff:7f00:1, etc.)
 *   IPv6:  IPv4-mapped loopback in dotted form (::ffff:127.0.0.1)
 *          — normalizeIP converts this to 127.0.0.1 before we see it
 *
 * @param {string} ip - Raw or normalized IP address
 * @returns {boolean} true if loopback, false otherwise (including invalid input)
 */
export function isLoopback(ip) {
  const normalized = normalizeIP(ip);
  if (!normalized) return false;

  // ── IPv4 ────────────────────────────────────────────────────────────────
  if (isIP(normalized) === 4) {
    return normalized.startsWith('127.');
  }

  // ── IPv6 ────────────────────────────────────────────────────────────────
  if (isIP(normalized) === 6) {
    const groups = expandIPv6(normalized);
    if (!groups) return false;

    // Pure loopback — ::1
    // All groups 0 except the last, which must be exactly 1.
    // Matches: ::1, 0:0:0:0:0:0:0:1, 0000:0000:0000:0000:0000:0000:0000:0001
    const isPureLoopback =
      groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0 && groups[6] === 0 && groups[7] === 1;

    if (isPureLoopback) return true;

    // IPv4-mapped loopback in hex notation — ::ffff:7fXX:XXXX
    // Structure: groups 0-4 = 0, group 5 = 0xFFFF, groups 6-7 encode IPv4.
    // We extract the first octet from group 6's high byte and check for 127.
    const isV4Mapped =
      groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0xFFFF;

    if (isV4Mapped) {
      const firstOctet = (groups[6] >>> 8) & 0xFF;
      return firstOctet === 127;
    }

    return false;
  }

  return false;
}

/**
 * Authorization gate: Is this request from the local machine?
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ SECURITY CONTRACT                                                  │
 * │                                                                    │
 * │ 1. Fails CLOSED — unknown/missing IP → false (deny)               │
 * │ 2. Reads ONLY the TCP-layer peer address (server.requestIP)       │
 * │ 3. NEVER inspects headers (XFF, X-Real-IP, Forwarded, Host, etc.) │
 * │ 4. NEVER calls SecurityManager.getClientIP                        │
 * │ 5. NEVER returns true for non-loopback addresses                  │
 * │ 6. Pure function of (request, server) — no mutable state          │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * This function gates destructive local-only operations:
 *   - create-project   (writes to filesystem)
 *   - open-folder      (exec() — shell command)
 *   - upload-theme     (writes to filesystem)
 *   - admin panel      (isLocal flag for conditional UI)
 *
 * If THYPRESS is behind a reverse proxy, the TCP peer address is the
 * proxy's IP (not loopback), so local-only features are correctly
 * disabled. Users who need admin access remotely must use the
 * authenticated session (PIN + PoW or magic link).
 *
 * @param {Request} request - Bun Web Standard Request object
 * @param {Object|null} server - Bun server instance (second arg from fetch handler)
 * @returns {boolean} true ONLY if TCP peer address is verified loopback
 */
export function isLocalRequest(request, server) {
  // ── Guard: server instance must exist and expose requestIP ──────────
  if (!server || typeof server.requestIP !== 'function') {
    return false;
  }

  // ── Resolve TCP-layer peer address ──────────────────────────────────
  let addr;
  try {
    addr = server.requestIP(request);
  } catch {
    // Bun internal failure (malformed request, connection reset, etc.)
    return false;
  }

  if (!addr || !addr.address) {
    return false;
  }

  // ── Loopback check on the raw TCP address ───────────────────────────
  const result = isLoopback(addr.address);

  if (!result) {
    console.debug(`[SECURITY] isLocalRequest denied: TCP peer ${addr.address} is not loopback`);
  }

  return result;
}


/**
 * SecurityManager - Centralized security implementation for THYPRESS
 *
 * Features:
 * - IP-based permaban + rate limiting
 * - CSRF protection via Origin validation
 * - Host header validation (anti-DNS rebinding)
 * - Session management (in-memory, expires on restart + 24h server-side TTL)
 * - Magic link HMAC authentication (60s TTL, one-time use)
 * - PIN + Proof-of-Work authentication (PIN stored as salt:hash, PoW difficulty 5 hex zeros)
 * - Traffic analysis countermeasures (padding, jitter)
 * - Honeypot routes for automated attack detection
 */
export class SecurityManager {
  // PoW difficulty: number of leading hex zeros required in SHA256(salt + nonce).
  // MUST match POW_DIFFICULTY constant in admin-utils.js adminCryptoScript().
  // 5 hex zeros = 20 bits = ~1M average attempts = 2-5 seconds on a modern browser.
  static POW_DIFFICULTY = '00000';

  constructor(siteConfig = {}) {
    this.siteConfig = siteConfig;

    // IP ban and rate limiting
    this.bannedIPs = new Set();
    this.rateLimits = new Map(); // IP -> { attempts: number, lastAttempt: timestamp, backoffUntil: timestamp }

    // Session management (in-memory, persists until server restart)
    // Reasoning: THYPRESS is a dual-use tool (dev and production, local and remote)
    // with a single-admin or small-team model. Server restarts are expected in dev;
    // in production, sessions are ephemeral by design — 24h server-side TTL enforced
    // in verifySession to match cookie Max-Age.
    this.sessions = new Map(); // sessionId -> { ip: string, createdAt: timestamp }

    // One-time magic link tokens with creation timestamps for TTL enforcement.
    // Map<token, createdAt> replaces the old Set to support 60-second expiry.
    this.magicTokens = new Map(); // token -> createdAt timestamp

    // Proof-of-Work challenges
    this.powChallenges = new Map(); // IP -> { salt: string, createdAt: timestamp }

    // Admin secret (random path component)
    this.adminSecret = this.loadOrGenerateAdminSecret();

    // HMAC secret for magic links
    this.hmacSecret = this.loadOrGenerateHMACSecret();

    // PIN (if configured) — stored as "salt:hash" (see loadPIN / setPIN)
    this.pin = this.loadPIN();

    // Trust proxy configuration
    this.trustProxy = siteConfig.trustProxy === true;
  }

  // ============================================================================
  // SECRET / KEY MANAGEMENT
  // ============================================================================

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

  // ============================================================================
  // PIN MANAGEMENT
  // ============================================================================

  /**
   * Load PIN from .thypress/pin
   * Expected format on disk: "salt:hash" where salt is 32 hex chars (16 random bytes)
   * and hash is 64 hex chars (SHA-256 of salt + PIN).
   * Unknown/legacy formats are rejected — user must set a new PIN via the setup form.
   */
  loadPIN() {
    const pinPath = path.join(process.cwd(), '.thypress', 'pin');

    if (fs.existsSync(pinPath)) {
      const stored = fs.readFileSync(pinPath, 'utf-8').trim();

      // Expected format: salt:hash
      if (stored.includes(':')) {
        return stored;
      }

      // Unknown/legacy format (e.g. old plaintext PIN) — reject and return null.
      // The user will be prompted to set a new PIN via the setup form.
      console.log('[SECURITY] Unrecognized PIN format in .thypress/pin, ignoring. Please set a new PIN via the admin setup page.');
    }

    return null;
  }

  /**
   * Set/update PIN — stored on disk as "salt:hash" (salted SHA-256).
   * Supports 4–6 digit PINs.
   * @param {string} newPIN - 4-6 digit numeric PIN
   */
  setPIN(newPIN) {
    if (newPIN.length < 6 || /\s/.test(newPIN)) {
      throw new Error('PIN must be at least 6 characters with no spaces');
    }

    const salt = crypto.randomBytes(16).toString('hex'); // 32 hex chars
    const hash = crypto.createHash('sha256').update(salt + newPIN).digest('hex'); // 64 hex chars
    const stored = `${salt}:${hash}`;

    const configDir = path.join(process.cwd(), '.thypress');
    const pinPath = path.join(configDir, 'pin');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(pinPath, stored, 'utf-8');
    this.pin = stored;
  }

  /**
   * Verify PIN using timing-safe comparison on the derived hashes.
   * Parses the stored "salt:hash" format and re-derives the hash from inputPIN.
   * Comparison is done on the hex-decoded hash bytes, not the raw PIN string.
   * @param {string} inputPIN - PIN to verify
   * @returns {boolean}
   */
  verifyPIN(inputPIN) {
    if (!this.pin || !inputPIN) return false;

    // Parse stored format: salt:hash
    const colonIndex = this.pin.indexOf(':');
    if (colonIndex === -1) return false;

    const salt = this.pin.substring(0, colonIndex);
    const storedHash = this.pin.substring(colonIndex + 1);

    // Re-derive hash from the candidate PIN using the same salt
    const inputHash = crypto.createHash('sha256').update(salt + inputPIN).digest('hex');

    // Timing-safe comparison on the hash bytes (SHA-256 output is always 32 bytes = 64 hex chars)
    const storedBuffer = Buffer.from(storedHash, 'hex');
    const inputBuffer  = Buffer.from(inputHash,  'hex');

    if (storedBuffer.length !== inputBuffer.length) return false;

    return crypto.timingSafeEqual(storedBuffer, inputBuffer);
  }

  // ============================================================================
  // IP / REQUEST IDENTIFICATION
  // ============================================================================

  /**
   * Extract client IP from request for IDENTIFICATION purposes.
   *
   * Used by: rate limiting, IP banning, session binding, honeypot logging.
   *
   * ┌─────────────────────────────────────────────────────────────────────┐
   * │ WARNING: This method returns 'unknown' when IP resolution fails.   │
   * │ This is SAFE for identification (banning, rate-limiting, logging)  │
   * │ but UNSAFE for authorization (granting privileges).                │
   * │                                                                    │
   * │ For authorization decisions (local-only feature gates), use        │
   * │ isLocalRequest() instead. That function fails    │
   * │ CLOSED (returns false on any failure).                             │
   * └─────────────────────────────────────────────────────────────────────┘
   *
   * Priority:
   *   1. X-Forwarded-For header (only when trustProxy: true, validated)
   *   2. Bun's server.requestIP(request) — TCP-layer remote address
   *   3. 'unknown' fallback
   *
   * All returned IPs are normalized (::ffff:x.x.x.x → x.x.x.x) so that
   * downstream consumers (session IP-binding, ban sets, rate-limit keys)
   * compare consistently regardless of dual-stack socket behavior.
   *
   * @param {Request} request - Incoming HTTP request
   * @param {Object|null} server - Bun server instance (from fetch handler 2nd arg)
   * @returns {string} Client IP address or 'unknown'
   */
  getClientIP(request, server) {
    // 1. If trust proxy is enabled, check forwarded headers first
    if (this.trustProxy) {
      const forwarded = request.headers.get('x-forwarded-for');
      if (forwarded) {
        const firstEntry = forwarded.split(',')[0].trim();
        // Validate: only accept if it's a syntactically valid IP.
        // Prevents garbage strings from polluting ban sets, rate-limit
        // keys, and session records.
        const normalized = normalizeIP(firstEntry);
        if (normalized) return normalized;
        // Invalid/empty XFF entry — fall through to TCP address
      }
    }

    // 2. Use Bun's native IP resolution — the actual TCP remote address
    if (server && typeof server.requestIP === 'function') {
      try {
        const addr = server.requestIP(request);
        if (addr && addr.address) {
          // Normalize so that session IP-binding, ban checks, and
          // rate-limit keys are consistent across dual-stack sockets.
          // e.g. ::ffff:127.0.0.1 and 127.0.0.1 become the same key.
          return normalizeIP(addr.address) || 'unknown';
        }
      } catch {
        // server.requestIP can fail on malformed requests or after
        // connection reset. Fall through to 'unknown'.
      }
    }

    // 3. Last resort fallback.
    // SAFE for identification (banning, rate-limiting, logging).
    // NEVER use this value for authorization — use isLocalRequest() instead.
    return 'unknown';
  }

  // ============================================================================
  // IP BANNING
  // ============================================================================

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

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

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

  // ============================================================================
  // REQUEST VALIDATION
  // ============================================================================

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

  // ============================================================================
  // MAGIC LINK TOKENS
  // ============================================================================

  /**
   * Generate magic link token (HMAC-signed, one-time use, 60-second TTL).
   * Token format: "{payload}.{hmac_signature}" where payload is 16 random bytes (hex).
   * Expired tokens are cleaned up opportunistically on each call to avoid unbounded growth.
   */
  generateMagicToken() {
    const payload = crypto.randomBytes(16).toString('hex');
    const hmac = crypto.createHmac('sha256', this.hmacSecret);
    hmac.update(payload);
    const signature = hmac.digest('hex');

    const token = `${payload}.${signature}`;
    this.magicTokens.set(token, Date.now());

    // Clean up expired tokens (older than 60s) while we're here
    const now = Date.now();
    for (const [t, createdAt] of this.magicTokens) {
      if (now - createdAt > 60_000) {
        this.magicTokens.delete(t);
      }
    }

    return token;
  }

  /**
   * Verify and consume magic link token (one-time use, 60-second TTL).
   * Checks: HMAC validity → existence in map → age ≤ 60s → delete on use.
   * @param {string} token - Token from URL parameter
   * @returns {boolean} True only if token is valid, unexpired, and not yet used
   */
  verifyMagicToken(token) {
    if (!token || typeof token !== 'string') return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [payload, signature] = parts;

    // Verify HMAC — reject forged tokens before any map lookup
    const hmac = crypto.createHmac('sha256', this.hmacSecret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    try {
      // Timing-safe comparison to prevent signature oracle attacks
      if (!crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      )) {
        return false;
      }
    } catch {
      // Buffer.from will throw if the signature isn't valid hex
      return false;
    }

    // Check existence (also catches already-consumed tokens)
    if (!this.magicTokens.has(token)) {
      return false;
    }

    // Check TTL (60 seconds)
    const createdAt = this.magicTokens.get(token);
    if (Date.now() - createdAt > 60_000) {
      this.magicTokens.delete(token);
      return false;
    }

    // Consume token — one-time use
    this.magicTokens.delete(token);

    return true;
  }

  // ============================================================================
  // PROOF-OF-WORK
  // ============================================================================

  /**
   * Generate Proof-of-Work challenge for an IP.
   * Replaces any existing pending challenge for the same IP.
   * Cleans up challenges older than 5 minutes to prevent memory growth.
   * @param {string} ip - Client IP address
   * @returns {string} Salt (hex string) to be sent to the client
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
   * Verify Proof-of-Work solution.
   * Client must find nonce where SHA256(salt + nonce) starts with SecurityManager.POW_DIFFICULTY.
   * The challenge is consumed on successful verification (one-time use).
   * @param {string} ip - Client IP address
   * @param {string} nonce - Candidate nonce string from client
   * @returns {boolean} True if solution is valid and challenge existed
   */
  verifyPowSolution(ip, nonce) {
    const challenge = this.powChallenges.get(ip);
    if (!challenge) return false;

    const hash = crypto.createHash('sha256');
    hash.update(challenge.salt + nonce);
    const result = hash.digest('hex');

    const valid = result.startsWith(SecurityManager.POW_DIFFICULTY);

    if (valid) {
      // Consume challenge — prevents PoW solution replay
      this.powChallenges.delete(ip);
    }

    return valid;
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  /**
   * Create authenticated session
   * @param {string} ip - Client IP address at time of authentication
   * @returns {string} Session ID (64 hex chars = 32 random bytes)
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
   * Verify session cookie.
   * Checks: cookie present → session exists → 24h TTL not exceeded → IP matches.
   * The IP check is skipped if the current IP is 'unknown' (server fallback path).
   *
   * @param {Request} request - Incoming HTTP request
   * @param {Object|null} server - Bun server instance for real IP resolution
   * @returns {boolean} True if session is valid and unexpired
   */
  verifySession(request, server) {
    const cookies = request.headers.get('cookie') || '';
    const sessionMatch = cookies.match(/thypress_session=([^;]+)/);

    if (!sessionMatch) return false;

    const sessionId = sessionMatch[1];
    const session = this.sessions.get(sessionId);

    if (!session) return false;

    // Enforce 24-hour server-side expiry (matches cookie Max-Age)
    if (Date.now() - session.createdAt > 86_400_000) {
      this.sessions.delete(sessionId);
      return false;
    }

    // Optional: verify IP matches (prevent session hijacking)
    // Skip when currentIP is 'unknown' — don't reject valid sessions just because
    // IP resolution fell back; the TTL and session ID entropy cover us.
    const currentIP = this.getClientIP(request, server);
    if (currentIP !== 'unknown' && session.ip !== currentIP) {
      return false;
    }

    return true;
  }

  // ============================================================================
  // TRAFFIC ANALYSIS COUNTERMEASURES
  // ============================================================================

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

  // ============================================================================
  // SECURITY HEADERS & COOKIES
  // ============================================================================

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
   * HttpOnly: no JS access. SameSite=Strict: no cross-site requests. Max-Age=86400: 24h (matches server-side TTL).
   */
  createSessionCookie(sessionId) {
    return `thypress_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
  }
}
