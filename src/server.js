/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import { watch } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import crypto from 'crypto';
import { promisify } from 'util';
import zlib from 'zlib';
import {
  POSTS_PER_PAGE,
  loadAllContent,
  loadTheme,
  renderContentList,
  renderContent,
  renderTagPage,
  renderCategoryPage,
  renderSeriesPage,
  generateRSS,
  generateSitemap,
  generateSearchIndex,
  getSiteConfig,
  buildNavigationTree,
  normalizeToWebPath,
  processContentFile,
  getAllTags,
  getAllCategories,
  getAllSeries,
  loadEmbeddedTemplates,
  slugify,

  scanAvailableThemes,
  setActiveTheme,
  THYPRESS_FEATURES
} from './renderer.js';
import { optimizeToCache, CACHE_DIR } from './build.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';

const START_PORT = 3009;
const MAX_PORT_TRIES = 100;
const DEBOUNCE_DELAY = 500;

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

// Valid HTTP redirect status codes
const VALID_REDIRECT_CODES = [301, 302, 303, 307, 308];
const DEFAULT_REDIRECT_STATUS = 301;

// FEATURE 1: WebSocket for live reload
const liveReloadClients = new Set();

function shouldIgnore(name) {
  return name.startsWith('.');
}

function isInDraftsFolder(filename) {
  const parts = filename.split(path.sep);
  return parts.includes('drafts');
}

// State
let contentCache = new Map();
let slugMap = new Map();
let navigation = [];
let templatesCache = new Map();
let themeAssets = new Map();
let activeTheme = null;
let siteConfig = getSiteConfig();
let imageReferences = new Map();
let brokenImages = [];
let contentMode = 'structured';
let contentRoot = '';

// FEATURE 4: Enhanced redirect rules with status codes
let redirectRules = new Map(); // Map<from, { to, statusCode }>

/**
 * Load redirect rules from redirects.json
 * Supports both simple and advanced formats
 */
function loadRedirects() {
  const redirectsPath = path.join(process.cwd(), 'redirects.json');

  if (!fsSync.existsSync(redirectsPath)) {
    return;
  }

  try {
    const redirectsData = JSON.parse(fsSync.readFileSync(redirectsPath, 'utf-8'));
    redirectRules = new Map();

    for (const [from, toData] of Object.entries(redirectsData)) {
      // Skip comment keys
      if (from.startsWith('_')) continue;

      let to, statusCode;

      if (typeof toData === 'string') {
        // Simple format: { "/old": "/new" }
        to = toData;
        statusCode = DEFAULT_REDIRECT_STATUS;
      } else if (typeof toData === 'object' && toData.to) {
        // Advanced format: { "/old": { "to": "/new", "statusCode": 302 } }
        to = toData.to;
        statusCode = toData.statusCode || DEFAULT_REDIRECT_STATUS;
      } else {
        console.log(warning(`Invalid redirect rule for "${from}", skipping`));
        continue;
      }

      // Validate status code
      if (!VALID_REDIRECT_CODES.includes(statusCode)) {
        console.log(warning(`Invalid status code ${statusCode} for "${from}", using ${DEFAULT_REDIRECT_STATUS}`));
        statusCode = DEFAULT_REDIRECT_STATUS;
      }

      redirectRules.set(from, { to, statusCode });
    }

    if (redirectRules.size > 0) {
      console.log(success(`Loaded ${redirectRules.size} redirect rules`));

      // Show status code breakdown
      const statusBreakdown = Array.from(redirectRules.values()).reduce((acc, rule) => {
        acc[rule.statusCode] = (acc[rule.statusCode] || 0) + 1;
        return acc;
      }, {});

      console.log(dim(`  Status codes: ${Object.entries(statusBreakdown).map(([code, count]) => `${count}×${code}`).join(', ')}`));
    }

  } catch (error) {
    console.error(errorMsg(`Failed to load redirects: ${error.message}`));
  }
}

/**
 * Match a request path against redirect rules
 * Supports exact matches and :param patterns
 * Returns { to, statusCode } or null
 */
function matchRedirect(requestPath) {
  // Try exact match first (fastest)
  if (redirectRules.has(requestPath)) {
    return redirectRules.get(requestPath);
  }

  // Try pattern matching with :param
  for (const [from, redirect] of redirectRules) {
    // Skip if no parameters
    if (!from.includes(':')) continue;

    // Convert :param to regex capture groups
    const pattern = from.replace(/:\w+/g, '([^/]+)');
    const regex = new RegExp(`^${pattern}$`);
    const match = requestPath.match(regex);

    if (match) {
      // Replace :params in destination with captured values
      let destination = redirect.to;
      const params = from.match(/:\w+/g) || [];

      params.forEach((param, i) => {
        destination = destination.replace(param, match[i + 1]);
      });

      return {
        to: destination,
        statusCode: redirect.statusCode
      };
    }
  }

  return null;
}

// Performance caches
const renderedCache = new Map();
const precompressedCache = new Map();
const staticAssetCache = new Map();
const dynamicContentCache = new Map();
const MAX_CACHE_SIZE = 50 * 1024 * 1024;
let currentCacheSize = 0;

// Build state
let isBuildingStatic = false;
let isOptimizingImages = false;
let optimizeDebounceTimer = null;

// Metrics
const metrics = {
  requests: 0,
  httpCacheHits: 0,
  serverCacheHits: 0,
  serverRenderHits: 0,
  responseTimes: []
};

setInterval(() => {
  if (metrics.requests > 0) {
    const totalCacheHits = metrics.httpCacheHits + metrics.serverCacheHits;
    const totalAttempts = totalCacheHits + metrics.serverRenderHits;
    const hitRate = totalAttempts > 0 ? ((totalCacheHits / totalAttempts) * 100).toFixed(1) : '0.0';
    const avgTime = metrics.responseTimes.length > 0
      ? (metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length).toFixed(2)
      : '0.00';

    console.log(dim(`[live] ${metrics.requests} req/10s | Avg: ${avgTime}ms | Cache: ${hitRate}% (HTTP304: ${metrics.httpCacheHits}, Cached: ${metrics.serverCacheHits}, Rendered: ${metrics.serverRenderHits})`));
  }
  metrics.requests = 0;
  metrics.httpCacheHits = 0;
  metrics.serverCacheHits = 0;
  metrics.serverRenderHits = 0;
  metrics.responseTimes = [];
}, 10000);

function getMimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const types = {
    'html': 'text/html; charset=utf-8',
    'css': 'text/css',
    'js': 'text/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'webp': 'image/webp',
    'xml': 'application/xml; charset=utf-8',
    'txt': 'text/plain; charset=utf-8'
  };
  return types[ext] || 'application/octet-stream';
}

function generateETag(content) {
  return `"${crypto.createHash('md5').update(content).digest('hex')}"`;
}

function getCacheControl(type) {
  if (type.includes('image') || type.includes('font') || type === 'text/css' || type === 'text/javascript') {
    return 'public, max-age=31536000, immutable';
  }
  if (type === 'text/html') {
    return 'public, max-age=3600';
  }
  return 'public, max-age=300';
}

async function compressContent(content, acceptEncoding) {
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

  const supportsBrotli = acceptEncoding && acceptEncoding.includes('br');
  const supportsGzip = acceptEncoding && acceptEncoding.includes('gzip');

  if (supportsBrotli) {
    return {
      content: await brotliCompress(contentBuffer),
      encoding: 'br'
    };
  } else if (supportsGzip) {
    return {
      content: await gzip(contentBuffer),
      encoding: 'gzip'
    };
  }

  return {
    content: contentBuffer,
    encoding: null
  };
}

async function serveWithCache(content, mimeType, request, options = {}) {
  const { skipCompression = false, maxAge = null } = options;

  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const etag = generateETag(contentBuffer);
  const acceptEncoding = request.headers.get('accept-encoding') || '';
  const ifNoneMatch = request.headers.get('if-none-match');

  if (ifNoneMatch === etag) {
    metrics.httpCacheHits++;
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': maxAge || getCacheControl(mimeType)
      }
    });
  }

  let finalContent = contentBuffer;
  let contentEncoding = null;

  if (!skipCompression && contentBuffer.length > 1024) {
    const compressed = await compressContent(contentBuffer, acceptEncoding);
    finalContent = compressed.content;
    contentEncoding = compressed.encoding;
  }

  const headers = {
    'Content-Type': mimeType,
    'ETag': etag,
    'Cache-Control': maxAge || getCacheControl(mimeType),
    'Vary': 'Accept-Encoding'
  };

  if (contentEncoding) {
    headers['Content-Encoding'] = contentEncoding;
  }

  return new Response(finalContent, { headers });
}

function servePrecompressed(slug, request, mimeType = 'text/html; charset=utf-8') {
  const acceptEncoding = request.headers.get('accept-encoding') || '';
  const ifNoneMatch = request.headers.get('if-none-match');

  const preferBrotli = acceptEncoding.includes('br');
  const cacheKey = preferBrotli ? `${slug}:br` : `${slug}:gzip`;

  const cached = precompressedCache.get(cacheKey);
  if (!cached) return null;

  if (ifNoneMatch === cached.etag) {
    metrics.httpCacheHits++;
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': cached.etag,
        'Cache-Control': getCacheControl(mimeType)
      }
    });
  }

  metrics.serverCacheHits++;
  return new Response(cached.content, {
    headers: {
      'Content-Type': mimeType,
      'Content-Encoding': cached.encoding,
      'ETag': cached.etag,
      'Cache-Control': getCacheControl(mimeType),
      'Vary': 'Accept-Encoding'
    }
  });
}

async function serve404(request) {
  const cacheKey = '404.html';

  if (dynamicContentCache.has(cacheKey)) {
    const cached = dynamicContentCache.get(cacheKey);
    const response = await serveWithCache(cached.content, 'text/html; charset=utf-8', request);
    return new Response(response.body, {
      status: 404,
      headers: response.headers
    });
  }

  const custom404Path = path.join(process.cwd(), 'templates', activeTheme || '.default', '404.html');
  let content404 = null;

  if (fsSync.existsSync(custom404Path)) {
    try {
      content404 = await fs.readFile(custom404Path, 'utf-8');
    } catch (error) {}
  }

  if (!content404) {
    const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();
    content404 = EMBEDDED_TEMPLATES['404.html'] || 'Not Found';
  }

  dynamicContentCache.set(cacheKey, { content: content404 });

  const response = await serveWithCache(content404, 'text/html; charset=utf-8', request);
  return new Response(response.body, {
    status: 404,
    headers: response.headers
  });
}

async function preRenderAllContent() {
  console.log(info('Pre-rendering all pages...'));

  renderedCache.clear();

  for (const [slug, content] of contentCache) {
    try {
      if (content.type === 'html' && content.renderedHtml !== null) {
        renderedCache.set(slug, content.renderedHtml);
      } else {
        const html = renderContent(content, slug, templatesCache, navigation, siteConfig, contentCache);
        renderedCache.set(slug, html);
      }
    } catch (error) {
      console.error(errorMsg(`Failed to pre-render ${slug}: ${error.message}`));
    }
  }

  const totalPages = Math.ceil(contentCache.size / POSTS_PER_PAGE);
  for (let page = 1; page <= totalPages; page++) {
    try {
      const html = renderContentList(contentCache, page, templatesCache, navigation, siteConfig);
      renderedCache.set(`__index_${page}`, html);
    } catch (error) {
      console.error(errorMsg(`Failed to pre-render page ${page}: ${error.message}`));
    }
  }

  const allTags = getAllTags(contentCache);
  for (const tag of allTags) {
    try {
      const html = renderTagPage(contentCache, tag, templatesCache, navigation);
      renderedCache.set(`__tag_${tag}`, html);
    } catch (error) {
      console.error(errorMsg(`Failed to pre-render tag ${tag}: ${error.message}`));
    }
  }

  const allCategories = getAllCategories(contentCache);
  for (const category of allCategories) {
    try {
      const html = renderCategoryPage(contentCache, category, templatesCache, navigation);
      renderedCache.set(`__category_${category}`, html);
    } catch (error) {
      console.error(errorMsg(`Failed to pre-render category ${category}: ${error.message}`));
    }
  }

  const allSeries = getAllSeries(contentCache);
  for (const series of allSeries) {
    try {
      const html = renderSeriesPage(contentCache, series, templatesCache, navigation);
      renderedCache.set(`__series_${slugify(series)}`, html);
    } catch (error) {
      console.error(errorMsg(`Failed to pre-render series ${series}: ${error.message}`));
    }
  }

  console.log(success(`Pre-rendered ${renderedCache.size} pages`));
}

async function preCompressContent() {
  console.log(info('Pre-compressing content...'));

  precompressedCache.clear();

  for (const [slug, html] of renderedCache) {
    const buffer = Buffer.from(html);
    const etag = generateETag(buffer);

    try {
      const gzipped = await gzip(buffer);
      precompressedCache.set(`${slug}:gzip`, {
        content: gzipped,
        encoding: 'gzip',
        etag: etag
      });

      const brotlied = await brotliCompress(buffer);
      precompressedCache.set(`${slug}:br`, {
        content: brotlied,
        encoding: 'br',
        etag: etag
      });
    } catch (error) {
      console.error(errorMsg(`Failed to compress ${slug}: ${error.message}`));
    }
  }

  console.log(success(`Pre-compressed ${renderedCache.size} pages (${precompressedCache.size / 2} × 2 formats)`));
}

async function reloadContent() {
  const result = loadAllContent();
  contentCache = result.contentCache;
  slugMap = result.slugMap;
  navigation = result.navigation;
  imageReferences = result.imageReferences;
  brokenImages = result.brokenImages;
  contentMode = result.mode;
  contentRoot = result.contentRoot;

  invalidateDynamicCaches();

  await preRenderAllContent();
  await preCompressContent();

  scheduleImageOptimization();

  // FEATURE 1: Notify live reload clients
  broadcastReload();
}

function invalidateDynamicCaches() {
  dynamicContentCache.delete('search.json');
  dynamicContentCache.delete('rss.xml');
  dynamicContentCache.delete('sitemap.xml');
  console.log(dim('[Cache] Invalidated dynamic content caches'));
}

function scheduleImageOptimization() {
  clearTimeout(optimizeDebounceTimer);
  optimizeDebounceTimer = setTimeout(async () => {
    if (!isOptimizingImages) {
      isOptimizingImages = true;
      await optimizeToCache(imageReferences, brokenImages);
      isOptimizingImages = false;
    }
  }, DEBOUNCE_DELAY);
}

// REPLACE the existing reloadTheme() function in server.js with this safe version:

async function reloadTheme() {
  const config = getSiteConfig();

  try {
    console.log(info(`Loading theme: ${config.theme || 'auto-detect'}...`));

    // Load into TEMPORARY variables
    const newTheme = await loadTheme(config.theme);

    // VALIDATE before replacing (skip for .default)
    if (newTheme.activeTheme && newTheme.activeTheme !== '.default' && newTheme.validation && !newTheme.validation.valid) {
      console.log('');
      console.error(errorMsg(`❌ Theme "${newTheme.activeTheme}" validation failed`));
      console.log('');

      // Show errors
      if (newTheme.validation.errors.length > 0) {
        console.log(errorMsg('Errors:'));
        newTheme.validation.errors.forEach(err => {
          console.log(dim(`  • ${err}`));
        });
        console.log('');
      }

      // Show warnings
      if (newTheme.validation.warnings.length > 0) {
        console.log(warning('Warnings:'));
        newTheme.validation.warnings.forEach(warn => {
          console.log(dim(`  • ${warn}`));
        });
        console.log('');
      }

      // Check forceTheme config
      if (config.forceTheme !== true) {
        console.log(info('Fix:'));
        console.log(dim('  1. Fix the errors listed above'));
        console.log(dim('  2. Set forceTheme: true in config.json (not recommended)'));
        console.log(dim('  3. Switch to a different theme'));
        console.log('');
        console.log(warning('  Keeping previous working theme loaded'));
        return; // ← ABORT reload, keep old theme
      } else {
        console.log('');
        console.log(warning('  forceTheme enabled - loading broken theme anyway'));
        console.log(warning('Pages may fail to render or show errors'));
        console.log('');
      }
    }

    // Show warnings even for valid themes
    if (newTheme.validation && newTheme.validation.warnings.length > 0) {
      console.log(warning(`Theme "${newTheme.activeTheme}" has warnings:`));
      newTheme.validation.warnings.forEach(warn => {
        console.log(dim(`  • ${warn}`));
      });
      console.log('');
    }

    // ONLY NOW replace global state (validation passed or forced)
    templatesCache = newTheme.templatesCache;
    themeAssets = newTheme.themeAssets;
    activeTheme = newTheme.activeTheme;

    dynamicContentCache.delete('404.html');

    await preRenderAllContent();
    await preCompressContent();

    console.log(success(`✓ Theme "${activeTheme}" loaded successfully`));
    broadcastReload();

  } catch (error) {
    console.log('');
    console.error(errorMsg(`Failed to reload theme: ${error.message}`));
    console.log(warning('  Keeping previous theme loaded'));
    console.log('');
    // Don't crash server, keep old theme
  }
}

// FEATURE 1: Live reload broadcast
function broadcastReload() {
  liveReloadClients.forEach(ws => {
    try {
      ws.send('reload');
    } catch (error) {
      // Client disconnected
      liveReloadClients.delete(ws);
    }
  });
}

// FEATURE 1: Inject live reload script
function injectLiveReloadScript(html) {
  const script = `
<script>
(function() {
  const ws = new WebSocket('ws://' + location.host + '/__live_reload');
  ws.onmessage = function(e) {
    if (e.data === 'reload') {
      console.log('[THYPRESS] Reloading page...');
      location.reload();
    }
  };
  ws.onerror = function() {
    console.log('[THYPRESS] Live reload disconnected');
  };
})();
</script>
</body>`;

  return html.replace('</body>', script);
}

function loadSingleContent(filename) {
  const webPath = normalizeToWebPath(filename);
  if (!/\.(md|txt|html)$/i.test(webPath)) return;

  try {
    const fullPath = path.join(contentRoot, filename);
    const result = processContentFile(fullPath, filename, contentMode, contentRoot, siteConfig);

    if (!result) {
      console.log(dim(`Skipped draft: ${path.basename(filename)}`));
      return;
    }

    contentCache.set(result.slug, result.content);
    slugMap.set(webPath, result.slug);

    if (result.imageReferences.length > 0) {
      imageReferences.set(webPath, result.imageReferences);
    }

    console.log(success(`Content '${path.basename(filename)}' loaded`));
    invalidateDynamicCaches();
  } catch (error) {
    console.error(errorMsg(`Error loading '${path.basename(filename)}': ${error.message}`));
  }
}

function resolveHomepage(request) {
  if (siteConfig.index) {
    const customContent = contentCache.get(siteConfig.index);
    if (customContent) {
      const precompressed = servePrecompressed(siteConfig.index, request);
      if (precompressed) return precompressed;

      const preRendered = renderedCache.get(siteConfig.index);
      if (preRendered) {
        metrics.serverCacheHits++;
        const html = injectLiveReloadScript(preRendered);
        return serveWithCache(html, 'text/html; charset=utf-8', request);
      }

      metrics.serverRenderHits++;
      if (customContent.type === 'html' && customContent.renderedHtml !== null) {
        const html = injectLiveReloadScript(customContent.renderedHtml);
        return serveWithCache(html, 'text/html; charset=utf-8', request);
      }
      const html = injectLiveReloadScript(renderContent(customContent, customContent.slug, templatesCache, navigation, siteConfig, contentCache));
      renderedCache.set(siteConfig.index, html);
      return serveWithCache(html, 'text/html; charset=utf-8', request);
    }
  }

  const indexContent = contentCache.get('index');
  if (indexContent) {
    const precompressed = servePrecompressed('index', request);
    if (precompressed) return precompressed;

    const preRendered = renderedCache.get('index');
    if (preRendered) {
      metrics.serverCacheHits++;
      const html = injectLiveReloadScript(preRendered);
      return serveWithCache(html, 'text/html; charset=utf-8', request);
    }

    metrics.serverRenderHits++;
    if (indexContent.type === 'html' && indexContent.renderedHtml !== null) {
      const html = injectLiveReloadScript(indexContent.renderedHtml);
      return serveWithCache(html, 'text/html; charset=utf-8', request);
    }
    const html = injectLiveReloadScript(renderContent(indexContent, 'index', templatesCache, navigation, siteConfig, contentCache));
    renderedCache.set('index', html);
    return serveWithCache(html, 'text/html; charset=utf-8', request);
  }

  const precompressed = servePrecompressed('__index_1', request);
  if (precompressed) return precompressed;

  const preRendered = renderedCache.get('__index_1');
  if (preRendered) {
    metrics.serverCacheHits++;
    const html = injectLiveReloadScript(preRendered);
    return serveWithCache(html, 'text/html; charset=utf-8', request);
  }

  metrics.serverRenderHits++;
  const html = injectLiveReloadScript(renderContentList(contentCache, 1, templatesCache, navigation, siteConfig));
  renderedCache.set('__index_1', html);
  return serveWithCache(html, 'text/html; charset=utf-8', request);
}

// Initialize
console.log(bright('Initializing server...\n'));

const initialLoad = loadAllContent();
contentCache = initialLoad.contentCache;
slugMap = initialLoad.slugMap;
navigation = initialLoad.navigation;
imageReferences = initialLoad.imageReferences;
brokenImages = initialLoad.brokenImages;
contentMode = initialLoad.mode;
contentRoot = initialLoad.contentRoot;

await reloadTheme();
// Validate critical templates are loaded
if (!templatesCache.has('index')) {
  console.log('');
  console.error(errorMsg('FATAL: Missing required template: index.html'));
  console.log('');
  console.log(info('The active theme must provide index.html'));
  console.log(dim('Fix:'));
  console.log(dim('  1. Add index.html to your theme'));
  console.log(dim('  2. Switch theme in config.json'));
  console.log(dim('  3. Set theme: ".default" to use embedded theme'));
  console.log('');
  process.exit(1);
}

if (!templatesCache.has('post')) {
  console.log('');
  console.error(errorMsg('FATAL: Missing required template: post.html'));
  console.log('');
  console.log(info('The active theme must provide post.html'));
  console.log(dim('Fix:'));
  console.log(dim('  1. Add post.html to your theme'));
  console.log(dim('  2. Switch theme in config.json'));
  console.log(dim('  3. Set theme: ".default" to use embedded theme'));
  console.log('');
  process.exit(1);
}

console.log(success('✓ Theme validation passed'));

loadRedirects();

if (!isOptimizingImages && imageReferences.size > 0) {
  isOptimizingImages = true;
  await optimizeToCache(imageReferences, brokenImages);
  isOptimizingImages = false;
}

// Watch content directory
try {
  watch(contentRoot, { recursive: true }, async (event, filename) => {
    if (!filename) return;

    if (shouldIgnore(path.basename(filename))) return;

    if (isInDraftsFolder(filename)) return;

    const webPath = normalizeToWebPath(filename);

    try {
      if (/\.(md|txt|html)$/i.test(webPath)) {
        console.log(info(`Content: ${event} - ${path.basename(filename)}`));

        if (event === 'rename') {
          const fullPath = path.join(contentRoot, filename);

          if (fsSync.existsSync(fullPath)) {
            loadSingleContent(filename);
            navigation = buildNavigationTree(contentRoot, contentCache, contentMode);
            await preRenderAllContent();
            await preCompressContent();
            const result = loadAllContent();
            imageReferences = result.imageReferences;
            scheduleImageOptimization();
          } else {
            const slug = slugMap.get(webPath);
            if (slug) {
              contentCache.delete(slug);
              slugMap.delete(webPath);
              imageReferences.delete(webPath);
              renderedCache.delete(slug);
              precompressedCache.delete(`${slug}:gzip`);
              precompressedCache.delete(`${slug}:br`);
              console.log(success(`Content '${path.basename(filename)}' removed from cache`));
              navigation = buildNavigationTree(contentRoot, contentCache, contentMode);
            }
          }
        } else if (event === 'change') {
          loadSingleContent(filename);
          navigation = buildNavigationTree(contentRoot, contentCache, contentMode);
          await preRenderAllContent();
          await preCompressContent();
          scheduleImageOptimization();
        }
      }

      if (/\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
        console.log(info(`Images: ${event} - ${path.basename(filename)}`));
        scheduleImageOptimization();
      }
    } catch (error) {
      console.error(errorMsg(`Error processing change: ${error.message}`));
    }
  });
  console.log(success(`Watching ${contentRoot} for changes`));
} catch (error) {
  console.error(errorMsg(`Could not watch content directory: ${error.message}`));
}

// Watch theme directory
try {
  const themesDir = path.join(process.cwd(), 'templates');
  if (fsSync.existsSync(themesDir)) {
    watch(themesDir, { recursive: true }, async (event, filename) => {
      if (!filename) return;

      if (shouldIgnore(path.basename(filename))) return;

      console.log(info(`Theme: ${event} - ${filename}`));
      await reloadTheme();
    });
    console.log(success('Watching templates/ for changes'));
  }
} catch (error) {}

// Watch config and redirects
try {
  const configPath = path.join(process.cwd(), 'config.json');
  if (fsSync.existsSync(configPath)) {
    watch(configPath, async (event, filename) => {
      siteConfig = getSiteConfig();
      await reloadTheme();
      invalidateDynamicCaches();
      console.log(success('Config reloaded'));
      broadcastReload();
    });
  }

  const redirectsPath = path.join(process.cwd(), 'redirects.json');
  if (fsSync.existsSync(redirectsPath)) {
    watch(redirectsPath, async (event, filename) => {
      loadRedirects();
      console.log(success('Redirects reloaded'));
    });
  }
} catch (error) {}

function openBrowser(url) {
  const start = process.platform === 'darwin' ? 'open' :
                process.platform === 'win32' ? 'start' :
                'xdg-open';

  exec(`${start} ${url}`, (error) => {
    if (error) {
      console.log(info(`Server running at ${url} (could not auto-open browser)`));
    }
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + MAX_PORT_TRIES; port++) {
    try {
      const testServer = Bun.serve({
        port,
        fetch() {
          return new Response('test');
        }
      });
      testServer.stop();
      return port;
    } catch (error) {
      continue;
    }
  }
  throw new Error('No available port');
}

// FIX 17: PORT environment variable support
let port;

if (process.env.PORT) {
  port = parseInt(process.env.PORT, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(errorMsg(`Invalid PORT value: ${process.env.PORT}`));
    console.log(dim('PORT must be a number between 1-65535'));
    process.exit(1);
  }

  try {
    const testServer = Bun.serve({
      port,
      fetch() { return new Response('test'); }
    });
    testServer.stop();
    console.log(info(`Using PORT from environment: ${port}`));
  } catch (error) {
    console.error(errorMsg(`Port ${port} is already in use`));
    console.log(info('Remove PORT env var to auto-detect available port'));
    process.exit(1);
  }
} else {
  port = await findAvailablePort(START_PORT);

  if (port !== START_PORT) {
    console.log(info(`Port ${START_PORT} in use, using ${port} instead\n`));
  }
}

Bun.serve({
  port,
  async fetch(request, server) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const route = url.pathname;

    try {
      metrics.requests++;

      // FEATURE 1: WebSocket upgrade for live reload
      if (route === '/__live_reload') {
        if (server.upgrade(request)) {
          return;
        }
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      // FEATURE 4: Enhanced redirect handling
      const redirectMatch = matchRedirect(route);
      if (redirectMatch) {
        const { to, statusCode } = redirectMatch;

        // Build full URL for redirect
        const redirectUrl = to.startsWith('http://') || to.startsWith('https://')
          ? to
          : new URL(to, url.origin).toString();

        return Response.redirect(redirectUrl, statusCode);
      }

      // Get available themes
      if (route === '/__thypress/themes' && request.method === 'GET') {
        const themes = scanAvailableThemes();
        const activeThemeId = siteConfig.theme || activeTheme || 'my-press';

        // Mark active theme
        themes.forEach(theme => {
          theme.active = theme.id === activeThemeId;
        });

        return new Response(JSON.stringify(themes), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get THYPRESS features registry
      if (route === '/__thypress/features' && request.method === 'GET') {
        return new Response(JSON.stringify(THYPRESS_FEATURES), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Set active theme with validation
      if (route === '/__thypress/themes/set' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { themeId } = body;

          if (!themeId) {
            return new Response(JSON.stringify({
              success: false,
              error: 'themeId required'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // PRE-VALIDATE theme before committing
          console.log(info(`Validating theme: ${themeId}...`));

          const testTheme = await loadTheme(themeId);

          // Check validation (skip for .default)
          if (testTheme.activeTheme !== '.default' && testTheme.validation && !testTheme.validation.valid) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Theme validation failed',
              errors: testTheme.validation.errors,
              warnings: testTheme.validation.warnings
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // Validation passed - safe to activate
          setActiveTheme(themeId);
          siteConfig = getSiteConfig(); // Reload config

          await reloadTheme();

          return new Response(JSON.stringify({
            success: true,
            message: `Theme "${themeId}" activated`,
            theme: themeId,
            warnings: testTheme.validation?.warnings || []
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Admin page
      if (route === '/__thypress/' || route === '/__thypress') {
        const htmlFiles = Array.from(contentCache.values()).filter(c => c.type === 'html');
        const htmlFilesTable = htmlFiles.length > 0 ? `
<h2>HTML File Handling</h2>
<div class="stats">
  <p><strong>Detection rules:</strong></p>
  <ul style="list-style: disc; margin-left: 20px; line-height: 1.8;">
    <li>Files with <code>&lt;!DOCTYPE html&gt;</code>, <code>&lt;html&gt;</code>, <code>&lt;head&gt;</code>, or <code>&lt;body&gt;</code> → raw (no template)</li>
    <li>Partial HTML (just <code>&lt;div&gt;</code>, <code>&lt;section&gt;</code>, etc) → templated (uses template)</li>
    <li>Front matter <code>template: none</code> → force raw</li>
    <li>Front matter <code>template: post</code> → force templated</li>
  </ul>
</div>

<h3>HTML Files (${htmlFiles.length})</h3>
<div class="stats">
  <table style="width: 100%; border-collapse: collapse;">
    <thead>
      <tr style="border-bottom: 1px solid #ddd;">
        <th style="text-align: left; padding: 8px;">File</th>
        <th style="text-align: left; padding: 8px;">Mode</th>
        <th style="text-align: left; padding: 8px;">Template</th>
      </tr>
    </thead>
    <tbody>
      ${htmlFiles.map(c => {
        const isRaw = c.renderedHtml !== null;
        const template = c.frontMatter?.template || (isRaw ? 'none' : 'post');
        return `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 8px;"><code>${c.filename}</code></td>
            <td style="padding: 8px;">${isRaw ? 'Raw' : 'Templated'}</td>
            <td style="padding: 8px;"><code>${template}</code></td>
          </tr>
        `;
      }).join('')}
    </tbody>
  </table>
</div>` : '';

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>THYPRESS Admin</title>
  <style>
    body {
      font-family: monospace, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
    }
    h1 { color: #2a2a2a; }
    h2 { margin-top: 2rem; border-bottom: 2px solid #ddd; padding-bottom: 0.5rem; }
    .stats {
      background: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .stats p { margin: 10px 0; }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: #1d7484;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      border: none;
      font-size: 16px;
      cursor: pointer;
      margin: 10px 10px 10px 0;
      font-family: inherit;
    }
    .button:hover { background: #982c61; }
    .button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .button-secondary {
      background: #666;
    }
    .button-secondary:hover {
      background: #444;
    }
    #status {
      margin: 20px 0;
      padding: 12px;
      border-radius: 4px;
      display: none;
    }
    #status.info {
      background: #e3f2fd;
      color: #1976d2;
      display: block;
    }
    #status.success {
      background: #e8f5e9;
      color: #388e3c;
      display: block;
    }
    #status.error {
      background: #ffebee;
      color: #d32f2f;
      display: block;
    }
    #status.warning {
      background: #fff3e0;
      color: #f57c00;
      display: block;
    }
    .back {
      color: #1d7484;
      text-decoration: none;
    }
    .back:hover { text-decoration: underline; }

    /* Theme Management Styles */
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1.5rem;
      margin: 2rem 0;
    }
    .theme-card {
      border: 2px solid #ddd;
      border-radius: 8px;
      padding: 1.25rem;
      background: white;
      transition: all 0.2s;
    }
    .theme-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .theme-card.active {
      border-color: #1d7484;
      background: #f0f9fa;
    }
    .theme-card.invalid {
      border-color: #d32f2f;
      background: #fff5f5;
      opacity: 0.8;
    }
    .theme-preview {
      width: 100%;
      height: 140px;
      background: #e0e0e0;
      border-radius: 4px;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #999;
      font-size: 0.9rem;
      overflow: hidden;
    }
    .theme-preview img {
      max-width: 100%;
      max-height: 100%;
      object-fit: cover;
    }
    .theme-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 0.5rem;
      gap: 0.5rem;
    }
    .theme-name {
      font-weight: 600;
      font-size: 1.1rem;
      margin: 0;
      flex: 1;
    }
    .theme-badges {
      display: flex;
      gap: 0.35rem;
      flex-shrink: 0;
    }
    .theme-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-active {
      background: #1d7484;
      color: white;
    }
    .badge-embedded {
      background: #666;
      color: white;
    }
    .badge-invalid {
      background: #d32f2f;
      color: white;
    }
    .theme-meta {
      font-size: 0.85rem;
      color: #666;
      margin: 0.5rem 0;
    }
    .theme-description {
      font-size: 0.9rem;
      color: #555;
      margin: 0.75rem 0;
      line-height: 1.4;
      min-height: 2.8em;
    }
    .theme-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin: 0.75rem 0;
      min-height: 1.5rem;
    }
    .theme-tag {
      padding: 0.2rem 0.5rem;
      background: #e0e0e0;
      border-radius: 12px;
      font-size: 0.7rem;
    }
    .theme-requires {
      font-size: 0.8rem;
      color: #666;
      margin: 0.75rem 0;
      padding: 0.5rem;
      background: #f5f5f5;
      border-radius: 4px;
    }
    .theme-error {
      color: #d32f2f;
      font-size: 0.85rem;
      margin-top: 0.75rem;
      padding: 0.5rem;
      background: #ffebee;
      border-radius: 4px;
    }
    .theme-actions {
      margin-top: 1rem;
      display: flex;
      gap: 0.5rem;
    }
    .theme-link {
      font-size: 0.85rem;
      color: #1d7484;
      text-decoration: none;
    }
    .theme-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <p><a href="/" class="back">← Back to site</a></p>

  <h1>THYPRESS Admin</h1>

  <div class="stats">
    <p><strong>Content files:</strong> ${contentCache.size}</p>
    <p><strong>Mode:</strong> ${contentMode}</p>
    <p><strong>Content root:</strong> ${contentRoot}</p>
    <p><strong>Active theme:</strong> ${activeTheme || '.default (embedded)'}</p>
    <p><strong>Pre-rendered pages:</strong> ${renderedCache.size}</p>
    <p><strong>Pre-compressed:</strong> ${precompressedCache.size / 2} pages × 2 formats</p>
    <p><strong>Images cached:</strong> ${imageReferences.size} files with images</p>
    <p><strong>Static cache:</strong> ${staticAssetCache.size} files (${(currentCacheSize / 1024 / 1024).toFixed(2)} MB)</p>
    <p><strong>Redirect rules:</strong> ${redirectRules.size}</p>
    <p><strong>Live reload:</strong> ${liveReloadClients.size} connected clients</p>
    <p><strong>Server:</strong> http://localhost:${port}</p>
  </div>

  <h2>Theme Management</h2>
  <div id="themes-container">
    <p>Loading themes...</p>
  </div>

  <h2>Build Static Site</h2>
  <p>Generate a complete static build in /build folder for deployment.</p>

  <button id="buildBtn" class="button" onclick="buildSite()">Build Static Site</button>
  <button id="clearCacheBtn" class="button button-secondary" onclick="clearCache()">Clear Cache</button>

  <div id="status"></div>

  <script>
    let themes = [];

    function setStatus(message, type) {
      const status = document.getElementById('status');
      status.textContent = message;
      status.className = type;
    }

    async function loadThemes() {
      try {
        const response = await fetch('/__thypress/themes');
        themes = await response.json();
        renderThemes();
      } catch (error) {
        document.getElementById('themes-container').innerHTML =
          '<p style="color: #d32f2f;">Failed to load themes: ' + error.message + '</p>';
      }
    }

    function renderThemes() {
      const container = document.getElementById('themes-container');

      if (themes.length === 0) {
        container.innerHTML = '<p>No themes found</p>';
        return;
      }

      container.innerHTML = '<div class="theme-grid">' + themes.map(theme => {
        const activeClass = theme.active ? 'active' : '';
        const invalidClass = !theme.valid ? 'invalid' : '';

        return \`
          <div class="theme-card \${activeClass} \${invalidClass}">
            <div class="theme-preview">
              \${theme.preview
                ? '<img src="/templates/' + theme.id + '/' + theme.preview + '" alt="' + theme.name + ' preview">'
                : 'No preview'}
            </div>

            <div class="theme-header">
              <h3 class="theme-name">\${theme.name}</h3>
              <div class="theme-badges">
                \${theme.active ? '<span class="theme-badge badge-active">ACTIVE</span>' : ''}
                \${theme.embedded ? '<span class="theme-badge badge-embedded">EMBEDDED</span>' : ''}
                \${!theme.valid ? '<span class="theme-badge badge-invalid">INVALID</span>' : ''}
              </div>
            </div>

            <div class="theme-meta">
              <strong>Version:</strong> \${theme.version} |
              <strong>By:</strong> \${theme.author}
            </div>

            <p class="theme-description">\${theme.description}</p>

            \${theme.tags && theme.tags.length > 0 ? \`
              <div class="theme-tags">
                \${theme.tags.map(tag => '<span class="theme-tag">' + tag + '</span>').join('')}
              </div>
            \` : '<div class="theme-tags"></div>'}

            \${theme.requires && theme.requires.length > 0 ? \`
              <div class="theme-requires">
                <strong>Requires:</strong> \${theme.requires.join(', ')}
              </div>
            \` : ''}

            \${!theme.valid && theme.error ? \`
              <div class="theme-error">
                [fail] \${theme.error}
              </div>
            \` : ''}

            <div class="theme-actions">
              \${!theme.active && theme.valid ? \`
                <button class="button" onclick="activateTheme('\${theme.id}')">
                  Activate Theme
                </button>
              \` : ''}

              \${theme.homepage ? \`
                <a href="\${theme.homepage}" target="_blank" class="theme-link">Homepage →</a>
              \` : ''}
            </div>
          </div>
        \`;
      }).join('') + '</div>';
    }

    async function activateTheme(themeId) {
      setStatus('Validating and activating theme...', 'info');

      try {
        const response = await fetch('/__thypress/themes/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ themeId })
        });

        const data = await response.json();

        if (data.success) {
          let message = 'Theme activated: ' + themeId;
          if (data.warnings && data.warnings.length > 0) {
            message += ' (with warnings - check console)';
          }
          message += '. Reloading...';
          setStatus(message, 'success');
          setTimeout(() => location.reload(), 1000);
        } else {
          let errorMsg = 'Failed to activate theme: ' + data.error;
          if (data.errors && data.errors.length > 0) {
            errorMsg += '\\n\\nErrors:\\n' + data.errors.join('\\n');
          }
          if (data.warnings && data.warnings.length > 0) {
            errorMsg += '\\n\\nWarnings:\\n' + data.warnings.join('\\n');
          }
          setStatus(errorMsg, 'error');
        }
      } catch (error) {
        setStatus('Failed to activate theme: ' + error.message, 'error');
      }
    }

    async function buildSite() {
      const btn = document.getElementById('buildBtn');
      btn.disabled = true;
      setStatus('Building static site... This may take a moment.', 'info');

      try {
        const response = await fetch('/__thypress/build', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
          setStatus('Build complete! Check the /build folder.', 'success');
        } else {
          setStatus('Build failed: ' + data.error, 'error');
        }
      } catch (error) {
        setStatus('Build failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function clearCache() {
      const btn = document.getElementById('clearCacheBtn');
      btn.disabled = true;
      setStatus('Clearing cache...', 'info');

      try {
        const response = await fetch('/__thypress/clear-cache', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
          setStatus('Cache cleared! Freed ' + data.freed + ' items. Reloading...', 'success');
          setTimeout(() => location.reload(), 1000);
        } else {
          setStatus('Clear cache failed: ' + data.error, 'error');
        }
      } catch (error) {
        setStatus('Clear cache failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    // Load themes on page load
    loadThemes();
  </script>
</body>
</html>`;
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Build endpoint
      if (route === '/__thypress/build' && request.method === 'POST') {
        if (isBuildingStatic) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Build already in progress'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        isBuildingStatic = true;

        try {
          const buildModule = await import('./build.js');
          await buildModule.build();

          return new Response(JSON.stringify({
            success: true,
            message: 'Build complete'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } finally {
          isBuildingStatic = false;
        }
      }

      // Clear cache endpoint
      if (route === '/__thypress/clear-cache' && request.method === 'POST') {
        const itemsFreed = staticAssetCache.size + dynamicContentCache.size + renderedCache.size + precompressedCache.size;
        staticAssetCache.clear();
        dynamicContentCache.clear();
        renderedCache.clear();
        precompressedCache.clear();
        currentCacheSize = 0;

        await preRenderAllContent();
        await preCompressContent();

        return new Response(JSON.stringify({
          success: true,
          freed: itemsFreed
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Serve optimized images from .cache/
      if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(route)) {
        const imagePath = route.substring(1);
        const cachedPath = path.join(CACHE_DIR, imagePath);

        try {
          const cacheKey = `image:${cachedPath}`;
          if (staticAssetCache.has(cacheKey)) {
            metrics.httpCacheHits++;
            const cached = staticAssetCache.get(cacheKey);
            return serveWithCache(cached.content, cached.mimeType, request);
          }

          if (fsSync.existsSync(cachedPath)) {
            const fileContents = await fs.readFile(cachedPath);
            const mimeType = getMimeType(cachedPath);

            if (fileContents.length < 5 * 1024 * 1024) {
              staticAssetCache.set(cacheKey, {
                content: fileContents,
                mimeType: mimeType
              });
              currentCacheSize += fileContents.length;

              if (currentCacheSize > MAX_CACHE_SIZE) {
                const firstKey = staticAssetCache.keys().next().value;
                const firstItem = staticAssetCache.get(firstKey);
                currentCacheSize -= firstItem.content.length;
                staticAssetCache.delete(firstKey);
              }
            }

            metrics.serverCacheHits++;
            return serveWithCache(fileContents, mimeType, request);
          }
        } catch (error) {
          console.error(errorMsg(`Error serving image: ${error.message}`));
        }
      }

      // Serve theme assets from /assets/
      if (route.startsWith('/assets/')) {
        const assetPath = route.substring(8);

        if (themeAssets.has(assetPath)) {
          const asset = themeAssets.get(assetPath);

          if (asset.type === 'template') {
            const rendered = asset.compiled({
              siteUrl: siteConfig.url || 'https://example.com',
              siteTitle: siteConfig.title || 'My Site',
              ...siteConfig,
              ...siteConfig.theme
            });
            return serveWithCache(rendered, getMimeType(assetPath), request);
          } else {
            return serveWithCache(asset.content, getMimeType(assetPath), request);
          }
        }

        const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();
        const assetName = path.basename(assetPath);
        if (EMBEDDED_TEMPLATES[assetName]) {
          return serveWithCache(EMBEDDED_TEMPLATES[assetName], getMimeType(assetPath), request);
        }
      }

      // Search index JSON
      if (route === '/search.json') {
        const cacheKey = 'search.json';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.serverCacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/json; charset=utf-8', request);
        }

        metrics.serverRenderHits++;
        const searchIndex = generateSearchIndex(contentCache);
        dynamicContentCache.set(cacheKey, { content: searchIndex });

        return serveWithCache(searchIndex, 'application/json; charset=utf-8', request);
      }

      // RSS feed
      if (route === '/rss.xml') {
        const cacheKey = 'rss.xml';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.serverCacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/xml; charset=utf-8', request);
        }

        metrics.serverRenderHits++;
        const rss = generateRSS(contentCache, siteConfig);
        dynamicContentCache.set(cacheKey, { content: rss });

        return serveWithCache(rss, 'application/xml; charset=utf-8', request);
      }

      // Sitemap
      if (route === '/sitemap.xml') {
        const cacheKey = 'sitemap.xml';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.serverCacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/xml; charset=utf-8', request);
        }

        metrics.serverRenderHits++;
        const sitemap = await generateSitemap(contentCache, siteConfig);
        dynamicContentCache.set(cacheKey, { content: sitemap });

        return serveWithCache(sitemap, 'application/xml; charset=utf-8', request);
      }

      // robots.txt and llms.txt
      if (route === '/robots.txt' || route === '/llms.txt') {
        const filename = route.substring(1);

        if (themeAssets.has(filename)) {
          const asset = themeAssets.get(filename);

          if (asset.type === 'template') {
            const rendered = asset.compiled({
              siteUrl: siteConfig.url || 'https://example.com',
              ...siteConfig
            });
            return serveWithCache(rendered, 'text/plain; charset=utf-8', request);
          } else {
            return serveWithCache(asset.content, 'text/plain; charset=utf-8', request);
          }
        }

        const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();
        if (EMBEDDED_TEMPLATES[filename]) {
          const Handlebars = await import('handlebars');
          const template = Handlebars.default.compile(EMBEDDED_TEMPLATES[filename]);
          const rendered = template({
            siteUrl: siteConfig.url || 'https://example.com',
            ...siteConfig
          });
          return serveWithCache(rendered, 'text/plain; charset=utf-8', request);
        }
      }

      // Tag pages
      if (route.startsWith('/tag/')) {
        const tag = route.substring(5).replace(/\/$/, '');
        const cacheKey = `__tag_${tag}`;

        const precompressed = servePrecompressed(cacheKey, request);
        if (precompressed) return precompressed;

        const preRendered = renderedCache.get(cacheKey);
        if (preRendered) {
          metrics.serverCacheHits++;
          const html = injectLiveReloadScript(preRendered);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        }

        try {
          metrics.serverRenderHits++;
          const html = injectLiveReloadScript(renderTagPage(contentCache, tag, templatesCache, navigation));
          renderedCache.set(cacheKey, html);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // Category pages
      if (route.startsWith('/category/')) {
        const category = route.substring(10).replace(/\/$/, '');
        const cacheKey = `__category_${category}`;

        const precompressed = servePrecompressed(cacheKey, request);
        if (precompressed) return precompressed;

        const preRendered = renderedCache.get(cacheKey);
        if (preRendered) {
          metrics.serverCacheHits++;
          const html = injectLiveReloadScript(preRendered);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        }

        try {
          metrics.serverRenderHits++;
          const html = injectLiveReloadScript(renderCategoryPage(contentCache, category, templatesCache, navigation));
          renderedCache.set(cacheKey, html);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // Series pages
      if (route.startsWith('/series/')) {
        const seriesSlug = route.substring(8).replace(/\/$/, '');
        const cacheKey = `__series_${seriesSlug}`;

        const precompressed = servePrecompressed(cacheKey, request);
        if (precompressed) return precompressed;

        const preRendered = renderedCache.get(cacheKey);
        if (preRendered) {
          metrics.serverCacheHits++;
          const html = injectLiveReloadScript(preRendered);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        }

        try {
          metrics.serverRenderHits++;
          const allSeries = getAllSeries(contentCache);
          const series = allSeries.find(s => slugify(s) === seriesSlug);
          if (!series) {
            return serve404(request);
          }
          const html = injectLiveReloadScript(renderSeriesPage(contentCache, series, templatesCache, navigation));
          renderedCache.set(cacheKey, html);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // Pagination routes
      if (route.startsWith('/page/')) {
        const pageMatch = route.match(/^\/page\/(\d+)\/?$/);
        if (pageMatch) {
          const page = parseInt(pageMatch[1], 10);
          const cacheKey = `__index_${page}`;

          const precompressed = servePrecompressed(cacheKey, request);
          if (precompressed) return precompressed;

          const preRendered = renderedCache.get(cacheKey);
          if (preRendered) {
            metrics.serverCacheHits++;
            const html = injectLiveReloadScript(preRendered);
            return serveWithCache(html, 'text/html; charset=utf-8', request);
          }

          try {
            metrics.serverRenderHits++;
            const html = injectLiveReloadScript(renderContentList(contentCache, page, templatesCache, navigation, siteConfig));
            renderedCache.set(cacheKey, html);
            return serveWithCache(html, 'text/html; charset=utf-8', request);
          } catch (error) {
            return new Response(`Error: ${error.message}`, { status: 500 });
          }
        }
      }

      // Homepage
      if (route === '/') {
        return resolveHomepage(request);
      }

      // Article pages
      const slug = route.substring(1).replace(/\/$/, '');
      const content = contentCache.get(slug);

      if (content) {
        const precompressed = servePrecompressed(slug, request);
        if (precompressed) return precompressed;

        const preRendered = renderedCache.get(slug);
        if (preRendered) {
          metrics.serverCacheHits++;
          const html = injectLiveReloadScript(preRendered);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        }

        try {
          metrics.serverRenderHits++;
          if (content.type === 'html' && content.renderedHtml !== null) {
            const html = injectLiveReloadScript(content.renderedHtml);
            renderedCache.set(slug, html);
            return serveWithCache(html, 'text/html; charset=utf-8', request);
          }

          const html = injectLiveReloadScript(renderContent(content, slug, templatesCache, navigation, siteConfig, contentCache));
          renderedCache.set(slug, html);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // Try to serve as static file from content/
      const staticFilePath = path.join(contentRoot, route.substring(1));
      if (fsSync.existsSync(staticFilePath) && fsSync.statSync(staticFilePath).isFile()) {
        try {
          const fileContents = await fs.readFile(staticFilePath);
          const mimeType = getMimeType(staticFilePath);
          return serveWithCache(fileContents, mimeType, request);
        } catch (error) {}
      }

      // 404
      return serve404(request);
    } catch (error) {
      console.error(errorMsg(`Request error: ${error.message}`));
      return new Response('Internal Server Error', { status: 500 });
    } finally {
      const responseTime = Date.now() - startTime;
      metrics.responseTimes.push(responseTime);
    }
  },

  // FEATURE 1: WebSocket handler
  websocket: {
    open(ws) {
      liveReloadClients.add(ws);
    },
    close(ws) {
      liveReloadClients.delete(ws);
    },
    message(ws, message) {
      // No-op
    }
  }
});

const serverUrl = `http://localhost:${port}`;

console.log(bright(`
• Server running on ${serverUrl}
• Content mode: ${contentMode}
• Content root: ${contentRoot}
• Active theme: ${activeTheme || '.default (embedded)'}
• Pre-rendered: ${renderedCache.size} pages
• Pre-compressed: ${precompressedCache.size / 2} pages × 2 formats
• Live reload: enabled
• Redirects: ${redirectRules.size} rules
• Admin panel: ${serverUrl}/__thypress/
`));

const shouldOpenBrowser = process.env.THYPRESS_OPEN_BROWSER === 'true';
if (shouldOpenBrowser) {
  console.log(info('Opening browser...\n'));
  openBrowser(serverUrl);
}
