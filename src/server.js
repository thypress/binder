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
  generateRSS,
  generateSitemap,
  generateSearchIndex,
  getSiteConfig,
  buildNavigationTree,
  normalizeToWebPath,
  processContentFile,
  getAllTags,
  loadEmbeddedTemplates
} from './renderer.js';
import { optimizeToCache, CACHE_DIR } from './build.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const START_PORT = 3009;
const MAX_PORT_TRIES = 100;
const DEBOUNCE_DELAY = 500;

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

/**
 * Check if file/folder should be ignored (starts with .)
 */
function shouldIgnore(name) {
  return name.startsWith('.');
}

/**
 * Check if path contains drafts folder
 */
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

// Metrics - FIXED: Split into meaningful categories
const metrics = {
  requests: 0,
  httpCacheHits: 0,      // HTTP 304 (ETag match)
  serverCacheHits: 0,    // HTTP 200 (served from cache)
  serverRenderHits: 0,   // HTTP 200 (had to render)
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

// FIXED: Now properly tracks HTTP 304 vs cached serving
function servePrecompressed(slug, request, mimeType = 'text/html; charset=utf-8') {
  const acceptEncoding = request.headers.get('accept-encoding') || '';
  const ifNoneMatch = request.headers.get('if-none-match');

  const preferBrotli = acceptEncoding.includes('br');
  const cacheKey = preferBrotli ? `${slug}:br` : `${slug}:gzip`;

  const cached = precompressedCache.get(cacheKey);
  if (!cached) return null;

  if (ifNoneMatch === cached.etag) {
    metrics.httpCacheHits++;  // HTTP 304
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': cached.etag,
        'Cache-Control': getCacheControl(mimeType)
      }
    });
  }

  metrics.serverCacheHits++;  // HTTP 200 from cache
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

async function reloadTheme() {
  const config = getSiteConfig();
  const result = await loadTheme(config.theme);
  templatesCache = result.templatesCache;
  themeAssets = result.themeAssets;
  activeTheme = result.activeTheme;

  dynamicContentCache.delete('404.html');

  await preRenderAllContent();
  await preCompressContent();
}

function loadSingleContent(filename) {
  const webPath = normalizeToWebPath(filename);
  if (!/\.(md|txt|html)$/i.test(webPath)) return;

  try {
    const fullPath = path.join(contentRoot, filename);
    const result = processContentFile(fullPath, filename, contentMode, contentRoot);

    // Skip if null (draft)
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

// FIXED: Use three-tier cache (precompressed → rendered → render fresh)
function resolveHomepage(request) {
  if (siteConfig.index) {
    const customContent = contentCache.get(siteConfig.index);
    if (customContent) {
      // Tier 1: Precompressed
      const precompressed = servePrecompressed(siteConfig.index, request);
      if (precompressed) return precompressed;

      // Tier 2: Rendered cache
      const preRendered = renderedCache.get(siteConfig.index);
      if (preRendered) {
        metrics.serverCacheHits++;
        return serveWithCache(preRendered, 'text/html; charset=utf-8', request);
      }

      // Tier 3: Render fresh
      metrics.serverRenderHits++;
      if (customContent.type === 'html' && customContent.renderedHtml !== null) {
        return serveWithCache(customContent.renderedHtml, 'text/html; charset=utf-8', request);
      }
      const html = renderContent(customContent, customContent.slug, templatesCache, navigation, siteConfig, contentCache);
      renderedCache.set(siteConfig.index, html);
      return serveWithCache(html, 'text/html; charset=utf-8', request);
    }
  }

  const indexContent = contentCache.get('index');
  if (indexContent) {
    // Tier 1: Precompressed
    const precompressed = servePrecompressed('index', request);
    if (precompressed) return precompressed;

    // Tier 2: Rendered cache
    const preRendered = renderedCache.get('index');
    if (preRendered) {
      metrics.serverCacheHits++;
      return serveWithCache(preRendered, 'text/html; charset=utf-8', request);
    }

    // Tier 3: Render fresh
    metrics.serverRenderHits++;
    if (indexContent.type === 'html' && indexContent.renderedHtml !== null) {
      return serveWithCache(indexContent.renderedHtml, 'text/html; charset=utf-8', request);
    }
    const html = renderContent(indexContent, 'index', templatesCache, navigation, siteConfig, contentCache);
    renderedCache.set('index', html);
    return serveWithCache(html, 'text/html; charset=utf-8', request);
  }

  // Default index listing
  // Tier 1: Precompressed
  const precompressed = servePrecompressed('__index_1', request);
  if (precompressed) return precompressed;

  // Tier 2: Rendered cache
  const preRendered = renderedCache.get('__index_1');
  if (preRendered) {
    metrics.serverCacheHits++;
    return serveWithCache(preRendered, 'text/html; charset=utf-8', request);
  }

  // Tier 3: Render fresh
  metrics.serverRenderHits++;
  const html = renderContentList(contentCache, 1, templatesCache, navigation, siteConfig);
  renderedCache.set('__index_1', html);
  return serveWithCache(html, 'text/html; charset=utf-8', request);
}

// Initialize - FIXED ORDER
console.log(bright('Initializing server...\n'));

// Load content first (metadata only, no rendering)
const initialLoad = loadAllContent();
contentCache = initialLoad.contentCache;
slugMap = initialLoad.slugMap;
navigation = initialLoad.navigation;
imageReferences = initialLoad.imageReferences;
brokenImages = initialLoad.brokenImages;
contentMode = initialLoad.mode;
contentRoot = initialLoad.contentRoot;

// Load theme second (this will trigger pre-rendering with templates available)
await reloadTheme();

// Optimize images after everything is loaded
if (!isOptimizingImages && imageReferences.size > 0) {
  isOptimizingImages = true;
  await optimizeToCache(imageReferences, brokenImages);
  isOptimizingImages = false;
}

// Watch content directory
try {
  watch(contentRoot, { recursive: true }, async (event, filename) => {
    if (!filename) return;

    // Skip hidden files/folders
    if (shouldIgnore(path.basename(filename))) return;

    // Skip drafts folders
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

      // Skip hidden files/folders
      if (shouldIgnore(path.basename(filename))) return;

      console.log(info(`Theme: ${event} - ${filename}`));
      await reloadTheme();
    });
    console.log(success('Watching templates/ for changes'));
  }
} catch (error) {}

// Watch config
try {
  const configPath = path.join(process.cwd(), 'config.json');
  if (fsSync.existsSync(configPath)) {
    watch(configPath, async (event, filename) => {
      siteConfig = getSiteConfig();
      await reloadTheme();
      invalidateDynamicCaches();
      console.log(success('Config reloaded'));
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

const port = await findAvailablePort(START_PORT);

if (port !== START_PORT) {
  console.log(info(`Port ${START_PORT} in use, using ${port} instead\n`));
}

Bun.serve({
  port,
  async fetch(request) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const route = url.pathname;

    try {
      metrics.requests++;

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
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
    }
    h1 { color: #2a2a2a; }
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
      font-family: monospace, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .button:hover { background: #982c61; }
    .button:disabled {
      background: #ccc;
      cursor: not-allowed;
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
    .back {
      color: #1d7484;
      text-decoration: none;
    }
    .back:hover { text-decoration: underline; }
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
    <p><strong>Server:</strong> http://localhost:${port}</p>
  </div>

  ${htmlFilesTable}

  <h2>Build Static Site</h2>
  <p>Generate a complete static build in /build folder for deployment.</p>

  <button id="buildBtn" class="button" onclick="buildSite()">Build Static Site</button>
  <button id="clearCacheBtn" class="button" onclick="clearCache()">Clear Cache</button>

  <div id="status"></div>

  <script>
    function setStatus(message, type) {
      const status = document.getElementById('status');
      status.textContent = message;
      status.className = type;
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
          setStatus('Cache cleared! Freed ' + data.freed + ' items.', 'success');
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

      // robots.txt and llms.txt (templated)
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

      // FIXED: Tag pages - three-tier cache
      if (route.startsWith('/tag/')) {
        const tag = route.substring(5).replace(/\/$/, '');
        const cacheKey = `__tag_${tag}`;

        // Tier 1: Precompressed
        const precompressed = servePrecompressed(cacheKey, request);
        if (precompressed) return precompressed;

        // Tier 2: Rendered cache
        const preRendered = renderedCache.get(cacheKey);
        if (preRendered) {
          metrics.serverCacheHits++;
          return serveWithCache(preRendered, 'text/html; charset=utf-8', request);
        }

        // Tier 3: Render fresh
        try {
          metrics.serverRenderHits++;
          const html = renderTagPage(contentCache, tag, templatesCache, navigation);
          renderedCache.set(cacheKey, html);
          return serveWithCache(html, 'text/html; charset=utf-8', request);
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // FIXED: Pagination routes - three-tier cache
      if (route.startsWith('/page/')) {
        const pageMatch = route.match(/^\/page\/(\d+)\/?$/);
        if (pageMatch) {
          const page = parseInt(pageMatch[1], 10);
          const cacheKey = `__index_${page}`;

          // Tier 1: Precompressed
          const precompressed = servePrecompressed(cacheKey, request);
          if (precompressed) return precompressed;

          // Tier 2: Rendered cache
          const preRendered = renderedCache.get(cacheKey);
          if (preRendered) {
            metrics.serverCacheHits++;
            return serveWithCache(preRendered, 'text/html; charset=utf-8', request);
          }

          // Tier 3: Render fresh
          try {
            metrics.serverRenderHits++;
            const html = renderContentList(contentCache, page, templatesCache, navigation, siteConfig);
            renderedCache.set(cacheKey, html);
            return serveWithCache(html, 'text/html; charset=utf-8', request);
          } catch (error) {
            return new Response(`Error: ${error.message}`, { status: 500 });
          }
        }
      }

      // Homepage - uses three-tier cache via resolveHomepage
      if (route === '/') {
        return resolveHomepage(request);
      }

      // FIXED: Article pages - three-tier cache
      const slug = route.substring(1).replace(/\/$/, '');
      const content = contentCache.get(slug);

      if (content) {
        // Tier 1: Precompressed
        const precompressed = servePrecompressed(slug, request);
        if (precompressed) return precompressed;

        // Tier 2: Rendered cache
        const preRendered = renderedCache.get(slug);
        if (preRendered) {
          metrics.serverCacheHits++;
          return serveWithCache(preRendered, 'text/html; charset=utf-8', request);
        }

        // Tier 3: Render fresh
        try {
          metrics.serverRenderHits++;
          if (content.type === 'html' && content.renderedHtml !== null) {
            const html = content.renderedHtml;
            renderedCache.set(slug, html);
            return serveWithCache(html, 'text/html; charset=utf-8', request);
          }

          const html = renderContent(content, slug, templatesCache, navigation, siteConfig, contentCache);
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
• Admin panel: ${serverUrl}/__thypress/
`));

const shouldOpenBrowser = process.env.THYPRESS_OPEN_BROWSER === 'true';
if (shouldOpenBrowser) {
  console.log(info('Opening browser...\n'));
  openBrowser(serverUrl);
}
