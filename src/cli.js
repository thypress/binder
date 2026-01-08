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
import { REDIRECT_STATUS_CODES, DEFAULT_STATUS_CODE, parseRedirectRules } from './build.js';

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
  let contentDir = null;
  let skipDirs = null;
  let redirectAction = 'validate';

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

    if (arg === 'redirects') {
      command = 'redirects';
      // Next arg is the action
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        redirectAction = args[i + 1];
        i++;
      }
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

    // FIX 13: Argument validation
    if (arg === '--dir' || arg === '-d') {
      if (i + 1 >= args.length) {
        console.error(errorMsg('--dir requires a path argument'));
        console.log(dim('Example: thypress --dir ./my-blog'));
        process.exit(1);
      }
      targetDir = args[i + 1];
      i++;
      continue;
    }

    if (arg === '--content-dir' || arg === '-c') {
      if (i + 1 >= args.length) {
        console.error(errorMsg('--content-dir requires a directory name'));
        console.log(dim('Example: thypress --content-dir articles'));
        process.exit(1);
      }
      contentDir = args[i + 1];
      i++;
      continue;
    }

    if (arg === '--skip-dirs') {
      if (i + 1 >= args.length) {
        console.error(errorMsg('--skip-dirs requires comma-separated directory names'));
        console.log(dim('Example: thypress --skip-dirs tmp,cache'));
        process.exit(1);
      }
      const dirs = args[i + 1];
      skipDirs = dirs.split(',').map(d => d.trim());
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

  return { command, targetDir, openBrowser, serveAfterBuild, contentDir, skipDirs, redirectAction };
}

const { command, targetDir, openBrowser, serveAfterBuild, contentDir, skipDirs, redirectAction } = parseArgs();

async function ensureDefaults() {
  console.log(info(`Working directory: ${targetDir}\n`));

  const { contentRoot, mode, shouldInit } = detectContentStructure(targetDir, {
    cliContentDir: contentDir,
    cliSkipDirs: skipDirs
  });

  if (shouldInit) {
    const postsDir = path.join(contentRoot, 'posts');
    fs.mkdirSync(postsDir, { recursive: true });
    console.log(success(`Created ${contentRoot}`));

    const examplePost = path.join(postsDir, '2024-01-01-welcome.md');
    fs.writeFileSync(examplePost, `---
title: Welcome to THYPRESS!
createdAt: 2024-01-01
updatedAt: 2024-01-15
tags: [blogging, markdown, documentation]
categories: [tutorials]
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
categories: [programming]
series: Getting Started
description: A short description
draft: false  # Set to true to hide from site
permalink: /custom-url/  # Optional: custom URL
---
\`\`\`

### File Formats

THYPRESS supports three content types:

- **Markdown** (\`.md\`) - Full CommonMark + GFM support
- **Plain text** (\`.txt\`) - Rendered in \`<pre>\` tags (HTML-escaped for security)
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

### Admonitions

Use callout boxes for tips, warnings, and notes:

\`\`\`markdown
:::tip
This is a helpful tip!
:::

:::warning
Be careful with this!
:::

:::danger
This is critical information!
:::
\`\`\`

### SEO & Performance

Every page includes:
- Meta descriptions
- Open Graph tags
- Twitter cards
- JSON-LD structured data
- Canonical URLs
- Sitemap + RSS feed (including per-tag/category RSS)

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

Use \`permalink:\` in front matter to override.

## Taxonomies

THYPRESS supports multiple ways to organize content:

- **Tags**: Lightweight categorization
- **Categories**: Hierarchical organization
- **Series**: Group related posts

\`\`\`yaml
---
title: Getting Started with THYPRESS
tags: [tutorial, beginner]
categories: [documentation, guides]
series: THYPRESS Tutorial Series
---
\`\`\`

Each taxonomy gets its own index page and RSS feed:
- \`/tag/tutorial/\`
- \`/category/documentation/\`
- \`/series/thypress-tutorial-series/\`

## Redirects

Create a \`redirects.json\` file to handle URL migrations:

\`\`\`json
{
  "/old-post/": "/new-post/",
  "/temp-promo/": {
    "to": "/sale/",
    "statusCode": 302
  }
}
\`\`\`

Redirects work in both dev server and build output. Supports 5 status codes: 301, 302, 303, 307, 308.

## Live Reload

The dev server automatically reloads your browser when files change. No manual refresh needed!

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
PORT=8080 thypress build --serve
# Production server on specified port
\`\`\`

## Configuration

Edit \`config.json\` to customize your site:

\`\`\`json
{
  "title": "My Site",
  "description": "A site powered by THYPRESS",
  "url": "https://example.com",
  "author": "Anonymous",
  "readingSpeed": 200,
  "escapeTextFiles": true,
  "strictImages": false,
  "discoverTemplates": false,
  "fingerprintAssets": true
}
\`\`\`

## Next Steps

1. **Edit this file**: \`content/posts/2024-01-01-welcome.md\`
2. **Create new posts**: Add \`.md\` files to \`content/posts/\`
3. **Customize theme**: Edit templates in \`templates/my-press/\`
4. **Configure site**: Update \`config.json\`
5. **Set up redirects**: Create \`redirects.json\` if migrating URLs

## Documentation

- **GitHub**: [github.com/thypress/thypress](https://github.com/thypress/thypress)
- **Issues**: Report bugs or request features
- **Discussions**: Ask questions and share your site

Happy blogging! ✨
`);
    console.log(success(`Created example post\n`));
  }

  const templatesDir = path.join(targetDir, 'templates');
  const defaultThemeDir = path.join(templatesDir, '.default');

  if (!fs.existsSync(defaultThemeDir)) {
    fs.mkdirSync(defaultThemeDir, { recursive: true });

    const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();

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

  const themes = fs.existsSync(templatesDir)
    ? fs.readdirSync(templatesDir).filter(f => !f.startsWith('.') && fs.statSync(path.join(templatesDir, f)).isDirectory())
    : [];

  if (themes.length === 0) {
    const myPressDir = path.join(templatesDir, 'my-press');
    fs.mkdirSync(myPressDir, { recursive: true });

    const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();

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

/**
 * Enhanced redirect management commands
 */
async function handleRedirectsCommand(action = 'validate') {
  const redirectsPath = path.join(targetDir, 'redirects.json');

  if (!fs.existsSync(redirectsPath)) {
    console.log(warning('No redirects.json file found'));
    console.log(info('Create one to get started:'));
    console.log(dim('  {'));
    console.log(dim('    "/old-post/": "/new-post/"'));
    console.log(dim('  }'));
    console.log('');
    console.log(info('Or use advanced format with status codes:'));
    console.log(dim('  {'));
    console.log(dim('    "/temp-promo/": {'));
    console.log(dim('      "to": "/sale/",'));
    console.log(dim('      "statusCode": 302'));
    console.log(dim('    }'));
    console.log(dim('  }'));
    return;
  }

  try {
    const redirectsData = JSON.parse(fs.readFileSync(redirectsPath, 'utf-8'));

    switch (action) {
      case 'validate':
        await validateRedirects(redirectsData);
        break;
      case 'test':
        await testRedirects(redirectsData);
        break;
      case 'list':
        await listRedirects(redirectsData);
        break;
      case 'check':
        await checkRedirects(redirectsData);
        break;
      default:
        console.log(errorMsg(`Unknown action: ${action}`));
        console.log(info('Available actions: validate, test, list, check'));
        console.log(dim('Run: thypress redirects [action]'));
    }
  } catch (error) {
    console.error(errorMsg(`Failed to parse redirects.json: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Validate redirect rules
 */
async function validateRedirects(redirectsData) {
  console.log(bright('Validating redirects.json...\n'));

  const { rules, errors } = parseRedirectRules(redirectsData);

  if (errors.length > 0) {
    console.log(errorMsg(`Found ${errors.length} validation error(s):\n`));
    errors.forEach((err, i) => {
      console.log(dim(`  ${i + 1}. ${err}`));
    });
    process.exit(1);
  }

  console.log(success(`✓ All ${rules.length} redirect rules are valid`));
  console.log('');

  // Status code breakdown
  const statusBreakdown = rules.reduce((acc, rule) => {
    const type = REDIRECT_STATUS_CODES[rule.statusCode].type;
    if (!acc[type]) acc[type] = {};
    acc[type][rule.statusCode] = (acc[type][rule.statusCode] || 0) + 1;
    return acc;
  }, {});

  console.log(info('Status Code Breakdown:'));

  if (statusBreakdown.permanent) {
    console.log(dim('  Permanent (SEO-friendly):'));
    Object.entries(statusBreakdown.permanent).forEach(([code, count]) => {
      console.log(dim(`    ${code}: ${count} redirect(s) - ${REDIRECT_STATUS_CODES[code].description}`));
    });
  }

  if (statusBreakdown.temporary) {
    console.log(dim('  Temporary (no SEO transfer):'));
    Object.entries(statusBreakdown.temporary).forEach(([code, count]) => {
      console.log(dim(`    ${code}: ${count} redirect(s) - ${REDIRECT_STATUS_CODES[code].description}`));
    });
  }

  if (statusBreakdown.functional) {
    console.log(dim('  Functional:'));
    Object.entries(statusBreakdown.functional).forEach(([code, count]) => {
      console.log(dim(`    ${code}: ${count} redirect(s) - ${REDIRECT_STATUS_CODES[code].description}`));
    });
  }

  // Check for potential issues
  console.log('');
  console.log(info('Checking for potential issues...'));

  // Check for redirect loops
  const loops = detectRedirectLoops(rules);
  if (loops.length > 0) {
    console.log(warning(`Found ${loops.length} potential redirect loop(s):`));
    loops.forEach(loop => {
      console.log(dim(`  ${loop.join(' → ')}`));
    });
  }

  // Check for redirect chains
  const chains = detectRedirectChains(rules);
  if (chains.length > 0) {
    console.log(warning(`Found ${chains.length} redirect chain(s) (recommend direct redirects):`));
    chains.forEach(chain => {
      console.log(dim(`  ${chain.join(' → ')}`));
    });
  }

  // Check for external redirects
  const externalRedirects = rules.filter(r =>
    r.to.startsWith('http://') || r.to.startsWith('https://')
  );
  if (externalRedirects.length > 0) {
    console.log(info(`${externalRedirects.length} external redirect(s) (no fallback HTML will be generated):`));
    externalRedirects.forEach(r => {
      console.log(dim(`  ${r.from} → ${r.to}`));
    });
  }

  if (loops.length === 0 && chains.length === 0) {
    console.log(success('✓ No issues detected'));
  }

  console.log('');
  console.log(bright('Validation complete!'));
}

/**
 * Detect redirect loops
 */
function detectRedirectLoops(rules) {
  const loops = [];
  const rulesMap = new Map(rules.map(r => [r.from, r.to]));

  for (const rule of rules) {
    const visited = new Set();
    let current = rule.from;

    while (current) {
      if (visited.has(current)) {
        // Found a loop
        loops.push([...visited, current]);
        break;
      }

      visited.add(current);
      current = rulesMap.get(current);
    }
  }

  return loops;
}

/**
 * Detect redirect chains
 */
function detectRedirectChains(rules) {
  const chains = [];
  const rulesMap = new Map(rules.map(r => [r.from, r.to]));

  for (const rule of rules) {
    const chain = [rule.from];
    let current = rule.to;

    while (current && rulesMap.has(current)) {
      chain.push(current);
      current = rulesMap.get(current);
    }

    if (chain.length > 2) {
      chain.push(current); // Add final destination
      chains.push(chain);
    }
  }

  return chains;
}

/**
 * Match redirect with pattern support
 */
function matchRedirect(requestPath, redirectRulesMap) {
  // Try exact match first
  if (redirectRulesMap.has(requestPath)) {
    return redirectRulesMap.get(requestPath);
  }

  // Try pattern matching
  for (const [from, redirect] of redirectRulesMap) {
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
 * Test redirects against sample URLs (interactive)
 */
async function testRedirects(redirectsData) {
  console.log(bright('Testing redirects...\n'));

  const { rules, errors } = parseRedirectRules(redirectsData);

  if (errors.length > 0) {
    console.log(errorMsg('Cannot test - validation errors found'));
    console.log(info('Run: thypress redirects validate'));
    process.exit(1);
  }

  console.log(info('Enter URLs to test (press Ctrl+C to exit):'));
  console.log(dim('Example: /old-post/ or /blog/hello-world/\n'));

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  const redirectRulesMap = new Map(rules.map(r => [r.from, { to: r.to, statusCode: r.statusCode }]));

  rl.on('line', (input) => {
    const testUrl = input.trim();

    if (!testUrl) {
      return;
    }

    if (!testUrl.startsWith('/')) {
      console.log(warning('URL must start with /\n'));
      return;
    }

    const match = matchRedirect(testUrl, redirectRulesMap);

    if (match) {
      console.log(success(`✓ ${testUrl}`));
      console.log(dim(`  → ${match.to} (${match.statusCode})`));
      console.log(dim(`  ${REDIRECT_STATUS_CODES[match.statusCode].description}\n`));
    } else {
      console.log(warning(`✗ ${testUrl}`));
      console.log(dim('  No redirect rule matches\n'));
    }
  });

  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });
}

/**
 * List all redirect rules grouped by status code
 */
async function listRedirects(redirectsData) {
  console.log(bright('Redirect Rules:\n'));

  const { rules, errors } = parseRedirectRules(redirectsData);

  if (errors.length > 0) {
    console.log(errorMsg('Validation errors found'));
    console.log(info('Run: thypress redirects validate'));
    return;
  }

  // Group by status code
  const grouped = rules.reduce((acc, rule) => {
    if (!acc[rule.statusCode]) acc[rule.statusCode] = [];
    acc[rule.statusCode].push(rule);
    return acc;
  }, {});

  Object.entries(grouped).forEach(([statusCode, statusRules]) => {
    const statusInfo = REDIRECT_STATUS_CODES[statusCode];
    console.log(info(`${statusCode} - ${statusInfo.description} (${statusRules.length})`));

    statusRules.forEach(rule => {
      console.log(dim(`  ${rule.from} → ${rule.to}`));
    });

    console.log('');
  });

  console.log(success(`Total: ${rules.length} redirect rule(s)`));
}

/**
 * Check redirect compatibility and build output
 */
async function checkRedirects(redirectsData) {
  console.log(bright('Checking redirect compatibility...\n'));

  const { rules, errors } = parseRedirectRules(redirectsData);

  if (errors.length > 0) {
    console.log(errorMsg('Validation errors found'));
    console.log(info('Run: thypress redirects validate'));
    return;
  }

  // Check smart host compatibility
  console.log(info('Smart Hosts (Server-Side Redirects):'));
  console.log(success('  ✓ Netlify (_redirects)'));
  console.log(success('  ✓ Cloudflare Pages (_redirects)'));
  console.log(success('  ✓ Vercel (vercel.json)'));
  console.log('');

  // Check dumb host compatibility
  const internalRedirects = rules.filter(r =>
    !r.to.startsWith('http://') && !r.to.startsWith('https://')
  );
  const externalRedirects = rules.filter(r =>
    r.to.startsWith('http://') || r.to.startsWith('https://')
  );

  console.log(info('Dumb Hosts (Fallback HTML):'));
  console.log(success(`  ✓ GitHub Pages: ${internalRedirects.length} redirect(s) with fallback HTML`));
  console.log(success(`  ✓ Amazon S3: ${internalRedirects.length} redirect(s) with fallback HTML`));
  console.log(success(`  ✓ Basic FTP: ${internalRedirects.length} redirect(s) with fallback HTML`));

  if (externalRedirects.length > 0) {
    console.log(warning(`    ${externalRedirects.length} external redirect(s) cannot have fallback HTML`));
    console.log(dim('    These will only work on smart hosts (Netlify, Vercel, etc.)'));
  }

  console.log('');

  // Estimate build output size
  const fallbackHtmlSize = internalRedirects.length * 1.5; // ~1.5KB per fallback
  console.log(info('Estimated Build Output:'));
  console.log(dim(`  _redirects: ~${Math.ceil(rules.length * 0.05)}KB`));
  console.log(dim(`  vercel.json: ~${Math.ceil(rules.length * 0.1)}KB`));
  console.log(dim(`  Fallback HTML: ~${fallbackHtmlSize.toFixed(1)}KB (${internalRedirects.length} files)`));
  console.log('');

  console.log(bright('All checks passed! Ready to build.'));
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
  redirects [action]      Manage redirect rules
  version, -v             Show version
  help, -h                Show help

${bright('Redirect Actions:')}
  redirects validate      Validate redirects.json syntax and rules (default)
  redirects test          Test URLs against redirect rules interactively
  redirects list          List all redirect rules grouped by status code
  redirects check         Check redirect compatibility and build output

${bright('Options:')}
  --dir, -d <path>        Target directory (default: current)
  --content-dir, -c <dir> Content directory name (default: content/)
  --skip-dirs <dirs>      Comma-separated dirs to skip (adds to defaults)
  --no-browser            Don't auto-open browser
  [directory]             Direct path to directory

${bright('Environment Variables:')}
  PORT=8080               Set server port (default: auto-detect)
  DISABLE_AUTOGEN_TEMPLATE=true   Disable template auto-generation

${bright('Examples:')}
  thypress                           # Serve from current directory
  thypress build                     # Build static site
  thypress build --serve             # Build + preview
  thypress my-blog/                  # Serve from my-blog/
  thypress --dir ~/blog              # Serve from ~/blog
  thypress --content-dir articles    # Use articles/ as content
  thypress --skip-dirs tmp,cache     # Skip tmp/ and cache/ folders
  PORT=8080 thypress serve           # Use specific port

${bright('Redirect Examples:')}
  thypress redirects validate        # Validate redirects.json
  thypress redirects test            # Test redirect rules interactively
  thypress redirects list            # Show all redirects
  thypress redirects check           # Check compatibility

${bright('Structure:')}
  content/              ← Your content (markdown/text/html)
    posts/              ← Blog posts
    docs/               ← Documentation
    guides/             ← Tutorial guides
    about.md            ← Static pages
  templates/            ← Themes
    my-press/           ← Active theme
    .default/           ← Embedded defaults
  config.json           ← Site configuration
  redirects.json        ← URL redirects (optional)

${bright('Redirects Configuration (redirects.json):')}
  Simple format (301 by default):
  {
    "/old-post/": "/new-post/"
  }

  Advanced format (custom status code):
  {
    "/temp-promo/": {
      "to": "/sale/",
      "statusCode": 302
    }
  }

  Pattern matching (dynamic parameters):
  {
    "/blog/:slug/": "/posts/:slug/",
    "/:year/:month/:slug/": "/posts/:slug/"
  }

  Supported status codes:
  - 301: Permanent (SEO-friendly, default)
  - 302: Temporary (promotions, A/B tests)
  - 303: Post-form redirect (prevents resubmit)
  - 307: Temporary + preserves POST data
  - 308: Permanent + preserves POST data

${bright('Configuration (config.json):')}
  {
    "contentDir": "articles",           // Custom content directory
    "skipDirs": ["tmp", "backup"],      // Additional dirs to skip
    "theme": "my-press",                // Active theme
    "readingSpeed": 200,                // Words per minute
    "escapeTextFiles": true,            // Escape HTML in .txt files
    "strictImages": false,              // Exit on broken images
    "discoverTemplates": false,         // Auto-detect template syntax
    "fingerprintAssets": true           // Add hash to CSS/JS filenames
  }

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

${bright('Features:')}
  • Live reload with WebSocket
  • Related posts (tag-based)
  • RSS per tag/category/series
  • URL redirects with 5 status codes
  • Dual-build strategy (smart + dumb hosts)
  • Taxonomies (tags, categories, series)
  • Admonitions (:::tip, :::warning, etc.)
  • Asset fingerprinting
  • Responsive image optimization
  • SEO + structured data
  • Unicode support

${bright('Docs:')}
  https://github.com/thypress/thypress
`);
}

// Main command dispatcher
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
  case 'redirects':
    await handleRedirectsCommand(redirectAction);
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
