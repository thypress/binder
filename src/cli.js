/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';
import { detectContentStructure, loadEmbeddedTemplates } from './renderer.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
);
const VERSION = packageJson.version;

function parseArgs() {
  const args = process.argv.slice(2);
  let command = 'serve';
  let targetDir = null;
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

    if (arg === '--dir' || arg === '-d') {
      targetDir = args[i + 1];
      i++;
      continue;
    }

    if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
      targetDir = arg;
      continue;
    }

    if (arg.includes('/') || arg.includes('\\')) {
      targetDir = arg;
      continue;
    }
  }

  if (targetDir) {
    targetDir = path.resolve(targetDir);
  } else {
    targetDir = process.cwd();
  }

  return { command, targetDir, openBrowser, serveAfterBuild };
}

const { command, targetDir, openBrowser, serveAfterBuild } = parseArgs();

async function ensureDefaults() {
  console.log(info(`Working directory: ${targetDir}\n`));

  const { contentRoot, mode, shouldInit } = detectContentStructure(targetDir);

  if (shouldInit) {
    // Create content/posts/ structure
    const postsDir = path.join(contentRoot, 'posts');
    fs.mkdirSync(postsDir, { recursive: true });
    console.log(success(`Created ${contentRoot}`));

    // Create example post with updated conventions documentation
    const examplePost = path.join(postsDir, '2024-01-01-welcome.md');
    fs.writeFileSync(examplePost, `---
title: Welcome to THYPRESS!
createdAt: 2024-01-01
updatedAt: 2024-01-15
tags: [blogging, markdown, documentation]
description: Your first post with THYPRESS - learn about features and get started
---

# Welcome to THYPRESS!

This is your first post. Create more \`.md\` files in \`content/posts/\`.

## Getting Started

THYPRESS is a **static site generator** with a built-in HTTP server. It's designed for speed, simplicity, and flexibility.

### Writing Content

Add YAML front matter to your posts:

\`\`\`yaml
---
title: My Post Title
createdAt: 2024-01-01
updatedAt: 2024-01-15
tags: [tag1, tag2]
description: A short description
draft: false  # Set to true to hide from site
---
\`\`\`

### File Formats

THYPRESS supports three content types:

- **Markdown** (\`.md\`) - Full CommonMark + GFM support
- **Plain text** (\`.txt\`) - Rendered in \`<pre>\` tags
- **HTML** (\`.html\`) - Complete documents or fragments

## THYPRESS Conventions

### Drafts (Content)

Keep work-in-progress content hidden with these methods:

1. **\`drafts/\` folder** - Place anywhere in \`content/\`:
   \`\`\`
   content/
   ├── posts/
   │   ├── published.md
   │   └── drafts/         ← Everything here is ignored
   │       └── wip.md
   └── drafts/             ← Top-level drafts
       └── another-wip.md
   \`\`\`

2. **\`draft: true\` in front matter**:
   \`\`\`yaml
   ---
   title: Work in Progress
   draft: true  # This post won't be published
   ---
   \`\`\`

3. **Dot prefix** - Hide any file/folder:
   \`\`\`
   content/
   ├── .notes/             ← Ignored folder
   └── .scratch.md         ← Ignored file
   \`\`\`

### Partials (Templates)

Reusable template fragments are detected by:

1. **\`partials/\` folder** in your theme:
   \`\`\`
   templates/
   └── my-press/
       ├── partials/       ← Put partials here
       │   ├── header.html
       │   └── footer.html
       └── post.html
   \`\`\`

2. **Underscore prefix** (Handlebars/Sass convention):
   \`\`\`
   templates/
   └── my-press/
       ├── _header.html    ← Also a partial
       └── post.html
   \`\`\`

3. **\`partial: true\` in front matter** (template files):
   \`\`\`yaml
   ---
   partial: true
   ---
   <aside>...</aside>
   \`\`\`

### Universal Ignore Rule

**Files/folders starting with \`.\` are ignored everywhere** (both content and templates):

\`\`\`
.hidden-file.md          ← Ignored
.experimental/           ← Ignored folder
templates/.backup/       ← Ignored
\`\`\`

This matches Unix/system file conventions.

## Core Features

### Table of Contents

Notice the **"On This Page"** sidebar on the right? It's auto-generated from your heading structure (H2-H4). The current section is highlighted as you scroll.

### Navigation

The left sidebar shows your site structure based on your \`content/\` folder hierarchy.

### Search

Client-side search with MiniSearch. Try the search box on the homepage.

### Image Optimization

Images are automatically optimized to WebP + JPEG with responsive sizes:

\`\`\`markdown
![Alt text](./photo.jpg)
\`\`\`

Becomes:
- 400w, 800w, 1200w responsive variants
- WebP + JPEG fallbacks
- Lazy loading + async decoding

### Syntax Highlighting

Code blocks get automatic syntax highlighting (140+ languages):

\`\`\`javascript
function greet(name) {
  console.log(\`Hello, \${name}!\`);
}
\`\`\`

\`\`\`python
def greet(name):
    print(f"Hello, {name}!")
\`\`\`

### SEO & Performance

Every page includes:
- Meta descriptions
- Open Graph tags
- Twitter cards
- JSON-LD structured data
- Canonical URLs
- Sitemap + RSS feed

## Content Organization

### Structured Mode (Recommended)

\`\`\`
content/
├── posts/              → Blog posts
│   ├── published.md
│   └── drafts/         → Drafts (ignored)
│       └── wip.md
├── docs/               → Documentation
├── guides/             → Tutorial guides
├── about.md            → Static pages
└── .notes/             → Hidden (ignored)
\`\`\`

### URL Generation

Your folder structure becomes your URL structure:

- \`content/posts/hello.md\` → \`/posts/hello/\`
- \`content/docs/api.md\` → \`/docs/api/\`
- \`content/about.md\` → \`/about/\`

## Deployment Options

### Option A: Static Hosting

Build and deploy to any CDN:

\`\`\`bash
thypress build
# Upload /build to Netlify, Vercel, GitHub Pages, etc.
\`\`\`

### Option B: Server Mode

Run as HTTP server on VPS:

\`\`\`bash
thypress build --serve
# Production server on port 3009
\`\`\`

## Next Steps

1. **Edit this file**: \`content/posts/2024-01-01-welcome.md\`
2. **Create new posts**: Add \`.md\` files to \`content/posts/\`
3. **Customize theme**: Edit templates in \`templates/my-press/\`
4. **Configure site**: Update \`config.json\`

## Documentation

- **GitHub**: [github.com/thypress/thypress](https://github.com/thypress/thypress)
- **Issues**: Report bugs or request features
- **Discussions**: Ask questions and share your site

Happy blogging! ✨
`);
    console.log(success(`Created example post\n`));
  }

  // Ensure templates directory with default theme
  const templatesDir = path.join(targetDir, 'templates');
  const defaultThemeDir = path.join(templatesDir, '.default');

  if (!fs.existsSync(defaultThemeDir)) {
    fs.mkdirSync(defaultThemeDir, { recursive: true });

    // Load embedded templates using the helper function
    const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();

    // Copy embedded templates to .default/
    const templates = [
      { name: 'index.html', content: EMBEDDED_TEMPLATES['index.html'] },
      { name: 'post.html', content: EMBEDDED_TEMPLATES['post.html'] },
      { name: 'tag.html', content: EMBEDDED_TEMPLATES['tag.html'] },
      { name: 'style.css', content: EMBEDDED_TEMPLATES['style.css'] },
      { name: 'robots.txt', content: EMBEDDED_TEMPLATES['robots.txt'] },
      { name: 'llms.txt', content: EMBEDDED_TEMPLATES['llms.txt'] },
      { name: '404.html', content: EMBEDDED_TEMPLATES['404.html'] },
      { name: '_sidebar-nav.html', content: EMBEDDED_TEMPLATES['_sidebar-nav.html'] },
      { name: '_sidebar-toc.html', content: EMBEDDED_TEMPLATES['_sidebar-toc.html'] },
      { name: '_nav-tree.html', content: EMBEDDED_TEMPLATES['_nav-tree.html'] },
      { name: '_toc-tree.html', content: EMBEDDED_TEMPLATES['_toc-tree.html'] }
    ];

    templates.forEach(({ name, content }) => {
      if (content && typeof content === 'string') {
        fs.writeFileSync(path.join(defaultThemeDir, name), content);
      }
    });

    console.log(success(`Created templates/.default/`));
  }

  // Check if user theme exists, if not create my-press/ from defaults
  const themes = fs.existsSync(templatesDir)
    ? fs.readdirSync(templatesDir).filter(f => !f.startsWith('.') && fs.statSync(path.join(templatesDir, f)).isDirectory())
    : [];

  if (themes.length === 0) {
    const myPressDir = path.join(templatesDir, 'my-press');
    fs.mkdirSync(myPressDir, { recursive: true });

    // Load embedded templates using the helper function
    const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();

    // Copy defaults to my-press/
    const templates = [
      { name: 'index.html', content: EMBEDDED_TEMPLATES['index.html'] },
      { name: 'post.html', content: EMBEDDED_TEMPLATES['post.html'] },
      { name: 'tag.html', content: EMBEDDED_TEMPLATES['tag.html'] },
      { name: 'style.css', content: EMBEDDED_TEMPLATES['style.css'] },
      { name: '_sidebar-nav.html', content: EMBEDDED_TEMPLATES['_sidebar-nav.html'] },
      { name: '_sidebar-toc.html', content: EMBEDDED_TEMPLATES['_sidebar-toc.html'] },
      { name: '_nav-tree.html', content: EMBEDDED_TEMPLATES['_nav-tree.html'] },
      { name: '_toc-tree.html', content: EMBEDDED_TEMPLATES['_toc-tree.html'] }
    ];

    templates.forEach(({ name, content }) => {
      if (content && typeof content === 'string') {
        fs.writeFileSync(path.join(myPressDir, name), content);
      }
    });

    console.log(success(`Created templates/my-press/ (your theme)\n`));
  }

  // Ensure config.json
  const configPath = path.join(targetDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      title: "My Site",
      description: "A site powered by THYPRESS",
      url: "https://example.com",
      author: "Anonymous"
    }, null, 2));
    console.log(success(`Created config.json`));
  }

  ensureGitignore();
}

function ensureGitignore() {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const requiredEntries = ['.cache/', 'build/', 'node_modules/'];

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

async function serve() {
  await ensureDefaults();

  process.env.THYPRESS_OPEN_BROWSER = openBrowser ? 'true' : 'false';
  process.chdir(targetDir);

  await import('./server.js');
}

async function build() {
  await ensureDefaults();

  process.chdir(targetDir);

  const module = await import('./build.js');
  await module.build();
}

async function buildAndServe() {
  await ensureDefaults();

  process.chdir(targetDir);

  const buildModule = await import('./build.js');
  await buildModule.build();

  console.log('\n' + '='.repeat(50));
  console.log(bright('Starting preview server for /build...\n'));

  const buildDir = path.join(targetDir, 'build');

  if (!fs.existsSync(buildDir)) {
    console.error(errorMsg('Error: /build not found'));
    process.exit(1);
  }

  // Simple preview server for build output
  const START_PORT = 3009;
  const MAX_PORT_TRIES = 100;

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

      if (url.pathname.endsWith('/')) {
        filePath = path.join(filePath, 'index.html');
      }

      if (!path.extname(filePath)) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          filePath = indexPath;
        }
      }

      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath);
          const mimeTypes = {
            'html': 'text/html',
            'css': 'text/css',
            'js': 'text/javascript',
            'json': 'application/json',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'webp': 'image/webp',
            'xml': 'application/xml'
          };
          const ext = path.extname(filePath).substring(1).toLowerCase();
          const mimeType = mimeTypes[ext] || 'application/octet-stream';

          return new Response(content, {
            headers: { 'Content-Type': mimeType }
          });
        }
      } catch (error) {
        console.error(errorMsg(`Error serving ${filePath}: ${error.message}`));
      }

      return new Response('Not Found', { status: 404 });
    }
  });

  const serverUrl = `http://localhost:${port}`;
  console.log(success(`Preview server: ${serverUrl}`));
  console.log(dim(`  Press Ctrl+C to stop\n`));

  if (openBrowser) {
    const { exec } = await import('child_process');
    const start = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${start} ${serverUrl}`);
  }
}

function clean() {
  const cacheDir = path.join(targetDir, '.cache');

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
  thypress [command] [options] [directory]

${bright('Commands:')}
  serve, s, dev           Start server with hot reload (default)
  build, b                Build static site to /build
  build --serve           Build + preview with optimized server
  clean                   Delete .cache
  version, -v             Show version
  help, -h                Show help

${bright('Options:')}
  --dir, -d <path>        Target directory (default: current)
  --no-browser            Don't auto-open browser
  [directory]             Direct path to directory

${bright('Examples:')}
  thypress                           # Serve from current directory
  thypress build                     # Build static site
  thypress build --serve             # Build + preview
  thypress my-blog/                  # Serve from my-blog/
  thypress --dir ~/blog              # Serve from ~/blog

${bright('Structure:')}
  content/              ← Your content (markdown/text/html)
    posts/              ← Blog posts
    docs/               ← Documentation
    guides/             ← Tutorial guides
    about.md            ← Static pages
  templates/            ← Themes
    my-press/           ← Active theme
    .default/           ← Embedded defaults

${bright('Conventions:')}
  ${bright('Drafts (Content):')}
    drafts/             ← Folder anywhere in content/ (ignored)
    .file.md            ← Dot prefix = hidden/ignored
    draft: true         ← Front matter flag

  ${bright('Partials (Templates):')}
    partials/           ← Folder in theme (auto-registered)
    _partial.html       ← Underscore prefix (Handlebars convention)
    partial: true       ← Front matter flag

  ${bright('Universal:')}
    .anything           ← Ignored everywhere (content + templates)

${bright('Docs:')}
  https://github.com/thypress/thypress
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
  case 'version':
    showVersion();
    break;
  case 'help':
    help();
    break;
  default:
    console.log(errorMsg(`Unknown command: ${command}`));
    console.log(dim('Run `thypress help` for usage.\n'));
    process.exit(1);
}
