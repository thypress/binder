// src/embed-templates.js
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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import matter from 'gray-matter';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const TEMPLATES_BASE_DIR = path.join(__dirname, '../templates');
const OUTPUT_FILE        = path.join(__dirname, 'embedded-templates.js');

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

const defaultFlag   = process.argv.find(a => a.startsWith('--default='));
const DEFAULT_THEME_ID = defaultFlag ? defaultFlag.split('=')[1] : '.default';

if (!DEFAULT_THEME_ID.startsWith('.')) {
  console.error(`[ERROR] --default value must start with "." (dot-prefixed). Got: "${DEFAULT_THEME_ID}"`);
  console.error('Example: bun src/embed-templates.js --default=.default');
  process.exit(1);
}

console.log(`[INFO] Default theme ID: ${DEFAULT_THEME_ID}`);

// ============================================================================
// FILE ENCODING UTILITIES
// ============================================================================

// Text extensions are stored as UTF-8 strings.
const TEXT_EXTENSIONS = new Set([
  '.html', '.hbs', '.handlebars',
  '.css', '.scss', '.less',
  '.js', '.mjs', '.ts',
  '.txt', '.xml', '.json', '.yaml', '.yml', '.md', '.svg'
]);

// Binary extensions are encoded as base64 data URIs.
const BINARY_MIME_TYPES = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.eot':  'application/vnd.ms-fontobject',
};

const ALL_VALID_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...Object.keys(BINARY_MIME_TYPES),
]);

/**
 * Read a file and return it as a UTF-8 string (text) or a base64 data URI (binary).
 */
function encodeFile(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  if (BINARY_MIME_TYPES[ext]) {
    const buf    = fs.readFileSync(fullPath);
    const mime   = BINARY_MIME_TYPES[ext];
    const b64    = buf.toString('base64');
    return `data:${mime};base64,${b64}`;
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

// ============================================================================
// HANDLEBARS SYNTAX VALIDATION
// ============================================================================

/**
 * Validate a Handlebars template string at the syntax level.
 * Does NOT require helpers or partials to be registered — purely AST parsing.
 *
 * @returns {boolean} true if valid
 */
function validateHandlebarsTemplate(content, logicalPath) {
  try {
    // Strip frontmatter before checking syntax to avoid Handlebars choking on YAML
    const { content: templateBody } = matter(content);
    Handlebars.precompile(templateBody);
    return true;
  } catch (err) {
    console.error(`  [SYNTAX ERROR] ${logicalPath}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

// ============================================================================
// THEME DIRECTORY SCANNER
// ============================================================================

/**
 * Recursively scan a single system-theme directory.
 * Returns { files: { relPath → encoded }, syntaxErrors: number }.
 *
 * Rules:
 * - Hidden files/dirs (name starts with ".") inside a theme are ignored.
 * - Only ALL_VALID_EXTENSIONS are included.
 * - Every .html file is Handlebars-precompiled for syntax.
 * - Binary files are base64-encoded as data URIs.
 * - Max recursion depth: 20.
 */
function scanThemeDir(themeDir, themeId) {
  const files        = {};
  let   syntaxErrors = 0;

  function scan(dir, prefix, depth) {
    if (depth > 20) {
      console.warn(`  [WARNING] Max directory depth reached in ${dir} — skipping deeper entries`);
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files/dirs *inside* the theme (e.g. .DS_Store, .git)
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      const relKey   = prefix ? `${prefix}/${entry.name}` : entry.name;
      const ext      = path.extname(entry.name).toLowerCase();

      if (entry.isDirectory()) {
        scan(fullPath, relKey, depth + 1);
        continue;
      }

      if (!ALL_VALID_EXTENSIONS.has(ext)) continue;

      try {
        const encoded = encodeFile(fullPath);
        files[relKey] = encoded;

        // Validate Handlebars syntax for HTML templates.
        // For text files, `encoded` is already the UTF-8 string.
        if (ext === '.html' || ext === '.hbs') {
          if (!validateHandlebarsTemplate(encoded, `templates/${themeId}/${relKey}`)) {
            syntaxErrors++;
          }
        }
      } catch (err) {
        console.warn(`  [WARNING] Could not read ${themeId}/${relKey}: ${err.message}`);
      }
    }
  }

  if (!fs.existsSync(themeDir)) {
    console.error(`[ERROR] Theme directory does not exist: ${themeDir}`);
    return { files, syntaxErrors: 1 }; // treat as error
  }

  scan(themeDir, '', 0);
  return { files, syntaxErrors };
}

// ============================================================================
// DISCOVER SYSTEM THEMES
// ============================================================================

if (!fs.existsSync(TEMPLATES_BASE_DIR)) {
  console.error(`[ERROR] Templates base directory not found: ${TEMPLATES_BASE_DIR}`);
  console.error('Expected project structure: templates/.default/, templates/.bare-1994/, ...');
  process.exit(1);
}

const systemThemeNames = fs.readdirSync(TEMPLATES_BASE_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith('.'))
  .map(e => e.name)
  .sort();

if (systemThemeNames.length === 0) {
  console.error('[ERROR] No system theme directories found in templates/');
  console.error('System themes must be dot-prefixed directories, e.g. templates/.default/');
  process.exit(1);
}

console.log(`\n[INFO] Found ${systemThemeNames.length} system theme(s): ${systemThemeNames.join(', ')}`);

// ============================================================================
// STRUCTURAL VALIDATION OF DESIGNATED DEFAULT THEME
// ============================================================================

const defaultThemeDir = path.join(TEMPLATES_BASE_DIR, DEFAULT_THEME_ID);

if (!fs.existsSync(defaultThemeDir)) {
  console.error(`\n[ERROR] Designated default theme directory not found: templates/${DEFAULT_THEME_ID}/`);
  console.error(`Available system themes: ${systemThemeNames.join(', ')}`);
  console.error(`Specify a different default with: bun src/embed-templates.js --default=<.theme-name>`);
  process.exit(1);
}

const defaultIndexPath = path.join(defaultThemeDir, 'index.html');
if (!fs.existsSync(defaultIndexPath)) {
  console.error(`\n[ERROR] Designated default theme "${DEFAULT_THEME_ID}" is missing the required file: index.html`);
  console.error(`Path checked: ${defaultIndexPath}`);
  console.error('The default theme must be a complete, self-sufficient theme.');
  process.exit(1);
}

// Check if Single File or Multi File
let isSingleFile = false;
try {
  const indexContent = fs.readFileSync(defaultIndexPath, 'utf-8');
  const { data } = matter(indexContent);
  if (data.singleFile === true) {
    isSingleFile = true;
    console.log(`[INFO] Default theme "${DEFAULT_THEME_ID}" detected as Single-File.`);
  }
} catch (e) {
  console.warn(`[WARNING] Could not parse frontmatter in ${DEFAULT_THEME_ID}/index.html: ${e.message}`);
}

// Enforce entry.html ONLY if NOT singleFile
if (!isSingleFile) {
  const defaultEntryPath = path.join(defaultThemeDir, 'entry.html');
  if (!fs.existsSync(defaultEntryPath)) {
    console.error(`\n[ERROR] Designated default theme "${DEFAULT_THEME_ID}" is missing required file: entry.html`);
    console.error('Multi-file themes must include entry.html. Mark "singleFile: true" in index.html frontmatter to bypass.');
    process.exit(1);
  }
}

console.log(`[INFO] Structural check passed for default theme: ${DEFAULT_THEME_ID}`);

// ============================================================================
// SCAN & VALIDATE ALL SYSTEM THEMES
// ============================================================================

const EMBEDDED_TEMPLATES = {};
let totalSyntaxErrors = 0;

const globalStats = { total: 0, html: 0, css: 0, js: 0, binary: 0, other: 0 };

for (const themeId of systemThemeNames) {
  const themeDir = path.join(TEMPLATES_BASE_DIR, themeId);
  console.log(`\n[INFO] Processing: ${themeId}`);

  const { files, syntaxErrors } = scanThemeDir(themeDir, themeId);

  if (syntaxErrors > 0) {
    totalSyntaxErrors += syntaxErrors;
    console.error(`  [ERROR] ${syntaxErrors} syntax error(s) in theme "${themeId}"`);
  }

  EMBEDDED_TEMPLATES[themeId] = files;

  // Per-theme stats
  const keys    = Object.keys(files);
  const counts = {
    total:  keys.length,
    html:   keys.filter(k => k.endsWith('.html') || k.endsWith('.hbs')).length,
    css:    keys.filter(k => k.endsWith('.css')).length,
    js:     keys.filter(k => k.endsWith('.js') || k.endsWith('.mjs')).length,
    binary: keys.filter(k => {
      const ext = path.extname(k).toLowerCase();
      return !!BINARY_MIME_TYPES[ext];
    }).length,
    other: 0,
  };
  counts.other = counts.total - counts.html - counts.css - counts.js - counts.binary;

  console.log(`  [SUCCESS] ${counts.total} files scanned — ` +
              `${counts.html} HTML, ${counts.css} CSS, ${counts.js} JS, ` +
              `${counts.binary} binary, ${counts.other} other`);

  if (syntaxErrors === 0) {
    console.log(`  [SUCCESS] All HTML templates passed syntax validation`);
  }

  globalStats.total  += counts.total;
  globalStats.html   += counts.html;
  globalStats.css    += counts.css;
  globalStats.js     += counts.js;
  globalStats.binary += counts.binary;
  globalStats.other  += counts.other;
}

// ============================================================================
// ABORT ON ERRORS
// ============================================================================

if (totalSyntaxErrors > 0) {
  console.error(`\n[ERROR] ${totalSyntaxErrors} template syntax error(s) across all themes.`);
  console.error('Fix the errors listed above and re-run: bun src/embed-templates.js');
  process.exit(1);
}

// ============================================================================
// GENERATE OUTPUT FILE
// ============================================================================

const totalSizeBytes = Object.values(EMBEDDED_TEMPLATES)
  .flatMap(themeFiles => Object.values(themeFiles))
  .reduce((sum, content) => sum + content.length, 0);

const sizeMB = (totalSizeBytes / 1024 / 1024).toFixed(2);

const themeBreakdown = systemThemeNames
  .map(id => {
    const count = Object.keys(EMBEDDED_TEMPLATES[id]).length;
    return `//    - "${id}": ${count} files`;
  })
  .join('\n');

const output = `// AUTO-GENERATED — DO NOT EDIT
// Generated:   ${new Date().toISOString()}
// Generator:   src/embed-templates.js
// Source dir:  templates/  (dot-prefixed subdirectories only)
//
// Themes embedded (${systemThemeNames.length}):
${themeBreakdown}
//
// Totals: ${globalStats.total} files | ${sizeMB} MB
//   HTML: ${globalStats.html} | CSS: ${globalStats.css} | JS: ${globalStats.js} | Binary: ${globalStats.binary} | Other: ${globalStats.other}
//
// To regenerate:
//   bun src/embed-templates.js
//   bun src/embed-templates.js --default=.minimal
//
// Binary assets are stored as data URIs: "data:<mime>;base64,<b64>"

/**
 * The theme ID that will be used as the absolute safety-net fallback.
 * Set at build time via --default=<id>. Baked into the binary.
 */
export const DEFAULT_THEME_ID = ${JSON.stringify(DEFAULT_THEME_ID)};

/**
 * All embedded system themes, keyed by theme ID (dot-prefixed).
 * Each value is a flat map of { "relPath": "content | data-uri" }.
 *
 * Structure:
 * EMBEDDED_TEMPLATES[themeId][relPath] → string content or base64 data URI
 */
export const EMBEDDED_TEMPLATES = ${JSON.stringify(EMBEDDED_TEMPLATES, null, 2)};
`;

fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');

// ============================================================================
// FINAL REPORT
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('[SUCCESS] embedded-templates.js generated');
console.log(`  Default theme:  ${DEFAULT_THEME_ID}`);
console.log(`  Themes bundled: ${systemThemeNames.join(', ')}`);
console.log(`  Total files:    ${globalStats.total}`);
console.log(`  Total size:     ${sizeMB} MB`);
console.log(`  Output:         ${OUTPUT_FILE}`);
console.log('='.repeat(60));
