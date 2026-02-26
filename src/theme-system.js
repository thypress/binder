// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS <https://thypress.org>)
// SPDX-License-Identifier: MPL-2.0

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import matter from 'gray-matter';
import Handlebars from 'handlebars';

import { slugify } from './utils/taxonomy.js';
import { registerHelpers } from './utils/theme-helpers.js';
import { success, error as errorMsg, warning, info, dim } from './utils/colors.js';

import { DEFAULT_THEME_ID, EMBEDDED_TEMPLATES as STATIC_EMBEDDED_TEMPLATES } from './embedded-templates.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ============================================================================
// HANDLEBARS HELPERS
// ============================================================================

registerHelpers(Handlebars, slugify);

// ============================================================================
// TEMPLATE VALIDATION
// ============================================================================

/**
 * Validates a Handlebars template string for syntax errors.
 * @param {string} templateString - The raw template string.
 * @param {string} filePath - Optional filename for better error messages.
 * @returns {boolean} True if valid, false if invalid.
 */
export function validateTemplate(templateString, filePath = 'unknown file') {
  try {
    Handlebars.precompile(templateString);
    return true;
  } catch (err) {
    console.error(errorMsg(`Template Syntax Error in ${filePath}:`));
    console.error(err.message);
    return false;
  }
}

// ============================================================================
// THYPRESS FEATURE REGISTRY
// ============================================================================
// Purpose: Validation + Documentation only (NOT runtime filtering)
// ============================================================================

export const THYPRESS_FEATURES = {
  // === Core Data ===
  config: {
    since: '0.1.0',
    description: 'Full site configuration from config.json',
    example: '{{config.title}}, {{config.customField}}'
  },
  theme: {
    since: '0.3.0',
    description: 'Theme metadata from theme.json or front-matter',
    example: '{{theme.name}}, {{theme.accentColor}}'
  },
  navigation: {
    since: '0.1.0',
    description: 'Site navigation tree',
    example: '{{#each navigation}}...{{/each}}'
  },
  pageType: {
    since: '0.3.0',
    description: 'Current page type identifier',
    example: '{{#if (eq pageType "entry")}}...{{/if}}'
  },
  // === Entry Context ===
  entry: {
    since: '0.1.0',
    description: 'Current entry object (title, html, tags, etc + all custom fields)',
    example: '{{entry.title}}, {{{entry.html}}}, {{entry.customField}}'
  },
  // === Lists ===
  entries: {
    since: '0.1.0',
    description: 'Array of entries for index/tag/category pages',
    example: '{{#each entries}}{{title}}{{/each}}'
  },
  pagination: {
    since: '0.1.0',
    description: 'Pagination data for multi-page lists',
    example: '{{pagination.currentPage}}, {{pagination.hasNext}}'
  },
  hasEntriesList: {
    since: '0.3.0',
    description: 'Boolean flag indicating list pages',
    example: '{{#if hasEntriesList}}...{{/if}}'
  },
  // === Taxonomies ===
  tags: {
    since: '0.1.0',
    description: 'Entry tags array',
    example: '{{#each entry.tags}}{{this}}{{/each}}'
  },
  categories: {
    since: '0.2.0',
    description: 'Entry categories array',
    example: '{{#each entry.categories}}{{this}}{{/each}}'
  },
  series: {
    since: '0.2.0',
    description: 'Entry series name',
    example: '{{entry.series}}'
  },
  tag: {
    since: '0.1.0',
    description: 'Current tag name (on tag pages)',
    example: '{{tag}}'
  },
  category: {
    since: '0.2.0',
    description: 'Current category name (on category pages)',
    example: '{{category}}'
  },
  // === Features ===
  toc: {
    since: '0.2.0',
    description: 'Table of contents tree from headings (H2-H4)',
    example: '{{#if hasToc}}{{> _toc-tree items=toc}}{{/if}}'
  },
  hasToc: {
    since: '0.3.0',
    description: 'Boolean flag for TOC display',
    example: '{{#if hasToc}}...{{/if}}'
  },
  relatedEntries: {
    since: '0.2.0',
    description: 'Tag-based related entries',
    example: '{{#each relatedEntries}}{{title}}{{/each}}'
  },
  prevEntry: {
    since: '0.2.0',
    description: 'Previous entry in chronological order',
    example: '{{#if prevEntry}}<a href="{{prevEntry.url}}">{{prevEntry.title}}</a>{{/if}}'
  },
  nextEntry: {
    since: '0.2.0',
    description: 'Next entry in chronological order',
    example: '{{#if nextEntry}}<a href="{{nextEntry.url}}">{{nextEntry.title}}</a>{{/if}}'
  }
};

// ============================================================================
// PAGE TYPE ROUTING CONSTANTS
// ============================================================================

/**
 * All canonical page type keys THYPRESS understands.
 *
 * Theme authors can remap ANY of these to their own filename choices via the
 * `templates` object in theme.json. This is the ONLY supported mechanism for
 * mapping canonical types to custom template filenames — there is no automatic
 * fallback cascade. Every mapping must be explicit.
 *
 * Example theme.json routing map:
 *
 *   {
 *     "templates": {
 *       "entry":    "post",
 *       "tag":      "archive",
 *       "category": "archive",
 *       "series":   "archive",
 *       "404":      "error"
 *     }
 *   }
 *
 * Rules:
 *   - `index` is the only hard requirement (by filename or via the routing map).
 *   - Any canonical type not covered by a template file OR a routing map entry
 *     will fall back to whatever the .default embedded layer loaded for that
 *     type. This is intentional and visible — theme authors must be explicit
 *     if they want to override all types.
 *   - Single-file themes should use `singleFile: true` or `handles: [...]`
 *     instead of the routing map (see single-file detection in loadTheme).
 */
const KNOWN_PAGE_TYPES = ['index', 'entry', 'page', 'tag', 'category', 'series', '404'];

// ============================================================================
// SINGLE-FILE HEURISTICS — Layer 4, last-resort auto-detection
// ============================================================================

/**
 * Scan a Handlebars template source for THYPRESS-specific variable usage to
 * infer which page types the template handles. This only runs when:
 *   - `singleFile: true` is NOT declared
 *   - `handles: [...]` is NOT declared
 *   - The auto-diff cannot conclusively determine single-file nature
 *   - The active theme has `index` but not `entry` in its contributed set
 *
 * Patterns checked for each type:
 *   {{#if entry}} / {{entry.x}}           → 'entry', 'page'
 *   {{#if tag}} / {{tag}}                 → 'tag'
 *   {{#if category}} / {{category}}       → 'category'
 *   {{#if series}} / {{series}}           → 'series'
 *   (eq pageType "xxx")                   → the named type
 *   {{#*inline "xxx"}}                    → the named type
 *   {{#each entries}}                     → 'tag', 'category', 'series' (list types)
 *
 * @param   {string}    source  Raw template content (front-matter already stripped)
 * @returns {Set<string>}       Detected canonical page types (always includes 'index')
 */
function detectPageTypesFromSource(source) {
  const detected = new Set(['index']);

  // entry / page (treated as synonymous for heuristic purposes)
  if (
    /\{\{#if\s+entry[\s}]/.test(source)                  ||
    /\{\{entry\./.test(source)                            ||
    /\(eq\s+pageType\s+['"]entry['"]\)/.test(source)     ||
    /\{\{#\*inline\s+["']entry["']\}\}/.test(source)
  ) {
    detected.add('entry');
    detected.add('page');
  }

  // tag
  if (
    /\{\{#if\s+tag[\s}]/.test(source)                    ||
    /\{\{tag\}\}/.test(source)                            ||
    /\(eq\s+pageType\s+['"]tag['"]\)/.test(source)       ||
    /\{\{#\*inline\s+["']tag["']\}\}/.test(source)
  ) {
    detected.add('tag');
  }

  // category
  if (
    /\{\{#if\s+category[\s}]/.test(source)               ||
    /\{\{category\}\}/.test(source)                       ||
    /\(eq\s+pageType\s+['"]category['"]\)/.test(source)  ||
    /\{\{#\*inline\s+["']category["']\}\}/.test(source)
  ) {
    detected.add('category');
  }

  // series
  if (
    /\{\{#if\s+series[\s}]/.test(source)                 ||
    /\{\{series\}\}/.test(source)                         ||
    /\(eq\s+pageType\s+['"]series['"]\)/.test(source)    ||
    /\{\{#\*inline\s+["']series["']\}\}/.test(source)
  ) {
    detected.add('series');
  }

  // 404
  if (
    /\(eq\s+pageType\s+['"]404['"]\)/.test(source)       ||
    /\{\{#\*inline\s+["']404["']\}\}/.test(source)
  ) {
    detected.add('404');
  }

  // Generic list view — {{#each entries}} or {{#if entries}} implies the
  // template renders listing pages (tag/category/series), even without an
  // explicit {{#if tag}} block.
  if (
    /\{\{#each\s+entries[\s}]/.test(source)              ||
    /\{\{#if\s+entries[\s}]/.test(source)
  ) {
    detected.add('tag');
    detected.add('category');
    detected.add('series');
  }

  return detected;
}

// ============================================================================
// THEME VALIDATION
// ============================================================================

/**
 * Validate theme requirements against THYPRESS runtime version.
 */
export function validateThemeRequirements(themeMetadata, thypressVersion) {
  const warnings = [];
  const errors = [];
  const requires = themeMetadata.requires || [];

  for (const required of requires) {
    const feature = THYPRESS_FEATURES[required];

    if (!feature) {
      errors.push({
        type: 'unknown-feature',
        feature: required,
        message: `Unknown feature '${required}' - check spelling or update THYPRESS`
      });
      continue;
    }

    if (compareVersions(thypressVersion, feature.since) < 0) {
      errors.push({
        type: 'version-mismatch',
        feature: required,
        message: `Theme requires '${required}' (added in THYPRESS ${feature.since}), but you're running ${thypressVersion}`,
        requiredVersion: feature.since,
        currentVersion: thypressVersion
      });
    }
  }

  return { errors, warnings };
}

/**
 * Validate theme structure and completeness.
 * Only `index` is required. All other templates are optional.
 *
 * Emits a diagnostic warning for any canonical page type that is not covered
 * by the active theme (neither a template file nor a routing map entry).
 * These types will silently render with the .default fallback layer, which
 * is correct behaviour but should be visible to theme authors.
 */
export function validateTheme(themePath, templatesCache, themeName, themeMetadata = {}, activeThemeContributed = new Set()) {
  const errors = [];
  const warnings = [];
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
  );
  const thypressVersion = packageJson.version;

  // Only index.html is strictly required — everything else is optional and
  // must be resolved explicitly via template files or the routing map.
  if (!templatesCache.has('index')) {
    errors.push(`Missing required template: index.html`);
  }

  // Warn about any canonical type not covered by the active theme.
  // These will fall back to .default visuals, which is intentional but
  // should be surfaced so authors know what they are not overriding.
  const uncoveredTypes = KNOWN_PAGE_TYPES.filter(
    t => t !== 'index' && !activeThemeContributed.has(t)
  );
  if (uncoveredTypes.length > 0 && activeThemeContributed.size > 0) {
    warnings.push(
      `Theme "${themeName}" does not explicitly handle: [${uncoveredTypes.join(', ')}]. ` +
      `These page types will render with the .default fallback layer. ` +
      `To override them, add template files or declare them in the "templates" routing map in theme.json.`
    );
  }

  // Scan all theme templates for partial references and verify they exist.
  const requiredPartials = new Set();
  const availablePartials = new Set();

  Object.keys(Handlebars.partials).forEach(p => availablePartials.add(p));

  if (fs.existsSync(themePath)) {
    const scanForPartials = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== 'partials') {
            scanForPartials(fullPath);
          }
        } else if (entry.name.endsWith('.html')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const partialRefs = content.matchAll(/\{\{>\s*([a-zA-Z0-9_/-]+)\s*\}\}/g);
            for (const match of partialRefs) {
              let partialName = match[1];
              if (partialName.startsWith('_')) {
                partialName = partialName.substring(1);
              }
              requiredPartials.add(partialName);
            }
          } catch (error) {}
        }
      }
    };
    scanForPartials(themePath);
  }

  const missingPartials = [];
  for (const partial of requiredPartials) {
    const variations = [
      partial,
      `_${partial}`,
      `partials/${partial}`,
      `partials/_${partial}`
    ];
    const found = variations.some(v => availablePartials.has(v));
    if (!found) missingPartials.push(partial);
  }

  if (missingPartials.length > 0) {
    errors.push(
      `Missing partials: ${missingPartials.join(', ')}\n` +
      `  Expected locations:\n` +
      missingPartials.map(p => `    - templates/${themeName}/partials/_${p}.html`).join('\n')
    );
  }

  if (themeMetadata.requires && themeMetadata.requires.length > 0) {
    const featureValidation = validateThemeRequirements(themeMetadata, thypressVersion);
    errors.push(...featureValidation.errors.map(e => e.message));
    warnings.push(...featureValidation.warnings.map(w => w.message));
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

// Module-level flag for dev mode logging (log once per process)
let hasLoggedDevMode = false;

function shouldIgnore(name) {
  return name.startsWith('.');
}

function compareVersions(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }
  return 0;
}

/**
 * Compile a Handlebars template string to a callable function.
 */
function compileTemplate(name, content) {
  try {
    return Handlebars.compile(content);
  } catch (error) {
    console.error(errorMsg(`Failed to compile template '${name}': ${error.message}`));
    return null;
  }
}

/**
 * Unregister ALL currently registered Handlebars partials.
 * Called at the top of every loadTheme() call to prevent partial bleed
 * between hot-reloads and theme switches.
 */
function _clearAllHandlebarsPartials() {
  const keys = Object.keys(Handlebars.partials);
  for (const k of keys) {
    Handlebars.unregisterPartial(k);
  }
  if (keys.length > 0) {
    console.log(dim(`Cleared ${keys.length} Handlebars partials`));
  }
}

/**
 * Read theme metadata (name, version, etc.) from an embedded theme's flat file map.
 * Checks theme.json first, then front-matter in index.html.
 */
function _loadEmbeddedThemeMetadata(themeId) {
  const files = (STATIC_EMBEDDED_TEMPLATES || {})[themeId] || {};

  if (files['theme.json']) {
    try {
      return JSON.parse(files['theme.json']);
    } catch (e) {}
  }

  if (files['index.html']) {
    try {
      const { data: frontMatter } = matter(files['index.html']);
      if (
        Object.keys(frontMatter).length > 0 &&
        (frontMatter.name || frontMatter.version || frontMatter.requires)
      ) {
        return frontMatter;
      }
    } catch (e) {}
  }

  return {};
}

/**
 * Read theme metadata from a disk theme directory.
 * Checks theme.json first, then front-matter in index.html.
 */
function _loadThemeMetadataFromDisk(themePath) {
  const themeJsonPath = path.join(themePath, 'theme.json');
  const indexHtmlPath = path.join(themePath, 'index.html');

  if (fs.existsSync(themeJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(themeJsonPath, 'utf-8'));
      console.log(dim('Loaded metadata from theme.json'));
      return data;
    } catch (error) {
      console.log(warning(`Could not parse theme.json: ${error.message}`));
    }
  } else if (fs.existsSync(indexHtmlPath)) {
    try {
      const indexContent = fs.readFileSync(indexHtmlPath, 'utf-8');
      const { data: frontMatter } = matter(indexContent);
      if (
        Object.keys(frontMatter).length > 0 &&
        (frontMatter.name || frontMatter.version || frontMatter.requires)
      ) {
        console.log(dim('Loaded metadata from index.html front-matter'));
        return frontMatter;
      }
    } catch (e) {}
  }

  return {};
}

// ============================================================================
// EMBEDDED TEMPLATE LOADER
// ============================================================================

/**
 * Recursively read all text-based theme files from a directory on disk.
 * Used in dev mode to give instant hot-refresh for the default embedded theme.
 */
function loadTemplatesFromDisk(dir) {
  const templates = {};

  function scan(currentDir, relativePath = '') {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        scan(fullPath, relPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.html', '.css', '.js', '.txt', '.xml'].includes(ext)) {
          try {
            templates[relPath] = fs.readFileSync(fullPath, 'utf-8');
          } catch (error) {
            console.warn(`Warning: Could not read ${relPath}: ${error.message}`);
          }
        }
      }
    }
  }

  scan(dir);
  return templates;
}

/**
 * Load the flat file map for a given embedded theme ID.
 *
 * - Dev mode: the DEFAULT_THEME_ID is loaded live from disk for instant refresh.
 * - All other cases: served from the static EMBEDDED_TEMPLATES registry.
 *
 * @param {string} themeId - e.g. ".default", ".bare-1994"
 * @returns {Promise<Object>} Flat map { relPath: content | data-URI }
 */
export async function loadEmbeddedTemplates(themeId = DEFAULT_THEME_ID) {
  const isDev = process.env.NODE_ENV !== 'production' &&
                process.env.THYPRESS_USE_DISK_TEMPLATES !== 'false';

  // Dev mode: load DEFAULT_THEME_ID live from disk (supports hot-refresh)
  if (isDev && themeId === DEFAULT_THEME_ID) {
    const templatesDir = path.join(__dirname, '../templates/.default');
    if (fs.existsSync(templatesDir)) {
      try {
        if (!hasLoggedDevMode) {
          console.log(info('Dev mode: Loading templates from disk (instant refresh enabled)'));
          hasLoggedDevMode = true;
        }
        return loadTemplatesFromDisk(templatesDir);
      } catch (error) {
        console.log(warning('Failed to load from disk, falling back to embedded'));
      }
    }
  }

  // Production / compiled exe: use static import
  if (STATIC_EMBEDDED_TEMPLATES) {
    const themeFiles = STATIC_EMBEDDED_TEMPLATES[themeId];
    if (themeFiles) return themeFiles;

    if (themeId !== DEFAULT_THEME_ID) {
      console.log(warning(`Embedded theme "${themeId}" not found in registry`));
      return {};
    }
  }

  throw new Error(
    'Embedded templates not found.\n' +
    'This executable was built incorrectly.\n' +
    'Rebuild with: bun run build:exe'
  );
}

// ============================================================================
// LAYER LOADERS
// ============================================================================

/**
 * Layer loader for an embedded theme.
 *
 * Processes the flat file map and populates:
 *   - Handlebars.partials  → underscore-prefixed files, files in partials/ subpath
 *   - templatesCache       → compiled page templates (index, entry, tag, …)
 *   - themeAssets          → CSS/JS/text assets (compiled if templated, raw otherwise)
 *                            binary data URIs decoded to Buffer
 *
 * Front-matter is stripped from HTML files before compilation.
 *
 * Returns a Set of template names (not partials, not assets) that this layer
 * wrote into templatesCache. The caller uses this to track what the active
 * theme explicitly contributes (Layer 1/.default contributions are intentionally
 * NOT tracked).
 *
 * @param {string} themeId
 * @param {Map}    templatesCache
 * @param {Map}    themeAssets
 * @returns {Set<string>} contributed template names
 */
async function _loadEmbeddedThemeLayer(themeId, templatesCache, themeAssets) {
  const files = await loadEmbeddedTemplates(themeId);
  const contributed = new Set();
  let templatesLoaded = 0;
  let partialsLoaded = 0;
  let assetsLoaded = 0;

  for (const [relPath, rawContent] of Object.entries(files)) {
    const basename = path.basename(relPath);
    const ext = path.extname(basename).toLowerCase();
    const isInPartialsFolder = relPath.includes('partials/');
    const isUnderscored = basename.startsWith('_');

    if (ext === '.html') {
      // Strip front-matter before registering/compiling
      let templateContent = rawContent;
      try {
        const parsed = matter(rawContent);
        templateContent = parsed.content;
      } catch (e) {
        // Leave as-is if matter fails
      }

      const templateName = basename.replace('.html', '');

      if (isInPartialsFolder || isUnderscored) {
        Handlebars.registerPartial(templateName, templateContent);
        partialsLoaded++;
      } else {
        const compiled = compileTemplate(templateName, templateContent);
        if (compiled) {
          templatesCache.set(templateName, compiled);
          contributed.add(templateName);
          templatesLoaded++;
        }
      }
    } else {
      // Non-HTML asset

      // Binary: generator encodes as "data:<mime>;base64,<b64>"
      if (typeof rawContent === 'string' && rawContent.startsWith('data:')) {
        const commaIdx = rawContent.indexOf(',');
        if (commaIdx !== -1) {
          const b64 = rawContent.slice(commaIdx + 1);
          const buf = Buffer.from(b64, 'base64');
          themeAssets.set(relPath, { type: 'static', content: buf });
          assetsLoaded++;
        }
        continue;
      }

      // Text asset: compile if it contains template syntax, otherwise store raw
      if (typeof rawContent === 'string' && (rawContent.includes('{{') || rawContent.includes('{%'))) {
        try {
          const compiled = Handlebars.compile(rawContent);
          themeAssets.set(relPath, { type: 'template', compiled });
        } catch (e) {
          themeAssets.set(relPath, { type: 'static', content: rawContent });
        }
      } else {
        themeAssets.set(relPath, { type: 'static', content: rawContent });
      }

      assetsLoaded++;
    }
  }

  console.log(dim(
    `Embedded layer "${themeId}": ` +
    `${templatesLoaded} templates, ${partialsLoaded} partials, ${assetsLoaded} assets`
  ));

  return contributed;
}

/**
 * Layer loader for a disk theme directory.
 *
 * Processing order:
 *   1. Scan partials/ folder → register all .html files as Handlebars partials
 *   2. Recursively walk theme root (skip partials/):
 *      - _underscore.html          → partial
 *      - partial: true front-matter → partial
 *      - any other .html           → validated & compiled page template
 *      - non-HTML                  → template asset (if contains {{) or static asset
 *
 * Templates overwrite any previously loaded template with the same name (last wins).
 *
 * Returns a Set of template names (not partials, not assets) that this layer
 * wrote into templatesCache. The caller uses this to track what the active
 * theme explicitly contributes.
 *
 * @param {string} themePath
 * @param {string} themeName     - For logging
 * @param {Map}    templatesCache
 * @param {Map}    themeAssets
 * @param {Object} siteConfig    - Used for strictTemplateValidation
 * @returns {Set<string>} contributed template names
 */
function _loadDiskThemeLayer(themePath, themeName, templatesCache, themeAssets, siteConfig) {
  const contributed = new Set();

  // --- Step 1: partials/ folder ---
  const partialsDir = path.join(themePath, 'partials');
  if (fs.existsSync(partialsDir)) {
    function scanPartialsFolder(dir, relativePath = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (shouldIgnore(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          scanPartialsFolder(fullPath, relPath);
        } else if (entry.name.endsWith('.html')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const partialName = path.basename(relPath, '.html').replace(/\\/g, '/');
            Handlebars.registerPartial(partialName, content);
            console.log(dim(`Registered partial (folder): ${partialName}`));
          } catch (e) {
            console.log(warning(`Could not read partial ${relPath}: ${e.message}`));
          }
        }
      }
    }
    scanPartialsFolder(partialsDir);
  }

  // --- Step 2: Recursive walk of theme root ---
  function loadThemeFiles(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (entry.name === 'partials') continue; // already handled above
        loadThemeFiles(fullPath, relPath);
      } else {
        // Attempt to read as UTF-8; fall back to Buffer for binary files
        let content;
        try {
          content = fs.readFileSync(fullPath, 'utf-8');
        } catch (e) {
          try {
            const buf = fs.readFileSync(fullPath);
            themeAssets.set(relPath, { type: 'static', content: buf });
          } catch (readErr) {
            console.log(warning(`Could not read theme file ${relPath}: ${readErr.message}`));
          }
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();

        if (ext === '.html') {
          const templateName = path.basename(entry.name, '.html');

          if (entry.name.startsWith('_')) {
            // Underscore prefix → always a partial
            Handlebars.registerPartial(templateName, content);
            console.log(dim(`Registered partial (underscore): ${templateName}`));
          } else {
            const { data: frontMatter, content: templateContent } = matter(content);

            if (frontMatter.partial === true) {
              Handlebars.registerPartial(templateName, templateContent);
              console.log(dim(`Registered partial (front-matter): ${templateName}`));
            } else {
              // Page template: validate then compile
              if (!validateTemplate(templateContent, relPath)) {
                if (siteConfig.strictTemplateValidation !== false) {
                  console.error(errorMsg('Exiting due to template validation failure'));
                  process.exit(1);
                }
                console.log(warning(`Skipping broken template: ${relPath}`));
                continue;
              }

              const compiled = compileTemplate(templateName, templateContent);
              if (compiled) {
                templatesCache.set(templateName, compiled);
                contributed.add(templateName);
                console.log(dim(`Loaded template: ${templateName}`));
              }
            }
          }
        } else {
          // Non-HTML asset
          const needsTemplating = content.includes('{{') || content.includes('{%');
          if (needsTemplating) {
            const compiled = compileTemplate(relPath, content);
            if (compiled) {
              themeAssets.set(relPath, { type: 'template', compiled });
            } else {
              themeAssets.set(relPath, { type: 'static', content });
            }
          } else {
            themeAssets.set(relPath, { type: 'static', content });
          }
        }
      }
    }
  }

  loadThemeFiles(themePath);
  return contributed;
}

// ============================================================================
// THEME DISCOVERY
// ============================================================================

/**
 * Auto-detect preview image file in a theme directory.
 * Checks for preview.png, preview.jpg, preview.jpeg, preview.webp (in that order).
 */
function detectPreviewImage(themeDir) {
  const extensions = ['png', 'jpg', 'jpeg', 'webp'];
  for (const ext of extensions) {
    const previewPath = path.join(themeDir, `preview.${ext}`);
    if (fs.existsSync(previewPath)) return `preview.${ext}`;
  }
  return null;
}

/**
 * Scan and return all available themes with their type classification:
 *
 *   'embedded'   — exists only in EMBEDDED_TEMPLATES registry
 *   'local'      — exists only on disk in templates/
 *   'overridden' — same ID exists in both registry AND on disk
 *
 * @returns {Array<Object>} Theme descriptor objects
 */
export function scanAvailableThemes() {
  const templatesDir = path.join(process.cwd(), 'templates');
  const themes = [];
  const embeddedIds = new Set();

  // --- Embedded themes from registry ---
  if (STATIC_EMBEDDED_TEMPLATES) {
    for (const [id, files] of Object.entries(STATIC_EMBEDDED_TEMPLATES)) {
      const metadata = _loadEmbeddedThemeMetadata(id);

      // Auto-detect preview image within the embedded file list
      let preview = metadata.preview || null;
      if (!preview) {
        for (const key of Object.keys(files)) {
          if (/^(.*\/)?preview\.(png|jpg|jpeg|webp)$/i.test(key)) {
            preview = path.basename(key);
            break;
          }
        }
      }

      themes.push({
        id,
        name: metadata.name || id,
        version: metadata.version || '1.0.0',
        description: metadata.description || 'Embedded THYPRESS theme',
        author: metadata.author || 'THYPRESS',
        license: metadata.license || null,
        homepage: metadata.homepage || null,
        preview,
        tags: metadata.tags || [],
        requires: metadata.requires || [],
        embedded: true,
        type: 'embedded',
        valid: true,
        active: false
      });

      embeddedIds.add(id);
    }
  }

  // --- Disk themes ---
  if (!fs.existsSync(templatesDir)) return themes;

  const entries = fs.readdirSync(templatesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const id = entry.name;
    const themeDir = path.join(templatesDir, id);
    const indexHtmlPath = path.join(themeDir, 'index.html');
    const themeJsonPath = path.join(themeDir, 'theme.json');
    const valid = fs.existsSync(indexHtmlPath);
    const isAlsoEmbedded = embeddedIds.has(id);

    let metadata = {
      name: id,
      version: 'unknown',
      description: 'No description available',
      author: 'Unknown',
      license: null,
      homepage: null,
      preview: null,
      tags: [],
      requires: [],
      error: null
    };

    // Load metadata: theme.json takes priority, then index.html front-matter
    if (fs.existsSync(themeJsonPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(themeJsonPath, 'utf-8'));
        metadata = {
          name: data.name || id,
          version: data.version || 'unknown',
          description: data.description || 'No description',
          author: data.author || 'Unknown',
          license: data.license || null,
          homepage: data.homepage || null,
          preview: data.preview || null,
          tags: data.tags || [],
          requires: data.requires || [],
          error: null
        };
      } catch (error) {
        metadata.error = `Invalid theme.json: ${error.message}`;
      }
    } else if (valid) {
      try {
        const indexContent = fs.readFileSync(indexHtmlPath, 'utf-8');
        const { data: fm } = matter(indexContent);
        if (Object.keys(fm).length > 0 && (fm.name || fm.version || fm.requires)) {
          metadata = {
            name: fm.name || id,
            version: fm.version || 'unknown',
            description: fm.description || 'No description',
            author: fm.author || 'Unknown',
            license: fm.license || null,
            homepage: fm.homepage || null,
            preview: fm.preview || null,
            tags: fm.tags || [],
            requires: fm.requires || [],
            error: null
          };
        }
      } catch (e) {}
    }

    // Auto-detect preview image on disk if not declared in metadata
    if (!metadata.preview) {
      metadata.preview = detectPreviewImage(themeDir);
    }

    if (isAlsoEmbedded) {
      // Upgrade existing embedded entry to 'overridden'
      const existing = themes.find(t => t.id === id);
      if (existing) {
        existing.type = 'overridden';
        existing.embedded = false;
        existing.name = metadata.name;
        existing.version = metadata.version;
        existing.description = metadata.description;
        existing.author = metadata.author;
        if (metadata.preview) existing.preview = metadata.preview;
        existing.valid = valid;
        if (metadata.error) existing.error = metadata.error;
      }
    } else {
      themes.push({
        id,
        name: metadata.name,
        version: metadata.version,
        description: metadata.description,
        author: metadata.author,
        license: metadata.license,
        homepage: metadata.homepage,
        preview: metadata.preview,
        tags: metadata.tags,
        requires: metadata.requires,
        embedded: false,
        type: 'local',
        valid,
        active: false,
        error: metadata.error
      });
    }
  }

  return themes;
}

// ============================================================================
// THEME CONFIGURATION
// ============================================================================

/**
 * Write any theme-related config key to config.json.
 * Generalized form — supports both "theme" and "defaultTheme" (and anything else).
 *
 * @param {string} key   - Config key to update
 * @param {string} value - New value
 * @returns {{ success: boolean, key: string, value: string }}
 */
export function setThemeConfig(key, value) {
  const configPath = path.join(process.cwd(), 'config.json');
  let config = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.log(warning(`Could not parse config.json: ${e.message}`));
    }
  }

  config[key] = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(success(`Config updated: ${key} = "${value}"`));

  return { success: true, key, value };
}

/**
 * Convenience wrapper: set config.theme.
 * Kept for backward compatibility with all existing call sites.
 */
export function setActiveTheme(themeId) {
  return setThemeConfig('theme', themeId);
}

// ============================================================================
// THEME LOADER — 3-Layer Inheritance + Template Routing + Single-File Detection
// ============================================================================

/**
 * Load and resolve all theme layers into a unified templatesCache + themeAssets.
 *
 * Resolution pipeline:
 *
 *   Layer 1 — Fallback embedded  (config.defaultTheme || DEFAULT_THEME_ID)
 *             Always loaded unless strictThemeIsolation: true. Provides the
 *             complete safety-net skeleton. Its contributions are intentionally
 *             NOT tracked in activeThemeContributed.
 *
 *   Layer 2 — Active embedded    (config.theme, only if key exists in EMBEDDED_TEMPLATES)
 *             Skipped when: activeTheme === fallbackId, or not in registry.
 *
 *   Layer 3 — Active disk        (templates/<config.theme>/, if directory exists on disk)
 *             Works for any theme name. Last write wins for any given template key.
 *
 *   Step 4  — Template routing map  (themeMetadata.templates object)
 *             The ONLY supported mechanism for aliasing canonical THYPRESS type
 *             names to the theme author's chosen filenames, or for pointing
 *             multiple canonical types at the same compiled template.
 *             All mappings are explicit — there is no automatic cascade.
 *
 *             Declared in theme.json (or index.html front-matter):
 *               {
 *                 "templates": {
 *                   "entry":    "post",
 *                   "tag":      "archive",
 *                   "category": "archive",
 *                   "series":   "archive",
 *                   "404":      "error"
 *                 }
 *               }
 *
 *             Authors can extend this with any key — canonical THYPRESS types
 *             (entry, tag, category, series, 404) OR fully custom template names
 *             (e.g. "docs" → "documentation") for section-specific rendering.
 *             The value must match a basename of a file already loaded by
 *             Layers 2 or 3. Unknown aliases are skipped with a warning.
 *
 *   Step 5  — Single-file detection (4-layer cascade)
 *             Determines if the active theme intends index to serve multiple
 *             page types and maps it accordingly. Layers in priority order:
 *               5a. Explicit `singleFile: true` in metadata
 *               5b. `handles: [...]` array — map only the listed types
 *               5c. Auto-diff — active theme contributed only 'index'
 *               5d. Regex heuristics — scan index source for THYPRESS variables
 *
 *   No automatic fallback cascade — any canonical page type not covered by the
 *   active theme after Steps 4–5 will render with the .default fallback layer
 *   loaded in Layer 1. This is intentional and a diagnostic warning is emitted
 *   so theme authors know exactly which types they are not overriding.
 *
 * @param {string|null} themeName  - Value of config.theme (null = use fallback only)
 * @param {Object}      siteConfig - Full site configuration object
 * @returns {Promise<{
 *   templatesCache: Map,
 *   themeAssets:    Map,
 *   activeTheme:    string,
 *   validation:     { valid: boolean, errors: string[], warnings: string[] },
 *   themeMetadata:  Object
 * }>}
 */
export async function loadTheme(themeName = null, siteConfig = {}) {
  const templatesDir = path.join(process.cwd(), 'templates');
  const templatesCache = new Map();
  const themeAssets = new Map();

  let activeTheme = themeName;
  let themeMetadata = {};
  let themePath = null;
  let validation = { valid: true, errors: [], warnings: [] };

  // Tracks template names (not partials, not assets) contributed by Layers 2+3
  // (the active theme only). This is the authoritative signal for single-file
  // detection and routing map resolution. Layer 1 is intentionally excluded
  // because it is the fallback safety net, not the active theme's own output.
  const activeThemeContributed = new Set();

  // ==========================================================================
  // STEP 0: Clean slate
  // Unregister ALL Handlebars partials before loading any layer.
  // ==========================================================================
  _clearAllHandlebarsPartials();

  // ==========================================================================
  // STEP 1: Fallback (safety-net) embedded layer — ALWAYS loaded
  // Skipped when strictThemeIsolation: true
  // ==========================================================================
  const fallbackId = siteConfig.defaultTheme || DEFAULT_THEME_ID;
  if (siteConfig.strictThemeIsolation !== true) {
    console.log(info(`Layer 1 (fallback): ${fallbackId}`));
    await _loadEmbeddedThemeLayer(fallbackId, templatesCache, themeAssets);
    // NOTE: Layer 1 contributions NOT tracked in activeThemeContributed.
  } else {
    console.log(info(`Layer 1 (fallback): skipped (strictThemeIsolation)`));
  }

  // ==========================================================================
  // STEP 2: Active embedded layer
  // ==========================================================================
  const isActiveEmbedded = !!(
    activeTheme &&
    activeTheme !== fallbackId &&
    STATIC_EMBEDDED_TEMPLATES &&
    Object.prototype.hasOwnProperty.call(STATIC_EMBEDDED_TEMPLATES, activeTheme)
  );

  if (isActiveEmbedded) {
    console.log(info(`Layer 2 (embedded active): ${activeTheme}`));
    const embeddedContrib = await _loadEmbeddedThemeLayer(activeTheme, templatesCache, themeAssets);
    for (const k of embeddedContrib) activeThemeContributed.add(k);
    themeMetadata = _loadEmbeddedThemeMetadata(activeTheme);
  }

  // ==========================================================================
  // STEP 3: Active disk layer
  // ==========================================================================
  if (activeTheme) {
    const candidatePath = path.join(templatesDir, activeTheme);

    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
      themePath = candidatePath;
      console.log(success(`Layer 3 (disk): ${activeTheme}`));

      // Disk metadata takes precedence over embedded metadata
      const diskMeta = _loadThemeMetadataFromDisk(themePath);
      if (Object.keys(diskMeta).length > 0) {
        themeMetadata = { ...themeMetadata, ...diskMeta };
      }

      const diskContrib = _loadDiskThemeLayer(themePath, activeTheme, templatesCache, themeAssets, siteConfig);
      for (const k of diskContrib) activeThemeContributed.add(k);

      if (activeTheme !== DEFAULT_THEME_ID) {
        validation = validateTheme(themePath, templatesCache, activeTheme, themeMetadata, activeThemeContributed);
      }
    } else if (!isActiveEmbedded && activeTheme !== fallbackId) {
      console.log(warning(`Theme "${activeTheme}" not found on disk or in embedded registry`));
      console.log(info(`Falling back to: ${fallbackId}`));
    }
  }

  // ==========================================================================
  // STEP 4: Template routing map
  //
  // The ONLY mechanism for mapping canonical page types to custom filenames,
  // or for pointing multiple canonical types at a single shared template.
  // Every mapping is explicit — nothing is inferred or cascaded automatically.
  //
  // How it works:
  //   - The value is a loaded template basename (WITHOUT .html extension).
  //   - The target must have been loaded by Layers 2 or 3 to be valid.
  //   - Any canonical THYPRESS type OR a custom section name can be a key.
  //   - Unknown alias targets are skipped with a warning (no silent failures).
  //   - Routing map entries are added to activeThemeContributed so single-file
  //     detection (Step 5) treats them as explicit active-theme output.
  //
  // Example theme.json:
  //   {
  //     "templates": {
  //       "entry":    "post",       ← canonical type remapped to post.html
  //       "tag":      "archive",    ← canonical type remapped to archive.html
  //       "category": "archive",    ← shares archive.html with tag
  //       "series":   "archive",    ← shares archive.html with tag + category
  //       "404":      "error",      ← canonical type remapped to error.html
  //       "docs":     "docs-layout" ← custom section template (non-canonical)
  //     }
  //   }
  // ==========================================================================
  if (themeMetadata.templates && typeof themeMetadata.templates === 'object') {
    console.log(info('Applying template routing map...'));
    for (const [canonical, alias] of Object.entries(themeMetadata.templates)) {
      if (typeof alias !== 'string' || alias.trim() === '') {
        console.log(warning(`Template routing: skipping "${canonical}" — alias must be a non-empty string`));
        continue;
      }

      const aliasedTemplate = templatesCache.get(alias);
      if (aliasedTemplate) {
        templatesCache.set(canonical, aliasedTemplate);
        activeThemeContributed.add(canonical);
        console.log(dim(`Template routing: ${canonical} → ${alias}`));
      } else {
        console.log(warning(
          `Template routing: alias "${alias}" for "${canonical}" was not found in loaded templates — ` +
          `make sure "${alias}.html" exists in your theme directory and compiled without errors.`
        ));
      }
    }
  }

  // ==========================================================================
  // STEP 5: Single-file detection — 4-layer cascade
  //
  // Only fires when the active theme contributed something (Layers 2+3 ran).
  // Each layer is tried in order; the first match wins and exits the block.
  // The index template compiled function is reused for all mapped types.
  // ==========================================================================
  if (activeThemeContributed.has('index')) {
    const indexTpl = templatesCache.get('index');

    // --- 5a: Explicit singleFile: true declaration ---
    // Trust fully. Map ALL known page types (that the theme didn't already
    // explicitly provide) to the active theme's index template.
    if (themeMetadata.singleFile === true) {
      console.log(info('Single-file theme (explicit singleFile: true)'));
      for (const type of KNOWN_PAGE_TYPES) {
        if (type !== 'index' && !activeThemeContributed.has(type)) {
          templatesCache.set(type, indexTpl);
          activeThemeContributed.add(type);
        }
      }
    }

    // --- 5b: handles: [...] partial declaration ---
    // Trust for listed types only. Maps only the declared types to index.
    // Useful when a theme has dedicated templates for some types but wants
    // index to handle others (e.g., handles: ['category', 'series']).
    else if (Array.isArray(themeMetadata.handles) && themeMetadata.handles.length > 0) {
      console.log(info(`Single-file theme (handles: [${themeMetadata.handles.join(', ')}])`));
      for (const type of themeMetadata.handles) {
        if (typeof type === 'string' && !activeThemeContributed.has(type)) {
          templatesCache.set(type, indexTpl);
          activeThemeContributed.add(type);
        }
      }
    }

    // --- 5c: Auto-diff — only index was contributed by the active theme ---
    // Safe automatic inference. If Layers 2+3 collectively only wrote 'index'
    // into the cache, the theme is structurally single-file regardless of any
    // metadata declaration.
    else if (activeThemeContributed.size === 1 && activeThemeContributed.has('index')) {
      console.log(info('Single-file theme (auto-detected: active theme contributed only index)'));
      for (const type of KNOWN_PAGE_TYPES) {
        if (type !== 'index' && !activeThemeContributed.has(type)) {
          templatesCache.set(type, indexTpl);
          activeThemeContributed.add(type);
        }
      }
    }

    // --- 5d: Regex heuristics — last resort ---
    // Only fires when the active theme has index but not entry, and none of
    // the above layers could determine single-file nature. Scans the active
    // theme's raw index.html source for THYPRESS-specific variable patterns.
    else if (!activeThemeContributed.has('entry')) {
      let indexSource = '';

      // Acquire the raw source of the active theme's index template
      if (themePath) {
        const idxPath = path.join(themePath, 'index.html');
        if (fs.existsSync(idxPath)) {
          try { indexSource = fs.readFileSync(idxPath, 'utf-8'); } catch {}
        }
      } else if (isActiveEmbedded && STATIC_EMBEDDED_TEMPLATES?.[activeTheme]) {
        indexSource = STATIC_EMBEDDED_TEMPLATES[activeTheme]['index.html'] || '';
      }

      if (indexSource) {
        // Strip front-matter before scanning so YAML fields don't confuse the regex
        try {
          const parsed = matter(indexSource);
          indexSource = parsed.content;
        } catch {}

        const heuristicTypes = detectPageTypesFromSource(indexSource);

        // Only act if more than just 'index' was detected — a single data point
        // is not meaningful enough to trigger single-file behaviour.
        if (heuristicTypes.size > 1) {
          console.log(info(`Single-file theme (heuristic detection: ${[...heuristicTypes].join(', ')})`));
          for (const type of heuristicTypes) {
            if (!activeThemeContributed.has(type)) {
              templatesCache.set(type, indexTpl);
              activeThemeContributed.add(type);
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log(success(
    `Theme resolved — ` +
    `${templatesCache.size} templates, ` +
    `${Object.keys(Handlebars.partials).length} partials, ` +
    `${themeAssets.size} assets`
  ));

  if (activeThemeContributed.size > 0) {
    console.log(dim(
      `Active theme covers: ${[...activeThemeContributed].sort().join(', ')}`
    ));
  }

  return {
    templatesCache,
    themeAssets,
    activeTheme: activeTheme || fallbackId,
    validation,
    themeMetadata
  };
}
