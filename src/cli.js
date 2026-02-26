// SPDX-FileCopyrightText: 2026 Teo Costa (https://thypress.org)
// SPDX-License-Identifier: MPL-2.0

import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js';

import { isHostileDirectory } from './content-processor.js';
import { REDIRECT_STATUS_CODES, parseRedirectRules } from './build.js';
import { configDefaults, getSiteConfig } from './utils/taxonomy.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const VERSION = globalThis.__THYPRESS_VERSION__ ?? JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')).version;

// ============================================================================
// BUNDLERBUS COMPATIBILITY: Restore working directory
// ============================================================================
// Bundlerbus (Bun 1.3.9+) must run from cache for module resolution.
// The original working directory is stored in this env var.
if (process.env.BUNDLERBUS_ORIGINAL_CWD) {
  const originalCwd = process.env.BUNDLERBUS_ORIGINAL_CWD;
  console.log(`[BUNDLERBUS] Detected bundled execution`);
  console.log(`[BUNDLERBUS] Restoring cwd from ${process.cwd()} to ${originalCwd}`);
  process.chdir(originalCwd);
  // Don't delete env var - other modules might need it
}

// ============================================================================
// INTENT MODES - The three ways users interact with THYPRESS
// ============================================================================

const THYPRESS_MODES = {
  VIEWER: 'viewer',       // Zero-footprint file viewing (dropped files/folders)
  PROJECT: 'project',     // Scaffolded project with content/ directory
  INSTALLER: 'installer', // Theme installation from .zip
  WELCOME: 'welcome'      // First-run GUI mode — hostile directory detected, no TTY
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
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        redirectAction = args[i + 1];
        i++;
      }
      continue;
    }

    if (arg === 'validate' || arg === 'v') {
      command = 'validate';
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

    // PIN setup — sets/updates the 4-digit admin PIN and exits immediately.
    // Handled here rather than as a separate command so it works standalone:
    // "thypress --pin mySecretPIN" with no other arguments.
    if (arg === '--pin') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        console.error(errorMsg('--pin requires at least 6 characters'));
        console.log(dim('Example: thypress --pin mySecretPIN'));
        process.exit(1);
      }
      handlePINSetup(args[i + 1]);
      // handlePINSetup calls process.exit — execution never reaches here
    }

    if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
      targetDir = arg;
      continue;
    }

    if (arg.includes('/') || arg.includes('\\')) {
      targetDir = arg;
      continue;
    }

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

/**
 * Handle --pin flag to set/update PIN.
 * Stores as "salt:hash" (salted SHA-256) — identical format to SecurityManager.setPIN.
 * Validation rules match SecurityManager: 6+ chars, no whitespace.
 */
function handlePINSetup(pin) {
  if (pin.length < 6 || /\s/.test(pin)) {
    console.error(errorMsg('PIN must be at least 6 characters with no spaces'));
    console.log(dim('Example: thypress --pin mySecretPIN"'));
    process.exit(1);
  }

  const configDir = path.join(process.cwd(), '.thypress');
  const pinPath = path.join(configDir, 'pin');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Salt + hash — matches SecurityManager.setPIN format exactly:
  // "salt:hash" where salt = 32 hex chars, hash = 64 hex chars (SHA-256)
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + pin).digest('hex');
  fs.writeFileSync(pinPath, `${salt}:${hash}`, 'utf-8');

  console.log(success(`✓ PIN set successfully`));
  console.log(dim('Your admin panel is now protected with PIN authentication'));
  console.log('');

  process.exit(0);
}

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

    const cwd = process.cwd();
    const exeFolder = path.dirname(process.execPath);
    let workingDir;

    console.log(info(`[DEBUG] cwd: ${cwd}`));
    console.log(info(`[DEBUG] exeFolder: ${exeFolder}`));

    if (fs.existsSync(path.join(cwd, 'config.json'))) {
      console.log(info(`[DEBUG] Found config.json in cwd, using: ${cwd}`));
      workingDir = cwd;
    } else if (fs.existsSync(path.join(exeFolder, 'config.json'))) {
      console.log(info(`[DEBUG] Found config.json in exeFolder, using: ${exeFolder}`));
      workingDir = exeFolder;
    } else {
      console.log(info(`[DEBUG] No config.json found, defaulting to exeFolder: ${exeFolder}`));
      workingDir = exeFolder;
    }

    return {
      mode: THYPRESS_MODES.INSTALLER,
      zipPath: path.resolve(zipFile),
      workingDir: workingDir
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

      const folders = files.map(f => path.dirname(path.resolve(f)));
      const uniqueFolders = [...new Set(folders)];
      const firstFileFolder = path.dirname(path.resolve(files[0]));

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

  // ── WELCOME MODE GATE ────────────────────────────────────────────────────
  // GUI double-click: no TTY + hostile directory (Downloads, Desktop, etc.)
  // → chdir to ~/THYPRESS/ BEFORE server starts so .thypress/ secrets never
  //   land in the hostile directory.
  if (!process.stdout.isTTY && isHostileDirectory(cwd)) {
    console.log(info('Hostile directory detected in GUI mode — entering Welcome mode'));

    const thypressHome = path.join(os.homedir(), 'THYPRESS');
    if (!fs.existsSync(thypressHome)) {
      fs.mkdirSync(thypressHome, { recursive: true });
    }
    process.chdir(thypressHome);

    return {
      mode: THYPRESS_MODES.WELCOME,
      workingDir: thypressHome
    };
  }

  // TTY + hostile directory → warn but continue (user deliberately navigated here)
  if (process.stdout.isTTY && isHostileDirectory(cwd)) {
    console.log(warning('This looks like a system folder (Downloads, Desktop, etc.)'));
    console.log(info('THYPRESS works best when run from a project directory.'));
    console.log(dim('Consider: cd ~/my-site && thypress serve'));
    console.log('');
  }
  // ── END WELCOME MODE GATE ────────────────────────────────────────────────

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

/**
 * Build the 3-step welcome.md content for new projects.
 * @param {string} contentRoot - Absolute path to the content root directory
 * @returns {string} Markdown content
 */
function buildWelcomeMd(contentRoot) {
  return `---
title: Let's make something
---

# Welcome to THYPRESS

Your site is live. Let's prove it.

## Step 1: Open your files
Click "Edit your pages" in the admin panel (or open the folder at \`${contentRoot}\`).

## Step 2: Edit this file
Open \`welcome.md\` in any text editor. Delete this line and type your name. Save.

## Step 3: Watch
↑ This page just updated. That's THYPRESS — edit a file, see it live.

---

Ready for more? Check the [full guide](https://thypress.org/docs) or
explore the admin panel to change themes, build your site, and more.
`;
}

// const examplePage = path.join(pagesDir, '2024-01-01-welcome.md');
// fs.writeFileSync(examplePage, `---
// title: Welcome to THYPRESS!
// createdAt: 2024-01-01
// updatedAt: 2024-01-15
// tags: [blogging, markdown, documentation]
// categories: [tutorials]
// description: Your first page with THYPRESS - learn about features and get started
// ---

// # Welcome to THYPRESS!

// This is your first page. Create more \`.md\` files in \`content/pages/\`.

// ## Getting Started

// THYPRESS is a **static site generator** with a built-in HTTP server. It's designed for speed, simplicity, and flexibility.

// ### Writing Content

// Add YAML front matter to your pages:

// \`\`\`yaml
// ---
// title: My Page Title
// createdAt: 2024-01-01
// updatedAt: 2024-01-15
// tags: [tag1, tag2]
// categories: [programming]
// series: Getting Started
// description: A short description
// draft: false  # Set to true to hide from site
// permalink: /custom-url/  # Optional: custom URL
// ---
// \`\`\`

// ### File Formats

// THYPRESS supports three content types:

// - **Markdown** (\`.md\`) - Full CommonMark + GFM support
// - **Plain text** (\`.txt\`) - Rendered in \`<pre>\` tags (HTML-escaped for security)
// - **HTML** (\`.html\`) - Complete documents or fragments

// ## THYPRESS Conventions

// ### Drafts (Content)

// Keep work-in-progress content hidden with these methods:

// 1. **\`drafts/\` folder** - Place anywhere in \`content/\`:
// \`\`\`
// content/
// ├── pages/
// │   ├── published.md
// │   └── drafts/         ← Everything here is ignored
// │       └── wip.md
// └── drafts/             ← Top-level drafts
//  └── another-wip.md
// \`\`\`

// 2. **\`draft: true\` in front matter**:
// \`\`\`yaml
// ---
// title: Work in Progress
// draft: true
// ---
// \`\`\`

// 3. **Dot prefix** - Files starting with \`.hidden.md\` are ignored

// ### Partials (Templates)

// Reusable template components use similar conventions:

// 1. **\`partials/\` folder** in your theme:
// \`\`\`
// templates/.default/
// ├── index.html
// ├── entry.html
// └── partials/           ← Auto-registered as partials
//  ├── header.html
//  └── footer.html
// \`\`\`

// 2. **Underscore prefix** - \`_header.html\` is auto-registered as a partial

// 3. **\`partial: true\` in front matter**:
// \`\`\`yaml
// ---
// partial: true
// ---
// \`\`\`

// ## Features

// - 📝 **Markdown** with syntax highlighting
// - 🏷️ **Taxonomies** - Tags, categories, and series
// - 🔗 **Related content** based on shared tags
// - 📊 **Table of contents** (auto-generated from headings)
// - 🔄 **Hot reload** templates and content automatically
// - 🎨 **Themes** - Handlebars templates
// - 📰 **RSS feeds** - Global, per-tag, per-category, per-series
// - 🗺️ **Sitemap** generation
// - 🔍 **Search index** (JSON)
// - 🖼️ **Image optimization** with responsive sizes
// - ⚡ **Fast builds** with parallel processing
// - 🎯 **URL redirects** with pattern matching
// - 📱 **Mobile-friendly** default theme

// ## Theme System

// THYPRESS uses Handlebars templates. The minimum viable theme is just \`index.html\`:

// \`\`\`handlebars
// <!DOCTYPE html>
// <html>
// <head>
// <title>{{config.title}}</title>
// </head>
// <body>
// {{#if entry}}
// <article>
// <h1>{{entry.title}}</h1>
// {{{entry.html}}}
// </article>
// {{else}}
// <ul>
// {{#each entries}}
//   <li><a href="{{url}}">{{title}}</a></li>
// {{/each}}
// </ul>
// {{/if}}
// </body>
// </html>
// \`\`\`

// ### Available Templates

// - \`index.html\` - Required: Homepage and lists
// - \`entry.html\` - Individual content pages
// - \`tag.html\` - Tag archives
// - \`category.html\` - Category archives
// - \`series.html\` - Series archives
// - \`404.html\` - Not found page

// ### Template Variables

// All templates receive:

// - \`config\` - Site configuration
// - \`navigation\` - Site navigation tree
// - \`theme\` - Theme metadata

// **Entry pages** get:

// - \`entry\` - Current entry object
// - \`frontMatter\` - Raw front matter
// - \`prevEntry\` / \`nextEntry\` - Navigation
// - \`relatedEntries\` - Tag-based suggestions
// - \`toc\` - Table of contents

// **List pages** get:

// - \`entries\` - Array of entries
// - \`pagination\` - Pagination data (if applicable)
// - \`tag\` / \`category\` / \`series\` - Current taxonomy term

// ## CLI Commands

// \`\`\`bash
// thypress serve              # Start dev server
// thypress build              # Build static site
// thypress build --serve      # Build + preview
// thypress clean              # Delete cache
// \`\`\`

// ## Configuration

// Edit \`config.json\`:

// \`\`\`json
// {
// "title": "My Site",
// "description": "A site powered by THYPRESS",
// "url": "https://example.com",
// "author": "Your Name",
// "theme": ".default",
// "contentDir": "content",
// "readingSpeed": 200,
// "escapeTextFiles": true,
// "strictImages": false,
// "fingerprintAssets": false
// }
// \`\`\`

// ## Next Steps

// 1. Edit this file or create new \`.md\` files
// 2. Install a theme by dragging a \`.zip\` file onto the THYPRESS executable
// 3. Customize your \`config.json\`
// 4. Run \`thypress build\` to export your site

// Happy writing! 🎉
// `);

async function ensureDefaults(intent) {
  const currentDir = intent.workingDir;

  // Change to working directory determined by intent
  process.chdir(currentDir);

  console.log(bright(`Intent: ${intent.mode.toUpperCase()}`));
  console.log(info(`Working directory: ${currentDir}\n`));

  // ========================================================================
  // WELCOME MODE: No scaffolding — server starts, browser goes to admin panel
  // ========================================================================
  if (intent.mode === THYPRESS_MODES.WELCOME) {
    console.log(success('Welcome mode — server will start, browser will open admin panel'));
    console.log(dim('No files created until user chooses to create a project.'));
    console.log('');
    return;
  }

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

      // 3-step welcome.md — concise tutorial, not a reference manual
      const examplePage = path.join(pagesDir, 'welcome.md');
      fs.writeFileSync(examplePage, buildWelcomeMd(contentRoot));
      console.log(success(`Created ${path.relative(currentDir, examplePage)}`));
    }

    // Create config.json
    const configPath = path.join(currentDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      const defaults = configDefaults();
      fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
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

    // Count theme files for display
    const themeFiles = fs.readdirSync(themeDestination, { recursive: true })
      .filter(f => {
        const fullPath = path.join(themeDestination, f);
        return fs.statSync(fullPath).isFile();
      });

    // ========================================================================
    // INTERACTIVE PROMPT: Activate theme or finish without activating
    // ========================================================================

    console.log('');
    console.log(success('✓ Theme installed successfully!'));
    console.log('');
    console.log(bright(`  Theme:    ${themeName}`));
    console.log(dim(`  Location: templates/${themeName}/`));
    console.log(dim(`  Files:    ${themeFiles.length}`));
    console.log('');
    console.log(dim('  • Manage all themes: localhost:3009/__thypress'));
    console.log('');

    // ── GUI MODE (no TTY): auto-activate, skip interactive prompt ───────────
    // This runs when a .zip is dragged onto the exe — no terminal is visible.
    if (!process.stdin.isTTY) {
      console.log(info(`Auto-activating theme: ${themeName}...`));

      const configPath = path.join(targetDir, 'config.json');
      let config = {};
      if (fs.existsSync(configPath)) {
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
      }
      config.theme = themeName;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      console.log(success(`✓ Theme installed and activated: ${themeName}`));
      console.log(dim('If THYPRESS is running, it will hot-reload automatically.'));
      process.exit(0);
    }
    // ── END GUI MODE ─────────────────────────────────────────────────────────

    console.log(dim('  ─────────────────────────────────────────'));
    console.log('');
    console.log(bright('  [Enter]    ') + 'Activate this theme now');
    console.log(bright('  [Any key]  ') + 'Finish without activating');
    console.log('');

    // Wait for user input
    const readline = require('readline');
    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    await new Promise((resolve) => {
      const onKeypress = (str, key) => {
        // Clean up listener
        process.stdin.removeListener('keypress', onKeypress);

        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }

        // Handle Ctrl+C
        if (key && key.ctrl && key.name === 'c') {
          console.log('');
          console.log(info('Installation cancelled.'));
          process.exit(0);
        }

        console.log(''); // Add newline after keypress

        // Check if Enter was pressed
        if (key && key.name === 'return') {
          // User wants to activate theme
          console.log(info(`Activating theme: ${themeName}...`));
          console.log('');

          const configPath = path.join(targetDir, 'config.json');
          let config = {};

          if (fs.existsSync(configPath)) {
            try {
              config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
              const oldTheme = config.theme || 'default';
              config.theme = themeName;
              fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
              console.log(success(`✓ Theme activated: ${oldTheme} → ${themeName}`));
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
            console.log(success(`✓ Theme activated: ${themeName}`));
            console.log(dim('  Created config.json'));
          }

          console.log('');
          console.log(bright('Next steps:'));
          console.log(dim('• If THYPRESS is running, it will reload automatically'));
          console.log(dim('• If not, launch THYPRESS to see your new theme'));
          console.log('');

        } else {
          // User pressed other key - finish without activating
          console.log(info('Theme installed but not activated.'));
          console.log('');
          console.log(bright('Next steps:'));
          console.log(dim(`• Activate later: Set "theme": "${themeName}" in config.json`));
          console.log(dim('• Or use admin panel: localhost:3009/__thypress'));
          console.log('');
        }

        resolve();
      };

      process.stdin.on('keypress', onKeypress);
    });

    // Exit cleanly - do NOT launch server
    process.exit(0);

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

  // Note: The server.js will output the magic link URL
  // We just need to import and let it run
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

  const { loadAllContent } = await import('./content-processor.js');
  const { getAllTags } = await import('./utils/taxonomy.js');
  const { contentCache, brokenImages } = await loadAllContent();

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
    .defaylt/           ← Active theme
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
    "theme": ".default",                // Active theme
    "readingSpeed": 200,                // Words per minute
    "escapeTextFiles": true,            // Escape HTML in .txt files
    "strictImages": false,              // Exit on broken images
    "strictThemeIsolation": false,      // Disable embedded defaults fallback
    "forceTheme": false,                // Load broken themes anyway
    "discoverTemplates": false,         // Auto-detect template syntax
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
