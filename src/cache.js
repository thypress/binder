// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS)
// SPDX-License-Identifier: MPL-2.0

import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

/**
 * Cache Manager
 * Handles multi-layer caching and Memoized Just-In-Time compression
 */
export class CacheManager {
  constructor(maxSize = 50 * 1024 * 1024) { // 50MB static asset limit (configurable)
    this.maxSize = maxSize;
    this.currentSize = 0;

    // Layer 1: Strings (Dynamic Mode Source)
    this.renderedCache = new Map();

    // Layer 2: Static Files (Build Mode Source)
    this.precompressedCache = new Map();

    // Layer 3: Assets (Images/Fonts)
    this.staticAssetCache = new Map();

    // Layer 4: Meta Data (JSON/XML)
    this.dynamicContentCache = new Map();

    // Layer 5: MEMOIZATION (The "Hot Gzip" Cache) with LRU eviction
    this.compressedBufferCache = new Map();
    this.MAX_COMPRESSED_ENTRIES = 2000; // ~200MB max (100KB avg per entry)
  }

  generateETag(content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  getCacheControl(mimeType) {
    // DYNAMIC MODE: Force browser to revalidate (Status 304 or 200)
    if (process.env.THYPRESS_MODE === 'dynamic') {
      return 'no-cache, no-store, must-revalidate';
    }

    // STATIC MODE: Production headers
    if (mimeType.includes('image') || mimeType.includes('font') ||
        mimeType === 'text/css' || mimeType === 'text/javascript') {
      return 'public, max-age=31536000, immutable';
    }

    if (mimeType === 'text/html') {
      return 'public, max-age=3600';
    }

    return 'public, max-age=300';
  }

  addStaticAsset(key, content, mimeType) {
    if (this.staticAssetCache.has(key)) return;

    if (this.currentSize + content.length > this.maxSize) {
      this.staticAssetCache.clear();
      this.compressedBufferCache.clear();
      this.currentSize = 0;
    }

    this.staticAssetCache.set(key, {
      content,
      mimeType,
      etag: this.generateETag(content)
    });
    this.currentSize += content.length;
  }

  delete(key) {
    let deleted = false;
    if (this.renderedCache.delete(key)) deleted = true;
    if (this.precompressedCache.delete(`${key}:gzip`)) deleted = true;
    if (this.precompressedCache.delete(`${key}:br`)) deleted = true;
    if (this.dynamicContentCache.delete(key)) deleted = true;
    return deleted;
  }

  clearAll() {
    const count = this.renderedCache.size + this.staticAssetCache.size;
    this.renderedCache.clear();
    this.precompressedCache.clear();
    this.staticAssetCache.clear();
    this.dynamicContentCache.clear();
    this.compressedBufferCache.clear();
    this.currentSize = 0;
    return count;
  }

  servePrecompressed(key, request) {
    if (process.env.THYPRESS_MODE === 'dynamic') return null;

    const accept = request.headers.get('Accept-Encoding') || '';

    if (accept.includes('br') && this.precompressedCache.has(`${key}:br`)) {
      const cached = this.precompressedCache.get(`${key}:br`);
      return this.createResponse(cached.content, 'text/html', cached.etag, 'br');
    }

    if (accept.includes('gzip') && this.precompressedCache.has(`${key}:gzip`)) {
      const cached = this.precompressedCache.get(`${key}:gzip`);
      return this.createResponse(cached.content, 'text/html', cached.etag, 'gzip');
    }

    return null;
  }

  async serveWithCache(content, mimeType, request) {
    const etag = this.generateETag(content);

    // 304 Not Modified
    if (request.headers.get('If-None-Match') === etag) {
      metrics.httpCacheHits++;
      return new Response(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': this.getCacheControl(mimeType),
          'Vary': 'Accept-Encoding'
        }
      });
    }

    // Dynamic Compression Logic with LRU eviction
    const accept = request.headers.get('Accept-Encoding') || '';
    const shouldCompress = mimeType.match(/text|javascript|json|xml|css/);

    if (shouldCompress) {
      if (accept.includes('br')) {
        const cacheKey = `br:${etag}`;
        if (this.compressedBufferCache.has(cacheKey)) {
          return this.createResponse(this.compressedBufferCache.get(cacheKey), mimeType, etag, 'br');
        }

        const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
        const compressed = await brotli(buffer);

        // LRU eviction: remove oldest entry if at capacity
        if (this.compressedBufferCache.size >= this.MAX_COMPRESSED_ENTRIES) {
          const firstKey = this.compressedBufferCache.keys().next().value;
          this.compressedBufferCache.delete(firstKey);
        }

        this.compressedBufferCache.set(cacheKey, compressed);
        return this.createResponse(compressed, mimeType, etag, 'br');
      }

      if (accept.includes('gzip')) {
        const cacheKey = `gzip:${etag}`;
        if (this.compressedBufferCache.has(cacheKey)) {
          return this.createResponse(this.compressedBufferCache.get(cacheKey), mimeType, etag, 'gzip');
        }

        const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
        const compressed = await gzip(buffer);

        // LRU eviction: remove oldest entry if at capacity
        if (this.compressedBufferCache.size >= this.MAX_COMPRESSED_ENTRIES) {
          const firstKey = this.compressedBufferCache.keys().next().value;
          this.compressedBufferCache.delete(firstKey);
        }

        this.compressedBufferCache.set(cacheKey, compressed);
        return this.createResponse(compressed, mimeType, etag, 'gzip');
      }
    }

    return this.createResponse(content, mimeType, etag, null);
  }

  createResponse(body, mimeType, etag, encoding) {
    const headers = {
      'Content-Type': mimeType,
      'ETag': etag,
      'Cache-Control': this.getCacheControl(mimeType),
      'Vary': 'Accept-Encoding'
    };

    if (encoding) {
      headers['Content-Encoding'] = encoding;
    }

    return new Response(body, { headers });
  }
}

export const metrics = {
  requests: 0,
  httpCacheHits: 0,
  serverCacheHits: 0,
  serverRenderHits: 0,
  responseTimes: []
};
