// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS)
// SPDX-License-Identifier: MPL-2.0

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import { success, error as errorMsg, warning, info, dim } from './utils/colors.js';
import { DEFAULT_THEME_ID, EMBEDDED_TEMPLATES as STATIC_EMBEDDED_TEMPLATES } from './embedded-templates.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ============================================================================
// HANDLEBARS HELPERS
// ============================================================================

Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('split', (str, sep, index) => String(str).split(sep)[index]);

// ============================================================================
// TEMPLATE VALIDATION
// ============================================================================

/**
 * Validates a Handlebars template string for syntax errors.
 * @param {string} templateString - The raw template string.
 * @param {string} filePath - Optional filename for better error messages.
 * @returns {boolean} - True if valid, False if invalid.
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
// UTILITY FUNCTIONS
// ============================================================================

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

// ============================================================================
// THEME VALIDATION
// ============================================================================

/**
 * Validate theme requirements against THYPRESS runtime
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
 * Validate theme structure and completeness
 */
export function validateTheme(themePath, templatesCache, themeName, themeMetadata = {}) {
  const errors = [];
  const warnings = [];
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
  );
  const thypressVersion = packageJson.version;

  // Only index.html is required
  if (!templatesCache.has('index')) {
    errors.push(`Missing required template: index.html`);
  }

  // Scan templates for partial references
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
 * @param {string} themeId
 * @param {Map}    templatesCache
 * @param {Map}    themeAssets
 */
async function _loadEmbeddedThemeLayer(themeId, templatesCache, themeAssets) {
  const files = await loadEmbeddedTemplates(themeId);
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
}

/**
 * Layer loader for a disk theme directory.
 *
 * Processing order:
 *   1. Scan partials/ folder → register all .html files as Handlebars partials
 *   2. Recursively walk theme root (skip partials/):
 *      - _underscore.html        → partial
 *      - partial: true front-matter → partial
 *      - any other .html         → validated & compiled page template
 *      - non-HTML                → template asset (if contains {{) or static asset
 *
 * Templates overwrite any previously loaded template with the same name (last wins).
 *
 * @param {string} themePath
 * @param {string} themeName    - For logging
 * @param {Map}    templatesCache
 * @param {Map}    themeAssets
 * @param {Object} siteConfig   - Used for strictTemplateValidation
 */
function _loadDiskThemeLayer(themePath, themeName, templatesCache, themeAssets, siteConfig) {
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
 *   'embedded'  — exists only in EMBEDDED_TEMPLATES registry
 *   'local'     — exists only on disk in templates/
 *   'overridden'— same ID exists in both registry AND on disk
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
// THEME LOADER — 3-Layer Inheritance Chain (ROBUST VERSION)
// ============================================================================

export async function loadTheme(themeName = null, siteConfig = {}) {
  const templatesDir = path.join(process.cwd(), 'templates');
  const templatesCache = new Map();
  const themeAssets = new Map();

  let activeTheme = themeName;
  let themeMetadata = {};

  // ==========================================================================
  // STEP 0: Clean slate
  // Unregister ALL Handlebars partials before loading any layer.
  // ==========================================================================
  _clearAllHandlebarsPartials();

  // ==========================================================================
  // STEP 1: Fallback (safety-net) embedded layer
  // Skipped when strictThemeIsolation=true — theme must be fully self-sufficient
  // ==========================================================================
  const fallbackId = siteConfig.defaultTheme || DEFAULT_THEME_ID;
  if (siteConfig.strictThemeIsolation !== true) {
    console.log(info(`Layer 1 (fallback): ${fallbackId}`));
    await _loadEmbeddedThemeLayer(fallbackId, templatesCache, themeAssets);
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
    await _loadEmbeddedThemeLayer(activeTheme, templatesCache, themeAssets);
    themeMetadata = _loadEmbeddedThemeMetadata(activeTheme);
  }

  // ==========================================================================
  // STEP 3: Active disk layer
  // ==========================================================================
  let themePath = null;
  let validation = { valid: true, errors: [], warnings: [] };

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

      _loadDiskThemeLayer(themePath, activeTheme, templatesCache, themeAssets, siteConfig);

      if (activeTheme !== DEFAULT_THEME_ID) {
        validation = validateTheme(themePath, templatesCache, activeTheme, themeMetadata);
      }
    } else if (!isActiveEmbedded && activeTheme !== fallbackId) {
      console.log(warning(`Theme "${activeTheme}" not found on disk or in embedded registry`));
      console.log(info(`Falling back to: ${fallbackId}`));
    }
  }

  // ==========================================================================
  // SINGLE-FILE LOGIC (Explicit & Deterministic)
  // ==========================================================================
  // Trust Metadata > Explicit Structure > Magic.
  if (!templatesCache.has('entry') && templatesCache.has('index')) {
      const indexTpl = templatesCache.get('index');

      // 1. Basic Mapping (Safe)
      // Index always handles 'page' (static pages) and 'entry' (posts) in a single-file theme.
      if (themeMetadata.singleFile === true || (!themePath && !isActiveEmbedded)) {
          templatesCache.set('entry', indexTpl);
          templatesCache.set('page', indexTpl);

          // 2. Explicit Capabilities (Advanced)
          // If the theme author explicitly says "I handle tags", we believe them.
          if (themeMetadata.handles && Array.isArray(themeMetadata.handles)) {
              themeMetadata.handles.forEach(type => {
                  templatesCache.set(type, indexTpl);
              });
              console.log(success(`Single-file handles explicitly: ${themeMetadata.handles.join(', ')}`));
          } else {
              // 3. The "Safe Fallback"
              // We do NOT automatically map complex views like 'tag', 'category', etc.
              // It is safer to let Layer 1 (System Fallback) handle those.
              console.log(dim(`Single-file mode: Mapped 'entry' and 'page' to index.`));
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

  return {
    templatesCache,
    themeAssets,
    activeTheme: activeTheme || fallbackId,
    validation,
    themeMetadata
  };
}

// ============================================================================
// TEMPLATE SELECTION
// ============================================================================

/**
 * Select the appropriate compiled template function for a given entry.
 *
 * Priority order:
 *   1. Explicit front-matter: template: "custom-template"
 *   2. Section-based:         content/docs/ → docs.html
 *   3. Index special case:    slug === 'index'
 *   4. Default chain:         entry → page → index
 */
export function selectTemplate(entry, templates, defaultTemplate = 'entry') {
  if (entry.frontMatter && entry.frontMatter.template) {
    const explicitTemplate = templates.get(entry.frontMatter.template);
    if (explicitTemplate) return explicitTemplate;
  }

  if (entry.section) {
    const sectionTemplate = templates.get(entry.section);
    if (sectionTemplate) return sectionTemplate;
  }

  if (entry.slug === 'index' || entry.slug === '') {
    const indexTemplate = templates.get('index');
    if (indexTemplate) return indexTemplate;
  }

  return templates.get(defaultTemplate)
      || templates.get('entry')
      || templates.get('page')
      || templates.get('index');
}

























// // ============================================================================
// // SINGLE-FILE THEME DETECTION (DEPRECATED DUE TO REGEX BLOATY DANGER BUT KEPT AS DOCUMENTATION)
// // ============================================================================

// /**
//  * Detect which page types a single-file theme can handle.
//  * Uses 5 detection layers from most explicit to most implicit.
//  *
//  * @param {string} templateSource - Raw template HTML source
//  * @param {Object} metadata       - Theme metadata (from theme.json or front-matter)
//  * @returns {Set<string>}
//  */
// function detectSingleFilePageTypes(templateSource, metadata = {}) {
//   const detected = new Set();

//   // Layer 1: Explicit declaration in metadata.handles
//   if (metadata.handles && Array.isArray(metadata.handles)) {
//     metadata.handles.forEach(type => detected.add(type));
//     console.log(dim(`Explicit page types from metadata: ${Array.from(detected).join(', ')}`));
//     return detected;
//   }

//   // Layer 2: Handlebars inline partials — {{#*inline "entry"}}
//   const inlinePartialRegex = /\{\{#\*inline\s+"([^"]+)"\}\}/g;
//   let match;
//   while ((match = inlinePartialRegex.exec(templateSource)) !== null) {
//     const name = match[1];
//     if (['entry', 'index', 'tag', 'category', 'series', '404'].includes(name)) {
//       detected.add(name);
//     }
//   }
//   if (detected.size > 0) {
//     console.log(dim(`Detected inline partials: ${Array.from(detected).join(', ')}`));
//   }

//   // Layer 3: Conditional pageType checks — (eq pageType "entry")
//   const conditionalRegex = /\(eq\s+pageType\s+['"]([^'"]+)['"]\)/g;
//   while ((match = conditionalRegex.exec(templateSource)) !== null) {
//     const pageType = match[1];
//     if (['entry', 'index', 'tag', 'category', 'series', '404'].includes(pageType)) {
//       detected.add(pageType);
//     }
//   }
//   if (detected.size > 0) {
//     console.log(dim(`Detected conditional checks: ${Array.from(detected).join(', ')}`));
//   }

//   // Layer 4: Implicit detection from template patterns
//   if (templateSource.includes('{{#if entry}}') || templateSource.match(/\{\{entry\./)) {
//     detected.add('entry');
//   }
//   if (templateSource.includes('{{#each entries}}') || templateSource.includes('{{#if entries}}')) {
//     detected.add('index');
//     detected.add('tag');
//     detected.add('category');
//     detected.add('series');
//   }
//   if (templateSource.includes('{{#if tag}}') || /\{\{tag\}\}/.test(templateSource)) {
//     detected.add('tag');
//   }
//   if (templateSource.includes('{{#if category}}') || /\{\{category\}\}/.test(templateSource)) {
//     detected.add('category');
//   }
//   if (templateSource.includes('{{#if series}}') || /\{\{series\}\}/.test(templateSource)) {
//     detected.add('series');
//   }

//   // Layer 5: Default fallback when nothing was detected
//   if (detected.size === 0) {
//     detected.add('entry');
//     detected.add('index');
//     console.log(dim('No explicit page type detection — defaulting to entry + index'));
//   } else {
//     console.log(dim(`Implicit detection found: ${Array.from(detected).join(', ')}`));
//   }

//   return detected;
// }



// // ============================================================================
// // THEME LOADER — 3-Layer Inheritance Chain
// // ============================================================================

// /**
//  * Load and resolve all theme layers into a unified templatesCache + themeAssets.
//  *
//  * Resolution order (last layer wins):
//  *
//  *   Layer 1 — Fallback embedded  (config.defaultTheme || DEFAULT_THEME_ID)
//  *             Always loaded. Provides the safety-net skeleton.
//  *
//  *   Layer 2 — Active  embedded  (config.theme, only if key exists in EMBEDDED_TEMPLATES)
//  *             Skipped when: activeTheme === fallbackId, or not in registry.
//  *
//  *   Layer 3 — Active  disk      (templates/<config.theme>/, if directory exists on disk)
//  *             Works for any theme name. Allows user customization over any embedded theme.
//  *
//  * Single-file detection runs as a post-processing step after all layers are settled:
//  *   If 'entry' template is absent, the index template is analyzed and registered
//  *   for all page types it can handle.
//  *
//  * @param {string|null} themeName  - Value of config.theme (null = use fallback only)
//  * @param {Object}      siteConfig - Full site configuration object
//  * @returns {Promise<{
//  *   templatesCache: Map,
//  *   themeAssets:    Map,
//  *   activeTheme:    string,
//  *   validation:     { valid: boolean, errors: string[], warnings: string[] },
//  *   themeMetadata:  Object
//  * }>}
//  */
// export async function loadTheme(themeName = null, siteConfig = {}) {
//   const templatesDir = path.join(process.cwd(), 'templates');
//   const templatesCache = new Map();
//   const themeAssets = new Map();

//   let activeTheme = themeName;
//   let themeMetadata = {};

//   // ==========================================================================
//   // STEP 0: Clean slate
//   // Unregister ALL Handlebars partials before loading any layer.
//   // Prevents stale partial bleed between hot-reloads and theme switches.
//   // ==========================================================================
//   _clearAllHandlebarsPartials();

//   // ==========================================================================
//   // STEP 1: Fallback (safety-net) embedded layer — ALWAYS loaded
//   // ==========================================================================
//   const fallbackId = siteConfig.defaultTheme || DEFAULT_THEME_ID;
//   console.log(info(`Layer 1 (fallback): ${fallbackId}`));
//   await _loadEmbeddedThemeLayer(fallbackId, templatesCache, themeAssets);

//   // ==========================================================================
//   // STEP 2: Active embedded layer
//   // Condition: activeTheme is set, is different from the fallback,
//   //            AND exists as a key in EMBEDDED_TEMPLATES.
//   // ==========================================================================
//   const isActiveEmbedded = !!(
//     activeTheme &&
//     activeTheme !== fallbackId &&
//     STATIC_EMBEDDED_TEMPLATES &&
//     Object.prototype.hasOwnProperty.call(STATIC_EMBEDDED_TEMPLATES, activeTheme)
//   );

//   if (isActiveEmbedded) {
//     console.log(info(`Layer 2 (embedded active): ${activeTheme}`));
//     await _loadEmbeddedThemeLayer(activeTheme, templatesCache, themeAssets);
//     themeMetadata = _loadEmbeddedThemeMetadata(activeTheme);
//   }

//   // ==========================================================================
//   // STEP 3: Active disk layer
//   // Condition: activeTheme is set AND templates/<activeTheme>/ exists on disk.
//   // This layer works for any theme name — including dot-prefixed embedded overrides.
//   // ==========================================================================
//   let themePath = null;
//   let validation = { valid: true, errors: [], warnings: [] };

//   if (activeTheme) {
//     const candidatePath = path.join(templatesDir, activeTheme);

//     if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
//       themePath = candidatePath;
//       console.log(success(`Layer 3 (disk): ${activeTheme}`));

//       // Disk metadata takes precedence over embedded metadata
//       const diskMeta = _loadThemeMetadataFromDisk(themePath);
//       if (Object.keys(diskMeta).length > 0) {
//         themeMetadata = diskMeta;
//       }

//       _loadDiskThemeLayer(themePath, activeTheme, templatesCache, themeAssets, siteConfig);

//       // Validate disk themes (embedded themes are pre-validated by the generator).
//       // Exception: skip validation for DEFAULT_THEME_ID — it is the trusted safety net.
//       if (activeTheme !== DEFAULT_THEME_ID) {
//         validation = validateTheme(themePath, templatesCache, activeTheme, themeMetadata);
//       }
//     } else if (!isActiveEmbedded && activeTheme !== fallbackId) {
//       // Theme was requested but not found anywhere
//       console.log(warning(`Theme "${activeTheme}" not found on disk or in embedded registry`));
//       console.log(info(`Falling back to: ${fallbackId}`));
//     }
//   }

//   // ==========================================================================
//   // SINGLE-FILE DETECTION  (post-processing, after all layers are settled)
//   //
//   // If 'entry' is still absent after all layers, this is a single-file theme.
//   // Analyze the index template source and map it to all detected page types.
//   // ==========================================================================
//   if (!templatesCache.has('entry') && templatesCache.has('index')) {
//     const indexTpl = templatesCache.get('index');

//     // Obtain source for analysis — prioritize disk, then embedded active, then fallback
//     let indexSource = '';

//     if (themePath) {
//       const idxPath = path.join(themePath, 'index.html');
//       if (fs.existsSync(idxPath)) {
//         indexSource = fs.readFileSync(idxPath, 'utf-8');
//       }
//     } else if (isActiveEmbedded && STATIC_EMBEDDED_TEMPLATES[activeTheme]) {
//       indexSource = STATIC_EMBEDDED_TEMPLATES[activeTheme]['index.html'] || '';
//     } else if (STATIC_EMBEDDED_TEMPLATES && STATIC_EMBEDDED_TEMPLATES[fallbackId]) {
//       indexSource = STATIC_EMBEDDED_TEMPLATES[fallbackId]['index.html'] || '';
//     }

//     console.log(info('Single-file theme — analyzing page type capabilities...'));
//     const detectedTypes = detectSingleFilePageTypes(indexSource, themeMetadata);

//     detectedTypes.forEach(type => {
//       if (!templatesCache.has(type)) {
//         templatesCache.set(type, indexTpl);
//       }
//     });

//     const allTypes = ['entry', 'index', 'tag', 'category', 'series', '404'];
//     const usingFallback = allTypes.filter(t => !detectedTypes.has(t));

//     console.log(success(`Single-file handles: ${Array.from(detectedTypes).join(', ')}`));
//     if (usingFallback.length > 0) {
//       console.log(dim(`Using embedded fallback for: ${usingFallback.join(', ')}`));
//     }
//   }

//   // ==========================================================================
//   // SUMMARY
//   // ==========================================================================
//   console.log(success(
//     `Theme resolved — ` +
//     `${templatesCache.size} templates, ` +
//     `${Object.keys(Handlebars.partials).length} partials, ` +
//     `${themeAssets.size} assets`
//   ));

//   return {
//     templatesCache,
//     themeAssets,
//     activeTheme: activeTheme || fallbackId,
//     validation,
//     themeMetadata
//   };
// }
