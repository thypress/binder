// Copyright (C) 2026 THYPRESS

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org>.

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// ============================================================================
// CLEAN IMPORTS - Direct from source modules (no re-exports)
// ============================================================================

// Rendering functions from renderer.js
import {
  renderEntry,
  renderEntryList,
  renderTagPage,
  renderCategoryPage,
  renderSeriesPage,
  generateRSS,
  generateSitemap,
  generateSearchIndex
} from './renderer.js';

// Utilities from taxonomy.js
import {
  getAllTags,
  getAllCategories,
  getAllSeries,
  slugify
} from './utils/taxonomy.js';

// Build utilities
import { CACHE_DIR } from './build.js';

// Theme functions (only for 404 fallback)
import { loadEmbeddedTemplates } from './theme-system.js';

// Template context builder
import { buildTemplateContext } from './utils/template-context.js';

// Import Admin SSR generator
import { generateAdminHTML } from './admin-pages.js';

// ============================================================================

/**
 * THYPRESS THEME SYSTEM DOCUMENTATION
 * ====================================
 *
 * REQUIRED TEMPLATES:
 * -------------------
 * - index.html: Homepage and pagination pages
 * Variables: { entries[], pagination }
 *
 * - entry.html: Individual content pages (posts, pages, articles)
 * Variables: { entry, frontMatter, prevEntry, nextEntry, relatedEntries[], toc[] }
 *
 * OPTIONAL TEMPLATES:
 * -------------------
 * - tag.html: Tag archive pages (fallback: index.html)
 * Variables: { tag, entries[] }
 *
 * - category.html: Category archive pages (fallback: tag.html → index.html)
 * Variables: { category, entries[] }
 *
 * - series.html: Series archive pages (fallback: tag.html → index.html)
 * Variables: { series, entries[] }
 *
 * - 404.html: Not found page (fallback: embedded template)
 * Variables: { site }
 *
 * GLOBAL TEMPLATE VARIABLES:
 * --------------------------
 * All templates receive:
 * - site: { title, description, url, author, ...siteConfig }
 * - navigation: Hierarchical navigation tree
 * - themeMetadata: Theme's theme.json metadata
 *
 * THEME.JSON STRUCTURE:
 * ---------------------
 * {
 * "name": "Theme Display Name",
 * "version": "1.0.0",
 * "author": "Author Name",
 * "description": "Brief theme description",
 * "features": ["feature1", "feature2"]
 * }
 *
 * TEMPLATE SELECTION:
 * -------------------
 * Templates can be selected based on entry front-matter:
 * - template: "custom-template" → looks for custom-template.html
 * - Falls back to entry.html if custom template not found
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * MIME type mappings for file extensions
 */
export const MIME_TYPES = {
  HTML: 'text/html; charset=utf-8',
  CSS: 'text/css',
  JS: 'text/javascript',
  JSON: 'application/json; charset=utf-8',
  XML: 'application/xml; charset=utf-8',
  TEXT: 'text/plain; charset=utf-8',
  PNG: 'image/png',
  JPG: 'image/jpeg',
  JPEG: 'image/jpeg',
  GIF: 'image/gif',
  SVG: 'image/svg+xml',
  WEBP: 'image/webp',
  AVIF: 'image/avif',
  ICO: 'image/x-icon',
  WOFF: 'font/woff',
  WOFF2: 'font/woff2',
  TTF: 'font/ttf',
  DEFAULT: 'application/octet-stream'
};

/**
 * Route patterns used throughout the application
 */
export const ROUTES = {
  ADMIN: '/__thypress/',
  ADMIN_BASE: '/__thypress',
  ADMIN_THEMES: '/__thypress/themes',
  ADMIN_BUILD: '/__thypress/build',
  ADMIN_CLEAR_CACHE: '/__thypress/clear-cache',
  ADMIN_CONFIG: '/__thypress/api/config',
  LIVE_RELOAD: '/__live_reload',
  ASSETS: '/assets/',
  TAG: '/tag/',
  CATEGORY: '/category/',
  SERIES: '/series/',
  PAGE: '/page/',
  HOME: '/'
};

/**
 * Cache key generators for different content types
 */
export const CACHE_KEYS = {
  tag: (tag) => `__tag_${tag}`,
  category: (category) => `__category_${category}`,
  series: (seriesSlug) => `__series_${seriesSlug}`,
  index: (page) => `__index_${page}`,
  notFound: '404.html',
  searchIndex: 'search.json',
  rss: 'rss.xml',
  sitemap: 'sitemap.xml',
  robotsTxt: 'robots.txt',
  llmsTxt: 'llms.txt'
};

/**
 * HTTP status codes
 */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  SERVER_ERROR: 500
};

/**
 * File extension patterns
 */
export const FILE_PATTERNS = {
  IMAGES: /\.(jpg|jpeg|png|gif|webp|svg)$/i,
  CONTENT: /\.(md|txt|html)$/i,
  HTML: '.html'
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get MIME type for a file path
 * @param {string} filePath - File path to check
 * @returns {string} MIME type string
 */
function getMimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const typeMap = {
    'html': MIME_TYPES.HTML,
    'css': MIME_TYPES.CSS,
    'js': MIME_TYPES.JS,
    'json': MIME_TYPES.JSON,
    'png': MIME_TYPES.PNG,
    'jpg': MIME_TYPES.JPG,
    'jpeg': MIME_TYPES.JPEG,
    'gif': MIME_TYPES.GIF,
    'svg': MIME_TYPES.SVG,
    'ico': MIME_TYPES.ICO,
    'woff': MIME_TYPES.WOFF,
    'woff2': MIME_TYPES.WOFF2,
    'ttf': MIME_TYPES.TTF,
    'webp': MIME_TYPES.WEBP,
    'xml': MIME_TYPES.XML,
    'txt': MIME_TYPES.TEXT
  };
  return typeMap[ext] || MIME_TYPES.DEFAULT;
}

/**
 * Inject live reload SSE script into HTML
 * Smart detection: tries </body>, then </html>, then appends to end
 * @param {string} html - HTML content
 * @returns {string} HTML with injected script
 */
function injectLiveReloadScript(html, siteConfig) {
  // Only inject in DYNAMIC mode (thypress serve)
  // We strictly skip this in 'static' or 'static_preview' modes
  if (process.env.THYPRESS_MODE !== 'dynamic') return html;
  // or when it is intentionally flagged in configurations
  if (siteConfig?.disableLiveReload === true) return html;

  const script = `
<script>
(function() {
  // SSE Live Reload for THYPRESS
  const source = new EventSource('${ROUTES.LIVE_RELOAD}');

  source.onmessage = function(e) {
    if (e.data === 'reload') {
      console.log('[THYPRESS] Content updated, reloading...');
      location.reload();
    }
  };

  source.onerror = function() {
    console.log('[THYPRESS] Live reload disconnected');
    source.close();
  };
})();
</script>`;

  // Smart injection - try </body> first
  if (html.includes('</body>')) {
    return html.replace('</body>', script + '\n</body>');
  }

  // Fallback: try </html>
  if (html.includes('</html>')) {
    return html.replace('</html>', script + '\n</html>');
  }

  // Last resort: append to end
  return html + script;
}

// ============================================================================
// MAIN REQUEST HANDLER
// ============================================================================

/**
 * Main request handler that routes all incoming requests
 * @param {Request} request - Incoming HTTP request
 * @param {Object} server - Bun server instance
 * @param {Object} deps - Application dependencies (cache, config, etc.)
 * @returns {Promise<Response>} HTTP response
 */
export async function handleRequest(request, server, deps) {
  const url = new URL(request.url);
  const route = url.pathname;

  // SSE endpoint for live reload
  if (route === ROUTES.LIVE_RELOAD) {
    return new Response(
      new ReadableStream({
        start(controller) {
          const client = {
            controller,
            send: (data) => {
              try {
                controller.enqueue(`data: ${data}\n\n`);
              } catch (error) {
                // Client disconnected - clean up properly
                deps.liveReloadClients.delete(client);
                try {
                  controller.close();
                } catch (closeErr) {
                  // Already closed, ignore
                }
              }
            }
          };

          deps.liveReloadClients.add(client);
          client.send('connected');

          const keepAlive = setInterval(() => {
            try {
              controller.enqueue(': keep-alive\n\n');
            } catch {
              clearInterval(keepAlive);
              deps.liveReloadClients.delete(client);
              try {
                controller.close();
              } catch {}
            }
          }, 30000);

          request.signal.addEventListener('abort', () => {
            clearInterval(keepAlive);
            deps.liveReloadClients.delete(client);
            try {
              controller.close();
            } catch {}
          });
        }
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      }
    );
  }

  // Admin API routes
  if (route.startsWith(ROUTES.ADMIN)) {
    return handleAdmin(request, deps);
  }

  // Theme-root asset passthrough
  if (deps.activeTheme && route !== ROUTES.HOME && !route.startsWith(ROUTES.ADMIN)) {
    const response = await handleThemeRootAssets(route, request, deps);
    if (response) return response;
  }

  // Redirect handling
  const redirectMatch = matchRedirect(route, deps.redirectRules);
  if (redirectMatch) {
    const redirectUrl = redirectMatch.to.startsWith('http://') || redirectMatch.to.startsWith('https://')
      ? redirectMatch.to
      : new URL(redirectMatch.to, url.origin).toString();

    deps.metrics.serverCacheHits++;
    return Response.redirect(redirectUrl, redirectMatch.statusCode);
  }

  // Optimized images
  if (FILE_PATTERNS.IMAGES.test(route)) {
    const response = await handleImages(route, request, deps);
    if (response) return response;
  }

  // Theme assets
  if (route.startsWith(ROUTES.ASSETS)) {
    return handleAssets(route, request, deps);
  }

  // Meta files
  const metaFiles = [
    `/${CACHE_KEYS.searchIndex}`,
    `/${CACHE_KEYS.rss}`,
    `/${CACHE_KEYS.sitemap}`,
    `/${CACHE_KEYS.robotsTxt}`,
    `/${CACHE_KEYS.llmsTxt}`
  ];
  if (metaFiles.includes(route)) {
    return handleMeta(route, request, deps);
  }

  // Tag pages
  if (route.startsWith(ROUTES.TAG)) {
    const tag = route.substring(ROUTES.TAG.length).replace(/\/$/, '');
    return handleTagPage(tag, request, deps);
  }

  // Category pages
  if (route.startsWith(ROUTES.CATEGORY)) {
    const category = route.substring(ROUTES.CATEGORY.length).replace(/\/$/, '');
    return handleCategoryPage(category, request, deps);
  }

  // Series pages
  if (route.startsWith(ROUTES.SERIES)) {
    const seriesSlug = route.substring(ROUTES.SERIES.length).replace(/\/$/, '');
    return handleSeriesPage(seriesSlug, request, deps);
  }

  // Pagination
  if (route.startsWith(ROUTES.PAGE)) {
    const pageMatch = route.match(/^\/page\/(\d+)\/?$/);
    if (pageMatch) {
      const page = parseInt(pageMatch[1], 10);
      return handlePagination(page, request, deps);
    }
  }

  // Homepage
  if (route === ROUTES.HOME) {
    return handleHomepage(request, deps);
  }

  // Entry pages
  const slug = route.substring(1).replace(/\/$/, '');
  const entry = deps.contentCache.get(slug);

  if (entry) {
    return handleEntryPage(entry, slug, request, deps);
  }

  // Try static file from content/
  const staticFilePath = path.join(deps.contentRoot, route.substring(1));
  if (fsSync.existsSync(staticFilePath) && fsSync.statSync(staticFilePath).isFile()) {
    try {
      const fileContent = await fs.readFile(staticFilePath);
      const mimeType = getMimeType(staticFilePath);
      deps.metrics.serverCacheHits++;
      return deps.cacheManager.serveWithCache(fileContent, mimeType, request);
    } catch (error) {}
  }

  // 404
  return handle404(request, deps);
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Handle theme root assets (files in theme directory root)
 * @param {string} route - Request route
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response|null>} Response or null if not found
 */
async function handleThemeRootAssets(route, request, { activeTheme, metrics, cacheManager }) {
  const themePath = path.join(process.cwd(), 'templates', activeTheme);
  const requestedFile = path.join(themePath, route.substring(1));

  try {
    if (fsSync.existsSync(requestedFile) && fsSync.statSync(requestedFile).isFile()) {
      const ext = path.extname(requestedFile).toLowerCase();

      if (ext === FILE_PATTERNS.HTML) {
        return null; // Let normal routing handle templates
      }

      const content = await fs.readFile(requestedFile);
      const mimeType = getMimeType(requestedFile);

      metrics.serverCacheHits++;
      return cacheManager.serveWithCache(content, mimeType, request);
    }
  } catch (error) {}

  return null;
}

/**
 * Match redirect rules with support for dynamic parameters
 * @param {string} requestPath - Request path
 * @param {Map} redirectRules - Map of redirect rules
 * @returns {Object|null} Redirect config or null
 */
function matchRedirect(requestPath, redirectRules) {
  if (redirectRules.has(requestPath)) {
    return redirectRules.get(requestPath);
  }

  for (const [from, redirect] of redirectRules) {
    if (!from.includes(':')) continue;

    const pattern = from.replace(/:\w+/g, '([^/]+)');
    const regex = new RegExp(`^${pattern}$`);
    const match = requestPath.match(regex);

    if (match) {
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

/**
 * Handle optimized image requests
 * @param {string} route - Image route
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response|null>} Response or null if not found
 */
async function handleImages(route, request, { metrics, cacheManager }) {
  const imagePath = route.substring(1);
  const cachedPath = path.join(CACHE_DIR, imagePath);

  try {
    const cacheKey = `image:${cachedPath}`;
    if (cacheManager.staticAssetCache.has(cacheKey)) {
      metrics.httpCacheHits++;
      const cached = cacheManager.staticAssetCache.get(cacheKey);
      return cacheManager.serveWithCache(cached.content, cached.mimeType, request);
    }

    if (fsSync.existsSync(cachedPath)) {
      const fileContent = await fs.readFile(cachedPath);
      const mimeType = getMimeType(cachedPath);

      cacheManager.addStaticAsset(cacheKey, fileContent, mimeType);

      metrics.serverCacheHits++;
      return cacheManager.serveWithCache(fileContent, mimeType, request);
    }
  } catch (error) {}

  return null;
}

/**
 * Handle theme asset requests
 * @param {string} route - Asset route
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response|null>} Response or null if not found
 */
async function handleAssets(route, request, { themeAssets, siteConfig, metrics, cacheManager }) {
  const assetPath = route.substring(ROUTES.ASSETS.length);

  if (themeAssets.has(assetPath)) {
    const asset = themeAssets.get(assetPath);

    if (asset.type === 'template') {
      const rendered = asset.compiled({
        siteUrl: siteConfig.url || 'https://example.com',
        siteTitle: siteConfig.title || 'My Site',
        ...siteConfig,
        ...siteConfig.theme
      });
      metrics.serverRenderHits++;
      return cacheManager.serveWithCache(rendered, getMimeType(assetPath), request);
    } else {
      metrics.serverCacheHits++;
      return cacheManager.serveWithCache(asset.content, getMimeType(assetPath), request);
    }
  }

  const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();
  const assetName = path.basename(assetPath);
  if (EMBEDDED_TEMPLATES[assetName]) {
    metrics.serverCacheHits++;
    return cacheManager.serveWithCache(EMBEDDED_TEMPLATES[assetName], getMimeType(assetPath), request);
  }

  return null;
}

/**
 * Handle meta file requests (RSS, sitemap, search index, etc.)
 * @param {string} route - Meta file route
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response>} Response with meta file content
 */
async function handleMeta(route, request, { contentCache, siteConfig, cacheManager, metrics }) {
  const cacheKey = route.substring(1);

  if (cacheManager.dynamicContentCache.has(cacheKey)) {
    metrics.serverCacheHits++;
    const cached = cacheManager.dynamicContentCache.get(cacheKey);
    const mimeType = route.endsWith('.json') ? MIME_TYPES.JSON :
                     route.endsWith('.xml') ? MIME_TYPES.XML :
                     MIME_TYPES.TEXT;
    return cacheManager.serveWithCache(cached.content, mimeType, request);
  }

  let content, mimeType;

  switch (route) {
    case `/${CACHE_KEYS.searchIndex}`:
      content = generateSearchIndex(contentCache);
      mimeType = MIME_TYPES.JSON;
      break;

    case `/${CACHE_KEYS.rss}`:
      content = generateRSS(contentCache, siteConfig);
      mimeType = MIME_TYPES.XML;
      break;

    case `/${CACHE_KEYS.sitemap}`:
      content = await generateSitemap(contentCache, siteConfig);
      mimeType = MIME_TYPES.XML;
      break;

    case `/${CACHE_KEYS.robotsTxt}`:
    case `/${CACHE_KEYS.llmsTxt}`:
      const { themeAssets: metaThemeAssets } = await getThemeAssets();
      const filename = route.substring(1);

      if (metaThemeAssets.has(filename)) {
        const asset = metaThemeAssets.get(filename);
        if (asset.type === 'template') {
          content = asset.compiled({
            siteUrl: siteConfig.url || 'https://example.com',
            ...siteConfig
          });
        } else {
          content = asset.content;
        }
      } else {
        // Only reached when strictThemeIsolation=true and disk theme
        // provides no robots.txt / llms.txt — hardcoded minimal fallback
        content = route === `/${CACHE_KEYS.robotsTxt}`
          ? `User-agent: *\nAllow: /\n\nSitemap: ${siteConfig.url || 'https://example.com'}/sitemap.xml\n`
          : `# ${siteConfig.title || 'My Site'}\n\n> ${siteConfig.description || 'A site powered by THYPRESS'}\n\n## Sitemap\n${siteConfig.url || 'https://example.com'}/sitemap.xml\n`;
      }
      mimeType = MIME_TYPES.TEXT;
      break;
  }

  metrics.serverRenderHits++;
  cacheManager.dynamicContentCache.set(cacheKey, { content });
  return cacheManager.serveWithCache(content, mimeType, request);
}

/**
 * Handle tag archive page
 * @param {string} tag - Tag name
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response>} Rendered tag page
 */
async function handleTagPage(tag, request, {
  contentCache,
  templatesCache,
  navigation,
  siteConfig,
  themeMetadata,
  cacheManager,
  metrics
}) {
  const cacheKey = CACHE_KEYS.tag(tag);

  // 1. Try serving pre-compressed (Fastest, Static Mode only)
  // In dynamic mode, this returns null because pre-compression is skipped
  const precompressed = cacheManager.servePrecompressed(cacheKey, request);
  if (precompressed) {
    metrics.serverCacheHits++;
    return precompressed;
  }

  // 2. Try serving rendered HTML from RAM
  const preRendered = cacheManager.renderedCache.get(cacheKey);
  if (preRendered) {
    metrics.serverCacheHits++;
    // Always attempt injection on cached HTML in case we just switched to dynamic mode
    const html = injectLiveReloadScript(preRendered, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  }

  // 3. Render Fresh
  try {
    metrics.serverRenderHits++;
    const rawHtml = renderTagPage(contentCache, tag, templatesCache, navigation, siteConfig, themeMetadata);

    // Cache the clean HTML (no script)
    cacheManager.renderedCache.set(cacheKey, rawHtml);

    // Inject script and serve
    const html = injectLiveReloadScript(rawHtml, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: HTTP_STATUS.SERVER_ERROR });
  }
}

/**
 * Handle category archive page
 * @param {string} category - Category name
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response>} Rendered category page
 */
async function handleCategoryPage(category, request, {
  contentCache,
  templatesCache,
  navigation,
  siteConfig,
  themeMetadata,
  cacheManager,
  metrics
}) {
  const cacheKey = CACHE_KEYS.category(category);

  const precompressed = cacheManager.servePrecompressed(cacheKey, request);
  if (precompressed) {
    metrics.serverCacheHits++;
    return precompressed;
  }

  const preRendered = cacheManager.renderedCache.get(cacheKey);
  if (preRendered) {
    metrics.serverCacheHits++;
    const html = injectLiveReloadScript(preRendered, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  }

  try {
    metrics.serverRenderHits++;
    const rawHtml = renderCategoryPage(contentCache, category, templatesCache, navigation, siteConfig, themeMetadata);

    cacheManager.renderedCache.set(cacheKey, rawHtml);

    const html = injectLiveReloadScript(rawHtml, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: HTTP_STATUS.SERVER_ERROR });
  }
}

/**
 * Handle series archive page
 * @param {string} seriesSlug - Series slug
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response>} Rendered series page or 404
 */
async function handleSeriesPage(seriesSlug, request, {
  contentCache,
  templatesCache,
  navigation,
  siteConfig,
  themeMetadata,
  cacheManager,
  metrics,
  activeTheme
}) {
  const cacheKey = CACHE_KEYS.series(seriesSlug);

  const precompressed = cacheManager.servePrecompressed(cacheKey, request);
  if (precompressed) {
    metrics.serverCacheHits++;
    return precompressed;
  }

  const preRendered = cacheManager.renderedCache.get(cacheKey);
  if (preRendered) {
    metrics.serverCacheHits++;
    const html = injectLiveReloadScript(preRendered, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  }

  try {
    metrics.serverRenderHits++;
    const allSeries = getAllSeries(contentCache);
    const series = allSeries.find(s => slugify(s) === seriesSlug);
    if (!series) {
      return handle404(request, { cacheManager, activeTheme, siteConfig });
    }
    const rawHtml = renderSeriesPage(contentCache, series, templatesCache, navigation, siteConfig, themeMetadata);

    cacheManager.renderedCache.set(cacheKey, rawHtml);

    const html = injectLiveReloadScript(rawHtml);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: HTTP_STATUS.SERVER_ERROR });
  }
}

/**
 * Handle pagination page
 * @param {number} page - Page number
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response>} Rendered pagination page
 */
async function handlePagination(page, request, {
  contentCache,
  templatesCache,
  navigation,
  siteConfig,
  themeMetadata,
  cacheManager,
  metrics
}) {
  const cacheKey = CACHE_KEYS.index(page);

  const precompressed = cacheManager.servePrecompressed(cacheKey, request);
  if (precompressed) {
    metrics.serverCacheHits++;
    return precompressed;
  }

  const preRendered = cacheManager.renderedCache.get(cacheKey);
  if (preRendered) {
    metrics.serverCacheHits++;
    const html = injectLiveReloadScript(preRendered, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  }

  try {
    metrics.serverRenderHits++;
    const rawHtml = renderEntryList(contentCache, page, templatesCache, navigation, siteConfig, themeMetadata);

    cacheManager.renderedCache.set(cacheKey, rawHtml);

    const html = injectLiveReloadScript(rawHtml, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: HTTP_STATUS.SERVER_ERROR });
  }
}

/**
 * Handle homepage with custom index support
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Response} Rendered homepage
 */
function handleHomepage(request, {
  contentCache,
  templatesCache,
  navigation,
  siteConfig,
  themeMetadata,
  cacheManager,
  metrics
}) {
  // Check for custom index page
  if (siteConfig.index) {
    const customEntry = contentCache.get(siteConfig.index);
    if (customEntry) {
      const precompressed = cacheManager.servePrecompressed(siteConfig.index, request);
      if (precompressed) {
        metrics.serverCacheHits++;
        return precompressed;
      }

      const preRendered = cacheManager.renderedCache.get(siteConfig.index);
      if (preRendered) {
        metrics.serverCacheHits++;
        const html = injectLiveReloadScript(preRendered, siteConfig);
        return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
      }

      metrics.serverRenderHits++;
      let rawHtml;
      if (customEntry.type === 'html' && customEntry.renderedHtml !== null) {
        rawHtml = customEntry.renderedHtml;
      } else {
        rawHtml = renderEntry(customEntry, customEntry.slug, templatesCache, navigation, siteConfig, contentCache, themeMetadata);
      }

      cacheManager.renderedCache.set(siteConfig.index, rawHtml);
      const html = injectLiveReloadScript(rawHtml, siteConfig);
      return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
    }
  }

  // Check for index.md/txt/html
  const indexEntry = contentCache.get('index');
  if (indexEntry) {
    const precompressed = cacheManager.servePrecompressed('index', request);
    if (precompressed) {
      metrics.serverCacheHits++;
      return precompressed;
    }

    const preRendered = cacheManager.renderedCache.get('index');
    if (preRendered) {
      metrics.serverCacheHits++;
      const html = injectLiveReloadScript(preRendered, siteConfig);
      return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
    }

    metrics.serverRenderHits++;
    let rawHtml;
    if (indexEntry.type === 'html' && indexEntry.renderedHtml !== null) {
      rawHtml = indexEntry.renderedHtml;
    } else {
      rawHtml = renderEntry(indexEntry, 'index', templatesCache, navigation, siteConfig, contentCache, themeMetadata);
    }

    cacheManager.renderedCache.set('index', rawHtml);
    const html = injectLiveReloadScript(rawHtml, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  }

  // Default to entry list
  const cacheKey = CACHE_KEYS.index(1);
  const precompressed = cacheManager.servePrecompressed(cacheKey, request);
  if (precompressed) {
    metrics.serverCacheHits++;
    return precompressed;
  }

  const preRendered = cacheManager.renderedCache.get(cacheKey);
  if (preRendered) {
    metrics.serverCacheHits++;
    const html = injectLiveReloadScript(preRendered, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  }

  metrics.serverRenderHits++;
  const rawHtml = renderEntryList(contentCache, 1, templatesCache, navigation, siteConfig, themeMetadata);

  cacheManager.renderedCache.set(cacheKey, rawHtml);
  const html = injectLiveReloadScript(rawHtml, siteConfig);
  return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
}

/**
 * Handle individual entry page
 * @param {Object} entry - Entry object
 * @param {string} slug - Entry slug
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Response} Rendered entry page
 */
function handleEntryPage(entry, slug, request, {
  contentCache,
  templatesCache,
  navigation,
  siteConfig,
  themeMetadata,
  cacheManager,
  metrics
}) {
  const precompressed = cacheManager.servePrecompressed(slug, request);
  if (precompressed) {
    metrics.serverCacheHits++;
    return precompressed;
  }

  const preRendered = cacheManager.renderedCache.get(slug);
  if (preRendered) {
    metrics.serverCacheHits++;
    const html = injectLiveReloadScript(preRendered, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  }

  try {
    metrics.serverRenderHits++;
    let rawHtml;
    if (entry.type === 'html' && entry.renderedHtml !== null) {
      rawHtml = entry.renderedHtml;
    } else {
      rawHtml = renderEntry(entry, slug, templatesCache, navigation, siteConfig, contentCache, themeMetadata);
    }

    cacheManager.renderedCache.set(slug, rawHtml);
    const html = injectLiveReloadScript(rawHtml, siteConfig);
    return cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: HTTP_STATUS.SERVER_ERROR });
  }
}

/**
 * Handle 404 not found page
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response>} 404 response
 */
async function handle404(request, deps) {
  const { cacheManager, templatesCache, navigation, siteConfig, themeMetadata } = deps;
  const cacheKey = CACHE_KEYS.notFound;

  if (cacheManager.dynamicContentCache.has(cacheKey)) {
    const cached = cacheManager.dynamicContentCache.get(cacheKey);
    const html = injectLiveReloadScript(cached.content, siteConfig);
    const response = await cacheManager.serveWithCache(html, MIME_TYPES.HTML, request);
    return new Response(response.body, {
      status: HTTP_STATUS.NOT_FOUND,
      headers: response.headers
    });
  }

  let html404 = null;

  // PRIORITY 1: templatesCache always has '404' unless strictThemeIsolation=true
  //             and the disk theme provides no 404.html
  if (templatesCache.has('404')) {
    try {
      const template = templatesCache.get('404');
      const context = buildTemplateContext('404', {}, siteConfig, navigation, themeMetadata);
      html404 = template(context);
    } catch (error) {
      console.error(`Error rendering 404 template: ${error.message}`);
    }
  }

  // PRIORITY 2: Absolute fallback
  // Only reached when strictThemeIsolation=true and disk theme has no 404.html
  if (!html404) {
    html404 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Page Not Found</title>
</head>
<body>
  <h1>404 - Page Not Found</h1>
  <p>The page you're looking for doesn't exist.</p>
  <p><a href="/">← Back to Home</a></p>
</body>
</html>`;
  }

  cacheManager.dynamicContentCache.set(cacheKey, { content: html404 });

  const htmlWithReload = injectLiveReloadScript(html404, siteConfig);
  const response = await cacheManager.serveWithCache(htmlWithReload, MIME_TYPES.HTML, request);
  return new Response(response.body, {
    status: HTTP_STATUS.NOT_FOUND,
    headers: response.headers
  });
}

// ============================================================================
// ADMIN PANEL
// ============================================================================

/**
 * Handle theme preview image requests
 * Serves preview images from theme directories
 * @param {string} themeId - Theme ID
 * @param {string} filename - Preview filename
 * @param {Request} request - HTTP request
 * @returns {Promise<Response|null>} Image response or null
 */
async function handleThemePreview(themeId, filename, request) {
  // Security: validate filename is actually a preview image
  const validExtensions = ['png', 'jpg', 'jpeg', 'webp', 'avif'];
  const ext = path.extname(filename).toLowerCase().substring(1);

  if (!validExtensions.includes(ext)) {
    return null;
  }

  // Security: prevent path traversal - validate RESOLVED path
  const templatesDir = path.resolve(process.cwd(), 'templates');
  const themePath = path.resolve(templatesDir, themeId, filename);

  // CRITICAL: Check if resolved path is within templates directory
  if (!themePath.startsWith(templatesDir)) {
    console.error(`Path traversal attempt blocked: ${filename}`);
    return null;
  }

  if (!fsSync.existsSync(themePath)) {
    return null;
  }

  try {
    const fileContent = await fs.readFile(themePath);
    const mimeType = getMimeType(themePath);

    return new Response(fileContent, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    return null;
  }
}

/**
 * Handle admin panel routes
 * @param {Request} request - HTTP request
 * @param {Object} deps - Dependencies
 * @returns {Promise<Response>} Admin response
 */
async function handleAdmin(request, deps) {
  const url = new URL(request.url);
  const route = url.pathname;

  // Serve theme preview images
  if (route.startsWith('/__thypress/theme-preview/')) {
    const parts = route.substring('/__thypress/theme-preview/'.length).split('/');
    if (parts.length === 2) {
      const [themeId, filename] = parts;
      const response = await handleThemePreview(themeId, filename, request);
      if (response) return response;
    }
    return new Response('Not Found', { status: HTTP_STATUS.NOT_FOUND });
  }

  // Get available themes
  if (route === ROUTES.ADMIN_THEMES && request.method === 'GET') {
    const { scanAvailableThemes } = await import('./theme-system.js');
    const { DEFAULT_THEME_ID } = await import('./embedded-templates.js');
    const themes = scanAvailableThemes();
    const activeThemeId = deps.siteConfig.theme || deps.activeTheme || 'my-press';
    const defaultThemeId = deps.siteConfig.defaultTheme || DEFAULT_THEME_ID;

    themes.forEach(theme => {
      theme.active    = theme.id === activeThemeId;
      theme.isDefault = theme.id === defaultThemeId;
    });

    return new Response(JSON.stringify(themes), {
      headers: { 'Content-Type': MIME_TYPES.JSON }
    });
  }

  // Generic config setter — handles all theme-related config keys
  if (route === ROUTES.ADMIN_CONFIG && request.method === 'POST') {
    try {
      const body = await request.json();
      const { key, value } = body;

      const ALLOWED_KEYS = ['theme', 'defaultTheme'];
      if (!key || !ALLOWED_KEYS.includes(key)) {
        return new Response(JSON.stringify({
          success: false,
          error: `Invalid key. Allowed keys: ${ALLOWED_KEYS.join(', ')}`
        }), {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': MIME_TYPES.JSON }
        });
      }

      if (!value) {
        return new Response(JSON.stringify({
          success: false,
          error: 'value is required'
        }), {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': MIME_TYPES.JSON }
        });
      }

      const { setThemeConfig, loadTheme } = await import('./theme-system.js');

      // key-specific validation before writing
      if (key === 'theme') {
        // Full theme validation
        const testTheme = await loadTheme(value);

        if (testTheme.activeTheme !== '.default' && testTheme.validation && !testTheme.validation.valid) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Theme validation failed',
            errors: testTheme.validation.errors,
            warnings: testTheme.validation.warnings
          }), {
            status: HTTP_STATUS.BAD_REQUEST,
            headers: { 'Content-Type': MIME_TYPES.JSON }
          });
        }

        setThemeConfig('theme', value);
        deps.siteConfig = (await import('./utils/taxonomy.js')).getSiteConfig();

        return new Response(JSON.stringify({
          success: true,
          message: `Theme activated: "${value}"`,
          key,
          value,
          warnings: testTheme.validation?.warnings || []
        }), {
          headers: { 'Content-Type': MIME_TYPES.JSON }
        });
      }

      if (key === 'defaultTheme') {
        // defaultTheme must always be an embedded theme — it is the safety net
        const { EMBEDDED_TEMPLATES } = await import('./embedded-templates.js');
        if (!Object.prototype.hasOwnProperty.call(EMBEDDED_TEMPLATES, value)) {
          return new Response(JSON.stringify({
            success: false,
            error: `"${value}" is not an embedded theme and cannot be used as fallback`
          }), {
            status: HTTP_STATUS.BAD_REQUEST,
            headers: { 'Content-Type': MIME_TYPES.JSON }
          });
        }

        setThemeConfig('defaultTheme', value);
        deps.siteConfig = (await import('./utils/taxonomy.js')).getSiteConfig();

        return new Response(JSON.stringify({
          success: true,
          message: `Fallback theme set to: "${value}"`,
          key,
          value
        }), {
          headers: { 'Content-Type': MIME_TYPES.JSON }
        });
      }

    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { 'Content-Type': MIME_TYPES.JSON }
      });
    }
  }

  // Build static site
  if (route === ROUTES.ADMIN_BUILD && request.method === 'POST') {
    if (deps.isBuildingStatic) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Build already in progress'
      }), {
        headers: { 'Content-Type': MIME_TYPES.JSON }
      });
    }

    deps.isBuildingStatic = true;

    try {
      const buildModule = await import('./build.js');
      await buildModule.build();

      return new Response(JSON.stringify({
        success: true,
        message: 'Build complete'
      }), {
        headers: { 'Content-Type': MIME_TYPES.JSON }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { 'Content-Type': MIME_TYPES.JSON }
      });
    } finally {
      deps.isBuildingStatic = false;
    }
  }

  // Clear cache
  if (route === ROUTES.ADMIN_CLEAR_CACHE && request.method === 'POST') {
    const itemsFreed = deps.cacheManager.clearAll();

    await deps.preRenderAllContent();
    await deps.preCompressContent();

    return new Response(JSON.stringify({
      success: true,
      freed: itemsFreed
    }), {
      headers: { 'Content-Type': MIME_TYPES.JSON }
    });
  }

  // Admin panel HTML
  if (route === ROUTES.ADMIN || route === ROUTES.ADMIN_BASE) {
    const adminHtml = generateAdminHTML(deps);
    return new Response(adminHtml, {
      headers: { 'Content-Type': MIME_TYPES.HTML }
    });
  }

  return new Response('Not Found', { status: HTTP_STATUS.NOT_FOUND });
}

/**
 * Helper to get current theme assets
 * @returns {Promise<Object>} Theme assets and metadata
 */
async function getThemeAssets() {
  const { loadTheme } = await import('./theme-system.js');
  const { getSiteConfig } = await import('./utils/taxonomy.js');
  const siteConfig = getSiteConfig();
  const theme = await loadTheme(siteConfig.theme, siteConfig);
  return theme;
}
