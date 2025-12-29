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
import MarkdownIt from 'markdown-it';
import markdownItHighlight from 'markdown-it-highlightjs';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import {
  POSTS_PER_PAGE,
  slugify,
  loadAllPosts,
  loadTemplates,
  renderPostsList,
  renderPost,
  renderTagPage,
  generateRSS,
  generateSitemap,
  generateSearchIndex,
  getSiteConfig,
  buildNavigationTree,
  normalizeToWebPath,
  processPostMetadata
} from './renderer.js';
import { optimizeToCache, CACHE_DIR } from './build.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';
import { EMBEDDED_TEMPLATES } from './embedded-templates.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const START_PORT = 3009;
const MAX_PORT_TRIES = 100;
const DEBOUNCE_DELAY = 500; // ms

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

const md = new MarkdownIt();
md.use(markdownItHighlight);

// In-memory caches
let postsCache = new Map();
let slugMap = new Map();
let navigation = [];
let templatesCache = new Map();
let siteConfig = getSiteConfig();
let imageReferences = new Map();
let brokenImages = [];

// Build state
let isBuildingStatic = false;
let isOptimizingImages = false;
let optimizeDebounceTimer = null;

// Performance caches
const staticAssetCache = new Map(); // { path: { content, etag, gzip, brotli, mtime } }
const dynamicContentCache = new Map(); // { key: { content, etag, gzip, brotli } }
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
let currentCacheSize = 0;

// Performance metrics
const metrics = {
  requests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  avgResponseTime: 0,
  responseTimes: []
};

// Start metrics logging
setInterval(() => {
  if (metrics.requests > 0) {
    const hitRate = ((metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)) * 100).toFixed(1);
    const avgTime = metrics.avgResponseTime.toFixed(2);
    console.log(dim(`[Metrics] ${metrics.requests} req/10s | Avg: ${avgTime}ms | Cache hit: ${hitRate}%`));
  }
  // Reset
  metrics.requests = 0;
  metrics.cacheHits = 0;
  metrics.cacheMisses = 0;
  metrics.responseTimes = [];
  metrics.avgResponseTime = 0;
}, 10000);

function getMimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const types = {
    'html': 'text/html',
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
    'xml': 'application/xml'
  };
  return types[ext] || 'application/octet-stream';
}

function generateETag(content) {
  return `"${crypto.createHash('md5').update(content).digest('hex')}"`;
}

function getCacheControl(type) {
  // Aggressive caching for static assets
  if (type.includes('image') || type.includes('font') || type === 'text/css' || type === 'text/javascript') {
    return 'public, max-age=31536000, immutable'; // 1 year
  }
  // Moderate caching for HTML
  if (type === 'text/html') {
    return 'public, max-age=3600'; // 1 hour
  }
  // Short caching for dynamic content
  return 'public, max-age=300'; // 5 minutes
}

async function compressContent(content, acceptEncoding) {
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

  // Check what encodings client accepts
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

  // Check ETag - if match, return 304 Not Modified
  if (ifNoneMatch === etag) {
    metrics.cacheHits++;
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': maxAge || getCacheControl(mimeType)
      }
    });
  }

  metrics.cacheMisses++;

  // Compress if appropriate and not skipped
  let finalContent = contentBuffer;
  let contentEncoding = null;

  if (!skipCompression && contentBuffer.length > 1024) { // Only compress if > 1KB
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

/**
 * Unified 404 handler with caching
 */
async function serve404(request) {
  const cacheKey = '404.html';

  // Check cache
  if (dynamicContentCache.has(cacheKey)) {
    const cached = dynamicContentCache.get(cacheKey);
    return serveWithCache(cached.content, 'text/html; charset=utf-8', request, { status: 404 });
  }

  const custom404Path = path.join(process.cwd(), 'assets', '404.html');
  let content404 = null;

  // 1. Try user's custom 404.html
  if (fsSync.existsSync(custom404Path)) {
    try {
      content404 = await fs.readFile(custom404Path, 'utf-8');
    } catch (error) {
      console.error(errorMsg(`Error loading custom 404.html: ${error.message}`));
    }
  }

  // 2. Fall back to embedded template
  if (!content404 && EMBEDDED_TEMPLATES['404.html']) {
    content404 = EMBEDDED_TEMPLATES['404.html'];
  }

  // 3. Ultimate fallback
  if (!content404) {
    content404 = 'Not Found';
  }

  // Cache it
  dynamicContentCache.set(cacheKey, { content: content404 });

  const response = await serveWithCache(content404, 'text/html; charset=utf-8', request);
  return new Response(response.body, {
    status: 404,
    headers: response.headers
  });
}

async function reloadPosts() {
  const result = loadAllPosts();
  postsCache = result.postsCache;
  slugMap = result.slugMap;
  navigation = result.navigation;
  imageReferences = result.imageReferences;
  brokenImages = result.brokenImages;

  // Invalidate dynamic content caches
  invalidateDynamicCaches();

  // Schedule image optimization with debouncing
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

function reloadTemplates() {
  templatesCache = loadTemplates();
  // Invalidate 404 cache since it might use templates
  dynamicContentCache.delete('404.html');
}

function loadSinglePost(filename) {
  const webPath = normalizeToWebPath(filename);
  if (!webPath.endsWith('.md') && !webPath.endsWith('.txt')) return;

  const postsDir = process.env.THYPRESS_POSTS_DIR || path.join(__dirname, '../posts');

  try {
    const isMarkdown = webPath.endsWith('.md');
    const slug = slugify(webPath.replace(/\.(md|txt)$/, ''));
    slugMap.set(webPath, slug);

    const fullPath = path.join(postsDir, filename);
    const rawContent = fsSync.readFileSync(fullPath, 'utf-8');
    const { data: frontMatter, content } = matter(rawContent);

    const env = { postRelativePath: webPath, referencedImages: [] };
    const renderedHtml = isMarkdown ? md.render(content, env) : `<pre>${content}</pre>`;

    if (env.referencedImages.length > 0) {
      imageReferences.set(webPath, env.referencedImages);
    }

    const { createdAt, updatedAt, wordCount, readingTime, title } = processPostMetadata(
      content,
      filename,
      frontMatter,
      isMarkdown,
      fullPath
    );

    const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []);
    const description = frontMatter.description || '';

    postsCache.set(slug, {
      filename: webPath,
      slug: slug,
      title: title,
      date: createdAt,
      createdAt: createdAt,
      updatedAt: updatedAt,
      tags: tags,
      description: description,
      content: content,
      renderedHtml: renderedHtml,
      frontMatter: frontMatter,
      relativePath: webPath,
      wordCount: wordCount,
      readingTime: readingTime
    });
    console.log(success(`Post '${path.basename(filename)}' loaded`));

    // Invalidate caches
    invalidateDynamicCaches();
  } catch (error) {
    console.error(errorMsg(`Error loading post '${path.basename(filename)}': ${error.message}`));
  }
}

function loadSingleTemplate(name) {
  try {
    const assetsDir = path.join(process.cwd(), 'assets');
    const html = fsSync.readFileSync(path.join(assetsDir, `${name}.html`), 'utf-8');
    const compiled = Handlebars.compile(html);
    templatesCache.set(name, compiled);
    console.log(success(`Template '${name}' compiled`));
  } catch (error) {
    console.error(errorMsg(`Error loading template '${name}': ${error.message}`));
  }
}

// Initialize everything
console.log(bright('Initializing server...\n'));
await reloadPosts();
reloadTemplates();

// Optimize images on startup
if (!isOptimizingImages && imageReferences.size > 0) {
  isOptimizingImages = true;
  await optimizeToCache(imageReferences, brokenImages);
  isOptimizingImages = false;
}

// Watch posts directory
const postsDir = process.env.THYPRESS_POSTS_DIR || path.join(__dirname, '../posts');
try {
  watch(postsDir, { recursive: true }, async (event, filename) => {
    if (!filename) return;

    const webPath = normalizeToWebPath(filename);

    try {
      // Handle markdown/txt changes
      if (webPath.endsWith('.md') || webPath.endsWith('.txt')) {
        console.log(info(`Posts: ${event} - ${path.basename(filename)}`));

        if (event === 'rename') {
          const fullPath = path.join(postsDir, filename);

          if (fsSync.existsSync(fullPath)) {
            loadSinglePost(filename);
            navigation = buildNavigationTree(postsDir, postsCache);
            const result = loadAllPosts();
            imageReferences = result.imageReferences;
            scheduleImageOptimization();
          } else {
            const slug = slugMap.get(webPath);
            if (slug) {
              postsCache.delete(slug);
              slugMap.delete(webPath);
              imageReferences.delete(webPath);
              console.log(success(`Post '${path.basename(filename)}' removed from cache`));
              navigation = buildNavigationTree(postsDir, postsCache);
            }
          }
        } else if (event === 'change') {
          loadSinglePost(filename);
          navigation = buildNavigationTree(postsDir, postsCache);
          scheduleImageOptimization();
        }
      }

      // Handle image changes
      if (/\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
        console.log(info(`Images: ${event} - ${path.basename(filename)}`));
        scheduleImageOptimization();
      }
    } catch (error) {
      console.error(errorMsg(`Error processing change: ${error.message}`));
    }
  });
  console.log(success('Watching /posts for changes'));
} catch (error) {
  console.error(errorMsg(`Could not watch /posts directory: ${error.message}`));
}

// Watch templates - SPECIFIC FILES ONLY (not entire directory)
try {
  const assetsDir = path.join(process.cwd(), 'assets');
  const templatesToWatch = ['index.html', 'post.html', 'tag.html', '404.html'];

  for (const templateFile of templatesToWatch) {
    const templatePath = path.join(assetsDir, templateFile);
    if (fsSync.existsSync(templatePath)) {
      watch(templatePath, (event, filename) => {
        console.log(info(`Template: ${event} - ${templateFile}`));
        const name = templateFile.replace('.html', '');
        if (name === '404') {
          dynamicContentCache.delete('404.html');
        } else {
          loadSingleTemplate(name);
        }
      });
    }
  }
  console.log(success('Watching template files for changes'));
} catch (error) {
  console.error(errorMsg(`Could not watch template files: ${error.message}`));
}

// Watch partials directory
try {
  const partialsDir = path.join(process.cwd(), 'assets', 'partials');
  if (fsSync.existsSync(partialsDir)) {
    watch(partialsDir, (event, filename) => {
      if (!filename || !filename.endsWith('.html')) return;
      console.log(info(`Partials: ${event} - ${filename}`));
      reloadTemplates();
    });
    console.log(success('Watching /assets/partials for changes'));
  }
} catch (error) {
  // Partials watching is optional
}

// Watch config
try {
  const configPath = path.join(process.cwd(), 'config.json');
  if (fsSync.existsSync(configPath)) {
    watch(configPath, (event, filename) => {
      siteConfig = getSiteConfig();
      invalidateDynamicCaches();
      console.log(success('Config reloaded'));
    });
  }
} catch (error) {
  // Config watching is optional
}

// Open browser function
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

// Find available port
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
  throw new Error(`Could not find available port after trying ${MAX_PORT_TRIES} ports`);
}

// Start server
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
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>thypress Admin</title>
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
  <p><a href="/" class="back">← Back to blog</a></p>

  <h1>THYPRESS Admin</h1>

  <div class="stats">
    <p><strong>Posts:</strong> ${postsCache.size}</p>
    <p><strong>Images cached:</strong> ${imageReferences.size} posts with images</p>
    <p><strong>Static cache:</strong> ${staticAssetCache.size} files (${(currentCacheSize / 1024 / 1024).toFixed(2)} MB)</p>
    <p><strong>Dynamic cache:</strong> ${dynamicContentCache.size} items</p>
    <p><strong>Server:</strong> http://localhost:${port}</p>
  </div>

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
        const itemsFreed = staticAssetCache.size + dynamicContentCache.size;
        staticAssetCache.clear();
        dynamicContentCache.clear();
        currentCacheSize = 0;

        return new Response(JSON.stringify({
          success: true,
          freed: itemsFreed
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Serve images from .cache/post/ directory
      if (route.startsWith('/post/') && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(route)) {
        const imagePath = route.substring(6);
        const cachedPath = path.join(CACHE_DIR, 'post', imagePath);

        try {
          // Check memory cache first
          const cacheKey = `image:${cachedPath}`;
          if (staticAssetCache.has(cacheKey)) {
            metrics.cacheHits++;
            const cached = staticAssetCache.get(cacheKey);
            return serveWithCache(cached.content, cached.mimeType, request);
          }

          // Load from disk
          if (fsSync.existsSync(cachedPath)) {
            const fileContents = await fs.readFile(cachedPath);
            const mimeType = getMimeType(cachedPath);

            // Cache it (if not too large)
            if (fileContents.length < 5 * 1024 * 1024) { // 5MB max per image
              staticAssetCache.set(cacheKey, {
                content: fileContents,
                mimeType: mimeType
              });
              currentCacheSize += fileContents.length;

              // LRU eviction if cache too large
              if (currentCacheSize > MAX_CACHE_SIZE) {
                const firstKey = staticAssetCache.keys().next().value;
                const firstItem = staticAssetCache.get(firstKey);
                currentCacheSize -= firstItem.content.length;
                staticAssetCache.delete(firstKey);
              }
            }

            metrics.cacheMisses++;
            return serveWithCache(fileContents, mimeType, request);
          }
        } catch (error) {
          console.error(errorMsg(`Error serving image: ${error.message}`));
        }

        return serve404(request);
      }

      // Search index JSON - CACHED
      if (route === '/search.json') {
        const cacheKey = 'search.json';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.cacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/json; charset=utf-8', request);
        }

        metrics.cacheMisses++;
        const searchIndex = generateSearchIndex(postsCache);
        dynamicContentCache.set(cacheKey, { content: searchIndex });

        return serveWithCache(searchIndex, 'application/json; charset=utf-8', request);
      }

      // RSS feed - CACHED
      if (route === '/rss.xml') {
        const cacheKey = 'rss.xml';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.cacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/xml; charset=utf-8', request);
        }

        metrics.cacheMisses++;
        const rss = generateRSS(postsCache, siteConfig);
        dynamicContentCache.set(cacheKey, { content: rss });

        return serveWithCache(rss, 'application/xml; charset=utf-8', request);
      }

      // Sitemap - CACHED
      if (route === '/sitemap.xml') {
        const cacheKey = 'sitemap.xml';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.cacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/xml; charset=utf-8', request);
        }

        metrics.cacheMisses++;
        const sitemap = await generateSitemap(postsCache, siteConfig);
        dynamicContentCache.set(cacheKey, { content: sitemap });

        return serveWithCache(sitemap, 'application/xml; charset=utf-8', request);
      }

      // Serve static files from assets - WITH CACHING
      if (route.startsWith('/assets/')) {
        const filePath = path.join(process.cwd(), route);
        const cacheKey = `static:${filePath}`;

        try {
          // Check memory cache
          if (staticAssetCache.has(cacheKey)) {
            metrics.cacheHits++;
            const cached = staticAssetCache.get(cacheKey);
            return serveWithCache(cached.content, cached.mimeType, request);
          }

          // Load from disk
          const fileContents = await fs.readFile(filePath);
          const mimeType = getMimeType(filePath);

          // Cache it (if not too large)
          if (fileContents.length < 10 * 1024 * 1024) { // 10MB max
            staticAssetCache.set(cacheKey, {
              content: fileContents,
              mimeType: mimeType
            });
            currentCacheSize += fileContents.length;

            // LRU eviction
            if (currentCacheSize > MAX_CACHE_SIZE) {
              const firstKey = staticAssetCache.keys().next().value;
              const firstItem = staticAssetCache.get(firstKey);
              currentCacheSize -= firstItem.content.length;
              staticAssetCache.delete(firstKey);
            }
          }

          metrics.cacheMisses++;
          return serveWithCache(fileContents, mimeType, request);
        } catch (error) {
          return serve404(request);
        }
      }

      // Tag pages
      if (route.startsWith('/tag/')) {
        const tag = route.substring(5).replace(/\/$/, '');
        try {
          const html = renderTagPage(postsCache, tag, templatesCache, navigation);
          return serveWithCache(html, 'text/html; charset=utf-8', request, { maxAge: 'public, max-age=3600' });
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // Pagination routes
      if (route.startsWith('/page/')) {
        const pageMatch = route.match(/^\/page\/(\d+)\/?$/);
        if (pageMatch) {
          const page = parseInt(pageMatch[1], 10);
          try {
            const html = renderPostsList(postsCache, page, templatesCache, navigation, siteConfig);
            return serveWithCache(html, 'text/html; charset=utf-8', request, { maxAge: 'public, max-age=3600' });
          } catch (error) {
            return new Response(`Error: ${error.message}`, { status: 500 });
          }
        }
      }

      // Main blog listing
      if (route === '/' || route.startsWith('/older')) {
        let page = parseInt(url.searchParams.get('page'), 10) || 1;

        try {
          const html = renderPostsList(postsCache, page, templatesCache, navigation, siteConfig);
          return serveWithCache(html, 'text/html; charset=utf-8', request, { maxAge: 'public, max-age=3600' });
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // Specific blog post
      if (route.startsWith('/post/')) {
        const slug = route.substring(6).replace(/\/$/, '');
        const post = postsCache.get(slug);

        if (!post) {
          return serve404(request);
        }

        try {
          const html = renderPost(post, slug, templatesCache, navigation, siteConfig, postsCache);
          return serveWithCache(html, 'text/html; charset=utf-8', request, { maxAge: 'public, max-age=3600' });
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // All other routes - unified 404
      return serve404(request);
    } catch (error) {
      console.error(errorMsg(`Request error: ${error.message}`));
      return new Response('Internal Server Error', { status: 500 });
    } finally {
      // Track response time
      const responseTime = Date.now() - startTime;
      metrics.responseTimes.push(responseTime);
      metrics.avgResponseTime = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
    }
  }
});

const serverUrl = `http://localhost:${port}`;

console.log(bright(`
• Server running on ${serverUrl}
• Performance optimizations enabled
• HTTP caching: ETag + Cache-Control
• Compression: gzip + brotli
• In-memory asset cache: ${MAX_CACHE_SIZE / 1024 / 1024}MB limit
• Admin panel: ${serverUrl}/__thypress/
`));

// Auto-open browser if flag is set
const shouldOpenBrowser = process.env.THYPRESS_OPEN_BROWSER === 'true';
if (shouldOpenBrowser) {
  console.log(info('Opening browser...\n'));
  openBrowser(serverUrl);
}
