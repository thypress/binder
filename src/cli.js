/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#!/usr/bin/env bun
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMBEDDED_TEMPLATES } from './embedded-templates.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let command = 'serve';
  let postsDir = null;
  let openBrowser = true;
  let serveAfterBuild = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Check for help
    if (arg === 'help' || arg === '--help' || arg === '-h') {
      command = 'help';
      break;
    }

    // Check for clean command
    if (arg === 'clean') {
      command = 'clean';
      continue;
    }

    // Check for build command
    if (arg === 'build' || arg === 'b') {
      command = 'build';
      continue;
    }

    // Check for serve command
    if (arg === 'serve' || arg === 'dev' || arg === 's') {
      command = 'serve';
      continue;
    }

    // Check for --serve flag (for build --serve)
    if (arg === '--serve') {
      serveAfterBuild = true;
      continue;
    }

    // Check for no-browser flag
    if (arg === '--no-browser' || arg === '--no-open') {
      openBrowser = false;
      continue;
    }

    // Check for posts directory flags
    if (arg === '--posts' || arg === '--posts-dir' || arg === '-p') {
      postsDir = args[i + 1];
      i++;
      continue;
    }

    // Check if it's a path (directory)
    if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
      postsDir = arg;
      continue;
    }

    // Check if it looks like a path (contains / or \)
    if (arg.includes('/') || arg.includes('\\')) {
      postsDir = arg;
      continue;
    }
  }

  // Resolve posts directory
  if (postsDir) {
    postsDir = path.resolve(postsDir);
  } else {
    postsDir = path.join(process.cwd(), 'posts');
  }

  return { command, postsDir, openBrowser, serveAfterBuild };
}

const { command, postsDir, openBrowser, serveAfterBuild } = parseArgs();

// Set the working directory context based on posts location
const workingDir = path.dirname(postsDir);
const postsFolder = path.basename(postsDir);

function ensureDefaults() {
  // Create posts directory if it doesn't exist
  if (!fs.existsSync(postsDir)) {
    fs.mkdirSync(postsDir, { recursive: true });
    console.log(`✓ Created ${postsDir}`);
  }

  // Create assets directory in the same location as posts
  const assetsDir = path.join(workingDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // Create config if missing
  const configPath = path.join(workingDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      title: "My Blog",
      description: "A blog powered by thypress",
      url: "https://example.com",
      author: "Anonymous"
    }, null, 2));
    console.log(`✓ Created ${configPath}`);
  }

  // Create templates from embedded data
  const templates = [
    { name: 'index.html', content: EMBEDDED_TEMPLATES['index.html'] },
    { name: 'post.html', content: EMBEDDED_TEMPLATES['post.html'] },
    { name: 'tag.html', content: EMBEDDED_TEMPLATES['tag.html'] },
    { name: 'style.css', content: EMBEDDED_TEMPLATES['style.css'] }
  ];

  let created = false;
  templates.forEach(({ name, content }) => {
    const dest = path.join(assetsDir, name);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, content);
      console.log(`✓ Created ${dest}`);
      created = true;
    }
  });

  if (created) console.log('');

  // Ensure .gitignore exists and contains .cache/ and build/
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
      console.log(`✓ Updated .gitignore (added ${newLines.join(', ')})`);
    }
  }
}

function createExamplePost() {
  if (fs.existsSync(postsDir)) {
    const mdFiles = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));
    if (mdFiles.length === 0) {
      const examplePost = path.join(postsDir, '2024-01-01-welcome.md');
      fs.writeFileSync(examplePost, `---
title: Welcome to thypress!
date: 2024-01-01
tags: [blogging, markdown]
description: Your first post with thypress
---

# Welcome to thypress!

This is your first post. Create more \`.md\` files in \`${postsFolder}/\`.

## Front Matter

Add YAML front matter to your posts:

\`\`\`yaml
---
title: My Post Title
date: 2024-01-01
tags: [tag1, tag2]
description: A short description
---
\`\`\`

## Features

- Write in Markdown
- Organize with tags
- Folder-based navigation for docs
- Client-side search with Fuse.js
- Auto-generated RSS feed
- Auto-generated sitemap
- Image optimization (WebP + responsive)
- Syntax highlighting
- Blazing fast hot reload

## Code Example

\`\`\`javascript
function greet(name) {
  console.log(\`Hello, \${name}!\`);
}

greet('World');
\`\`\`

Happy blogging!
`);
      console.log(`✓ Created example post at ${examplePost}\n`);
    }
  }
}

async function serve() {
  console.log(`Using posts directory: ${postsDir}\n`);
  ensureDefaults();
  createExamplePost();

  // Set environment variable for renderer
  process.env.THYPRESS_POSTS_DIR = postsDir;
  process.env.THYPRESS_OPEN_BROWSER = openBrowser ? 'true' : 'false';

  // Change to working directory before starting server
  process.chdir(workingDir);

  await import('./server.js');
}

async function build() {
  console.log(`Using posts directory: ${postsDir}\n`);
  ensureDefaults();

  // Set environment variable for renderer
  process.env.THYPRESS_POSTS_DIR = postsDir;

  // Change to working directory before building
  process.chdir(workingDir);

  const module = await import('./build.js');
  await module.build();
}

async function buildAndServe() {
  console.log(`Using posts directory: ${postsDir}\n`);
  ensureDefaults();

  process.env.THYPRESS_POSTS_DIR = postsDir;
  process.chdir(workingDir);

  // First build
  const buildModule = await import('./build.js');
  await buildModule.build();

  console.log('\n' + '='.repeat(50));
  console.log('Starting preview server for /build...\n');

  // Then serve the build directory
  const buildDir = path.join(workingDir, 'build');

  if (!fs.existsSync(buildDir)) {
    console.error('Error: /build directory not found. Build may have failed.');
    process.exit(1);
  }

  // Simple static file server for build directory
  const START_PORT = 3009;
  const MAX_PORT_TRIES = 100;

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
    throw new Error(`Could not find available port`);
  }

  const port = await findAvailablePort(START_PORT);

  Bun.serve({
    port,
    fetch(request) {
      const url = new URL(request.url);
      let filePath = path.join(buildDir, url.pathname);

      // Serve index.html for directory requests
      if (url.pathname.endsWith('/')) {
        filePath = path.join(filePath, 'index.html');
      }

      // If no extension, try adding index.html
      if (!path.extname(filePath)) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          filePath = indexPath;
        }
      }

      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath);
          const ext = path.extname(filePath).substring(1);

          const mimeTypes = {
            'html': 'text/html',
            'css': 'text/css',
            'js': 'text/javascript',
            'json': 'application/json',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'xml': 'application/xml'
          };

          return new Response(content, {
            headers: {
              'Content-Type': mimeTypes[ext] || 'application/octet-stream'
            }
          });
        }
      } catch (error) {
        console.error(`Error serving ${filePath}:`, error.message);
      }

      return new Response('Not Found', { status: 404 });
    }
  });

  const serverUrl = `http://localhost:${port}`;
  console.log(`✓ Preview server running at ${serverUrl}`);
  console.log(`  Serving static files from /build`);
  console.log(`  Press Ctrl+C to stop\n`);

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
    console.log(`✓ Cleaned .cache directory`);
  } else {
    console.log('No .cache directory found');
  }
}

function help() {
  console.log(`
thypress v0.1 - Simple markdown blog/docs engine

Usage:
  thypress [command] [options]

Commands:
  serve, s, dev           Start server with hot reload (default)
  build, b                Build static site to /build
  build --serve           Build static site and preview it
  clean                   Delete .cache directory
  help, --help, -h        Show this help

Options:
  --posts, -p <path>      Specify posts directory
  --no-browser            Don't auto-open browser
  <path>                  Directly specify posts directory

Examples:
  thypress                           # Serve from ./posts
  thypress serve                     # Same as above
  thypress --no-browser              # Serve without opening browser
  thypress build                     # Build static site
  thypress build --serve             # Build and preview
  thypress clean                     # Clear image cache

  thypress /path/to/posts            # Use specific posts folder
  thypress --posts /path/to/posts    # Same, with explicit flag
  thypress -p ~/my-blog/posts        # Short flag version

  thypress build --posts ~/blog/posts    # Build from specific location

  # Drag & drop:
  # Just drag your posts folder onto the thypress binary!

Features:
  • Front matter support (title, date, tags, description)
  • Folder-based navigation (for docs)
  • Images alongside posts (auto-optimized)
  • Tag pages
  • Client-side search (Fuse.js)
  • RSS feed (/rss.xml)
  • Sitemap (/sitemap.xml)
  • Image optimization (WebP + responsive)
  • Syntax highlighting
  • Hot reload in serve mode
  • Pagination

Image Optimization:
  • Put images next to your markdown files
  • Serve mode: Images cached in .cache/ (gitignored)
  • Build mode: Optimized to build/post/
  • Auto-cleanup of orphaned images

Documentation:
  https://github.com/thypress/thypress

That's it!
`);
}

switch (command) {
  case 'serve':
    serve();
    break;
  case 'build':
    if (serveAfterBuild) {
      buildAndServe();
    } else {
      build();
    }
    break;
  case 'clean':
    clean();
    break;
  case 'help':
    help();
    break;
  default:
    console.log(`Unknown command: ${command}`);
    console.log('Run \`thypress help\` for usage.\n');
    process.exit(1);
}
