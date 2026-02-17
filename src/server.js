// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS)
// SPDX-License-Identifier: MPL-2.0

// ARCHITECTURE NOTE:
// THYPRESS operates in two distinct modes:
//
// 1. DYNAMIC MODE (thypress serve):
//    - Mutable, In-Memory, Living System.
//    - Watchers active. Live Reload injected.
//    - HTML rendered on-demand OR pre-rendered on startup.
//
// 2. STATIC PREVIEW MODE (thypress build --serve):
//    - Immutable, File-Based, Snapshot.
//    - No watchers. No Live Reload.
//    - Serves pre-built files from /build directory only (Nginx behavior).

import fsSync from 'fs';
import { watch } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import zlib from 'zlib';
import { SecurityManager } from './utils/security.js';

// ============================================================================
// CLEAN IMPORTS - Direct from source modules (no re-exports)
// ============================================================================

// Content processing from content-processor.js
import {
  loadAllContent,
  buildNavigationTree,
  processContentFile
} from './content-processor.js';

// Theme functions from theme-system.js
import {
  loadTheme
} from './theme-system.js';

// Utilities from taxonomy.js
import {
  getSiteConfig,
  normalizeToWebPath
} from './utils/taxonomy.js';

// Rendering functions from renderer.js
import {
  generateSearchIndex
} from './renderer.js';

// Build functions
import { optimizeToCache } from './build.js';

// Color utilities
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';

// Cache system
import { CacheManager, metrics } from './cache.js';

// Routes
import { handleRequest } from './routes.js';

// ============================================================================

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

// ============================================================================
// CONSTANTS
// ============================================================================

const START_PORT = 3009;
const MAX_PORT_TRIES = 100;
const DEBOUNCE_DELAY = 500;
const VALID_REDIRECT_CODES = [301, 302, 303, 307, 308];
const DEFAULT_REDIRECT_STATUS = 301;
const METRICS_INTERVAL_MS = 10000;

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(deps) {
  const shutdown = () => {
    console.log('\n' + info('Shutting down gracefully...'));

    // Notify live reload clients
    if (deps.liveReloadClients) {
      deps.liveReloadClients.forEach(client => {
        try {
          client.send('shutdown');
          client.controller.close();
        } catch {}
      });
    }

    console.log(success('Shutdown complete'));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Open browser to given URL
 * @param {string} url - URL to open
 */
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

/**
 * Find an available port starting from startPort
 * @param {number} startPort - Port to start searching from
 * @returns {Promise<number>} Available port number
 */
async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + MAX_PORT_TRIES; port++) {
    try {
      const testServer = Bun.serve({
        port,
        fetch() { return new Response('test'); }
      });
      testServer.stop();
      return port;
    } catch (error) {
      continue;
    }
  }
  throw new Error('No available port');
}

/**
 * Get MIME type for static files
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
  };
  return types[ext] || 'application/octet-stream';
}

// ============================================================================
// MODE SELECTION
// ============================================================================

if (process.env.THYPRESS_MODE === 'static_preview') {
  await startStaticServer();
} else {
  await startDynamicServer();
}

// ============================================================================
// STATIC FILE SERVER (Nginx Simulator)
// ============================================================================

async function startStaticServer() {
  const buildDir = path.join(process.cwd(), 'build');

  if (!fsSync.existsSync(buildDir)) {
    console.error(errorMsg('Build directory not found. Run "thypress build" first.'));
    process.exit(1);
  }

  const port = process.env.PORT ? parseInt(process.env.PORT) : await findAvailablePort(START_PORT);
  const serverUrl = `http://localhost:${port}`;

  console.log(bright(`\n• Static Preview running on ${serverUrl}`));
  console.log(dim(`• Serving files from: ${buildDir}`));
  console.log(dim(`• Live reload: disabled (static mode)`));
  console.log(dim(`• Caching: enabled (simulating production)`));

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      let filePath = path.join(buildDir, url.pathname);

      // Directory index fallback (trailing slash handling)
      if (fsSync.existsSync(filePath) && fsSync.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      // 404 Fallback
      if (!fsSync.existsSync(filePath) || !fsSync.statSync(filePath).isFile()) {
        filePath = path.join(buildDir, '404.html');
        if (!fsSync.existsSync(filePath)) {
          return new Response('404 Not Found', { status: 404 });
        }
        return new Response(Bun.file(filePath), {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      const file = Bun.file(filePath);
      const mimeType = getMimeType(filePath);

      return new Response(file, {
        headers: {
          'Content-Type': mimeType,
          // Simulate production caching headers
          'Cache-Control': mimeType.includes('html') ? 'public, max-age=3600' : 'public, max-age=31536000'
        }
      });
    }
  });

  if (process.env.THYPRESS_OPEN_BROWSER === 'true') {
    openBrowser(serverUrl);
  }
}

// ============================================================================
// DYNAMIC SERVER (The Full Engine)
// ============================================================================

async function startDynamicServer() {
  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  // Content state
  let contentCache = new Map();
  let slugMap = new Map();
  let navigation = [];
  let imageReferences = new Map();
  let brokenImages = [];
  let contentMode = 'structured';
  let contentRoot = '';

  // Rendering state
  let templatesCache = new Map();
  let themeAssets = new Map();
  let activeTheme = null;
  let themeMetadata = {};
  let siteConfig = getSiteConfig();

  // Server state
  let redirectRules = new Map();
  let isOptimizingImages = false;
  let optimizeDebounceTimer = null;
  const liveReloadClients = new Set();

  // Reload coordination state
  let reloadLock = false;
  let pendingReload = null;
  let imageOptimizationPending = false;

  // Cache state
  const cacheManager = new CacheManager(siteConfig.cacheMaxSize || 50 * 1024 * 1024);

  // Security state
  const securityManager = new SecurityManager(siteConfig);

  // ============================================================================
  // INTERNAL UTILITY FUNCTIONS
  // ============================================================================

  function shouldIgnore(name) {
    return name.startsWith('.');
  }

  function isInDraftsFolder(filename) {
    const parts = filename.split(path.sep);
    return parts.includes('drafts');
  }

  function loadRedirects() {
    const redirectsPath = path.join(process.cwd(), 'redirects.json');

    if (!fsSync.existsSync(redirectsPath)) {
      return;
    }

    try {
      const redirectsData = JSON.parse(fsSync.readFileSync(redirectsPath, 'utf-8'));
      redirectRules = new Map();

      for (const [from, toData] of Object.entries(redirectsData)) {
        if (from.startsWith('_')) continue;

        let to, statusCode;

        if (typeof toData === 'string') {
          to = toData;
          statusCode = DEFAULT_REDIRECT_STATUS;
        } else if (typeof toData === 'object' && toData.to) {
          to = toData.to;
          statusCode = toData.statusCode || DEFAULT_REDIRECT_STATUS;
        } else {
          console.log(warning(`Invalid redirect rule for "${from}", skipping`));
          continue;
        }

        if (!VALID_REDIRECT_CODES.includes(statusCode)) {
          console.log(warning(`Invalid status code ${statusCode} for "${from}", using ${DEFAULT_REDIRECT_STATUS}`));
          statusCode = DEFAULT_REDIRECT_STATUS;
        }

        redirectRules.set(from, { to, statusCode });
      }

      if (redirectRules.size > 0) {
        console.log(success(`Loaded ${redirectRules.size} redirect rules`));
      }

    } catch (error) {
      console.error(errorMsg(`Failed to load redirects: ${error.message}`));
    }
  }

  function broadcastReload() {
    liveReloadClients.forEach(client => {
      try {
        client.send('reload');
      } catch (error) {
        liveReloadClients.delete(client);
      }
    });
  }

  function invalidateDynamicCaches() {
    cacheManager.dynamicContentCache.delete('search.json');
    cacheManager.dynamicContentCache.delete('rss.xml');
    cacheManager.dynamicContentCache.delete('sitemap.xml');
  }

  // ============================================================================
  // RELOAD COORDINATION
  // ============================================================================

  /**
   * Schedule a full content reload with debouncing and locking
   */
  function scheduleFullReload() {
    clearTimeout(pendingReload);
    pendingReload = setTimeout(async () => {
      if (reloadLock) {
        console.log(dim('Reload already in progress, skipping...'));
        return;
      }

      reloadLock = true;
      try {
        console.log(info('Reloading all content...'));
        const result = loadAllContent();

        // Atomic swap of all state
        contentCache = result.contentCache;
        slugMap = result.slugMap;
        navigation = result.navigation;
        imageReferences = result.imageReferences;
        brokenImages = result.brokenImages;
        contentMode = result.mode;

        cacheManager.renderedCache.clear();
        cacheManager.dynamicContentCache.clear();

        // Re-warm if enabled
        await preRenderAllContent();
        await preCompressContent();

        broadcastReload();
        console.log(success('Content reloaded'));
      } catch (error) {
        console.error(errorMsg(`Reload failed: ${error.message}`));
      } finally {
        reloadLock = false;
      }
    }, 500); // 500ms debounce
  }

  /**
   * Schedule image optimization with simplified boolean flag
   */
  function scheduleImageOptimization() {
    if (imageOptimizationPending) return;

    imageOptimizationPending = true;

    clearTimeout(optimizeDebounceTimer);
    optimizeDebounceTimer = setTimeout(async () => {
      if (!isOptimizingImages && imageReferences.size > 0) {
        isOptimizingImages = true;
        await optimizeToCache(imageReferences, brokenImages);
        isOptimizingImages = false;
        imageOptimizationPending = false;
      }
    }, DEBOUNCE_DELAY);
  }

  // ============================================================================
  // PRE-RENDERING & PRE-COMPRESSION
  // ============================================================================

  /**
   * Pre-render all content pages to HTML cache
   * Runs by default in dynamic mode unless disabled
   */
  async function preRenderAllContent() {
    if (siteConfig.disablePreRender === true) {
      console.log(info('Pre-render disabled, pages will render on-demand'));
      return;
    }

    console.log(info('Pre-rendering all pages (warmup)...'));

    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    const { renderEntry, renderEntryList, renderTagPage, renderCategoryPage, renderSeriesPage,
            POSTS_PER_PAGE } = await import('./renderer.js');
    const { getAllTags: taxonomyGetAllTags, getAllCategories: taxonomyGetAllCategories, getAllSeries: taxonomyGetAllSeries, slugify: taxonomySlugify } = await import('./utils/taxonomy.js');

    for (const [slug, entry] of contentCache) {
      try {
        let html;
        if (entry.type === 'html' && entry.renderedHtml !== null) {
          html = entry.renderedHtml;
        } else {
          html = renderEntry(entry, slug, templatesCache, navigation, siteConfig, contentCache, themeMetadata);
        }
        cacheManager.renderedCache.set(slug, html);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(errorMsg(`Failed to pre-render ${slug}: ${error.message}`));
        if (siteConfig.strictPreRender === true) {
          console.error(errorMsg('Exiting due to strictPreRender setting'));
          process.exit(1);
        }
      }
    }

    const totalPages = Math.ceil(contentCache.size / POSTS_PER_PAGE);
    for (let page = 1; page <= totalPages; page++) {
      try {
        const html = renderEntryList(contentCache, page, templatesCache, navigation, siteConfig, themeMetadata);
        cacheManager.renderedCache.set(`__index_${page}`, html);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(errorMsg(`Failed to pre-render index page ${page}: ${error.message}`));
        if (siteConfig.strictPreRender === true) process.exit(1);
      }
    }

    const allTags = taxonomyGetAllTags(contentCache);
    for (const tag of allTags) {
      try {
        const html = renderTagPage(contentCache, tag, templatesCache, navigation, siteConfig, themeMetadata);
        cacheManager.renderedCache.set(`__tag_${tag}`, html);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(errorMsg(`Failed to pre-render tag ${tag}: ${error.message}`));
        if (siteConfig.strictPreRender === true) process.exit(1);
      }
    }

    const allCategories = taxonomyGetAllCategories(contentCache);
    for (const category of allCategories) {
      try {
        const html = renderCategoryPage(contentCache, category, templatesCache, navigation, siteConfig, themeMetadata);
        cacheManager.renderedCache.set(`__category_${category}`, html);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(errorMsg(`Failed to pre-render category ${category}: ${error.message}`));
        if (siteConfig.strictPreRender === true) process.exit(1);
      }
    }

    const allSeries = taxonomyGetAllSeries(contentCache);
    for (const series of allSeries) {
      try {
        const html = renderSeriesPage(contentCache, series, templatesCache, navigation, siteConfig, themeMetadata);
        cacheManager.renderedCache.set(`__series_${taxonomySlugify(series)}`, html);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(errorMsg(`Failed to pre-render series ${series}: ${error.message}`));
        if (siteConfig.strictPreRender === true) process.exit(1);
      }
    }

    const elapsed = Date.now() - startTime;

    if (errorCount > 0) {
      console.log(warning(`Pre-render completed with ${errorCount} errors`));
    }

    console.log(success(`Pre-rendered ${successCount} pages in ${elapsed}ms (${(elapsed / successCount).toFixed(1)}ms avg)`));
  }

  /**
   * Pre-compress all rendered content with gzip and brotli
   * Opt-in feature for production dynamic mode
   */
  async function preCompressContent() {
    if (siteConfig.preCompressContent !== true) {
      return;
    }

    console.log(info('Pre-compressing all pages...'));

    const startTime = Date.now();
    let compressedCount = 0;

    for (const [slug, html] of cacheManager.renderedCache) {
      const buffer = Buffer.from(html);
      const etag = cacheManager.generateETag(buffer);

      try {
        const gzipped = await gzip(buffer);
        cacheManager.compressedBufferCache.set(`gzip:${etag}`, gzipped);

        const brotlied = await brotliCompress(buffer);
        cacheManager.compressedBufferCache.set(`br:${etag}`, brotlied);

        compressedCount++;
      } catch (error) {
        console.error(errorMsg(`Failed to compress ${slug}: ${error.message}`));
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(success(`Pre-compressed ${compressedCount} pages (${compressedCount * 2} formats) in ${elapsed}ms`));
  }

  // ============================================================================
  // CONTENT & THEME RELOADING
  // ============================================================================

  async function reloadTheme() {
    const config = getSiteConfig();

    try {
      console.log(info(`Loading theme: ${config.theme || 'auto-detect'}...`));

      const newTheme = await loadTheme(config.theme, config);

      if (newTheme.activeTheme && newTheme.activeTheme !== '.default' && newTheme.validation && !newTheme.validation.valid) {
        console.log('');
        console.error(errorMsg(`✗ Theme "${newTheme.activeTheme}" validation failed`));
        console.log('');

        if (newTheme.validation.errors.length > 0) {
          console.log(errorMsg('Errors:'));
          newTheme.validation.errors.forEach(err => {
            console.log(dim(`• ${err}`));
          });
          console.log('');
        }

        if (newTheme.validation.warnings.length > 0) {
          console.log(warning('Warnings:'));
          newTheme.validation.warnings.forEach(warn => {
            console.log(dim(`• ${warn}`));
          });
          console.log('');
        }

        if (config.forceTheme !== true) {
          console.log(info('Fix:'));
          console.log(dim('1. Fix the errors listed above'));
          console.log(dim('2. Set forceTheme: true in config.json (not recommended)'));
          console.log(dim('3. Switch to a different theme in config.json'));
          console.log('');
          console.log(warning('Keeping previous working theme loaded'));
          return;
        } else {
          console.log('');
          console.log(warning('forceTheme enabled - loading broken theme anyway'));
          console.log(warning('Pages may fail to render or show errors'));
          console.log('');
        }
      }

      if (newTheme.validation && newTheme.validation.warnings.length > 0) {
        console.log(warning(`Theme "${newTheme.activeTheme}" has warnings:`));
        newTheme.validation.warnings.forEach(warn => {
          console.log(dim(`• ${warn}`));
        });
        console.log('');
      }

      templatesCache = newTheme.templatesCache;
      themeAssets = newTheme.themeAssets;
      activeTheme = newTheme.activeTheme;
      themeMetadata = newTheme.themeMetadata;

      cacheManager.dynamicContentCache.delete('404.html');

      // CRITICAL: Flush cache on theme change in Dynamic Mode
      cacheManager.clearAll();

      console.log(success(`✓ Theme "${activeTheme}" loaded successfully`));
      broadcastReload();

    } catch (error) {
      console.log('');
      console.error(errorMsg(`Failed to reload theme: ${error.message}`));
      console.log(warning('Keeping previous theme loaded'));
      console.log('');
    }
  }

  // IT'S OVER, this surgical updates are tricky but KEEP THIS FUNCTION COMMENTED OUT FOR DOCS, DO NOT REMOVE IT
  // function loadSingleContent(filename) {
  //   const webPath = normalizeToWebPath(filename);
  //   if (!/\.(md|txt|html)$/i.test(webPath)) return null;

  //   try {
  //     const fullPath = path.join(contentRoot, filename);
  //     const result = processContentFile(fullPath, filename, contentMode, contentRoot, siteConfig);

  //     if (!result) {
  //       console.log(dim(`Skipped draft: ${path.basename(filename)}`));
  //       return null;
  //     }

  //     contentCache.set(result.slug, result.entry);
  //     slugMap.set(webPath, result.slug);

  //     if (result.imageReferences.length > 0) {
  //       imageReferences.set(webPath, result.imageReferences);
  //     }

  //     console.log(success(`Entry '${path.basename(filename)}' loaded`));
  //     invalidateDynamicCaches();
  //     return result.slug;
  //   } catch (error) {
  //     console.error(errorMsg(`Error loading '${path.basename(filename)}': ${error.message}`));
  //     return null;
  //   }
  // }

  // ============================================================================
  // INITIALIZATION SEQUENCE
  // ============================================================================

  console.log(bright('Initializing Dynamic Engine...\n'));

  const initialLoad = loadAllContent();
  contentCache = initialLoad.contentCache;
  slugMap = initialLoad.slugMap;
  navigation = initialLoad.navigation;
  imageReferences = initialLoad.imageReferences;
  brokenImages = initialLoad.brokenImages;
  contentMode = initialLoad.mode;
  contentRoot = initialLoad.contentRoot;

  siteConfig = getSiteConfig();

  await reloadTheme();

  if (!templatesCache.has('index')) {
    console.log('');
    console.error(errorMsg('FATAL: Missing required template: index.html'));
    console.log('');
    console.log(info('The active theme must provide index.html'));
    console.log(dim('Fix:'));
    console.log(dim('1. Add index.html to your theme'));
    console.log(dim('2. Switch theme in config.json'));
    console.log(dim('3. Set theme: ".default" to use embedded theme'));
    console.log('');
    process.exit(1);
  }

  if (!templatesCache.has('entry')) {
    console.log('');
    console.error(errorMsg('FATAL: Missing required template: entry.html'));
    console.log('');
    console.log(info('The active theme must provide entry.html'));
    console.log(dim('Fix:'));
    console.log(dim('1. Add entry.html to your theme'));
    console.log(dim('2. Switch theme in config.json'));
    console.log(dim('3. Set theme: ".default" to use embedded theme'));
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

  console.log(info('Generating search index...'));
  const searchIndex = generateSearchIndex(contentCache);
  cacheManager.dynamicContentCache.set('search.json', { content: searchIndex });
  console.log(success('Search index ready'));

  await preRenderAllContent();
  await preCompressContent();

  // ============================================================================
  // FILE WATCHING
  // ============================================================================

  try {
    watch(contentRoot, { recursive: true }, async (event, filename) => {
      if (!filename) return;

      if (shouldIgnore(path.basename(filename))) return;

      if (isInDraftsFolder(filename)) return;

      const webPath = normalizeToWebPath(filename);

      try {
        if (/\.(md|txt|html)$/i.test(webPath)) {
          console.log(info(`Content: ${event} - ${path.basename(filename)}`));
          scheduleFullReload();
        }

        if (/\.(jpg|jpeg|png|webp|avif|gif)$/i.test(filename)) {
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

  // ============================================================================
  // SERVER & METRICS
  // ============================================================================

  setInterval(() => {
    if (metrics.requests > 0) {
      const totalCacheHits = metrics.httpCacheHits + metrics.serverCacheHits;
      const totalAttempts = totalCacheHits + metrics.serverRenderHits;
      const hitRate = totalAttempts > 0 ? ((totalCacheHits / totalAttempts) * 100).toFixed(1) : '0.0';
      const avgTime = metrics.responseTimes.length > 0
        ? (metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length).toFixed(2)
        : '0.00';

      console.log(dim(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${metrics.requests} req/10s | Avg: ${avgTime}ms | Cache: ${hitRate}% (HTTP304: ${metrics.httpCacheHits}, Cached: ${metrics.serverCacheHits}, Rendered: ${metrics.serverRenderHits})`));
    }
    metrics.requests = 0;
    metrics.httpCacheHits = 0;
    metrics.serverCacheHits = 0;
    metrics.serverRenderHits = 0;
    metrics.responseTimes = [];
  }, METRICS_INTERVAL_MS);

  let port;
  if (process.env.PORT) {
    port = parseInt(process.env.PORT, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(errorMsg(`Invalid PORT value: ${process.env.PORT}`));
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
    idleTimeout: process.env.THYPRESS_IDLE_TIMEOUT
      ? parseInt(process.env.THYPRESS_IDLE_TIMEOUT)
      : 0,

    async fetch(request, server) {
      const startTime = Date.now();

      try {
        metrics.requests++;

        // Security validation layer
        const ip = securityManager.getClientIP(request);

        // Check IP ban
        if (securityManager.isIPBanned(ip)) {
          return new Response(null, { status: 403 });
        }

        // Validate request headers
        const validation = securityManager.validateRequest(request);
        if (!validation.valid) {
          console.log(`[SECURITY] Rejected request: ${validation.error}`);
          return new Response('Forbidden', { status: 403 });
        }

        const deps = {
          contentCache,
          slugMap,
          navigation,
          imageReferences,
          brokenImages,
          contentMode,
          contentRoot,
          templatesCache,
          themeAssets,
          activeTheme,
          siteConfig,
          themeMetadata,
          redirectRules,
          liveReloadClients,
          isBuildingStatic: false, // Explicitly false in dynamic mode
          cacheManager,
          metrics,
          preRenderAllContent,
          preCompressContent,
          securityManager // Pass security manager to routes
        };

        return await handleRequest(request, server, deps);
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

  // Generate magic link for CLI output
  const magicToken = securityManager.generateMagicToken();
  const adminUrl = `${serverUrl}/__thypress_${securityManager.adminSecret}/?token=${magicToken}`;

  console.log(bright(`\n• Server running on ${serverUrl}`));
  console.log(dim(`• Mode: Dynamic`));
  console.log(dim(`• Content root: ${contentRoot}`));
  console.log(dim(`• Live reload: enabled`));
  console.log(bright(`• Admin panel: ${adminUrl}`));

  const shouldOpenBrowser = process.env.THYPRESS_OPEN_BROWSER === 'true';
  if (shouldOpenBrowser) {
    console.log(info('Opening browser...\n'));
    openBrowser(serverUrl); // Opens site homepage — admin link is printed to console above
  }

  setupGracefulShutdown({ liveReloadClients });
}
