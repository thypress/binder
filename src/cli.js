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

import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js';
import matter from 'gray-matter';
import { getSiteConfig, slugify } from './utils/taxonomy.js';
import { setActiveTheme } from './theme-system.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';
import { loadEmbeddedTemplates } from './theme-system.js';
import { REDIRECT_STATUS_CODES, DEFAULT_STATUS_CODE, parseRedirectRules } from './build.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const VERSION = globalThis.__THYPRESS_VERSION__ ?? JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')).version;

// ============================================================================
// INTENT MODES - The three ways users interact with THYPRESS
// ============================================================================

const THYPRESS_MODES = {
  VIEWER: 'viewer',      // Zero-footprint file viewing (dropped files/folders)
  PROJECT: 'project',    // Scaffolded project with content/ directory
  INSTALLER: 'installer' // Theme installation from .zip
};

function parseArgs() {
  const args = process.argv.slice(2);
  let command = 'serve';
  let targetDir = null;
  let openBrowser = true;
  let serveAfterBuild = false;
  let contentDir = null;
  let skipDirs = null;
  let redirectAction = 'validate';
  let themeArchivePath = null;
  let validateTarget = null;

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

    if (arg === 'validate' || arg === 'v') {
      command = 'validate';
      // Next arg is the target
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        validateTarget = args[i + 1];
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

    if (arg === '--dir' || arg === '-d') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
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

    // Check for .zip files (theme installation)
    if (arg.endsWith('.zip')) {
      command = 'install-theme';
      themeArchivePath = path.resolve(arg);
      continue;
    }
  }

  if (targetDir) {
    targetDir = path.resolve(targetDir);
  } else {
    targetDir = process.cwd();
  }

  return { command, targetDir, openBrowser, serveAfterBuild, contentDir, skipDirs, redirectAction, themeArchivePath, validateTarget };
}

const { command, targetDir, openBrowser, serveAfterBuild, contentDir, skipDirs, redirectAction, themeArchivePath, validateTarget } = parseArgs();

// ============================================================================
// INTENT DISPATCHER - Determines user intent BEFORE any filesystem operations
// ============================================================================

/**
 * Determine user intent from CLI arguments and dropped files
 * Priority: Explicit user action > File presence > Initialization
 *
 * @returns {Object} Intent object with mode, workingDir, and context
 */
function determineIntent() {
  const droppedPaths = process.argv.slice(2).filter(arg =>
    !arg.startsWith('-') &&
    arg !== 'serve' &&
    arg !== 'build' &&
    arg !== 'dev' &&
    arg !== 's' &&
    arg !== 'b' &&
    (arg.includes('/') || arg.includes('\\') || fs.existsSync(arg))
  );

  console.log(bright('Analyzing input...\n'));

  // ========================================================================
  // SCENARIO 1: .zip file dropped → Theme installer
  // ========================================================================
  const zipFile = droppedPaths.find(p => p.endsWith('.zip'));
  if (zipFile) {
    console.log(info(`Detected: Theme archive (${path.basename(zipFile)})`));

    return {
      mode: THYPRESS_MODES.INSTALLER,
      zipPath: path.resolve(zipFile),
      workingDir: process.cwd()  // Install to current working directory
    };
  }

  // ========================================================================
  // SCENARIO 2: File(s) dropped → Zero-footprint viewer
  // ========================================================================
  if (droppedPaths.length > 0) {
    const files = droppedPaths.filter(p => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });

    if (files.length > 0) {
      console.log(info(`Detected: ${files.length} dropped file(s)`));

      // Check if files are from multiple folders
      const folders = files.map(f => path.dirname(path.resolve(f)));
      const uniqueFolders = [...new Set(folders)];

      // Use first file's folder as working directory
      const firstFileFolder = path.dirname(path.resolve(files[0]));

      // Filter files to only include those from the first folder
      const validFiles = files.filter(f =>
        path.dirname(path.resolve(f)) === firstFileFolder
      );
      const ignoredFiles = files.filter(f =>
        path.dirname(path.resolve(f)) !== firstFileFolder
      );

      if (uniqueFolders.length > 1) {
        console.log(warning(`Files from ${uniqueFolders.length} different locations detected`));
        console.log(info(`Using first file's location: ${firstFileFolder}`));
        console.log(warning(`Ignoring files from other locations:`));
        ignoredFiles.forEach(f => {
          console.log(dim(`× ${path.basename(f)} (from ${path.dirname(f)})`));
        });
        console.log('');
      }

      console.log(success(`Working with ${validFiles.length} file(s) from: ${firstFileFolder}\n`));

      // Note: Assets/images are only resolvable relative to this folder
      return {
        mode: THYPRESS_MODES.VIEWER,
        workingDir: firstFileFolder,
        initialFiles: validFiles.map(f => path.resolve(f)),
        ignoredFiles: ignoredFiles.map(f => path.resolve(f))
      };
    }

    // ========================================================================
    // SCENARIO 3: Folder(s) dropped
    // ========================================================================
    const folders = droppedPaths.filter(p => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });

    if (folders.length > 0) {
      const targetFolder = path.resolve(folders[0]);

      if (folders.length > 1) {
        console.log(warning(`Multiple folders detected, using: ${path.basename(targetFolder)}`));
      } else {
        console.log(info(`Detected: Folder (${path.basename(targetFolder)})`));
      }

      // Check if folder has ANY content files (.md, .txt, .html)
      let hasContent = false;
      try {
        const entries = fs.readdirSync(targetFolder);
        hasContent = entries.some(f => {
          if (f.startsWith('.')) return false;
          try {
            const fullPath = path.join(targetFolder, f);
            return fs.statSync(fullPath).isFile() && /\.(md|txt|html)$/i.test(f);
          } catch {
            return false;
          }
        });
      } catch {
        hasContent = false;
      }

      // Check if it has subdirectories with content
      if (!hasContent) {
        try {
          const entries = fs.readdirSync(targetFolder);
          for (const entry of entries) {
            if (entry.startsWith('.')) continue;
            const fullPath = path.join(targetFolder, entry);
            try {
              if (fs.statSync(fullPath).isDirectory()) {
                const subEntries = fs.readdirSync(fullPath);
                const hasSubContent = subEntries.some(f => {
                  if (f.startsWith('.')) return false;
                  const subFullPath = path.join(fullPath, f);
                  try {
                    return fs.statSync(subFullPath).isFile() && /\.(md|txt|html)$/i.test(f);
                  } catch {
                    return false;
                  }
                });
                if (hasSubContent) {
                  hasContent = true;
                  break;
                }
              }
            } catch {
              continue;
            }
          }
        } catch {
          hasContent = false;
        }
      }

      if (hasContent) {
        console.log(success(`Folder contains content files\n`));
        return {
          mode: THYPRESS_MODES.VIEWER,
          workingDir: targetFolder
        };
      } else {
        // Check for images-only folder
        try {
          const entries = fs.readdirSync(targetFolder);
          const hasImages = entries.some(f => {
            const fullPath = path.join(targetFolder, f);
            try {
              return fs.statSync(fullPath).isFile() && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f);
            } catch {
              return false;
            }
          });

          if (hasImages) {
            console.log(info('Folder contains images but no content files'));
          }
        } catch {}

        console.log(info('Empty folder - will initialize project structure\n'));
        return {
          mode: THYPRESS_MODES.PROJECT,
          workingDir: targetFolder
        };
      }
    }
  }

  // ========================================================================
  // SCENARIO 4: Run in current directory (no drops)
  // ========================================================================
  const cwd = targetDir || process.cwd();
  console.log(info(`Running in: ${cwd}`));

  // Check for content files in root
  let rootFiles = [];
  try {
    const entries = fs.readdirSync(cwd);
    rootFiles = entries.filter(f => {
      if (f.startsWith('.')) return false;
      try {
        const fullPath = path.join(cwd, f);
        return fs.statSync(fullPath).isFile() && /\.(md|txt|html)$/i.test(f);
      } catch {
        return false;
      }
    });
  } catch {
    rootFiles = [];
  }

  // Check for content/ directory
  const contentDirPath = path.join(cwd, contentDir || 'content');
  const hasContentDir = fs.existsSync(contentDirPath);

  if (rootFiles.length > 0) {
    console.log(success(`Found ${rootFiles.length} content file(s) in root\n`));
    return {
      mode: THYPRESS_MODES.VIEWER,
      workingDir: cwd
    };
  }

  if (hasContentDir) {
    console.log(success(`Found ${contentDir || 'content'}/ directory\n`));
    return {
      mode: THYPRESS_MODES.VIEWER,
      workingDir: cwd
    };
  }

  // ========================================================================
  // SCENARIO 5: Empty directory → Initialize project
  // ========================================================================
  console.log(info('No content found - will initialize project\n'));
  return {
    mode: THYPRESS_MODES.PROJECT,
    workingDir: cwd
  };
}

// ============================================================================
// SCAFFOLDING - Only runs in PROJECT mode
// ============================================================================

async function ensureDefaults(intent) {
  const currentDir = intent.workingDir;

  // Change to working directory determined by intent
  process.chdir(currentDir);

  console.log(bright(`Intent: ${intent.mode.toUpperCase()}`));
  console.log(info(`Working directory: ${currentDir}\n`));

  // ========================================================================
  // VIEWER MODE: Zero footprint - NO scaffolding
  // ========================================================================
  if (intent.mode === THYPRESS_MODES.VIEWER) {
    console.log(success('Zero-footprint mode (no files created)'));

    if (intent.ignoredFiles && intent.ignoredFiles.length > 0) {
      console.log(dim(`Note: ${intent.ignoredFiles.length} file(s) from other locations were ignored`));
    }

    console.log('');
    return;
  }

  // ========================================================================
  // INSTALLER MODE: Extract theme
  // ========================================================================
  if (intent.mode === THYPRESS_MODES.INSTALLER) {
    await installThemeFromArchive(intent.zipPath, currentDir);
    return;
  }

  // ========================================================================
  // PROJECT MODE: Create scaffolding
  // ========================================================================
  if (intent.mode === THYPRESS_MODES.PROJECT) {
    console.log(info('Initializing project structure...\n'));

    const contentRoot = contentDir ?
      path.join(currentDir, contentDir) :
      path.join(currentDir, 'content');

    if (!fs.existsSync(contentRoot)) {
      const pagesDir = path.join(contentRoot, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      console.log(success(`Created ${path.relative(currentDir, contentRoot)}/`));

      const examplePage = path.join(pagesDir, '2024-01-01-welcome.md');
      fs.writeFileSync(examplePage, `---
title: Welcome to THYPRESS!
createdAt: 2024-01-01
updatedAt: 2024-01-15
tags: [blogging, markdown, documentation]
categories: [tutorials]
description: Your first page with THYPRESS - learn about features and get started
---

# Welcome to THYPRESS!

This is your first page. Create more \`.md\` files in \`content/pages/\`.

## Getting Started

THYPRESS is a **static site generator** with a built-in HTTP server. It's designed for speed, simplicity, and flexibility.

### Writing Content

Add YAML front matter to your pages:

\`\`\`yaml
---
title: My Page Title
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
   ├── pages/
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
   draft: true
   ---
   \`\`\`

3. **Dot prefix** - Files starting with \`.hidden.md\` are ignored

### Partials (Templates)

Reusable template components use similar conventions:

1. **\`partials/\` folder** in your theme:
   \`\`\`
   templates/my-theme/
   ├── index.html
   ├── entry.html
   └── partials/           ← Auto-registered as partials
       ├── header.html
       └── footer.html
   \`\`\`

2. **Underscore prefix** - \`_header.html\` is auto-registered as a partial

3. **\`partial: true\` in front matter**:
   \`\`\`yaml
   ---
   partial: true
   ---
   \`\`\`

## Features

- 📝 **Markdown** with syntax highlighting
- 🏷️ **Taxonomies** - Tags, categories, and series
- 🔗 **Related content** based on shared tags
- 📊 **Table of contents** (auto-generated from headings)
- 🔄 **Live reload** with WebSocket
- 🎨 **Themes** - Handlebars templates
- 📰 **RSS feeds** - Global, per-tag, per-category, per-series
- 🗺️ **Sitemap** generation
- **Search index** (JSON)
- 🖼️ **Image optimization** with responsive sizes
- ⚡ **Fast builds** with parallel processing
- 🎯 **URL redirects** with pattern matching
- 📱 **Mobile-friendly** default theme

## Theme System

THYPRESS uses Handlebars templates. The minimum viable theme is just \`index.html\`:

\`\`\`handlebars
<!DOCTYPE html>
<html>
<head>
  <title>{{config.title}}</title>
</head>
<body>
  {{#if entry}}
    <article>
      <h1>{{entry.title}}</h1>
      {{{entry.html}}}
    </article>
  {{else}}
    <ul>
      {{#each entries}}
        <li><a href="{{url}}">{{title}}</a></li>
      {{/each}}
    </ul>
  {{/if}}
</body>
</html>
\`\`\`

### Available Templates

- \`index.html\` - Required: Homepage and lists
- \`entry.html\` - Individual content pages
- \`tag.html\` - Tag archives
- \`category.html\` - Category archives
- \`series.html\` - Series archives
- \`404.html\` - Not found page

### Template Variables

All templates receive:

- \`config\` - Site configuration
- \`navigation\` - Site navigation tree
- \`theme\` - Theme metadata

**Entry pages** get:

- \`entry\` - Current entry object
- \`frontMatter\` - Raw front matter
- \`prevEntry\` / \`nextEntry\` - Navigation
- \`relatedEntries\` - Tag-based suggestions
- \`toc\` - Table of contents

**List pages** get:

- \`entries\` - Array of entries
- \`pagination\` - Pagination data (if applicable)
- \`tag\` / \`category\` / \`series\` - Current taxonomy term

## CLI Commands

\`\`\`bash
thypress serve              # Start dev server
thypress build              # Build static site
thypress build --serve      # Build + preview
thypress clean              # Delete cache
\`\`\`

## Configuration

Edit \`config.json\`:

\`\`\`json
{
  "title": "My Site",
  "description": "A site powered by THYPRESS",
  "url": "https://example.com",
  "author": "Your Name",
  "theme": "my-press",
  "contentDir": "content",
  "readingSpeed": 200,
  "escapeTextFiles": true,
  "strictImages": false,
  "fingerprintAssets": false
}
\`\`\`

## Next Steps

1. Edit this file or create new \`.md\` files
2. Install a theme by dragging a \`.zip\` file onto the THYPRESS executable
3. Customize your \`config.json\`
4. Run \`thypress build\` to export your site

Happy writing! 🎉
`);
      console.log(success(`Created ${path.relative(currentDir, examplePage)}`));
    }

    // Create config.json
    const configPath = path.join(currentDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      const defaultConfig = {
        // === Core Settings ===
        title: 'My Site',
        description: 'A site powered by THYPRESS',
        url: 'https://example.com',
        author: 'Anonymous',

        // === Content Processing ===
        contentDir: 'content',
        skipDirs: [],
        readingSpeed: 200,
        escapeTextFiles: true,

        // === Image Handling ===
        strictImages: false,

        // === Theme System ===
        theme: 'my-press',
        strictThemeIsolation: false,
        forceTheme: false,
        fingerprintAssets: false,

        // === Dynamic Mode (thypress serve) ===
        disablePreRender: false,        // Skip warmup for faster dev startups
        preCompressContent: false,      // Pre-compress all pages (opt-in for production)
        disableLiveReload: false,       // Disable live reload

        // === Validation ===
        strictPreRender: true,          // Exit if ANY page fails during warmup
        strictTemplateValidation: true, // Exit if template syntax is invalid

        // === Security ===
        allowExternalRedirects: false,  // Allow redirects to external URLs
        allowedRedirectDomains: [],     // Whitelist of allowed domains for redirects

        // === Cache Configuration ===
        cacheMaxSize: 50 * 1024 * 1024  // 50MB in bytes (configurable)
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log(success('Created config.json'));
    }

    console.log('');
  }
}

// ============================================================================
// THEME INSTALLATION
// ============================================================================

async function installThemeFromArchive(zipPath, targetDir) {
  console.log(info(`Installing theme from: ${path.basename(zipPath)}\n`));

  if (!fs.existsSync(zipPath)) {
    console.error(errorMsg(`Theme archive not found: ${zipPath}`));
    process.exit(1);
  }

  try {
    // Stage 1: Extract to temp directory (atomic operation)
    const tempDir = path.join(os.tmpdir(), `thypress-theme-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    console.log(dim('Extracting archive...'));

    const zipBlob = new Blob([fs.readFileSync(zipPath)]);
    const reader = new ZipReader(new BlobReader(zipBlob));
    const entries = await reader.getEntries();

    let extractedFiles = 0;
    const totalFiles = entries.length;

    // Progress indicator for large archives
    const showProgress = totalFiles > 20;

    for (const entry of entries) {
      if (!entry.directory) {
        const data = await entry.getData(new BlobWriter());
        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const fullPath = path.join(tempDir, entry.filename);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, buffer);
        extractedFiles++;

        // Show progress for large archives
        if (showProgress) {
          const progress = Math.floor((extractedFiles / totalFiles) * 100);
          if (progress % 25 === 0 || extractedFiles === totalFiles) {
            console.log(dim(`Progress: ${progress}% (${extractedFiles}/${totalFiles} files)`));
          }
        }
      }
    }

    await reader.close();

    // Stage 2: Verify - Check for valid theme structure
    console.log(dim('Verifying theme structure...'));

    const tempEntries = fs.readdirSync(tempDir);
    let themeRoot = tempDir;
    let themeName = null;

    // If archive contains a single root folder, use that
    if (tempEntries.length === 1 && fs.statSync(path.join(tempDir, tempEntries[0])).isDirectory()) {
      themeRoot = path.join(tempDir, tempEntries[0]);
      themeName = tempEntries[0];
    } else {
      // Use zip filename as theme name
      themeName = path.basename(zipPath, '.zip');
    }

    // Check for index.html (minimum requirement)
    const indexHtml = path.join(themeRoot, 'index.html');
    if (!fs.existsSync(indexHtml)) {
      console.error(errorMsg('Invalid theme: index.html not found'));
      console.log(warning('Theme must contain at least index.html'));
      fs.rmSync(tempDir, { recursive: true, force: true });
      process.exit(1);
    }

    console.log(success(`Valid theme detected: ${themeName}`));

    // Stage 3: Commit - Move to templates directory
    const templatesDir = path.join(targetDir, 'templates');
    const themeDestination = path.join(templatesDir, themeName);

    fs.mkdirSync(templatesDir, { recursive: true });

    // Check for existing theme
    if (fs.existsSync(themeDestination)) {
      console.log(warning(`Theme '${themeName}' already exists`));
      console.log(info('Overwriting existing theme...'));
      fs.rmSync(themeDestination, { recursive: true, force: true });
    }

    // Copy theme files
    fs.cpSync(themeRoot, themeDestination, { recursive: true });

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(success(`\nTheme installed: ${themeName}`));
    console.log(dim(`Location: ${path.relative(targetDir, themeDestination)}/`));

    // Count theme files
    const themeFiles = fs.readdirSync(themeDestination, { recursive: true })
      .filter(f => {
        const fullPath = path.join(themeDestination, f);
        return fs.statSync(fullPath).isFile();
      });

    console.log(dim(`Files: ${themeFiles.length}`));

    // Update config.json to use new theme
    const configPath = path.join(targetDir, 'config.json');
    let config = {};

    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const oldTheme = config.theme;
        config.theme = themeName;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(success(`Updated config.json: theme '${oldTheme}' → '${themeName}'`));
      } catch (error) {
        console.log(warning(`Could not update config.json: ${error.message}`));
      }
    } else {
      // Create config.json if it doesn't exist
      config = {
        title: 'My Site',
        description: 'A site powered by THYPRESS',
        url: 'https://example.com',
        author: 'Anonymous',
        theme: themeName,
        readingSpeed: 200,
        escapeTextFiles: true,
        strictImages: false,
        fingerprintAssets: false
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(success('Created config.json with new theme'));
    }

    // Check if there's content to serve
    const contentDirPath = path.join(targetDir, 'content');
    const hasContent = fs.existsSync(contentDirPath);

    console.log('');
    console.log(bright('Next steps:'));

    if (!hasContent) {
      console.log(dim('• Run THYPRESS again to initialize content/ folder'));
      console.log(dim('• Or drop your existing content folder'));
    } else {
      console.log(dim('• Run THYPRESS again to preview with new theme'));
      console.log(dim('• Edit templates/ to customize your theme'));
    }

    console.log('');

  } catch (error) {
    console.error(errorMsg(`\nTheme installation failed: ${error.message}`));

    // Clean up on error
    const tempDirs = fs.readdirSync(os.tmpdir())
      .filter(f => f.startsWith('thypress-theme-'))
      .map(f => path.join(os.tmpdir(), f));

    tempDirs.forEach(dir => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    });

    process.exit(1);
  }
}

// ============================================================================
// SERVE COMMAND
// ============================================================================

async function serve() {
  const intent = determineIntent();
  await ensureDefaults(intent);

  // ============================================================
  // ENVIRONMENT MODE CONFIGURATION (Architecture Update)
  // ============================================================

  // 1. DYNAMIC MODE: For 'serve', we use 'dynamic'.
  // This tells the server to:
  // - SKIP pre-compression (fast startup)
  // - Enable watchers
  // - Enable Live Reload
  // - Lazy-render pages on request
  process.env.THYPRESS_MODE = 'dynamic';

  // 2. FORCE DEV ENV: Ensures templates load from disk
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development';
  }

  // 3. INTENT & CONTEXT
  process.env.THYPRESS_INTENT_MODE = intent.mode;
  process.env.THYPRESS_WORKING_DIR = intent.workingDir;
  process.env.THYPRESS_OPEN_BROWSER = openBrowser ? 'true' : 'false';

  if (intent.contentRoot) {
    process.env.THYPRESS_CONTENT_ROOT = intent.contentRoot;
  }

  // Next steps guidance
  console.log(bright('Next steps:'));

  if (intent.mode === THYPRESS_MODES.VIEWER) {
    console.log(dim('• Edit your files and see changes instantly'));
    console.log(dim('• Press Ctrl+C to stop the server'));
  }

  if (intent.mode === THYPRESS_MODES.PROJECT) {
    console.log(dim('• Add .md files to content/pages/'));
    console.log(dim('• Install themes by dragging .zip files'));
    console.log(dim('• Run "thypress build" to export static site'));
  }

  console.log('');

  const serverPath = new URL('./server.js', import.meta.url).href;

  import(serverPath).catch(error => {
    console.error(errorMsg(`Server startup failed: ${error.message}`));
    process.exit(1);
  });
}

// ============================================================================
// BUILD COMMAND
// ============================================================================

async function build() {
  const intent = determineIntent();

  // Build always runs in project mode context
  if (intent.mode === THYPRESS_MODES.VIEWER && !fs.existsSync(path.join(intent.workingDir, 'content'))) {
    console.log(warning('Build requires a project structure'));
    console.log(info('Initialize a project first by running in an empty folder'));
    process.exit(1);
  }

  await ensureDefaults(intent);

  // ============================================================
  // STATIC MODE: For 'build', we use 'static'.
  // ============================================================
  process.env.THYPRESS_MODE = 'static';
  process.env.NODE_ENV = 'production';

  console.log(bright('Building static site...\n'));

  const { buildSite } = await import('./build.js');
  await buildSite();
}

async function buildAndServe() {
  await build();

  console.log('');
  console.log(bright('Starting preview server...\n'));

  // ============================================================
  // STATIC PREVIEW MODE: For 'build --serve'
  // This tells the server to act like a static host (Nginx-like)
  // serving only the /build directory.
  // ============================================================
  process.env.THYPRESS_MODE = 'static_preview';
  process.env.NODE_ENV = 'production';
  process.env.THYPRESS_OPEN_BROWSER = openBrowser ? 'true' : 'false';

  const serverPath = new URL('./server.js', import.meta.url).href;

  import(serverPath).catch(error => {
    console.error(errorMsg(`Server startup failed: ${error.message}`));
    process.exit(1);
  });
}

// ============================================================================
// UTILITY COMMANDS
// ============================================================================

function showVersion() {
  console.log(`${bright('THYPRESS')} v${VERSION}`);
  console.log(dim('Dead simple markdown blog/docs engine'));
  console.log(dim('https://github.com/thypress/thypress'));
}

function clean() {
  const cacheDir = path.join(process.cwd(), '.cache');

  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    console.log(success('Cache cleared'));
  } else {
    console.log(info('No cache to clear'));
  }
}

async function runValidation(target, workingDir) {
  if (!target) {
    // Validate everything
    console.log(bright('Validating all components...\n'));
    await validateThemeCommand();
    await validateContentCommand();
    await validateRedirectsCommand();
    return;
  }

  if (target === 'theme') {
    await validateThemeCommand();
  } else if (target === 'content') {
    await validateContentCommand();
  } else if (target === 'redirects') {
    await validateRedirectsCommand();
  } else {
    console.error(errorMsg(`Unknown validation target: ${target}`));
    console.log(dim('Valid targets: theme, content, redirects'));
    process.exit(1);
  }
}

async function handleRedirectsCommand(action) {
  const validActions = ['validate', 'test', 'list', 'check'];

  if (!validActions.includes(action)) {
    console.error(errorMsg(`Unknown redirects action: ${action}`));
    console.log(dim(`Valid actions: ${validActions.join(', ')}`));
    process.exit(1);
  }

  switch (action) {
    case 'validate':
      await validateRedirectsCommand();
      break;
    case 'test':
      await testRedirectsCommand();
      break;
    case 'list':
      await listRedirectsCommand();
      break;
    case 'check':
      await checkRedirectsCommand();
      break;
  }
}

async function testRedirectsCommand() {
  console.log(bright('Testing redirects...\n'));

  const redirectsPath = path.join(process.cwd(), 'redirects.json');

  if (!fs.existsSync(redirectsPath)) {
    console.log(info('No redirects.json found'));
    return;
  }

  const redirectsData = JSON.parse(fs.readFileSync(redirectsPath, 'utf-8'));
  const { rules, errors } = parseRedirectRules(redirectsData);

  if (errors.length > 0) {
    console.log(errorMsg('Validation errors found. Fix these first:\n'));
    errors.forEach(err => {
      console.log(dim(`• ${err}`));
    });
    process.exit(1);
  }

  console.log(success(`✓ Loaded ${rules.length} redirect rules\n`));

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise(resolve => rl.question(query, resolve));

  console.log(dim('Enter URLs to test (or "exit" to quit):\n'));

  while (true) {
    const url = await question(bright('URL: '));

    if (url.toLowerCase() === 'exit' || url.toLowerCase() === 'quit') {
      rl.close();
      break;
    }

    if (!url.trim()) continue;

    const testPath = url.startsWith('/') ? url : `/${url}`;
    let matched = false;

    for (const rule of rules) {
      const pattern = rule.from.replace(/:[^/]+/g, '([^/]+)');
      const regex = new RegExp(`^${pattern}$`);
      const match = testPath.match(regex);

      if (match) {
        matched = true;
        let finalTo = rule.to;

        const params = rule.from.match(/:([^/]+)/g);
        if (params) {
          params.forEach((param, i) => {
            finalTo = finalTo.replace(param, match[i + 1]);
          });
        }

        console.log(success(`✓ Match found!`));
        console.log(dim(`From: ${testPath}`));
        console.log(dim(`To: ${finalTo}`));
        console.log(dim(`Status: ${rule.statusCode}`));
        console.log('');
        break;
      }
    }

    if (!matched) {
      console.log(warning('No matching redirect rule'));
      console.log('');
    }
  }
}

async function listRedirectsCommand() {
  console.log(bright('Listing redirects...\n'));

  const redirectsPath = path.join(process.cwd(), 'redirects.json');

  if (!fs.existsSync(redirectsPath)) {
    console.log(info('No redirects.json found'));
    return;
  }

  const redirectsData = JSON.parse(fs.readFileSync(redirectsPath, 'utf-8'));
  const { rules, errors } = parseRedirectRules(redirectsData);

  if (errors.length > 0) {
    console.log(errorMsg('Validation errors:\n'));
    errors.forEach(err => {
      console.log(dim(`• ${err}`));
    });
    process.exit(1);
  }

  const byStatus = rules.reduce((acc, rule) => {
    if (!acc[rule.statusCode]) acc[rule.statusCode] = [];
    acc[rule.statusCode].push(rule);
    return acc;
  }, {});

  Object.entries(byStatus).forEach(([code, statusRules]) => {
    const desc = REDIRECT_STATUS_CODES[code];
    console.log(bright(`${code} - ${desc.description}`));
    console.log(dim(`${statusRules.length} rule(s):\n`));

    statusRules.forEach(rule => {
      console.log(`${rule.from} → ${rule.to}`);
    });

    console.log('');
  });

  console.log(success(`Total: ${rules.length} redirects`));
}

async function checkRedirectsCommand() {
  console.log(bright('Checking redirect compatibility...\n'));

  const redirectsPath = path.join(process.cwd(), 'redirects.json');

  if (!fs.existsSync(redirectsPath)) {
    console.log(info('No redirects.json found'));
    return;
  }

  const redirectsData = JSON.parse(fs.readFileSync(redirectsPath, 'utf-8'));
  const { rules, errors } = parseRedirectRules(redirectsData);

  if (errors.length > 0) {
    console.log(errorMsg('Validation errors:\n'));
    errors.forEach(err => {
      console.log(dim(`• ${err}`));
    });
    process.exit(1);
  }

  console.log(success(`✓ ${rules.length} valid redirect rules\n`));

  console.log(bright('Platform Support:\n'));

  console.log(success('✓ THYPRESS dev server (all status codes)'));
  console.log(success('✓ THYPRESS static build (smart routing)'));
  console.log(success('✓ Netlify (_redirects file)'));
  console.log(success('✓ Vercel (vercel.json)'));
  console.log(warning('GitHub Pages (limited - 301 only via Jekyll)'));
  console.log(warning('Static hosts (limited - manual .htaccess)'));

  console.log('');
  console.log(dim('Run "thypress build" to generate platform-specific files'));
}

async function validateRedirectsCommand() {
  console.log(bright('Validating redirects...\n'));

  const redirectsPath = path.join(process.cwd(), 'redirects.json');

  if (!fs.existsSync(redirectsPath)) {
    console.log(info('No redirects.json found (optional)'));
    return;
  }

  const redirectsData = JSON.parse(fs.readFileSync(redirectsPath, 'utf-8'));
  const { rules, errors } = parseRedirectRules(redirectsData);

  if (errors.length > 0) {
    console.log(errorMsg('Validation errors:\n'));
    errors.forEach(err => {
      console.log(dim(`• ${err}`));
    });
    process.exit(1);
  }

  console.log(success(`✓ All ${rules.length} redirect rules valid`));

  const statusBreakdown = rules.reduce((acc, rule) => {
    acc[rule.statusCode] = (acc[rule.statusCode] || 0) + 1;
    return acc;
  }, {});

  console.log(dim(`Status codes: ${Object.entries(statusBreakdown).map(([code, count]) => `${count}×${code}`).join(', ')}`));
}

async function validateContentCommand() {
  console.log(bright('Validating content...\n'));

  const { loadAllContent, getAllTags } = await import('./renderer.js');
  const { contentCache, brokenImages } = loadAllContent();

  console.log(success(`✓ Loaded ${contentCache.size} entries`));

  if (brokenImages.length > 0) {
    console.log(warning(`\n  Broken image references (${brokenImages.length}):`));
    brokenImages.forEach(broken => {
      console.log(dim(`• ${broken.page} → ${broken.src} (file not found)`));
    });
    console.log('');
  }

  // Check for duplicate URLs
  const urlMap = new Map();
  const duplicates = [];

  for (const [slug, entry] of contentCache) {
    if (urlMap.has(entry.url)) {
      duplicates.push({
        url: entry.url,
        files: [urlMap.get(entry.url), entry.filename]
      });
    } else {
      urlMap.set(entry.url, entry.filename);
    }
  }

  if (duplicates.length > 0) {
    console.log(errorMsg(`Duplicate URLs detected (${duplicates.length}):\n`));
    duplicates.forEach(dup => {
      console.log(dim(`• ${dup.url}`));
      console.log(dim(`- ${dup.files[0]}`));
      console.log(dim(`- ${dup.files[1]}`));
    });
    console.log('');
    process.exit(1);
  }

  console.log('');
  console.log(info('Content Statistics:'));
  console.log(dim(`Total entries: ${contentCache.size}`));

  const tags = getAllTags(contentCache);
  console.log(dim(`Tags: ${tags.length}`));
}

async function validateThemeCommand() {
  console.log(bright('Validating theme...\n'));

  const siteConfig = getSiteConfig();
  const { loadTheme } = await import('./theme-system.js');

  console.log(info(`Loading theme: ${siteConfig.theme || 'auto-detect'}...`));
  const theme = await loadTheme(siteConfig.theme, siteConfig);

  console.log('');

  if (theme.validation && !theme.validation.valid) {
    console.error(errorMsg(`✗ Theme "${theme.activeTheme}" validation failed\n`));

    if (theme.validation.errors.length > 0) {
      console.log(errorMsg('Errors:'));
      theme.validation.errors.forEach(err => {
        console.log(dim(`  • ${err}`));
      });
      console.log('');
    }

    if (theme.validation.warnings.length > 0) {
      console.log(warning('Warnings:'));
      theme.validation.warnings.forEach(warn => {
        console.log(dim(`  • ${warn}`));
      });
      console.log('');
    }

    process.exit(1);
  }

  console.log(success(`✓ Theme "${theme.activeTheme}" validation passed`));

  if (theme.validation && theme.validation.warnings.length > 0) {
    console.log('');
    console.log(warning('Warnings:'));
    theme.validation.warnings.forEach(warn => {
      console.log(dim(`  • ${warn}`));
    });
  }

  console.log('');
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

${bright('Validation Commands:')}
  validate                Validate all (theme + content + redirects)
  validate <target>       Validate specific component (theme/content/redirects)

${bright('Redirect Commands:')}
  redirects [action]      Manage redirect rules (default action: validate)
    validate              Validate redirects.json syntax and rules
    test                  Test URLs against redirect rules interactively
    list                  List all redirect rules grouped by status code
    check                 Check redirect compatibility and build output

${bright('Note:')} "validate redirects" and "redirects validate" are equivalent aliases

${bright('Options:')}
  --dir, -d <path>        Target directory (default: current)
  --content-dir, -c <dir> Content directory name (default: content/)
  --skip-dirs <dirs>      Comma-separated dirs to skip (adds to defaults)
  --no-browser            Don't auto-open browser
  [directory]             Direct path to directory

${bright('Environment Variables:')}
  PORT=8080               Set server port (default: auto-detect)
  DISABLE_AUTOGEN_TEMPLATE=true   Disable template auto-generation
  THYPRESS_IDLE_TIMEOUT=0  Seconds before connection timeout (0=infinite)

${bright('Examples:')}
  thypress                           # Serve from current directory
  thypress build                     # Build static site
  thypress build --serve             # Build + preview
  thypress my-blog/                  # Serve from my-blog/
  thypress --dir ~/blog              # Serve from ~/blog
  thypress --content-dir articles    # Use articles/ as content
  thypress --skip-dirs tmp,cache     # Skip tmp/ and cache/ folders
  PORT=8080 thypress serve           # Use specific port

${bright('Validation Examples:')}
  thypress validate                  # Validate all components
  thypress validate theme            # Check theme structure and syntax
  thypress validate content          # Check for duplicate URLs and broken images
  thypress validate redirects        # Verify redirect rules

${bright('Redirect Examples:')}
  thypress redirects validate        # Validate redirects.json
  thypress redirects test            # Test redirect rules interactively
  thypress redirects list            # Show all redirects
  thypress redirects check           # Check compatibility

${bright('Structure:')}
  content/              ← Your content (markdown/text/html)
    pages/              ← Blog pages
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
    "/old-page/": "/new-page/"
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
    "/blog/:slug/": "/pages/:slug/",
    "/:year/:month/:slug/": "/pages/:slug/"
  }

  Supported status codes:
  - 301: Permanent (SEO-friendly, default)
  - 302: Temporary (promotions, A/B tests)
  - 303: Page-form redirect (prevents resubmit)
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
    "strictThemeIsolation": false,      // Disable embedded defaults fallback
    "forceTheme": false,                // Load broken themes anyway
    "fingerprintAssets": true,          // Add hash to CSS/JS filenames
    "disablePreRender": false,          // Skip warmup on startup
    "preCompressContent": false,        // Pre-compress all pages (opt-in)
    "disableLiveReload": false,         // Disable live reload
    "strictPreRender": true,            // Exit if page fails to render
    "strictTemplateValidation": true,   // Exit on template syntax errors
    "allowExternalRedirects": false,    // Allow redirects to external URLs
    "allowedRedirectDomains": [],       // Domain whitelist for redirects
    "cacheMaxSize": 52428800            // Cache size in bytes (50MB default)
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

${bright('Intent Modes:')}
  ${bright('VIEWER:')}   Zero-footprint file viewing
             Drop files or folders with existing content
             No scaffolding, no config creation

  ${bright('PROJECT:')}  Full project with content/ directory
             Empty folders get initialized with welcome.md
             Creates config.json and project structure

  ${bright('INSTALLER:')} Theme installation from .zip
             Extracts theme to templates/
             Updates or creates config.json

${bright('Features:')}
  • Lightweight live reload
  • Related pages (tag-based)
  • RSS per tag/category/series
  • URL redirects with 5 status codes
  • Dual-build strategy (smart + dumb hosts)
  • Taxonomies (tags, categories, series)
  • Admonitions (:::tip, :::warning, etc.)
  • Asset fingerprinting
  • Responsive image optimization
  • SEO + structured data
  • Unicode support
  • Pre-render warmup (production-ready)
  • Pre-compression (gzip + brotli)
  • Template validation

${bright('Docs:')}
  https://github.com/thypress/launcher
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
  case 'install-theme':
    await installThemeFromArchive(themeArchivePath, targetDir);
    break;
  case 'validate':
    await runValidation(validateTarget, targetDir);
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
