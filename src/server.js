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
  generateUrl,
  selectTemplate,
  processPostMetadata,
  normalizeToWebPath
} from './renderer.js';
import { optimizeToCache, CACHE_DIR } from './build.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const START_PORT = 3009;
const MAX_PORT_TRIES = 100;
const DEBOUNCE_DELAY = 500;

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

const md = new MarkdownIt();
md.use(markdownItHighlight);

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

// Build state
let isBuildingStatic = false;
let isOptimizingImages = false;
let optimizeDebounceTimer = null;

// Performance caches
const staticAssetCache = new Map();
const dynamicContentCache = new Map();
const MAX_CACHE_SIZE = 50 * 1024 * 1024;
let currentCacheSize = 0;

// Metrics
const metrics = {
  requests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  avgResponseTime: 0,
  responseTimes: []
};

setInterval(() => {
  if (metrics.requests > 0) {
    const hitRate = ((metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)) * 100).toFixed(1);
    const avgTime = metrics.avgResponseTime.toFixed(2);
    console.log(dim(`[Metrics] ${metrics.requests} req/10s | Avg: ${avgTime}ms | Cache hit: ${hitRate}%`));
  }
  metrics.requests = 0;
  metrics.cacheHits = 0;
  metrics.cacheMisses = 0;
  metrics.responseTimes = [];
  metrics.avgResponseTime = 0;
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
    const { EMBEDDED_TEMPLATES } = await import('./embedded-templates.js');
    content404 = EMBEDDED_TEMPLATES['404.html'] || 'Not Found';
  }

  dynamicContentCache.set(cacheKey, { content: content404 });

  const response = await serveWithCache(content404, 'text/html; charset=utf-8', request);
  return new Response(response.body, {
    status: 404,
    headers: response.headers
  });
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
}

function loadSingleContent(filename) {
  const webPath = normalizeToWebPath(filename);
  if (!/\.(md|txt|html)$/i.test(webPath)) return;

  try {
    const ext = path.extname(webPath).toLowerCase();
    const isMarkdown = ext === '.md';
    const isText = ext === '.txt';
    const isHtml = ext === '.html';

    const url = generateUrl(webPath, contentMode);
    const slug = url.substring(1).replace(/\/$/, '') || 'index';

    slugMap.set(webPath, slug);

    const fullPath = path.join(contentRoot, filename);

    // HTML files are served as-is
    if (isHtml) {
      const htmlContent = fsSync.readFileSync(fullPath, 'utf-8');

      contentCache.set(slug, {
        filename: webPath,
        slug: slug,
        url: url,
        title: path.basename(filename, '.html'),
        date: fsSync.statSync(fullPath).mtime.toISOString().split('T')[0],
        createdAt: fsSync.statSync(fullPath).mtime.toISOString().split('T')[0],
        updatedAt: fsSync.statSync(fullPath).mtime.toISOString().split('T')[0],
        tags: [],
        description: '',
        content: htmlContent,
        renderedHtml: htmlContent,
        frontMatter: {},
        relativePath: webPath,
        type: 'html',
        wordCount: 0,
        readingTime: 0
      });

      console.log(success(`Content '${path.basename(filename)}' loaded`));
      invalidateDynamicCaches();
      return;
    }

    const rawContent = fsSync.readFileSync(fullPath, 'utf-8');
    const { data: frontMatter, content } = matter(rawContent);

    const env = { postRelativePath: webPath, referencedImages: [], contentDir: contentRoot };
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

    let section = null;
    if (contentMode === 'structured') {
      section = webPath.split('/')[0];
    } else if (contentMode === 'legacy') {
      section = 'posts';
    }

    contentCache.set(slug, {
      filename: webPath,
      slug: slug,
      url: url,
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
      readingTime: readingTime,
      section: section,
      type: isMarkdown ? 'markdown' : 'text'
    });

    console.log(success(`Content '${path.basename(filename)}' loaded`));
    invalidateDynamicCaches();
  } catch (error) {
    console.error(errorMsg(`Error loading content '${path.basename(filename)}': ${error.message}`));
  }
}

/**
 * Resolve homepage with priority order
 */
function resolveHomepage(request) {
  // 1. config.json override
  if (siteConfig.index) {
    const customContent = contentCache.get(siteConfig.index);
    if (customContent) {
      if (customContent.type === 'html') {
        return serveWithCache(customContent.renderedHtml, 'text/html; charset=utf-8', request);
      }
      const html = renderContent(customContent, customContent.slug, templatesCache, navigation, siteConfig, contentCache);
      return serveWithCache(html, 'text/html; charset=utf-8', request);
    }
  }

  // 2. content/index.* (any extension)
  const indexContent = contentCache.get('index');
  if (indexContent) {
    if (indexContent.type === 'html') {
      return serveWithCache(indexContent.renderedHtml, 'text/html; charset=utf-8', request);
    }
    const html = renderContent(indexContent, 'index', templatesCache, navigation, siteConfig, contentCache);
    return serveWithCache(html, 'text/html; charset=utf-8', request);
  }

  // 3. Auto-generated post listing (default)
  const html = renderContentList(contentCache, 1, templatesCache, navigation, siteConfig);
  return serveWithCache(html, 'text/html; charset=utf-8', request);
}

// Initialize
console.log(bright('Initializing server...\n'));
await reloadContent();
await reloadTheme();

if (!isOptimizingImages && imageReferences.size > 0) {
  isOptimizingImages = true;
  await optimizeToCache(imageReferences, brokenImages);
  isOptimizingImages = false;
}

// Watch content directory
try {
  watch(contentRoot, { recursive: true }, async (event, filename) => {
    if (!filename) return;

    const webPath = normalizeToWebPath(filename);

    try {
      if (/\.(md|txt|html)$/i.test(webPath)) {
        console.log(info(`Content: ${event} - ${path.basename(filename)}`));

        if (event === 'rename') {
          const fullPath = path.join(contentRoot, filename);

          if (fsSync.existsSync(fullPath)) {
            loadSingleContent(filename);
            navigation = buildNavigationTree(contentRoot, contentCache, contentMode);
            const result = loadAllContent();
            imageReferences = result.imageReferences;
            scheduleImageOptimization();
          } else {
            const slug = slugMap.get(webPath);
            if (slug) {
              contentCache.delete(slug);
              slugMap.delete(webPath);
              imageReferences.delete(webPath);
              console.log(success(`Content '${path.basename(filename)}' removed from cache`));
              navigation = buildNavigationTree(contentRoot, contentCache, contentMode);
            }
          }
        } else if (event === 'change') {
          loadSingleContent(filename);
          navigation = buildNavigationTree(contentRoot, contentCache, contentMode);
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
  throw new Error(`Could not find available port after trying ${MAX_PORT_TRIES} ports`);
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
    <p><strong>Images cached:</strong> ${imageReferences.size} files with images</p>
    <p><strong>Static cache:</strong> ${staticAssetCache.size} files (${(currentCacheSize / 1024 / 1024).toFixed(2)} MB)</p>
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

      // Serve optimized images from .cache/
      if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(route)) {
        const imagePath = route.substring(1);
        const cachedPath = path.join(CACHE_DIR, imagePath);

        try {
          const cacheKey = `image:${cachedPath}`;
          if (staticAssetCache.has(cacheKey)) {
            metrics.cacheHits++;
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

            metrics.cacheMisses++;
            return serveWithCache(fileContents, mimeType, request);
          }
        } catch (error) {
          console.error(errorMsg(`Error serving image: ${error.message}`));
        }
      }

      // Serve theme assets from /assets/
      if (route.startsWith('/assets/')) {
        const assetPath = route.substring(8);

        // Check if it's a templated asset
        if (themeAssets.has(assetPath)) {
          const asset = themeAssets.get(assetPath);

          if (asset.type === 'template') {
            // Render with site config
            const rendered = asset.compiled({
              siteUrl: siteConfig.url || 'https://example.com',
              siteTitle: siteConfig.title || 'My Site',
              ...siteConfig,
              ...siteConfig.theme
            });
            return serveWithCache(rendered, getMimeType(assetPath), request);
          } else {
            // Serve static
            return serveWithCache(asset.content, getMimeType(assetPath), request);
          }
        }

        // Fall back to embedded assets
        const { EMBEDDED_TEMPLATES } = await import('./embedded-templates.js');
        const assetName = path.basename(assetPath);
        if (EMBEDDED_TEMPLATES[assetName]) {
          return serveWithCache(EMBEDDED_TEMPLATES[assetName], getMimeType(assetPath), request);
        }
      }

      // Search index JSON
      if (route === '/search.json') {
        const cacheKey = 'search.json';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.cacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/json; charset=utf-8', request);
        }

        metrics.cacheMisses++;
        const searchIndex = generateSearchIndex(contentCache);
        dynamicContentCache.set(cacheKey, { content: searchIndex });

        return serveWithCache(searchIndex, 'application/json; charset=utf-8', request);
      }

      // RSS feed
      if (route === '/rss.xml') {
        const cacheKey = 'rss.xml';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.cacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/xml; charset=utf-8', request);
        }

        metrics.cacheMisses++;
        const rss = generateRSS(contentCache, siteConfig);
        dynamicContentCache.set(cacheKey, { content: rss });

        return serveWithCache(rss, 'application/xml; charset=utf-8', request);
      }

      // Sitemap
      if (route === '/sitemap.xml') {
        const cacheKey = 'sitemap.xml';

        if (dynamicContentCache.has(cacheKey)) {
          metrics.cacheHits++;
          const cached = dynamicContentCache.get(cacheKey);
          return serveWithCache(cached.content, 'application/xml; charset=utf-8', request);
        }

        metrics.cacheMisses++;
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

        // Fall back to embedded
        const { EMBEDDED_TEMPLATES } = await import('./embedded-templates.js');
        if (EMBEDDED_TEMPLATES[filename]) {
          const template = Handlebars.compile(EMBEDDED_TEMPLATES[filename]);
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
        try {
          const html = renderTagPage(contentCache, tag, templatesCache, navigation);
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
          try {
            const html = renderContentList(contentCache, page, templatesCache, navigation, siteConfig);
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

      // Try to serve as content page
      const slug = route.substring(1).replace(/\/$/, '');
      const content = contentCache.get(slug);

      if (content) {
        try {
          if (content.type === 'html') {
            return serveWithCache(content.renderedHtml, 'text/html; charset=utf-8', request);
          }

          const html = renderContent(content, slug, templatesCache, navigation, siteConfig, contentCache);
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
      metrics.avgResponseTime = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
    }
  }
});

const serverUrl = `http://localhost:${port}`;

console.log(bright(`
• Server running on ${serverUrl}
• Content mode: ${contentMode}
• Content root: ${contentRoot}
• Active theme: ${activeTheme || '.default (embedded)'}
• Performance optimizations enabled
• Admin panel: ${serverUrl}/__thypress/
`));

const shouldOpenBrowser = process.env.THYPRESS_OPEN_BROWSER === 'true';
if (shouldOpenBrowser) {
  console.log(info('Opening browser...\n'));
  openBrowser(serverUrl);
}
