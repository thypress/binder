/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// #!/usr/bin/env bun
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { EMBEDDED_TEMPLATES } from './embedded-templates.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

// Import version from package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
);
const VERSION = packageJson.version;

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let command = 'serve';
  let postsDir = null;
  let openBrowser = true;
  let serveAfterBuild = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === 'help' || arg === '--help' || arg === '-h') {
      command = 'help';
      break;
    }

    if (arg === 'version' || arg === '--version' || arg === '-v') {
      command = 'version';
      break;
    }

    if (arg === 'clean') {
      command = 'clean';
      continue;
    }

    if (arg === 'build' || arg === 'b') {
      command = 'build';
      continue;
    }

    if (arg === 'serve' || arg === 'dev' || arg === 's') {
      command = 'serve';
      continue;
    }

    if (arg === '--serve') {
      serveAfterBuild = true;
      continue;
    }

    if (arg === '--no-browser' || arg === '--no-open') {
      openBrowser = false;
      continue;
    }

    if (arg === '--posts' || arg === '--posts-dir' || arg === '-p') {
      postsDir = args[i + 1];
      i++;
      continue;
    }

    if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
      postsDir = arg;
      continue;
    }

    if (arg.includes('/') || arg.includes('\\')) {
      postsDir = arg;
      continue;
    }
  }

  if (postsDir) {
    postsDir = path.resolve(postsDir);
  } else {
    postsDir = path.join(process.cwd(), 'posts');
  }

  return { command, postsDir, openBrowser, serveAfterBuild };
}

const { command, postsDir, openBrowser, serveAfterBuild } = parseArgs();

const workingDir = path.dirname(postsDir);
const postsFolder = path.basename(postsDir);

function checkTemplatesStaleness() {
  const templatesDir = path.join(__dirname, '../templates');
  const embeddedFile = path.join(__dirname, 'embedded-templates.js');

  if (!fs.existsSync(templatesDir) || !fs.existsSync(embeddedFile)) return;

  const files = fs.readdirSync(templatesDir);
  let newestMtime = 0;
  for (const file of files) {
    const filePath = path.join(templatesDir, file);
    if (fs.statSync(filePath).isFile()) {
      const mtime = fs.statSync(filePath).mtime.getTime();
      if (mtime > newestMtime) newestMtime = mtime;
    }
  }

  const embeddedMtime = fs.statSync(embeddedFile).mtime.getTime();

  if (newestMtime > embeddedMtime) {
    console.log(warning('Templates modified since last embed'));
    console.log(dim('Run: bun src/embed-templates.js'));
    console.log('');
  }
}

function ensureDefaults() {
  if (!fs.existsSync(postsDir)) {
    fs.mkdirSync(postsDir, { recursive: true });
    console.log(success(`Created ${postsDir}`));
  }

  const assetsDir = path.join(workingDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const configPath = path.join(workingDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      title: "My Blog",
      description: "A blog powered by THYPRESS",
      url: "https://example.com",
      author: "Anonymous"
    }, null, 2));
    console.log(success(`Created ${configPath}`));
  }

  const templates = [
    { name: 'index.html', content: EMBEDDED_TEMPLATES['index.html'] },
    { name: 'post.html', content: EMBEDDED_TEMPLATES['post.html'] },
    { name: 'tag.html', content: EMBEDDED_TEMPLATES['tag.html'] },
    { name: 'style.css', content: EMBEDDED_TEMPLATES['style.css'] },
    { name: 'robots.txt', content: EMBEDDED_TEMPLATES['robots.txt'] },
    { name: 'llms.txt', content: EMBEDDED_TEMPLATES['llms.txt'] },
    { name: '404.html', content: EMBEDDED_TEMPLATES['404.html'] }
  ];

  let created = false;
  templates.forEach(({ name, content }) => {
    const dest = path.join(assetsDir, name);
    if (!fs.existsSync(dest)) {
      if (content && typeof content === 'string') {
        fs.writeFileSync(dest, content);
        console.log(success(`Created ${dest}`));
        created = true;
      } else {
        console.log(warning(`Skipping ${name} - not in embedded templates`));
      }
    }
  });

  if (created) console.log('');
  ensureGitignore();
}

function ensureGitignore() {
  const gitignorePath = path.join(workingDir, '.gitignore');
  const requiredEntries = ['.cache/', 'build/'];

  let gitignoreContent = '';
  let needsUpdate = false;

  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');

    for (const entry of requiredEntries) {
      if (!gitignoreContent.includes(entry)) {
        needsUpdate = true;
        break;
      }
    }
  } else {
    needsUpdate = true;
  }

  if (needsUpdate) {
    const existingLines = gitignoreContent.split('\n').filter(line => line.trim());
    const newLines = [];

    for (const entry of requiredEntries) {
      if (!existingLines.includes(entry.replace('/', ''))) {
        newLines.push(entry);
      }
    }

    if (newLines.length > 0) {
      const updatedContent = existingLines.length > 0
        ? gitignoreContent.trim() + '\n\n# THYPRESS cache and build\n' + newLines.join('\n') + '\n'
        : '# THYPRESS cache and build\n' + newLines.join('\n') + '\n';

      fs.writeFileSync(gitignorePath, updatedContent);
      console.log(success(`Updated .gitignore`));
    }
  }
}

function createExamplePost() {
  if (fs.existsSync(postsDir)) {
    const mdFiles = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));
    if (mdFiles.length === 0) {
      const examplePost = path.join(postsDir, '2024-01-01-welcome.md');
      fs.writeFileSync(examplePost, `---
title: Welcome to THYPRESS!
createdAt: 2024-01-01
updatedAt: 2024-01-15
tags: [blogging, markdown]
description: Your first post with THYPRESS
---

# Welcome to THYPRESS!

This is your first post. Create more \`.md\` files in \`${postsFolder}/\`.

## Front Matter

Add YAML front matter to your posts:

\`\`\`yaml
---
title: My Post Title
createdAt: 2024-01-01
updatedAt: 2024-01-15
tags: [tag1, tag2]
description: A short description
---
\`\`\`

## Features

- Write in Markdown
- Organize with tags
- Folder-based navigation
- Client-side search (MiniSearch)
- Auto-generated RSS & sitemap
- Image optimization (WebP + responsive)
- Syntax highlighting
- Blazing fast hot reload
- HTTP caching + compression

Happy blogging!
`);
      console.log(success(`Created example post\n`));
    }
  }
}

async function serve() {
  console.log(info(`Using posts directory: ${postsDir}\n`));
  checkTemplatesStaleness();
  ensureDefaults();
  createExamplePost();

  process.env.THYPRESS_POSTS_DIR = postsDir;
  process.env.THYPRESS_OPEN_BROWSER = openBrowser ? 'true' : 'false';
  process.chdir(workingDir);

  await import('./server.js');
}

async function build() {
  console.log(info(`Using posts directory: ${postsDir}\n`));
  checkTemplatesStaleness();
  ensureDefaults();

  process.env.THYPRESS_POSTS_DIR = postsDir;
  process.chdir(workingDir);

  const module = await import('./build.js');
  await module.build();
}

async function buildAndServe() {
  console.log(info(`Using posts directory: ${postsDir}\n`));
  checkTemplatesStaleness();
  ensureDefaults();

  process.env.THYPRESS_POSTS_DIR = postsDir;
  process.chdir(workingDir);

  const buildModule = await import('./build.js');
  await buildModule.build();

  console.log('\n' + '='.repeat(50));
  console.log(bright('Starting preview server for /build...\n'));

  const buildDir = path.join(workingDir, 'build');

  if (!fs.existsSync(buildDir)) {
    console.error(errorMsg('Error: /build not found'));
    process.exit(1);
  }

  // OPTIMIZED BUILD PREVIEW SERVER
  const START_PORT = 3009;
  const MAX_PORT_TRIES = 100;

  // In-memory cache for build preview
  const buildCache = new Map();
  const MAX_BUILD_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
  let currentBuildCacheSize = 0;

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
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'xml': 'application/xml; charset=utf-8'
    };
    return types[ext] || 'application/octet-stream';
  }

  function generateETag(content) {
    return `"${crypto.createHash('md5').update(content).digest('hex')}"`;
  }

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

  const port = await findAvailablePort(START_PORT);

  if (port !== START_PORT) {
    console.log(info(`Using port ${port}\n`));
  }

  Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      let filePath = path.join(buildDir, url.pathname);

      // Directory → index.html
      if (url.pathname.endsWith('/')) {
        filePath = path.join(filePath, 'index.html');
      }

      // No extension → try index.html
      if (!path.extname(filePath)) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          filePath = indexPath;
        }
      }

      const cacheKey = filePath;

      try {
        // Check cache
        if (buildCache.has(cacheKey)) {
          const cached = buildCache.get(cacheKey);
          const ifNoneMatch = request.headers.get('if-none-match');

          if (ifNoneMatch === cached.etag) {
            return new Response(null, {
              status: 304,
              headers: {
                'ETag': cached.etag,
                'Cache-Control': cached.cacheControl
              }
            });
          }

          const acceptEncoding = request.headers.get('accept-encoding') || '';
          let content = cached.raw;
          let encoding = null;

          if (acceptEncoding.includes('br') && cached.brotli) {
            content = cached.brotli;
            encoding = 'br';
          } else if (acceptEncoding.includes('gzip') && cached.gzip) {
            content = cached.gzip;
            encoding = 'gzip';
          }

          const headers = {
            'Content-Type': cached.mimeType,
            'ETag': cached.etag,
            'Cache-Control': cached.cacheControl
          };

          if (encoding) headers['Content-Encoding'] = encoding;

          return new Response(content, { headers });
        }

        // Load from disk
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = await fsPromises.readFile(filePath);
          const mimeType = getMimeType(filePath);
          const etag = generateETag(content);

          const cacheControl = mimeType.includes('image') || mimeType.includes('font')
            ? 'public, max-age=31536000, immutable'
            : mimeType.includes('css') || mimeType.includes('javascript')
            ? 'public, max-age=86400, immutable'
            : 'public, max-age=3600';

          // Pre-compress text-based files
          let gzipData = null;
          let brotliData = null;

          if (content.length > 1024 && (
            mimeType.includes('text') ||
            mimeType.includes('html') ||
            mimeType.includes('javascript') ||
            mimeType.includes('json') ||
            mimeType.includes('xml') ||
            mimeType.includes('css')
          )) {
            [gzipData, brotliData] = await Promise.all([
              gzip(content, { level: 6 }),
              brotliCompress(content, {
                params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 }
              })
            ]);
          }

          // Cache it
          if (content.length < 10 * 1024 * 1024) {
            buildCache.set(cacheKey, {
              raw: content,
              mimeType,
              etag,
              cacheControl,
              gzip: gzipData,
              brotli: brotliData
            });

            currentBuildCacheSize += content.length;
            if (gzipData) currentBuildCacheSize += gzipData.length;
            if (brotliData) currentBuildCacheSize += brotliData.length;

            // Simple LRU eviction
            while (currentBuildCacheSize > MAX_BUILD_CACHE_SIZE) {
              const firstKey = buildCache.keys().next().value;
              const firstItem = buildCache.get(firstKey);
              currentBuildCacheSize -= firstItem.raw.length;
              if (firstItem.gzip) currentBuildCacheSize -= firstItem.gzip.length;
              if (firstItem.brotli) currentBuildCacheSize -= firstItem.brotli.length;
              buildCache.delete(firstKey);
            }
          }

          const acceptEncoding = request.headers.get('accept-encoding') || '';
          let finalContent = content;
          let encoding = null;

          if (acceptEncoding.includes('br') && brotliData) {
            finalContent = brotliData;
            encoding = 'br';
          } else if (acceptEncoding.includes('gzip') && gzipData) {
            finalContent = gzipData;
            encoding = 'gzip';
          }

          const headers = {
            'Content-Type': mimeType,
            'ETag': etag,
            'Cache-Control': cacheControl
          };

          if (encoding) headers['Content-Encoding'] = encoding;

          return new Response(finalContent, { headers });
        }
      } catch (error) {
        console.error(errorMsg(`Error serving ${filePath}: ${error.message}`));
      }

      return new Response('Not Found', { status: 404 });
    }
  });

  const serverUrl = `http://localhost:${port}`;
  console.log(success(`Preview server: ${serverUrl}`));
  console.log(dim(`  Optimized with caching + compression`));
  console.log(dim(`  Press Ctrl+C to stop\n`));

  if (openBrowser) {
    const { exec } = await import('child_process');
    const start = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${start} ${serverUrl}`);
  }
}

function clean() {
  const cacheDir = path.join(workingDir, '.cache');

  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    console.log(success(`Cleaned .cache`));
  } else {
    console.log(info('No .cache found'));
  }
}

function showVersion() {
  console.log(`THYPRESS v${VERSION}`);
}

function help() {
  console.log(`
${bright('THYPRESS')} v${VERSION} - Simple markdown blog/docs engine

${bright('Usage:')}
  THYPRESS [command] [options]

${bright('Commands:')}
  serve, s, dev           Start server with hot reload (default)
  build, b                Build static site to /build
  build --serve           Build + preview with optimized server
  clean                   Delete .cache
  version, -v             Show version
  help, -h                Show help

${bright('Options:')}
  --posts, -p <path>      Posts directory
  --no-browser            Don't auto-open browser
  <path>                  Direct posts path

${bright('Examples:')}
  THYPRESS                           # Serve from ./posts
  THYPRESS build                     # Build static site
  THYPRESS build --serve             # Build + preview
  THYPRESS --posts ~/blog/posts      # Custom posts dir

${bright('Performance Features:')}
  ✓ HTTP caching (ETag + Cache-Control)
  ✓ Compression (Brotli + gzip)
  ✓ Pre-compressed cache variants
  ✓ Request deduplication
  ✓ Priority-based LRU cache
  ✓ Async I/O throughout

${bright('Docs:')}
  https://github.com/THYPRESS/THYPRESS
`);
}

switch (command) {
  case 'serve':
    checkTemplatesStaleness();
    serve();
    break;
  case 'build':
    checkTemplatesStaleness();
    if (serveAfterBuild) {
      buildAndServe();
    } else {
      build();
    }
    break;
  case 'clean':
    clean();
    break;
  case 'version':
    showVersion();
    break;
  case 'help':
    help();
    break;
  default:
    console.log(errorMsg(`Unknown command: ${command}`));
    console.log(dim('Run `THYPRESS help` for usage.\n'));
    process.exit(1);
}
