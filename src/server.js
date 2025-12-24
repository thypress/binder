/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import fs from 'fs';
import { watch } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
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
  getSiteConfig
} from './renderer.js';
import { optimizeToCache, CACHE_DIR } from './build.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const START_PORT = 3009;
const MAX_PORT_TRIES = 100;
const DEBOUNCE_DELAY = 500; // ms

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
  return types[ext] || 'text/plain';
}

async function reloadPosts() {
  const result = loadAllPosts();
  postsCache = result.postsCache;
  slugMap = result.slugMap;
  navigation = result.navigation;
  imageReferences = result.imageReferences;
  brokenImages = result.brokenImages;

  // Schedule image optimization with debouncing
  scheduleImageOptimization();
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
}

function loadSinglePost(filename) {
  if (!filename.endsWith('.md') && !filename.endsWith('.txt')) return;

  const postsDir = process.env.thypress_POSTS_DIR || path.join(__dirname, '../posts');

  try {
    const isMarkdown = filename.endsWith('.md');
    const slug = slugify(filename.replace(/\.(md|txt)$/, ''));
    slugMap.set(filename, slug);

    const rawContent = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
    const { data: frontMatter, content } = matter(rawContent);

    const env = { postRelativePath: filename, referencedImages: [] };
    const renderedHtml = isMarkdown ? md.render(content, env) : `<pre>${content}</pre>`;

    if (env.referencedImages.length > 0) {
      imageReferences.set(filename, env.referencedImages);
    }

    // Smart title extraction
    let title = frontMatter.title;
    if (!title && isMarkdown) {
      const h1Match = content.match(/^#\s+(.+)$/m);
      if (h1Match) {
        title = h1Match[1].trim();
      }
    }
    if (!title) {
      title = filename
        .replace(/\.(md|txt)$/, '')
        .replace(/^\d{4}-\d{2}-\d{2}-/, '')
        .replace(/[-_]/g, ' ')
        .trim() || filename.replace(/\.(md|txt)$/, '');
    }

    // Smart date extraction
    let date = frontMatter.date;
    if (!date) {
      const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        date = dateMatch[1];
      }
    }
    if (!date) {
      const stats = fs.statSync(path.join(postsDir, filename));
      date = stats.mtime.toISOString().split('T')[0];
    }
    if (date instanceof Date) {
      date = date.toISOString().split('T')[0];
    }

    const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []);
    const description = frontMatter.description || '';

    postsCache.set(slug, {
      filename: filename,
      slug: slug,
      title: title,
      date: date,
      tags: tags,
      description: description,
      content: content,
      renderedHtml: renderedHtml,
      frontMatter: frontMatter,
      relativePath: filename
    });
    console.log(`✓ Post '${filename}' loaded`);
  } catch (error) {
    console.error(`Error loading post '${filename}': ${error.message}`);
  }
}

function loadSingleTemplate(name) {
  try {
    const assetsDir = path.join(process.cwd(), 'assets');
    const html = fs.readFileSync(path.join(assetsDir, `${name}.html`), 'utf-8');
    const compiled = Handlebars.compile(html);
    templatesCache.set(name, compiled);
    console.log(`✓ Template '${name}' compiled`);
  } catch (error) {
    console.error(`Error loading template '${name}': ${error.message}`);
  }
}

// Initialize everything
console.log('Initializing server...\n');
await reloadPosts();
reloadTemplates();

// Optimize images on startup
if (!isOptimizingImages && imageReferences.size > 0) {
  isOptimizingImages = true;
  await optimizeToCache(imageReferences, brokenImages);
  isOptimizingImages = false;
}

// Watch posts directory
const postsDir = process.env.thypress_POSTS_DIR || path.join(__dirname, '../posts');
try {
  watch(postsDir, { recursive: true }, async (event, filename) => {
    if (!filename) return;

    try {
      // Handle markdown/txt changes
      if (filename.endsWith('.md') || filename.endsWith('.txt')) {
        console.log(`Posts: ${event} - ${filename}`);

        if (event === 'rename') {
          if (fs.existsSync(path.join(postsDir, filename))) {
            loadSinglePost(filename);
            const result = loadAllPosts();
            navigation = result.navigation;
            imageReferences = result.imageReferences;

            // Schedule image optimization
            scheduleImageOptimization();
          } else {
            const slug = slugMap.get(filename);
            if (slug) {
              postsCache.delete(slug);
              slugMap.delete(filename);
              imageReferences.delete(filename);
              console.log(`✓ Post '${filename}' removed from cache`);
            }
          }
        } else if (event === 'change') {
          loadSinglePost(filename);

          // Schedule image optimization
          scheduleImageOptimization();
        }
      }

      // Handle image changes
      if (/\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
        console.log(`Images: ${event} - ${filename}`);

        // Schedule image optimization
        scheduleImageOptimization();
      }
    } catch (error) {
      console.error(`Error processing change: ${error.message}`);
    }
  });
  console.log('✓ Watching /posts for changes');
} catch (error) {
  console.error(`Could not watch /posts directory: ${error.message}`);
}

// Watch templates
try {
  const assetsDir = path.join(process.cwd(), 'assets');
  watch(assetsDir, (event, filename) => {
    if (!filename) return;

    try {
      console.log(`Templates: ${event} - ${filename}`);

      if (filename === 'index.html') {
        loadSingleTemplate('index');
      } else if (filename === 'post.html') {
        loadSingleTemplate('post');
      } else if (filename === 'tag.html') {
        loadSingleTemplate('tag');
      }
    } catch (error) {
      console.error(`Error processing template change: ${error.message}`);
    }
  });
  console.log('✓ Watching /assets for template changes');
} catch (error) {
  console.error(`Could not watch /assets directory: ${error.message}`);
}

// Watch config
try {
  watch(process.cwd(), (event, filename) => {
    if (filename === 'config.json') {
      siteConfig = getSiteConfig();
      console.log('✓ Config reloaded');
    }
  });
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
      console.log(`✓ Server running at ${url} (could not auto-open browser)`);
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
  console.log(`ℹ️  Port ${START_PORT} in use, using ${port} instead\n`);
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const route = url.pathname;

    try {
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
    <p><strong>Server:</strong> http://localhost:${port}</p>
  </div>

  <h2>Build Static Site</h2>
  <p>Generate a complete static build in /build folder for deployment.</p>

  <button id="buildBtn" class="button" onclick="buildSite()">Build Static Site</button>

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
          setStatus('✓ Build complete! Check the /build folder.', 'success');
        } else {
          setStatus('Build failed: ' + data.error, 'error');
        }
      } catch (error) {
        setStatus('Build failed: ' + error.message, 'error');
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

      // Serve images from .cache/post/ directory
      if (route.startsWith('/post/') && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(route)) {
        const imagePath = route.substring(6); // Remove '/post/'
        const cachedPath = path.join(CACHE_DIR, 'post', imagePath);

        try {
          if (fs.existsSync(cachedPath)) {
            const fileContents = fs.readFileSync(cachedPath);
            return new Response(fileContents, {
              headers: { 'Content-Type': getMimeType(cachedPath) }
            });
          }
        } catch (error) {
          // Fall through to 404
        }

        return new Response('Image not found', { status: 404 });
      }

      // Search index JSON
      if (route === '/search.json') {
        const searchIndex = generateSearchIndex(postsCache);
        return new Response(searchIndex, {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // RSS feed
      if (route === '/rss.xml') {
        const rss = generateRSS(postsCache, siteConfig);
        return new Response(rss, {
          headers: { 'Content-Type': 'application/xml; charset=utf-8' }
        });
      }

      // Sitemap
      if (route === '/sitemap.xml') {
        const sitemap = await generateSitemap(postsCache, siteConfig);
        return new Response(sitemap, {
          headers: { 'Content-Type': 'application/xml; charset=utf-8' }
        });
      }

      // Serve static files from assets
      if (route.startsWith('/assets/')) {
        const filePath = path.join(process.cwd(), route);
        try {
          const fileContents = fs.readFileSync(filePath);
          return new Response(fileContents, {
            headers: { 'Content-Type': getMimeType(filePath) }
          });
        } catch (error) {
          return new Response('File not found', { status: 404 });
        }
      }

      // Tag pages
      if (route.startsWith('/tag/')) {
        const tag = route.substring(5).replace(/\/$/, '');
        try {
          const html = renderTagPage(postsCache, tag, templatesCache, navigation);
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
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
            return new Response(html, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
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
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      // Specific blog post
      if (route.startsWith('/post/')) {
        const slug = route.substring(6).replace(/\/$/, '');
        const post = postsCache.get(slug);

        if (!post) {
          return new Response('Post not found', { status: 404 });
        }

        try {
          const html = renderPost(post, slug, templatesCache, navigation, siteConfig);
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        } catch (error) {
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error(`Request error: ${error.message}`);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
});

const serverUrl = `http://localhost:${port}`;

console.log(`
• Server running on ${serverUrl}
• Put markdown files in /posts
• Put images next to your markdown files
• Edit templates in /assets
• Admin panel: ${serverUrl}/__thypress/
• Images cached in /.cache (auto-managed)
`);

// Auto-open browser if flag is set
const shouldOpenBrowser = process.env.thypress_OPEN_BROWSER === 'true';
if (shouldOpenBrowser) {
  console.log('Opening browser...\n');
  openBrowser(serverUrl);
}
