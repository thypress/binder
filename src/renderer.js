// ### 🎯 Core Functionality
// ```bash
// # Works immediately after clone
// git clone repo && bun install && bun src/cli.js serve
// ✅ Auto-generates embedded-templates.js
// ```

// ### !️ Stale Detection
// ```bash
// # Edit template source
// vim templates/.default/post.html

// # Restart server
// bun src/cli.js serve
// [warn] Embedded templates may be outdated
//   Template sources changed since last generation
//   Run: bun src/embed-templates.js
// ```

// ### 🐳 Production Safety
// ```bash
// # Docker with read-only filesystem
// DISABLE_AUTOGEN_TEMPLATE=true bun src/cli.js serve

// # Error message (if file missing):
// Error: embedded-templates.js not found and cannot write to src/
// Please pre-generate templates during build:
//   bun src/embed-templates.js

// For production deployments, add to your Dockerfile:
//   RUN bun src/embed-templates.js
// ```

// ### 🚀 Environment Control
// ```bash
// # Disable auto-generation (production)
// export DISABLE_AUTOGEN_TEMPLATE=true
// bun src/cli.js serve

// # Enable auto-generation (development, default)
// unset DISABLE_AUTOGEN_TEMPLATE
// bun src/cli.js serve
// ```

// ---

// ## Testing Commands

// ```bash
// # Test 1: Fresh clone
// rm src/embedded-templates.js
// bun src/cli.js serve
// # Should auto-generate ✅

// # Test 2: Stale detection
// touch templates/.default/post.html
// bun src/cli.js serve
// # Should warn !️

// # Test 3: Disabled auto-gen
// rm src/embedded-templates.js
// DISABLE_AUTOGEN_TEMPLATE=true bun src/cli.js serve
// # Should show clear error ❌

// # Test 4: Pre-generated (production simulation)
// bun src/embed-templates.js
// DISABLE_AUTOGEN_TEMPLATE=true bun src/cli.js serve
// # Should work ✅
// ```

// ---

// ## Production Dockerfile Example

// ```dockerfile
// FROM oven/bun AS builder
// WORKDIR /app
// COPY . .
// RUN bun install
// RUN bun src/embed-templates.js  # ✅ Pre-generate

// FROM oven/bun
// WORKDIR /app
// COPY --from=builder /app .

// # ✅ Disable runtime generation (read-only safe)
// ENV DISABLE_AUTOGEN_TEMPLATE=true

// CMD ["bun", "src/cli.js", "serve"]
// ```

// ---

/* SPDX-License-Identifier: MPL-2.0
*
* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at https://mozilla.org/MPL/2.0/.
*/

import MarkdownIt from 'markdown-it';
import markdownItHighlight from 'markdown-it-highlightjs';
import markdownItAnchor from 'markdown-it-anchor';
import Handlebars from 'handlebars';
import matter from 'gray-matter';
import { Feed } from 'feed';
import { SitemapStream, streamToPromise } from 'sitemap';
import { Readable } from 'stream';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseDocument } from 'htmlparser2';
import { success, error as errorMsg, warning, info, dim } from './utils/colors.js';

// THYPRESS Feature Registry - what the runtime provides to templates
export const THYPRESS_FEATURES = {
  // Core variables (always available)
  navigation: { since: '0.1.0', type: 'core', description: 'Site navigation tree' },
  content: { since: '0.1.0', type: 'core', description: 'Rendered content HTML' },
  siteTitle: { since: '0.1.0', type: 'core', description: 'Site title from config' },
  siteDescription: { since: '0.1.0', type: 'core', description: 'Site description from config' },
  siteUrl: { since: '0.1.0', type: 'core', description: 'Site URL from config' },
  author: { since: '0.1.0', type: 'core', description: 'Site author from config' },

  // Content metadata
  title: { since: '0.1.0', type: 'content', description: 'Post/page title' },
  date: { since: '0.1.0', type: 'content', description: 'Post date' },
  createdAt: { since: '0.1.0', type: 'content', description: 'Post creation date' },
  updatedAt: { since: '0.1.0', type: 'content', description: 'Post last updated date' },
  description: { since: '0.1.0', type: 'content', description: 'Post description/excerpt' },
  slug: { since: '0.1.0', type: 'content', description: 'Post URL slug' },
  url: { since: '0.1.0', type: 'content', description: 'Post full URL path' },

  // Features
  tags: { since: '0.1.0', type: 'feature', description: 'Post tags array' },
  toc: { since: '0.1.0', type: 'feature', description: 'Table of contents from headings' },
  pagination: { since: '0.1.0', type: 'feature', description: 'Pagination data for lists' },
  posts: { since: '0.1.0', type: 'feature', description: 'Posts list (on index/tag pages)' },
  tag: { since: '0.1.0', type: 'feature', description: 'Current tag (on tag pages)' },

  // Advanced features (v0.2.0+)
  categories: { since: '0.2.0', type: 'feature', description: 'Post categories array' },
  series: { since: '0.2.0', type: 'feature', description: 'Post series name' },
  category: { since: '0.2.0', type: 'feature', description: 'Current category (on category pages)' },
  relatedPosts: { since: '0.2.0', type: 'feature', description: 'Related posts based on tags' },
  prevPost: { since: '0.2.0', type: 'navigation', description: 'Previous post in chronological order' },
  nextPost: { since: '0.2.0', type: 'navigation', description: 'Next post in chronological order' },
  wordCount: { since: '0.2.0', type: 'content', description: 'Word count for reading time' },
  readingTime: { since: '0.2.0', type: 'content', description: 'Estimated reading time in minutes' },
  ogImage: { since: '0.2.0', type: 'content', description: 'Open Graph image URL' },

  // Context flags
  isArticle: { since: '0.1.0', type: 'context', description: 'True if rendering single post' },
  hasPostsList: { since: '0.1.0', type: 'context', description: 'True if page shows posts list' },
  showToc: { since: '0.2.0', type: 'context', description: 'True if TOC should be displayed' }
};

/**
 * Helper: Check if content has categories
 */
function hasCategories(contentCache) {
  for (const content of contentCache.values()) {
    if (content.categories && content.categories.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Helper: Check if content has series
 */
function hasSeries(contentCache) {
  for (const content of contentCache.values()) {
    if (content.series) {
      return true;
    }
  }
  return false;
}

/**
 * Helper: Check if content has headings (for TOC)
 */
function hasContentWithHeadings(contentCache) {
  for (const content of contentCache.values()) {
    if (content.headings && content.headings.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Compare semantic versions (simple implementation)
 */
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
 * Validate theme requirements against THYPRESS runtime and content
 */
export function validateThemeRequirements(themeMetadata, thypressVersion, contentCache, themePath) {
  const warnings = [];
  const errors = [];

  // Check feature requirements
  const requires = themeMetadata.requires || [];

  for (const required of requires) {
    const feature = THYPRESS_FEATURES[required];

    // Check 1: Unknown feature
    if (!feature) {
      warnings.push({
        type: 'unknown-feature',
        feature: required,
        message: `Theme requires unknown feature '${required}' - may not work correctly`
      });
      continue;
    }

    // Check 2: THYPRESS version check
    if (compareVersions(thypressVersion, feature.since) < 0) {
      errors.push({
        type: 'version-mismatch',
        feature: required,
        message: `Theme requires '${required}' (added in THYPRESS ${feature.since}), but you're running ${thypressVersion}`,
        requiredVersion: feature.since,
        currentVersion: thypressVersion
      });
      continue;
    }

    // Check 3: Content feature availability
    if (feature.type === 'feature' && contentCache) {
      if (required === 'categories' && !hasCategories(contentCache)) {
        warnings.push({
          type: 'content-missing',
          feature: required,
          message: `Theme uses categories, but no content has categories defined`
        });
      }

      if (required === 'series' && !hasSeries(contentCache)) {
        warnings.push({
          type: 'content-missing',
          feature: required,
          message: `Theme uses series, but no content has series defined`
        });
      }

      if (required === 'toc' && !hasContentWithHeadings(contentCache)) {
        warnings.push({
          type: 'content-missing',
          feature: required,
          message: `Theme uses table of contents, but no content has headings`
        });
      }
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
    fs.readFileSync(path.join(fileURLToPath(new URL('.', import.meta.url)), '../package.json'), 'utf-8')
  );
  const thypressVersion = packageJson.version;

  // Check 1: Required templates exist
  const requiredTemplates = ['index', 'post'];
  for (const required of requiredTemplates) {
    if (!templatesCache.has(required)) {
      errors.push(`Missing required template: ${required}.html`);
    }
  }

  // Check 2: Scan templates for partial references
  const requiredPartials = new Set();
  const availablePartials = new Set();

  // Get available partials from Handlebars
  const registeredPartials = Object.keys(Handlebars.partials);
  registeredPartials.forEach(p => availablePartials.add(p));

  // Scan all template files in theme directory
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
            // Match {{> partialName}} or {{> _partialName}}
            const partialRefs = content.matchAll(/\{\{>\s*([a-zA-Z0-9_/-]+)\s*\}\}/g);

            for (const match of partialRefs) {
              let partialName = match[1];
              // Normalize partial name (remove leading underscore if present)
              if (partialName.startsWith('_')) {
                partialName = partialName.substring(1);
              }
              requiredPartials.add(partialName);
            }
          } catch (error) {
            // Ignore read errors for validation
          }
        }
      }
    };

    scanForPartials(themePath);
  }

  // Check which required partials are missing
  const missingPartials = [];
  for (const partial of requiredPartials) {
    const variations = [
      partial,
      `_${partial}`,
      `partials/${partial}`,
      `partials/_${partial}`
    ];

    const found = variations.some(v => availablePartials.has(v));

    if (!found) {
      missingPartials.push(partial);
    }
  }

  if (missingPartials.length > 0) {
    errors.push(
      `Missing partials: ${missingPartials.join(', ')}\n` +
      `  Expected locations:\n` +
      missingPartials.map(p => `    - templates/${themeName}/partials/_${p}.html`).join('\n')
    );
  }

  // Check 3: Feature requirements (if metadata provided)
  if (themeMetadata.requires && themeMetadata.requires.length > 0) {
    const featureValidation = validateThemeRequirements(
      themeMetadata,
      thypressVersion,
      null, // Content cache not available during initial load
      themePath
    );

    errors.push(...featureValidation.errors.map(e => e.message));
    warnings.push(...featureValidation.warnings.map(w => w.message));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Scan available themes in templates directory
 */
export function scanAvailableThemes() {
  const templatesDir = path.join(process.cwd(), 'templates');
  const themes = [];

  // Always include embedded .default
  themes.push({
    id: '.default',
    name: 'Default (Embedded)',
    version: '1.0.0',
    description: 'Built-in THYPRESS theme',
    author: 'THYPRESS',
    embedded: true,
    valid: true,
    active: false
  });

  if (!fs.existsSync(templatesDir)) {
    return themes;
  }

  const entries = fs.readdirSync(templatesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const themeDir = path.join(templatesDir, entry.name);
    const themeJsonPath = path.join(themeDir, 'theme.json');
    const indexHtmlPath = path.join(themeDir, 'index.html');

    let metadata = {
      id: entry.name,
      name: entry.name,
      version: 'unknown',
      description: 'No description available',
      author: 'Unknown',
      embedded: false,
      valid: true,
      active: false
    };

    // Priority 1: theme.json
    if (fs.existsSync(themeJsonPath)) {
      try {
        const themeData = JSON.parse(fs.readFileSync(themeJsonPath, 'utf-8'));
        metadata = {
          id: entry.name,
          name: themeData.name || entry.name,
          version: themeData.version || 'unknown',
          description: themeData.description || 'No description',
          author: themeData.author || 'Unknown',
          license: themeData.license,
          homepage: themeData.homepage,
          preview: themeData.preview,
          tags: themeData.tags || [],
          requires: themeData.requires || [],
          embedded: false,
          valid: true,
          active: false
        };
      } catch (error) {
        metadata.error = `Invalid theme.json: ${error.message}`;
        metadata.valid = false;
      }
    }
    // Priority 2: front-matter in index.html
    else if (fs.existsSync(indexHtmlPath)) {
      try {
        const indexContent = fs.readFileSync(indexHtmlPath, 'utf-8');
        const { data: frontMatter } = matter(indexContent);

        if (Object.keys(frontMatter).length > 0) {
          metadata = {
            id: entry.name,
            name: frontMatter.name || entry.name,
            version: frontMatter.version || 'unknown',
            description: frontMatter.description || 'No description',
            author: frontMatter.author || 'Unknown',
            license: frontMatter.license,
            homepage: frontMatter.homepage,
            preview: frontMatter.preview,
            tags: frontMatter.tags || [],
            requires: frontMatter.requires || [],
            embedded: false,
            valid: true,
            active: false
          };
        }
      } catch (error) {
        // Front-matter parse error, use defaults
      }
    }
    // Priority 3: folder name (already set above)

    // Check if theme has required files
    const hasIndexHtml = fs.existsSync(path.join(themeDir, 'index.html'));
    const hasPostHtml = fs.existsSync(path.join(themeDir, 'post.html'));

    if (!hasIndexHtml) {
      metadata.valid = false;
      metadata.error = 'Missing required file: index.html';
    } else if (!hasPostHtml) {
      metadata.valid = false;
      metadata.error = 'Missing required file: post.html';
    }

    themes.push(metadata);
  }

  return themes;
}

/**
 * Set active theme in config.json
 */
export function setActiveTheme(themeId) {
  const configPath = path.join(process.cwd(), 'config.json');
  let config = {};

  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  config.theme = themeId;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  return { success: true, theme: themeId };
}

const md = new MarkdownIt();
md.use(markdownItHighlight);
md.use(markdownItAnchor, {
  permalink: false,
  slugify: (s) => slugify(s)
});

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const POSTS_PER_PAGE = 10;
const STANDARD_IMAGE_SIZES = [400, 800, 1200];

const DEFAULT_SKIP_DIRS = [
  'node_modules',
  'src',
  'templates',
  '.git',
  'build',
  'dist',
  '.cache',
  '.next',
  'vendor',
  '.vscode',
  '.idea',
  'coverage',
  'test',
  'tests',
  '__tests__'
];

// FIX 1: HTML escape function for text files
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Register minimal Handlebars helpers
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('multiply', (a, b) => a * b);

// FEATURE 5: Taxonomy helpers
Handlebars.registerHelper('getTaxonomy', function(type, context) {
  return context.data.root[type] || [];
});

function isEmbeddedTemplatesStale(embeddedPath) {
  const templatesPath = path.join(__dirname, '../templates/.default');
  if (!fs.existsSync(templatesPath)) return false;
  if (!fs.existsSync(embeddedPath)) return false;

  try {
    const embeddedMtime = fs.statSync(embeddedPath).mtime.getTime();
    const templateFiles = fs.readdirSync(templatesPath);

    for (const file of templateFiles) {
      const filePath = path.join(templatesPath, file);
      if (!fs.statSync(filePath).isFile()) continue;

      const fileMtime = fs.statSync(filePath).mtime.getTime();
      if (fileMtime > embeddedMtime) {
        return true;
      }
    }
  } catch (error) {
    return false;
  }

  return false;
}

function canWriteToSrcDir() {
  try {
    fs.accessSync(__dirname, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

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

export async function loadEmbeddedTemplates() {
  const isDev = process.env.NODE_ENV !== 'production' && process.env.THYPRESS_USE_DISK_TEMPLATES !== 'false';
  const templatesDir = path.join(__dirname, '../templates/.default');
  const embeddedPath = path.join(__dirname, 'embedded-templates.js');

  // DEV MODE: Try loading from disk first (instant refresh)
  if (isDev && fs.existsSync(templatesDir)) {
    try {
      console.log(info('Dev mode: Loading templates from disk (instant refresh enabled)'));
      return loadTemplatesFromDisk(templatesDir);
    } catch (error) {
      console.log(warning('Failed to load from disk, falling back to embedded'));
      // Fall through to embedded loading
    }
  }

  // PRODUCTION or fallback: Use embedded templates
  if (fs.existsSync(embeddedPath)) {
    // Check staleness
    if (isEmbeddedTemplatesStale(embeddedPath)) {
      console.log(warning('Embedded templates may be outdated'));
      console.log(dim('  Template sources changed since last generation'));
      console.log(dim('  Run: bun src/embed-templates.js'));
    }

    const { EMBEDDED_TEMPLATES } = await import('./embedded-templates.js');
    return EMBEDDED_TEMPLATES;
  }

  // Missing embedded - try to auto-generate
  const autoGenerateDisabled = process.env.DISABLE_AUTOGEN_TEMPLATE === 'true';

  if (autoGenerateDisabled) {
    throw new Error(
      'embedded-templates.js not found and auto-generation is disabled.\n' +
      'Please pre-generate templates during build:\n' +
      '  bun src/embed-templates.js\n\n' +
      'Or enable auto-generation by removing DISABLE_AUTOGEN_TEMPLATE env var.'
    );
  }

  if (!canWriteToSrcDir()) {
    throw new Error(
      'embedded-templates.js not found and cannot write to src/ directory.\n' +
      'Please pre-generate templates during build:\n' +
      '  bun src/embed-templates.js'
    );
  }

  console.log(info('Embedded templates not found, generating...'));

  try {
    const embedScriptPath = path.join(__dirname, 'embed-templates.js');
    await import(embedScriptPath);
    console.log(success('Embedded templates generated'));
  } catch (genError) {
    throw new Error(
      `Failed to generate embedded templates: ${genError.message}\n` +
      'Try running manually: bun src/embed-templates.js'
    );
  }

  const { EMBEDDED_TEMPLATES } = await import('./embedded-templates.js');
  return EMBEDDED_TEMPLATES;
}

function shouldIgnore(name) {
  return name.startsWith('.');
}

// FIX 2: Windows-safe draft folder detection
function isInDraftsFolder(relativePath) {
  return relativePath
    .split(/[\\/]+/)
    .some(p => p.toLowerCase() === 'drafts');
}

function isCompleteHtmlDocument(htmlContent) {
  try {
    const dom = parseDocument(htmlContent);

    return dom.children.some(node => {
      if (node.type === 'directive' && node.name === '!doctype') {
        return true;
      }

      if (node.type === 'tag') {
        const structuralTags = ['html', 'head', 'body'];
        return structuralTags.includes(node.name.toLowerCase());
      }

      return false;
    });
  } catch {
    const cleaned = htmlContent.trim()
      .replace(/^<\?xml[^>]*>\s*/i, '')
      .replace(/^<!--[\s\S]*?-->\s*/g, '');

    return /^<!DOCTYPE\s+html/i.test(cleaned) ||
          /<(html|head|body)[\s>]/i.test(cleaned);
  }
}

function detectHtmlIntent(htmlContent, frontMatter) {
  if (frontMatter.template === 'none' || frontMatter.template === false) {
    return { mode: 'raw' };
  }

  if (frontMatter.template) {
    return { mode: 'templated' };
  }

  if (isCompleteHtmlDocument(htmlContent)) {
    return { mode: 'raw' };
  }

  return { mode: 'templated' };
}

// FIX 3: Recursive text extraction for nested HTML
function extractTextContent(node) {
  if (node.type === 'text') return node.data;
  if (node.children) {
    return node.children.map(extractTextContent).join('');
  }
  return '';
}

function extractHeadingsFromHtml(htmlContent) {
  const headings = [];

  try {
    const dom = parseDocument(htmlContent);

    function traverse(node) {
      if (node.type === 'tag' && /^h[1-6]$/i.test(node.name)) {
        const level = parseInt(node.name.substring(1));
        const content = extractTextContent(node).trim();
        const slug = node.attribs?.id || '';

        if (content) {
          headings.push({ level, content, slug });
        }
      }

      if (node.children) {
        node.children.forEach(traverse);
      }
    }

    traverse(dom);
  } catch (error) {
    console.error(errorMsg(`Error extracting headings from HTML: ${error.message}`));
  }

  return headings;
}

function buildTocStructure(headings, minLevel = 2, maxLevel = 4) {
  if (!headings || headings.length === 0) return [];

  const toc = [];
  const stack = [{ children: toc, level: 0 }];

  for (const heading of headings) {
    if (heading.level < minLevel || heading.level > maxLevel) continue;
    if (!heading.slug) continue;

    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    const item = {
      level: heading.level,
      content: heading.content,
      slug: heading.slug,
      children: []
    };

    stack[stack.length - 1].children.push(item);
    stack.push(item);
  }

  return toc;
}

function setupHeadingExtractor(md) {
  const originalHeadingOpen = md.renderer.rules.heading_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.heading_open = function(tokens, idx, options, env, self) {
    const token = tokens[idx];
    const level = parseInt(token.tag.substring(1));
    const nextToken = tokens[idx + 1];
    const content = nextToken && nextToken.type === 'inline' ? nextToken.content : '';
    const slug = token.attrGet('id') || '';

    if (!env.headings) env.headings = [];
    env.headings.push({ level, content, slug });

    return originalHeadingOpen(tokens, idx, options, env, self);
  };
}

setupHeadingExtractor(md);

// FEATURE 6: Admonitions/Callouts plugin
function setupAdmonitions(md) {
  const admonitionTypes = {
    'note': { icon: 'ℹ️', class: 'admonition-note' },
    'tip': { icon: '💡', class: 'admonition-tip' },
    'warning': { icon: '!️', class: 'admonition-warning' },
    'danger': { icon: '🚨', class: 'admonition-danger' },
    'info': { icon: 'ℹ️', class: 'admonition-info' }
  };

  md.block.ruler.before('fence', 'admonition', function(state, startLine, endLine, silent) {
    const marker = ':::';
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];

    if (pos + 3 > max) return false;
    if (state.src.slice(pos, pos + 3) !== marker) return false;

    const typeMatch = state.src.slice(pos + 3, max).trim().toLowerCase();
    if (!admonitionTypes[typeMatch]) return false;

    if (silent) return true;

    let nextLine = startLine;
    let autoClosed = false;

    while (nextLine < endLine) {
      nextLine++;
      if (nextLine >= endLine) break;

      const linePos = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];

      if (linePos < lineMax && state.sCount[nextLine] < state.blkIndent) break;

      if (state.src.slice(linePos, linePos + 3) === marker) {
        autoClosed = true;
        break;
      }
    }

    const oldParent = state.parentType;
    const oldLineMax = state.lineMax;
    state.parentType = 'admonition';

    const token = state.push('admonition_open', 'div', 1);
    token.markup = marker;
    token.block = true;
    token.info = typeMatch;
    token.map = [startLine, nextLine];

    state.md.block.tokenize(state, startLine + 1, nextLine);

    const closeToken = state.push('admonition_close', 'div', -1);
    closeToken.markup = marker;
    closeToken.block = true;

    state.parentType = oldParent;
    state.lineMax = oldLineMax;
    state.line = nextLine + (autoClosed ? 1 : 0);

    return true;
  });

  md.renderer.rules.admonition_open = function(tokens, idx) {
    const token = tokens[idx];
    const type = token.info;
    const config = admonitionTypes[type];
    return `<div class="admonition ${config.class}"><div class="admonition-title">${config.icon} ${type.toUpperCase()}</div><div class="admonition-content">`;
  };

  md.renderer.rules.admonition_close = function() {
    return '</div></div>\n';
  };
}

setupAdmonitions(md);

export function processContentFile(fullPath, relativePath, mode, contentDir, siteConfig = {}, cachedContent = null) {
  const ext = path.extname(fullPath).toLowerCase();
  const isMarkdown = ext === '.md';
  const isText = ext === '.txt';
  const isHtml = ext === '.html';

  const webPath = normalizeToWebPath(relativePath);

  if (isHtml) {
    const rawHtml = fs.readFileSync(fullPath, 'utf-8');
    const { data: frontMatter, content: htmlContent } = matter(rawHtml);

    if (frontMatter.draft === true) {
      return null;
    }

    // FIX 16: Permalink support
    let url;
    if (frontMatter.permalink) {
      url = frontMatter.permalink;
      if (!url.startsWith('/')) url = '/' + url;
      if (!url.endsWith('/')) url = url + '/';
      console.log(dim(`  Using permalink: ${url} (${relativePath})`));
    } else {
      url = generateUrl(webPath);
    }

    const slug = url.substring(1).replace(/\/$/, '') || 'index';

    const intent = detectHtmlIntent(htmlContent, frontMatter);

    // FIX 4: Section detection fix
    let section = null;
    if (mode === 'structured') {
      const parts = webPath.split('/');
      section = parts.length > 1 ? parts[0] : null;
    }

    let toc = [];
    let headings = [];
    if (intent.mode === 'templated') {
      headings = extractHeadingsFromHtml(htmlContent);
      toc = buildTocStructure(headings);
    }

    // FEATURE 5: Extract taxonomies
    const taxonomies = extractTaxonomies(frontMatter);

    return {
      slug,
      content: {
        filename: webPath,
        slug: slug,
        url: url,
        title: frontMatter.title || path.basename(fullPath, '.html'),
        date: fs.statSync(fullPath).mtime.toISOString().split('T')[0],
        createdAt: frontMatter.createdAt || fs.statSync(fullPath).mtime.toISOString().split('T')[0],
        updatedAt: frontMatter.updatedAt || fs.statSync(fullPath).mtime.toISOString().split('T')[0],
        tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []),
        description: frontMatter.description || '',
        content: htmlContent,
        renderedHtml: intent.mode === 'raw' ? htmlContent : null,
        frontMatter: frontMatter,
        relativePath: webPath,
        ogImage: frontMatter.image || null,
        type: 'html',
        wordCount: 0,
        readingTime: 0,
        section: section,
        toc: toc,
        headings: headings,
        ...taxonomies
      },
      imageReferences: []
    };
  }

  // FIX 6: Use cached content to avoid double read
  const rawContent = cachedContent || fs.readFileSync(fullPath, 'utf-8');
  const { data: frontMatter, content } = matter(rawContent);

  if (frontMatter.draft === true) {
    return null;
  }

  // FIX 16: Permalink support
  let url;
  if (frontMatter.permalink) {
    url = frontMatter.permalink;
    if (!url.startsWith('/')) url = '/' + url;
    if (!url.endsWith('/')) url = url + '/';
    console.log(dim(`  Using permalink: ${url} (${relativePath})`));
  } else {
    url = generateUrl(webPath);
  }

  const slug = url.substring(1).replace(/\/$/, '') || 'index';

  const env = {
    postRelativePath: webPath,
    referencedImages: [],
    contentDir: contentDir,
    headings: []
  };

  // FIX 1: Escape text files
  const renderedHtml = isMarkdown
    ? md.render(content, env)
    : siteConfig.escapeTextFiles !== false
      ? `<pre>${escapeHtml(content)}</pre>`
      : `<pre>${content}</pre>`;

  const { title, createdAt, updatedAt, wordCount, readingTime } = processPostMetadata(
    content,
    path.basename(fullPath),
    frontMatter,
    isMarkdown,
    fullPath,
    siteConfig
  );

  const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []);
  const description = frontMatter.description || '';

  // FIX 4: Section detection fix
  let section = null;
  if (mode === 'structured') {
    const parts = webPath.split('/');
    section = parts.length > 1 ? parts[0] : null;
  }

  let ogImage = frontMatter.image || null;
  if (!ogImage && env.referencedImages.length > 0) {
    const firstImg = env.referencedImages[0];
    const ogSize = firstImg.sizesToGenerate[Math.floor(firstImg.sizesToGenerate.length / 2)] || 800;
    ogImage = `/${firstImg.urlBase}${firstImg.basename}-${ogSize}-${firstImg.hash}.jpg`;
  }

  const toc = isMarkdown ? buildTocStructure(env.headings) : [];

  // FEATURE 5: Extract taxonomies
  const taxonomies = extractTaxonomies(frontMatter);

  return {
    slug,
    content: {
      filename: webPath,
      slug: slug,
      url: url,
      title: title,
      date: createdAt,
      createdAt: createdAt,
      updatedAt: updatedAt,
      tags: tags,
      description: description,
      content: content,
      renderedHtml: renderedHtml,
      frontMatter: frontMatter,
      relativePath: webPath,
      ogImage: ogImage,
      wordCount: wordCount,
      readingTime: readingTime,
      section: section,
      type: isMarkdown ? 'markdown' : 'text',
      toc: toc,
      headings: env.headings,
      ...taxonomies
    },
    imageReferences: env.referencedImages
  };
}

// FIX 8: Unicode-safe slugify
export function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeToWebPath(filePath) {
  return filePath.split(path.sep).join('/');
}

// FIX 9: Configurable reading speed
function calculateReadingStats(content, siteConfig = {}) {
  const plainText = content
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/[#*`_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words = plainText.split(/\s+/).filter(w => w.length > 0).length;
  const wordsPerMinute = siteConfig.readingSpeed || 200;
  const readingTime = Math.ceil(words / wordsPerMinute);

  return { wordCount: words, readingTime };
}

export function extractTitleFromContent(content, isMarkdown) {
  if (!isMarkdown) return null;
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return null;
}

export function extractDateFromFilename(filename) {
  const basename = path.basename(filename);
  const dateMatch = basename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return dateMatch[1];
  return null;
}

function isValidBirthtime(stats) {
  const birthtime = stats.birthtime.getTime();
  const ctime = stats.ctime.getTime();
  const mtime = stats.mtime.getTime();

  if (birthtime <= 0) return false;
  if (birthtime === ctime) return false;
  if (birthtime > mtime) return false;

  return true;
}

export function processPostMetadata(content, filename, frontMatter, isMarkdown, fullPath, siteConfig = {}) {
  const stats = fs.statSync(fullPath);

  let title = frontMatter.title;

  if (!title) {
    title = extractTitleFromContent(content, isMarkdown);
  }

  if (!title) {
    const basename = path.basename(filename);
    title = basename
      .replace(/\.(md|txt|html)$/, '')
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')
      .replace(/[-_]/g, ' ')
      .trim();
  }

  if (!title) {
    title = path.basename(filename).replace(/\.(md|txt|html)$/, '');
  }

  let createdAt = frontMatter.createdAt || frontMatter.date;

  if (!createdAt) {
    createdAt = extractDateFromFilename(filename);
  }

  if (!createdAt) {
    if (isValidBirthtime(stats)) {
      createdAt = stats.birthtime.toISOString().split('T')[0];
    }
  }

  if (!createdAt) {
    createdAt = stats.mtime.toISOString().split('T')[0];
  }

  let updatedAt = frontMatter.updatedAt || frontMatter.updated;

  if (!updatedAt) {
    updatedAt = stats.mtime.toISOString().split('T')[0];
  }

  if (createdAt instanceof Date) {
    createdAt = createdAt.toISOString().split('T')[0];
  }

  if (updatedAt instanceof Date) {
    updatedAt = updatedAt.toISOString().split('T')[0];
  }

  const { wordCount, readingTime } = calculateReadingStats(content, siteConfig);

  return { title, createdAt, updatedAt, wordCount, readingTime };
}

// FEATURE 5: Taxonomy extraction
function extractTaxonomies(frontMatter) {
  const taxonomies = {};

  if (frontMatter.categories) {
    taxonomies.categories = Array.isArray(frontMatter.categories)
      ? frontMatter.categories
      : [frontMatter.categories];
  }

  if (frontMatter.series) {
    taxonomies.series = frontMatter.series;
  }

  return taxonomies;
}

function setupImageOptimizer(md) {
  const defaultRender = md.renderer.rules.image || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.image = function(tokens, idx, options, env, self) {
    const token = tokens[idx];
    const srcIndex = token.attrIndex('src');
    const altIndex = token.attrIndex('alt');

    if (srcIndex < 0) return defaultRender(tokens, idx, options, env, self);

    const src = token.attrs[srcIndex][1];
    const alt = altIndex >= 0 ? token.attrs[altIndex][1] : '';

    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
      return defaultRender(tokens, idx, options, env, self);
    }

    const postRelativePath = env.postRelativePath || '';
    const contentDir = env.contentDir;

    let resolvedImagePath;
    let outputImagePath;

    if (src.startsWith('/')) {
      resolvedImagePath = path.join(contentDir, src.substring(1));
      outputImagePath = src.substring(1);
    } else if (src.startsWith('./') || src.startsWith('../')) {
      const postDir = path.dirname(path.join(contentDir, postRelativePath));
      resolvedImagePath = path.resolve(postDir, src);
      outputImagePath = path.relative(contentDir, resolvedImagePath);
    } else {
      const postDir = path.dirname(path.join(contentDir, postRelativePath));
      resolvedImagePath = path.resolve(postDir, src);
      outputImagePath = path.relative(contentDir, resolvedImagePath);
    }

    outputImagePath = normalizeToWebPath(outputImagePath);

    const basename = path.basename(resolvedImagePath, path.extname(resolvedImagePath));
    const outputDir = path.dirname(outputImagePath);

    const hash = crypto.createHash('md5').update(resolvedImagePath).digest('hex').substring(0, 8);

    const urlBase = outputDir === '.' ? '' : `${outputDir}/`;

    let sizesToGenerate = [...STANDARD_IMAGE_SIZES];

    const imageDimensionsCache = env.imageDimensionsCache || new Map();
    const originalWidth = imageDimensionsCache.get(resolvedImagePath);

    if (originalWidth) {
      sizesToGenerate = STANDARD_IMAGE_SIZES.filter(size => size < originalWidth);
      if (!sizesToGenerate.includes(originalWidth)) {
        sizesToGenerate.push(originalWidth);
      }
      sizesToGenerate.sort((a, b) => a - b);
    }

    if (!env.referencedImages) env.referencedImages = [];
    env.referencedImages.push({
      src,
      resolvedPath: resolvedImagePath,
      outputPath: outputImagePath,
      basename,
      hash,
      urlBase,
      sizesToGenerate
    });

    return `<picture>
  <source
    srcset="${sizesToGenerate.map(size => `/${urlBase}${basename}-${size}-${hash}.webp ${size}w`).join(', ')}"
    type="image/webp"
    sizes="(max-width: ${sizesToGenerate[0]}px) ${sizesToGenerate[0]}px, (max-width: ${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}px) ${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}px, ${sizesToGenerate[sizesToGenerate.length - 1]}px">
  <source
    srcset="${sizesToGenerate.map(size => `/${urlBase}${basename}-${size}-${hash}.jpg ${size}w`).join(', ')}"
    type="image/jpeg"
    sizes="(max-width: ${sizesToGenerate[0]}px) ${sizesToGenerate[0]}px, (max-width: ${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}px) ${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}px, ${sizesToGenerate[sizesToGenerate.length - 1]}px">
  <img
    src="/${urlBase}${basename}-${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}-${hash}.jpg"
    alt="${alt}"
    loading="lazy"
    decoding="async">
</picture>`;
  };
}

setupImageOptimizer(md);

export async function optimizeImage(imagePath, outputDir, sizesToGenerate = STANDARD_IMAGE_SIZES) {
  const ext = path.extname(imagePath);
  const name = path.basename(imagePath, ext);
  const hash = crypto.createHash('md5').update(imagePath).digest('hex').substring(0, 8);

  if (!sizesToGenerate || sizesToGenerate.length === 0) {
    try {
      const metadata = await sharp(imagePath).metadata();
      const originalWidth = metadata.width;

      sizesToGenerate = STANDARD_IMAGE_SIZES.filter(size => size < originalWidth);

      if (!sizesToGenerate.includes(originalWidth)) {
        sizesToGenerate.push(originalWidth);
      }
      sizesToGenerate.sort((a, b) => a - b);
    } catch (error) {
      sizesToGenerate = STANDARD_IMAGE_SIZES;
    }
  }

  const optimized = [];

  try {
    for (const size of sizesToGenerate) {
      const webpFilename = `${name}-${size}-${hash}.webp`;
      const webpPath = path.join(outputDir, webpFilename);
      await sharp(imagePath)
        .resize(size, null, {
          withoutEnlargement: true,
          fit: 'inside'
        })
        .webp({ quality: 80, effort: 6 })
        .toFile(webpPath);
      optimized.push({ format: 'webp', size, filename: webpFilename });

      const jpegFilename = `${name}-${size}-${hash}.jpg`;
      const jpegPath = path.join(outputDir, jpegFilename);
      await sharp(imagePath)
        .resize(size, null, {
          withoutEnlargement: true,
          fit: 'inside'
        })
        .jpeg({ quality: 80, progressive: true, mozjpeg: true })
        .toFile(jpegPath);
      optimized.push({ format: 'jpeg', size, filename: jpegFilename });
    }
  } catch (error) {
    console.error(`Error optimizing ${imagePath}:`, error.message);
  }

  return optimized;
}

export function detectContentStructure(workingDir, options = {}) {
  const { cliContentDir = null, cliSkipDirs = null } = options;

  if (cliContentDir) {
    const cliDir = path.join(workingDir, cliContentDir);
    if (fs.existsSync(cliDir) && fs.statSync(cliDir).isDirectory()) {
      console.log(success(`Using CLI-specified content directory: ${cliContentDir}`));
      return {
        contentRoot: cliDir,
        mode: 'structured',
        customDir: cliContentDir
      };
    } else {
      console.log(errorMsg(`CLI content directory not found: ${cliContentDir}`));
      process.exit(1);
    }
  }

  let config = {};
  try {
    config = getSiteConfig();
    if (config.contentDir) {
      const configDir = path.join(workingDir, config.contentDir);
      if (!fs.existsSync(configDir) || !fs.statSync(configDir).isDirectory()) {
        // FIX 12: Strict config validation
        console.log(errorMsg(`Configured contentDir not found: ${config.contentDir}`));
        console.log(info('Please create the directory or update config.json'));
        process.exit(1);
      }
      console.log(success(`Using configured content directory: ${config.contentDir}`));
      return {
        contentRoot: configDir,
        mode: 'structured',
        customDir: config.contentDir
      };
    }
  } catch (error) {
    // No config file
  }

  const contentDir = path.join(workingDir, 'content');
  if (fs.existsSync(contentDir) && fs.statSync(contentDir).isDirectory()) {
    return {
      contentRoot: contentDir,
      mode: 'structured'
    };
  }

  let skipDirs = [...DEFAULT_SKIP_DIRS];

  if (cliSkipDirs) {
    skipDirs = [...skipDirs, ...cliSkipDirs];
  }

  if (config.skipDirs && Array.isArray(config.skipDirs)) {
    skipDirs = [...skipDirs, ...config.skipDirs];
  }

  skipDirs = [...new Set(skipDirs)];

  const hasSkippedDirs = skipDirs.some(dir => {
    const dirPath = path.join(workingDir, dir);
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  });

  if (!hasSkippedDirs) {
    try {
      const files = fs.readdirSync(workingDir);
      const contentFiles = files.filter(f => {
        if (shouldIgnore(f)) return false;
        const fullPath = path.join(workingDir, f);
        if (!fs.statSync(fullPath).isFile()) return false;
        return /\.(md|txt|html)$/i.test(f);
      });

      if (contentFiles.length > 0) {
        console.log(success(`Found ${contentFiles.length} content file(s) in root`));
        console.log(info('Using root directory as content (no dev folders detected)'));
        console.log(dim('  To use subdirectory: create content/ or add contentDir to config.json'));

        return {
          contentRoot: workingDir,
          mode: 'structured',
          rootContent: true
        };
      }
    } catch (error) {
      // Continue to initialization
    }
  } else {
    const detectedDirs = skipDirs
      .filter(dir => fs.existsSync(path.join(workingDir, dir)))
      .slice(0, 3);

    console.log(warning(`Development folders detected: ${detectedDirs.join(', ')}`));
    console.log(info('Content must be in content/, or set contentDir in config.json'));
  }

  console.log(warning('No content directory found'));
  console.log(info('Will initialize content/ on first run'));

  return {
    contentRoot: contentDir,
    mode: 'structured',
    shouldInit: true
  };
}

// FIX 14: Remove unused 'mode' parameter
export function generateUrl(relativePath) {
  let url = relativePath.replace(/\.(md|txt|html)$/, '');
  url = url.replace(/\/index$/, '');
  return '/' + url + (url ? '/' : '');
}

// FIX 5: O(n²) → O(n) navigation building
export function buildNavigationTree(contentRoot, contentCache = new Map(), mode = 'structured') {
  const pathToContent = new Map();
  for (const content of contentCache.values()) {
    pathToContent.set(content.relativePath, content);
  }

  const navigation = [];

  function processDirectory(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const webPath = normalizeToWebPath(relPath);

      if (entry.isDirectory() && entry.name === 'drafts') continue;

      if (entry.isDirectory()) {
        const children = processDirectory(fullPath, relPath);
        if (children.length > 0) {
          items.push({
            type: 'folder',
            name: entry.name,
            title: entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' '),
            children: children
          });
        }
      } else if (/\.(md|txt|html)$/i.test(entry.name)) {
        const url = generateUrl(webPath);

        const content = pathToContent.get(webPath);
        const title = content ? content.title : null;

        const finalTitle = title || entry.name
          .replace(/\.(md|txt|html)$/, '')
          .replace(/^\d{4}-\d{2}-\d{2}-/, '')
          .replace(/-/g, ' ');

        items.push({
          type: 'file',
          name: entry.name,
          title: finalTitle,
          url: url,
          path: webPath
        });
      }
    }

    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return items;
  }

  return processDirectory(contentRoot);
}

export function loadAllContent(options = {}) {
  const workingDir = process.cwd();
  const { contentRoot, mode, shouldInit } = detectContentStructure(workingDir, options);

  const contentCache = new Map();
  const slugMap = new Map();
  const imageReferences = new Map();
  const brokenImages = [];
  const imageDimensionsCache = new Map();

  console.log(dim(`Content mode: ${mode}`));
  console.log(dim(`Content root: ${contentRoot}`));

  if (shouldInit) {
    console.log(info('No content found, will initialize on first run'));
    return { contentCache, slugMap, navigation: [], imageReferences, brokenImages, imageDimensionsCache, mode, contentRoot };
  }

  if (!fs.existsSync(contentRoot)) {
    console.log(warning(`Content directory not found: ${contentRoot}`));
    return { contentCache, slugMap, navigation: [], imageReferences, brokenImages, imageDimensionsCache, mode, contentRoot };
  }

  const siteConfig = getSiteConfig();

  function preScanImageDimensions(content, relativePath) {
    const imageMatches = content.matchAll(/!\[.*?\]\((.*?)\)/g);

    for (const match of imageMatches) {
      const src = match[1];

      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
        continue;
      }

      let resolvedImagePath;
      if (src.startsWith('/')) {
        resolvedImagePath = path.join(contentRoot, src.substring(1));
      } else if (src.startsWith('./') || src.startsWith('../')) {
        const postDir = path.dirname(path.join(contentRoot, relativePath));
        resolvedImagePath = path.resolve(postDir, src);
      } else {
        const postDir = path.dirname(path.join(contentRoot, relativePath));
        resolvedImagePath = path.resolve(postDir, src);
      }

      if (fs.existsSync(resolvedImagePath) && !imageDimensionsCache.has(resolvedImagePath)) {
        try {
          const buffer = fs.readFileSync(resolvedImagePath);
          sharp(buffer).metadata().then(meta => {
            imageDimensionsCache.set(resolvedImagePath, meta.width);
          }).catch(() => {});
        } catch (error) {}
      }
    }
  }

  function loadContentFromDir(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const webPath = normalizeToWebPath(relPath);

      if (entry.isDirectory() && entry.name === 'drafts') {
        console.log(dim(`Skipping drafts folder: ${webPath}`));
        continue;
      }

      if (isInDraftsFolder(relPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        loadContentFromDir(fullPath, relPath);
      } else if (/\.(md|txt|html)$/i.test(entry.name)) {
        if (entry.name.startsWith('_')) {
          console.log(warning(`${webPath} uses underscore prefix (intended for template partials, not content)`));
          console.log(dim(`  Consider using drafts/ folder or draft: true in front matter for drafts`));
        }

        try {
          const ext = path.extname(entry.name).toLowerCase();
          const isMarkdown = ext === '.md';

          // FIX 6: Cache content for single read
          let cachedContent = null;
          if (isMarkdown) {
            cachedContent = fs.readFileSync(fullPath, 'utf-8');
            const { content } = matter(cachedContent);
            preScanImageDimensions(content, webPath);
          }

          const result = processContentFile(fullPath, relPath, mode, contentRoot, siteConfig, cachedContent);

          if (!result) continue;

          // FIX 16: Check for duplicate slugs/permalinks
          if (slugMap.has(result.slug)) {
            const existingPath = slugMap.get(result.slug);
            console.error(errorMsg(`Duplicate URL detected: ${result.content.url}`));
            console.log(dim(`  Used in: ${webPath}`));
            console.log(dim(`  Already used in: ${existingPath}`));
            process.exit(1);
          }

          contentCache.set(result.slug, result.content);
          slugMap.set(webPath, result.slug);

          if (result.imageReferences.length > 0) {
            imageReferences.set(webPath, result.imageReferences);

            // FIX 11: Strict images option
            for (const img of result.imageReferences) {
              if (!fs.existsSync(img.resolvedPath)) {
                brokenImages.push({
                  post: webPath,
                  src: img.src,
                  resolvedPath: img.resolvedPath
                });

                if (siteConfig.strictImages === true) {
                  console.error(errorMsg(`Broken image in ${webPath}: ${img.src}`));
                  console.log(dim(`  Expected path: ${img.resolvedPath}`));
                  process.exit(1);
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error loading content '${webPath}': ${error.message}`);
        }
      }
    }
  }

  try {
    loadContentFromDir(contentRoot);
    console.log(success(`Loaded ${contentCache.size} content files`));
  } catch (error) {
    console.error(`Error reading content directory: ${error.message}`);
  }

  const navigation = buildNavigationTree(contentRoot, contentCache, mode);

  return { contentCache, slugMap, navigation, imageReferences, brokenImages, imageDimensionsCache, mode, contentRoot };
}

export function selectTemplate(content, templates, defaultTemplate = 'post') {
  if (content.frontMatter && content.frontMatter.template) {
    const explicitTemplate = templates.get(content.frontMatter.template);
    if (explicitTemplate) {
      return explicitTemplate;
    }
  }

  if (content.section) {
    const sectionTemplate = templates.get(content.section);
    if (sectionTemplate) {
      return sectionTemplate;
    }
  }

  if (content.slug === 'index' || content.slug === '') {
    const indexTemplate = templates.get('index');
    if (indexTemplate) return indexTemplate;
  }

  return templates.get(defaultTemplate)
      || templates.get('post')
      || templates.get('page')
      || templates.get('index');
}

export async function loadTheme(themeName = null) {
  const templatesDir = path.join(process.cwd(), 'templates');
  const templatesCache = new Map();
  const themeAssets = new Map();

  let activeTheme = themeName;
  let themeMetadata = {};

  if (!activeTheme) {
    if (fs.existsSync(templatesDir)) {
      const themes = fs.readdirSync(templatesDir)
        .filter(f => {
          const fullPath = path.join(templatesDir, f);
          return !shouldIgnore(f) && fs.statSync(fullPath).isDirectory();
        });

      if (themes.length === 1) {
        activeTheme = themes[0];
      } else if (themes.includes('my-press')) {
        activeTheme = 'my-press';
      }
    }
  }

  const EMBEDDED_TEMPLATES = await loadEmbeddedTemplates();

  function compileTemplate(name, content) {
    try {
      return Handlebars.compile(content);
    } catch (error) {
      console.error(errorMsg(`Failed to compile template '${name}': ${error.message}`));
      return null;
    }
  }

  for (const [name, content] of Object.entries(EMBEDDED_TEMPLATES)) {
    if (name.endsWith('.html')) {
      const templateName = name.replace('.html', '');

      if (name.startsWith('_')) {
        Handlebars.registerPartial(templateName, content);
      } else {
        const compiled = compileTemplate(templateName, content);
        if (compiled) {
          templatesCache.set(templateName, compiled);
        }
      }
    }
  }

  let themePath = null;

  if (activeTheme) {
    themePath = path.join(templatesDir, activeTheme);

    if (fs.existsSync(themePath)) {
      console.log(success(`Loading theme: ${activeTheme}`));

      // Load theme metadata
      const themeJsonPath = path.join(themePath, 'theme.json');
      const indexHtmlPath = path.join(themePath, 'index.html');

      // Priority 1: theme.json
      if (fs.existsSync(themeJsonPath)) {
        try {
          themeMetadata = JSON.parse(fs.readFileSync(themeJsonPath, 'utf-8'));
          console.log(dim(`  Loaded metadata from theme.json`));
        } catch (error) {
          console.log(warning(`  Could not parse theme.json: ${error.message}`));
        }
      }
      // Priority 2: front-matter in index.html
      else if (fs.existsSync(indexHtmlPath)) {
        try {
          const indexContent = fs.readFileSync(indexHtmlPath, 'utf-8');
          const { data: frontMatter } = matter(indexContent);

          if (Object.keys(frontMatter).length > 0 && (frontMatter.name || frontMatter.version || frontMatter.requires)) {
            themeMetadata = frontMatter;
            console.log(dim(`  Loaded metadata from index.html front-matter`));
          }
        } catch (error) {
          // Silently ignore front-matter parse errors
        }
      }

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
              const content = fs.readFileSync(fullPath, 'utf-8');
              const partialName = path.basename(relPath, '.html').replace(/\\/g, '/');
              Handlebars.registerPartial(partialName, content);
              console.log(dim(`  Registered partial (folder): ${partialName}`));
            }
          }
        }

        scanPartialsFolder(partialsDir);
      }

      function loadThemeFiles(dir, relativePath = '') {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (shouldIgnore(entry.name)) continue;

          const fullPath = path.join(dir, entry.name);
          const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

          if (entry.isDirectory()) {
            if (entry.name === 'partials') continue;

            loadThemeFiles(fullPath, relPath);
          } else {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const ext = path.extname(entry.name).toLowerCase();

            if (ext === '.html') {
              const templateName = path.basename(entry.name, '.html');

              if (entry.name.startsWith('_')) {
                Handlebars.registerPartial(templateName, content);
                console.log(dim(`  Registered partial (underscore): ${templateName}`));
              } else {
                const { data: frontMatter, content: templateContent } = matter(content);

                if (frontMatter.partial === true) {
                  Handlebars.registerPartial(templateName, templateContent);
                  console.log(dim(`  Registered partial (front matter): ${templateName}`));
                } else {
                  const compiled = compileTemplate(templateName, content);
                  if (compiled) {
                    templatesCache.set(templateName, compiled);
                  }
                }
              }
            } else {
              const needsTemplating = content.includes('{{') || content.includes('{%');

              if (needsTemplating) {
                const compiled = compileTemplate(relPath, content);
                if (compiled) {
                  themeAssets.set(relPath, { type: 'template', compiled });
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
  }

  console.log(success(`Loaded ${templatesCache.size} templates`));

  // Validate theme (skip for .default)
  let validation = { valid: true, errors: [], warnings: [] };

  if (activeTheme && activeTheme !== '.default' && themePath) {
    validation = validateTheme(themePath, templatesCache, activeTheme, themeMetadata);
  }

  return { templatesCache, themeAssets, activeTheme, validation, themeMetadata };
}

export function getContentSorted(contentCache) {
  return Array.from(contentCache.values()).sort((a, b) => {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

export function getPaginationData(contentCache, currentPage) {
  const totalPages = Math.ceil(contentCache.size / POSTS_PER_PAGE);
  const pages = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    pages.push(1);

    if (currentPage > 3) {
      pages.push('...');
    }

    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push('...');
    }

    pages.push(totalPages);
  }

  return {
    currentPage,
    totalPages,
    pages,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
    prevPage: currentPage - 1,
    nextPage: currentPage + 1
  };
}

// FEATURE 2: Related posts function
export function getRelatedPosts(post, contentCache, limit = 3) {
  const allPosts = Array.from(contentCache.values());

  return allPosts
    .filter(p => p.slug !== post.slug)
    .map(p => ({
      ...p,
      score: post.tags.filter(t => p.tags.includes(t)).length
    }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function renderContentList(contentCache, page, templates, navigation, siteConfig = {}) {
  const startIndex = (page - 1) * POSTS_PER_PAGE;

  const allContent = getContentSorted(contentCache);
  const pageContent = allContent.slice(startIndex, startIndex + POSTS_PER_PAGE);

  const items = pageContent.map(content => ({
    slug: content.slug,
    url: content.url,
    title: content.title,
    date: content.date,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    tags: content.tags,
    description: content.description,
    categories: content.categories || [],
    series: content.series || null
  }));

  const pagination = getPaginationData(contentCache, page);

  const indexTpl = templates.get('index');
  if (!indexTpl) {
    throw new Error('Index template not found');
  }

  const {
    title: siteTitle = 'My Site',
    description: siteDescription = 'A site powered by THYPRESS',
    url: siteUrl = 'https://example.com'
  } = siteConfig;

  return indexTpl({
    posts: items,
    pagination: pagination,
    navigation: navigation,
    siteTitle: siteTitle,
    siteDescription: siteDescription,
    siteUrl: siteUrl
  });
}

export function renderContent(content, slug, templates, navigation, siteConfig = {}, contentCache = null) {
  if (content.type === 'html' && content.renderedHtml !== null) {
    return content.renderedHtml;
  }

  const template = selectTemplate(content, templates, 'post');

  if (!template) {
    throw new Error(`Template not found for content: ${slug}`);
  }

  const {
    title: siteTitle = 'My Site',
    url: siteUrl = 'https://example.com',
    author = 'Anonymous'
  } = siteConfig;

  const createdAtISO = new Date(content.createdAt).toISOString();
  const updatedAtISO = new Date(content.updatedAt).toISOString();

  let prevContent = null;
  let nextContent = null;

  if (contentCache) {
    const sortedContent = getContentSorted(contentCache);
    const currentIndex = sortedContent.findIndex(c => c.slug === slug);

    if (currentIndex !== -1) {
      if (currentIndex < sortedContent.length - 1) {
        prevContent = {
          title: sortedContent[currentIndex + 1].title,
          url: sortedContent[currentIndex + 1].url
        };
      }

      if (currentIndex > 0) {
        nextContent = {
          title: sortedContent[currentIndex - 1].title,
          url: sortedContent[currentIndex - 1].url
        };
      }
    }
  }

  // FEATURE 2: Add related posts
  const relatedPosts = contentCache ? getRelatedPosts(content, contentCache) : [];

  const htmlToWrap = content.renderedHtml || content.content;
  const showToc = content.toc && content.toc.length > 0;

  return template({
    content: htmlToWrap,
    title: content.title,
    date: content.date,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    dateISO: createdAtISO,
    createdAtISO: createdAtISO,
    updatedAtISO: updatedAtISO,
    tags: content.tags,
    description: content.description,
    slug: content.slug,
    url: content.url,
    ogImage: content.ogImage || null,
    siteTitle: siteTitle,
    siteUrl: siteUrl,
    author: author,
    navigation: navigation,
    wordCount: content.wordCount,
    readingTime: content.readingTime,
    frontMatter: content.frontMatter,
    prevPost: prevContent,
    nextPost: nextContent,
    relatedPosts: relatedPosts,
    toc: content.toc || [],
    showToc: showToc,
    categories: content.categories || [],
    series: content.series || null
  });
}

export function renderTagPage(contentCache, tag, templates, navigation) {
  const tagTpl = templates.get('tag') || templates.get('index');

  const allContent = getContentSorted(contentCache);
  const taggedContent = allContent.filter(content => content.tags.includes(tag));

  const items = taggedContent.map(content => ({
    slug: content.slug,
    url: content.url,
    title: content.title,
    date: content.date,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    tags: content.tags,
    description: content.description
  }));

  return tagTpl({
    tag: tag,
    posts: items,
    pagination: null,
    navigation: navigation
  });
}

// FEATURE 5: Render category page
export function renderCategoryPage(contentCache, category, templates, navigation) {
  const categoryTpl = templates.get('category') || templates.get('tag') || templates.get('index');

  const allContent = getContentSorted(contentCache);
  const categoryContent = allContent.filter(content =>
    content.categories && content.categories.includes(category)
  );

  const items = categoryContent.map(content => ({
    slug: content.slug,
    url: content.url,
    title: content.title,
    date: content.date,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    tags: content.tags,
    description: content.description
  }));

  return categoryTpl({
    category: category,
    posts: items,
    pagination: null,
    navigation: navigation
  });
}

// FEATURE 5: Render series page
export function renderSeriesPage(contentCache, series, templates, navigation) {
  const seriesTpl = templates.get('series') || templates.get('tag') || templates.get('index');

  const allContent = getContentSorted(contentCache);
  const seriesContent = allContent.filter(content => content.series === series);

  const items = seriesContent.map(content => ({
    slug: content.slug,
    url: content.url,
    title: content.title,
    date: content.date,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    tags: content.tags,
    description: content.description
  }));

  return seriesTpl({
    series: series,
    posts: items,
    pagination: null,
    navigation: navigation
  });
}

export function getAllTags(contentCache) {
  const tags = new Set();
  for (const content of contentCache.values()) {
    content.tags.forEach(tag => tags.add(tag));
  }
  return Array.from(tags).sort();
}

// FEATURE 5: Get all categories
export function getAllCategories(contentCache) {
  const categories = new Set();
  for (const content of contentCache.values()) {
    if (content.categories) {
      content.categories.forEach(cat => categories.add(cat));
    }
  }
  return Array.from(categories).sort();
}

// FEATURE 5: Get all series
export function getAllSeries(contentCache) {
  const series = new Set();
  for (const content of contentCache.values()) {
    if (content.series) {
      series.add(content.series);
    }
  }
  return Array.from(series).sort();
}

export function generateSearchIndex(contentCache) {
  const allContent = getContentSorted(contentCache);

  const searchData = allContent.map(content => ({
    id: content.slug,
    title: content.title,
    slug: content.slug,
    url: content.url,
    date: content.date,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    tags: content.tags,
    description: content.description,
    content: content.content
      .replace(/[#*`\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 5000)
  }));

  return JSON.stringify(searchData, null, 0);
}

export function generateRSS(contentCache, siteConfig = {}) {
  const {
    title = 'My Site',
    description = 'A site powered by THYPRESS',
    url = 'https://example.com',
    author = 'Anonymous'
  } = siteConfig;

  const feed = new Feed({
    title: title,
    description: description,
    id: url,
    link: url,
    language: 'en',
    favicon: `${url}/favicon.ico`,
    copyright: `All rights reserved ${new Date().getFullYear()}, ${author}`,
    author: {
      name: author,
      link: url
    }
  });

  const allContent = getContentSorted(contentCache);
  const recentContent = allContent.slice(0, 20);

  recentContent.forEach(content => {
    feed.addItem({
      title: content.title,
      id: `${url}${content.url}`,
      link: `${url}${content.url}`,
      description: content.description || content.content.substring(0, 200),
      content: content.renderedHtml || content.content,
      author: [{ name: author }],
      date: new Date(content.createdAt),
      published: new Date(content.createdAt),
      updated: new Date(content.updatedAt),
      category: content.tags.map(tag => ({ name: tag }))
    });
  });

  return feed.rss2();
}

export async function generateSitemap(contentCache, siteConfig = {}) {
  const { url = 'https://example.com' } = siteConfig;

  const allContent = getContentSorted(contentCache);
  const allTags = getAllTags(contentCache);
  const allCategories = getAllCategories(contentCache);
  const allSeries = getAllSeries(contentCache);

  const links = [];

  links.push({
    url: '/',
    changefreq: 'daily',
    priority: 1.0
  });

  allContent.forEach(content => {
    links.push({
      url: content.url,
      lastmod: content.updatedAt,
      changefreq: 'monthly',
      priority: 0.8
    });
  });

  allTags.forEach(tag => {
    links.push({
      url: `/tag/${tag}/`,
      changefreq: 'weekly',
      priority: 0.5
    });
  });

  allCategories.forEach(category => {
    links.push({
      url: `/category/${category}/`,
      changefreq: 'weekly',
      priority: 0.6
    });
  });

  allSeries.forEach(series => {
    links.push({
      url: `/series/${slugify(series)}/`,
      changefreq: 'weekly',
      priority: 0.6
    });
  });

  const stream = new SitemapStream({ hostname: url });
  const xml = await streamToPromise(Readable.from(links).pipe(stream));

  return xml.toString();
}

export function getSiteConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (error) {
    console.error(errorMsg('Error loading config.json:', error.message));
  }

  return {
    title: 'My Site',
    description: 'A site powered by THYPRESS',
    url: 'https://example.com',
    author: 'Anonymous'
  };
}
