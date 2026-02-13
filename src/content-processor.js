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
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import markdownItAlerts from 'markdown-it-github-alerts';
import markdownItContainer from 'markdown-it-container';
import markdownItHighlight from 'markdown-it-highlightjs';
import { parseDocument } from 'htmlparser2';
import { success, error as errorMsg, warning, info, dim } from './utils/colors.js';
import { slugify, normalizeToWebPath, getSiteConfig } from './utils/taxonomy.js';

// ============================================================================
// MARKDOWN-IT SETUP
// ============================================================================

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

md.use(markdownItHighlight);
md.use(markdownItAnchor, {
  permalink: false,
  slugify: (s) => slugify(s)
});

// ============================================================================
// CONSTANTS
// ============================================================================

// Standard responsive image sizes
const STANDARD_IMAGE_SIZES = [400, 800, 1200];

// Default directories to skip in content detection
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

// ============================================================================
// RESERVED FIELDS FOR PROTECTED SPREAD
// ============================================================================
// These fields are core metadata and should never be overwritten by custom
// front-matter fields. Custom fields are safely spread alongside these.
// ============================================================================

const RESERVED_FIELDS = new Set([
  'slug', 'url', 'filename', 'title', 'date', 'createdAt', 'updatedAt',
  'tags', 'categories', 'series', 'html', 'rawContent', 'description',
  'ogImage', 'wordCount', 'readingTime', 'section', 'type', 'toc',
  'headings', 'relativePath', 'dateISO', 'createdAtISO', 'updatedAtISO',
  'renderedHtml'
]);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if file/folder should be ignored (dotfiles)
 */
function shouldIgnore(name) {
  return name.startsWith('.');
}

/**
 * Check if path contains a drafts folder
 */
function isInDraftsFolder(relativePath) {
  return relativePath
    .split(/[\\/]+/)
    .some(p => p.toLowerCase() === 'drafts');
}

/**
 * HTML escape for text files
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// HTML DETECTION & PROCESSING
// ============================================================================

/**
 * Detect if HTML content is a complete document
 */
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
      .replace(/^\s*/g, '');

    return /^<!DOCTYPE\s+html/i.test(cleaned) ||
          /<(html|head|body)[\s>]/i.test(cleaned);
  }
}

/**
 * Detect HTML intent (raw vs templated)
 */
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

/**
 * Extract text content from HTML node recursively
 */
function extractTextContent(node) {
  if (node.type === 'text') return node.data;
  if (node.children) {
    return node.children.map(extractTextContent).join('');
  }
  return '';
}

/**
 * Extract headings from HTML content
 */
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

// ============================================================================
// TABLE OF CONTENTS
// ============================================================================

/**
 * Build hierarchical TOC structure from flat headings array
 */
export function buildTocStructure(headings, minLevel = 2, maxLevel = 4) {
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

// ============================================================================
// MARKDOWN-IT PLUGINS
// ============================================================================

/**
 * Setup heading extractor for markdown-it
 */
function setupHeadingExtractor(md) {
  const originalHeadingOpen = md.renderer.rules.heading_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.heading_open = function(tokens, idx, options, env, self) {
    const token = tokens[idx];
    const level = parseInt(token.tag.substring(1));
    const nextToken = tokens[idx + 1];
    const content = nextToken && nextToken.type === 'inline' ? nextToken.content : '';
    const slug = token.attrGet('id') || slugify(content);

    if (!env.headings) env.headings = [];
    env.headings.push({ level, content, slug });

    // Ensure ID attribute exists for linking
    if (!token.attrGet('id')) {
      token.attrSet('id', slug);
    }

    return originalHeadingOpen(tokens, idx, options, env, self);
  };
}

setupHeadingExtractor(md);

/**
 * Setup admonitions with dual syntax support
 * Supports both ::: syntax and GitHub > [!TYPE] syntax
 */
function setupAdmonitions(md) {
  // GitHub-style alerts (> [!WARNING])
  md.use(markdownItAlerts);

  // Container-style admonitions (::: warning)
  const admonitionTypes = ['note', 'tip', 'warning', 'danger', 'info'];

  admonitionTypes.forEach(type => {
    md.use(markdownItContainer, type, {
      render: (tokens, idx) => {
        if (tokens[idx].nesting === 1) {
          const title = type.toUpperCase();
          return `<div class="admonition admonition-${type}">
                    <div class="admonition-title">${title}</div>
                    <div class="admonition-content">`;
        } else {
          return `</div></div>\n`;
        }
      }
    });
  });
}

setupAdmonitions(md);

/**
 * Setup image optimizer for markdown-it
 */
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

    // Skip external images
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
      return defaultRender(tokens, idx, options, env, self);
    }

    const pageRelativePath = env.pageRelativePath || '';
    const contentDir = env.contentDir;

    let resolvedImagePath;
    let outputImagePath;

    if (src.startsWith('/')) {
      resolvedImagePath = path.join(contentDir, src.substring(1));
      outputImagePath = src.substring(1);
    } else if (src.startsWith('./') || src.startsWith('../')) {
      const pageDir = path.dirname(path.join(contentDir, pageRelativePath));
      resolvedImagePath = path.resolve(pageDir, src);
      outputImagePath = path.relative(contentDir, resolvedImagePath);
    } else {
      const pageDir = path.dirname(path.join(contentDir, pageRelativePath));
      resolvedImagePath = path.resolve(pageDir, src);
      outputImagePath = path.relative(contentDir, resolvedImagePath);
    }

    outputImagePath = normalizeToWebPath(outputImagePath);

    const basename = path.basename(resolvedImagePath, path.extname(resolvedImagePath));
    const outputDir = path.dirname(outputImagePath);

    // Security: Validate image is within content directory
    const contentDirResolved = path.resolve(contentDir);
    const imageResolved = path.resolve(resolvedImagePath);
    if (!imageResolved.startsWith(contentDirResolved)) {
      console.log(warning(`Image outside content directory (ignored): ${src}`));
      return ``;
    }

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

// ============================================================================
// IMAGE OPTIMIZATION
// ============================================================================

/**
 * Optimize image to multiple sizes and formats
 */
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
      // WebP variant
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

      // JPEG variant
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

// ============================================================================
// CONTENT METADATA PROCESSING
// ============================================================================

/**
 * Calculate reading statistics
 */
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

/**
 * Extract title from markdown content
 */
export function extractTitleFromContent(content, isMarkdown) {
  if (!isMarkdown) return null;
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return null;
}

/**
 * Extract date from filename
 */
export function extractDateFromFilename(filename) {
  const basename = path.basename(filename);
  const dateMatch = basename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return dateMatch[1];
  return null;
}

/**
 * Check if birthtime is valid
 */
function isValidBirthtime(stats) {
  const birthtime = stats.birthtime.getTime();
  const ctime = stats.ctime.getTime();
  const mtime = stats.mtime.getTime();

  if (birthtime <= 0) return false;
  if (birthtime === ctime) return false;
  if (birthtime > mtime) return false;

  return true;
}

/**
 * Process page metadata with MINIMAL intervention
 * Only fixes what would break the system, preserves everything else
 */
export function processPageMetadata(content, filename, frontMatter, isMarkdown, fullPath, siteConfig = {}) {
  const stats = fs.statSync(fullPath);

  // ========================================================================
  // TITLE EXTRACTION - Preserve original as much as possible
  // ========================================================================

  let title = frontMatter.title;

  // Layer 1: Extract from content (markdown H1)
  if (!title && isMarkdown) {
    title = extractTitleFromContent(content, isMarkdown);
  }

  // Layer 2: Use filename AS-IS (keep dates, dashes, everything)
  if (!title) {
    const basename = path.basename(filename);

    // Only strip extension - KEEP EVERYTHING ELSE
    title = basename.replace(/\.(md|txt|html)$/, '');
  }

  // Layer 3: Fallback for truly broken cases
  if (!title || title.trim().length === 0) {
    // Generate unique identifier for completely empty filenames
    const pathHash = crypto.createHash('md5')
      .update(fullPath)
      .digest('hex')
      .substring(0, 8);

    title = `untitled-${pathHash}`;
    console.log(warning(`File has no name: ${fullPath} → Generated: ${title}`));
  }

  // ========================================================================
  // DATE EXTRACTION (unchanged, this part is fine)
  // ========================================================================

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

/**
 * Extract taxonomies from front-matter
 */
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

/**
 * Generate URL from relative path
 */
export function generateUrl(relativePath) {
  let url = relativePath.replace(/\.(md|txt|html)$/, '');
  url = url.replace(/\/index$/, '');
  return '/' + url + (url ? '/' : '');
}

// ============================================================================
// MAIN CONTENT PROCESSOR
// ============================================================================

/**
 * Process a single content file
 *
 * Protected spread implementation
 * - Reserved fields (slug, url, title, etc.) are set first
 * - Custom front-matter fields are filtered to exclude reserved names
 * - Safe custom fields are spread at the root level for template access
 */
export function processContentFile(fullPath, relativePath, mode, contentDir, siteConfig = {}, cachedContent = null) {
  const ext = path.extname(fullPath).toLowerCase();
  const isMarkdown = ext === '.md';
  const isHtml = ext === '.html';
  // Note: isText removed - was unused, both .txt and .md go through same processing

  const webPath = normalizeToWebPath(relativePath);

  // ========================================================================
  // HTML FILES
  // ========================================================================
  if (isHtml) {
    const rawHtml = fs.readFileSync(fullPath, 'utf-8');
    const { data: frontMatter, content: htmlContent } = matter(rawHtml);

    if (frontMatter.draft === true) {
      return null;
    }

    let url;
    if (frontMatter.permalink) {
      url = frontMatter.permalink;
      if (!url.startsWith('/')) url = '/' + url;
      if (!url.endsWith('/')) url = url + '/';
      console.log(dim(`Using permalink: ${url} (${relativePath})`));
    } else {
      url = generateUrl(webPath);
    }

    const slug = url.substring(1).replace(/\/$/, '') || 'index';

    const intent = detectHtmlIntent(htmlContent, frontMatter);

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

    const taxonomies = extractTaxonomies(frontMatter);

    // UNIFIED: Use processPageMetadata for HTML files too (consistency with MD/TXT)
    const { title, createdAt, updatedAt, wordCount, readingTime } = processPageMetadata(
      htmlContent,
      path.basename(fullPath),
      frontMatter,
      false,  // isMarkdown = false for HTML
      fullPath,
      siteConfig
    );

    // Filter custom fields to exclude reserved names
    const safeCustomFields = {};
    for (const [key, value] of Object.entries(frontMatter)) {
      if (!RESERVED_FIELDS.has(key)) {
        safeCustomFields[key] = value;
      }
    }

    return {
      slug,
      entry: {
        filename: webPath,
        slug: slug,
        url: url,
        title: title,  // Now uses 4-layer fallback with hash
        date: createdAt,  // Now extracts from filename
        createdAt: createdAt,
        updatedAt: updatedAt,
        tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []),
        description: frontMatter.description || '',
        html: htmlContent,
        renderedHtml: intent.mode === 'raw' ? htmlContent : null,
        relativePath: webPath,
        ogImage: frontMatter.image || null,
        type: 'html',
        wordCount: wordCount,  // Now calculated
        readingTime: readingTime,  // Now calculated
        section: section,
        toc: toc,
        headings: headings,
        categories: taxonomies.categories,
        series: taxonomies.series,

        // Safe custom fields spread to root level
        ...safeCustomFields
      },
      imageReferences: []
    };
  }

  // ========================================================================
  // MARKDOWN/TEXT FILES
  // ========================================================================
  const rawContent = cachedContent || fs.readFileSync(fullPath, 'utf-8');
  const { data: frontMatter, content } = matter(rawContent);

  if (frontMatter.draft === true) {
    return null;
  }

  let url;
  if (frontMatter.permalink) {
    url = frontMatter.permalink;
    if (!url.startsWith('/')) url = '/' + url;
    if (!url.endsWith('/')) url = url + '/';
    console.log(dim(`Using permalink: ${url} (${relativePath})`));
  } else {
    url = generateUrl(webPath);
  }

  const slug = url.substring(1).replace(/\/$/, '') || 'index';

  const env = {
    pageRelativePath: webPath,
    referencedImages: [],
    contentDir: contentDir,
    headings: [],
    imageDimensionsCache: siteConfig._imageDimensionsCache || new Map()
  };

  const renderedHtml = isMarkdown
    ? md.render(content, env)
    : siteConfig.escapeTextFiles !== false
      ? `<pre>${escapeHtml(content)}</pre>`
      : `<pre>${content}</pre>`;

  const { title, createdAt, updatedAt, wordCount, readingTime } = processPageMetadata(
    content,
    path.basename(fullPath),
    frontMatter,
    isMarkdown,
    fullPath,
    siteConfig
  );

  const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []);
  const description = frontMatter.description || '';

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

  const taxonomies = extractTaxonomies(frontMatter);

  // Filter custom fields to exclude reserved names
  const safeCustomFields = {};
  for (const [key, value] of Object.entries(frontMatter)) {
    if (!RESERVED_FIELDS.has(key)) {
      safeCustomFields[key] = value;
    }
  }

  return {
    slug,
    entry: {
      filename: webPath,
      slug: slug,
      url: url,
      title: title,
      date: createdAt,
      createdAt: createdAt,
      updatedAt: updatedAt,
      tags: tags,
      description: description,
      html: renderedHtml,
      rawContent: content,
      relativePath: webPath,
      ogImage: ogImage,
      wordCount: wordCount,
      readingTime: readingTime,
      section: section,
      type: isMarkdown ? 'markdown' : 'text',
      toc: toc,
      headings: env.headings,
      categories: taxonomies.categories,
      series: taxonomies.series,

      // Safe custom fields spread to root level
      ...safeCustomFields
    },
    imageReferences: env.referencedImages
  };
}

// ============================================================================
// CONTENT STRUCTURE DETECTION
// ============================================================================

/**
 * Detect content structure and determine mode
 * Now accepts explicit mode from CLI intent system
 */
// export function detectContentStructure(workingDir, options = {}) {
//   const {
//     cliContentDir = null,
//     cliSkipDirs = null,
//     intentMode = null,
//     intentContentRoot = null
//   } = options;

//   console.log(dim(`Detecting content structure in: ${workingDir}`));

//   // ========================================================================
//   // PRIORITY 1: Intent system override
//   // If CLI has already determined mode and contentRoot, use it directly
//   // ========================================================================
//   if (intentMode && intentContentRoot) {
//     console.log(info(`Using intent-determined mode: ${intentMode}`));
//     console.log(info(`Content root: ${intentContentRoot}`));

//     return {
//       contentRoot: intentContentRoot,
//       mode: intentMode,
//       shouldInit: false
//     };
//   }

//   // ========================================================================
//   // PRIORITY 2: Check config.json for custom contentDir
//   // ========================================================================
//   let config = {};
//   try {
//     const configPath = path.join(workingDir, 'config.json');
//     if (fs.existsSync(configPath)) {
//       config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

//       if (config.contentDir) {
//         const customContentDir = path.join(workingDir, config.contentDir);

//         if (fs.existsSync(customContentDir)) {
//           console.log(success(`Using custom content directory from config: ${config.contentDir}/`));

//           return {
//             contentRoot: customContentDir,
//             mode: 'viewer',
//             customDir: config.contentDir
//           };
//         } else {
//           console.log(warning(`Config specifies contentDir "${config.contentDir}" but directory not found`));
//         }
//       }
//     }
//   } catch (error) {
//     // No config file or parse error - continue
//   }

//   // ========================================================================
//   // PRIORITY 3: Check for CLI --content-dir flag
//   // ========================================================================
//   if (cliContentDir) {
//     const cliContentPath = path.join(workingDir, cliContentDir);

//     if (fs.existsSync(cliContentPath)) {
//       console.log(success(`Using content directory from --content-dir flag: ${cliContentDir}/`));

//       return {
//         contentRoot: cliContentPath,
//         mode: 'viewer'
//       };
//     } else {
//       console.log(warning(`CLI flag --content-dir "${cliContentDir}" specified but directory not found`));
//     }
//   }

//   // ========================================================================
//   // PRIORITY 4: Check for default content/ directory
//   // ========================================================================
//   const defaultContentDir = path.join(workingDir, 'content');
//   if (fs.existsSync(defaultContentDir) && fs.statSync(defaultContentDir).isDirectory()) {
//     console.log(success('Found content/ directory'));

//     return {
//       contentRoot: defaultContentDir,
//       mode: 'viewer'
//     };
//   }

//   // ========================================================================
//   // PRIORITY 5: Build skip directory list
//   // ========================================================================
//   let skipDirs = [...DEFAULT_SKIP_DIRS.filter(d => d !== 'templates')];

//   if (cliSkipDirs) {
//     skipDirs = [...skipDirs, ...cliSkipDirs];
//   }

//   if (config.skipDirs && Array.isArray(config.skipDirs)) {
//     skipDirs = [...skipDirs, ...config.skipDirs];
//   }

//   skipDirs = [...new Set(skipDirs)];

//   const hasSkippedDirs = skipDirs.some(dir => {
//     const dirPath = path.join(workingDir, dir);
//     return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
//   });

//   // ========================================================================
//   // PRIORITY 6: Check for root content files
//   // ========================================================================
//   try {
//     const files = fs.readdirSync(workingDir);
//     const contentFiles = files.filter(f => {
//       if (shouldIgnore(f)) return false;
//       const fullPath = path.join(workingDir, f);
//       try {
//         if (!fs.statSync(fullPath).isFile()) return false;
//       } catch {
//         return false;
//       }
//       return /\.(md|txt|html)$/i.test(f);
//     });

//     if (contentFiles.length > 0) {
//       console.log(success(`Found ${contentFiles.length} content file(s) in root`));
//       console.log(info('Using root directory as content (viewer mode)'));
//       console.log(dim('Tip: Create content/ folder for organized projects'));

//       return {
//         contentRoot: workingDir,
//         mode: 'viewer',
//         rootContent: true
//       };
//     }
//   } catch (error) {
//     console.log(warning(`Could not scan root directory: ${error.message}`));
//   }

//   // ========================================================================
//   // PRIORITY 7: No content found - needs initialization
//   // ========================================================================
//   if (hasSkippedDirs) {
//     const detectedDirs = skipDirs
//       .filter(dir => fs.existsSync(path.join(workingDir, dir)))
//       .slice(0, 3);

//     console.log(warning(`Development folders detected: ${detectedDirs.join(', ')}`));
//     console.log(info('Content should be in content/ or set contentDir in config.json'));
//   }

//   console.log(warning('No content directory or files found'));
//   console.log(info('Will initialize project structure'));

//   return {
//     contentRoot: defaultContentDir,
//     mode: 'project',
//     shouldInit: true
//   };
// }
// PROPERLY CORRECTED VERSION of detectContentStructure()
// Replace lines 862-1018 in content-processor.js with this

export function detectContentStructure(workingDir, options = {}) {
  const {
    cliContentDir = null,
    cliSkipDirs = null,
    intentMode = null,
    intentContentRoot = null
  } = options;

  console.log(dim(`Detecting content structure in: ${workingDir}`));

  // ========================================================================
  // PRIORITY 1: Intent system override
  // ========================================================================
  if (intentMode && intentContentRoot) {
    console.log(info(`Using intent-determined mode: ${intentMode}`));
    console.log(info(`Content root: ${intentContentRoot}`));

    return {
      contentRoot: intentContentRoot,
      mode: intentMode,
      shouldInit: false
    };
  }

  // ========================================================================
  // PRIORITY 2: Check for root content files (IMPROVED WITH DEV PROJECT DETECTION)
  // ========================================================================
  // ONLY use root as content if:
  // 1. It has content files OR content subdirs (pages/, docs/, etc.)
  // 2. AND it's NOT a development project (no node_modules/, package.json, etc.)
  // 3. AND it doesn't already have a content/ subdirectory
  try {
    const entries = fs.readdirSync(workingDir);

    // Check if this is a development project (DON'T use as content!)
    const isDevelopmentProject = entries.some(e => {
      return ['node_modules', 'package.json', 'package-lock.json', 'bun.lock',
              '.git', 'tsconfig.json', 'vite.config.js', 'webpack.config.js'].includes(e);
    });

    // Check if content/ subdirectory already exists (use that instead!)
    const hasContentSubdir = entries.includes('content') &&
                              fs.statSync(path.join(workingDir, 'content')).isDirectory();

    // Only proceed if NOT a dev project AND no content/ subdir
    if (!isDevelopmentProject && !hasContentSubdir) {
      // Check for content files directly in root
      const contentFiles = entries.filter(f => {
        if (shouldIgnore(f)) return false;
        const fullPath = path.join(workingDir, f);
        try {
          if (!fs.statSync(fullPath).isFile()) return false;
        } catch {
          return false;
        }
        return /\.(md|txt|html)$/i.test(f);
      });

      // Check for common content subdirectory patterns
      const hasContentDirs = entries.some(e => {
        const fullPath = path.join(workingDir, e);
        try {
          return fs.statSync(fullPath).isDirectory() &&
                 ['pages', 'docs', 'posts', 'articles', 'guides', 'blog'].includes(e.toLowerCase());
        } catch {
          return false;
        }
      });

      // Return if EITHER files OR content subdirs are found
      if (contentFiles.length > 0 || hasContentDirs) {
        if (contentFiles.length > 0) {
          console.log(success(`Found ${contentFiles.length} content file(s) in root`));
        }
        if (hasContentDirs) {
          console.log(success('Folder contains content files'));
        }
        console.log(info('Using root directory as content (viewer mode)'));

        return {
          contentRoot: workingDir,
          mode: 'viewer',
          rootContent: true
        };
      }
    }
  } catch (error) {
    console.log(warning(`Could not scan root directory: ${error.message}`));
  }

  // ========================================================================
  // PRIORITY 3: Check config.json for custom contentDir
  // ========================================================================
  let config = {};
  try {
    const configPath = path.join(workingDir, 'config.json');
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      if (config.contentDir) {
        const customContentDir = path.join(workingDir, config.contentDir);

        if (fs.existsSync(customContentDir)) {
          console.log(success(`Using custom content directory from config: ${config.contentDir}/`));

          return {
            contentRoot: customContentDir,
            mode: 'viewer',
            customDir: config.contentDir
          };
        } else {
          console.log(warning(`Config specifies contentDir "${config.contentDir}" but directory not found`));
        }
      }
    }
  } catch (error) {
    // No config file or parse error - continue
  }

  // ========================================================================
  // PRIORITY 4: Check for CLI --content-dir flag
  // ========================================================================
  if (cliContentDir) {
    const cliContentPath = path.join(workingDir, cliContentDir);

    if (fs.existsSync(cliContentPath)) {
      console.log(success(`Using content directory from --content-dir flag: ${cliContentDir}/`));

      return {
        contentRoot: cliContentPath,
        mode: 'viewer'
      };
    } else {
      console.log(warning(`CLI flag --content-dir "${cliContentDir}" specified but directory not found`));
    }
  }

  // ========================================================================
  // PRIORITY 5: Check for default content/ directory
  // ========================================================================
  const defaultContentDir = path.join(workingDir, 'content');
  if (fs.existsSync(defaultContentDir) && fs.statSync(defaultContentDir).isDirectory()) {
    console.log(success('Found content/ directory'));

    return {
      contentRoot: defaultContentDir,
      mode: 'viewer'
    };
  }

  // ========================================================================
  // PRIORITY 6: Build skip directory list
  // ========================================================================
  let skipDirs = [...DEFAULT_SKIP_DIRS.filter(d => d !== 'templates')];

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

  // ========================================================================
  // PRIORITY 7: No content found - needs initialization
  // ========================================================================
  if (hasSkippedDirs) {
    const detectedDirs = skipDirs
      .filter(dir => fs.existsSync(path.join(workingDir, dir)))
      .slice(0, 3);

    console.log(warning(`Development folders detected: ${detectedDirs.join(', ')}`));
    console.log(info('Content should be in content/ or set contentDir in config.json'));
  }

  console.log(warning('No content directory or files found'));
  console.log(info('Will initialize project structure'));

  return {
    contentRoot: defaultContentDir,
    mode: 'project',
    shouldInit: true
  };
}

// ============================================================================
// NAVIGATION TREE
// ============================================================================

/**
 * Build navigation tree with MINIMAL intervention
 * Only handles cases that would break path resolution or cause security issues
 */
export function buildNavigationTree(contentRoot, contentCache = new Map(), mode = 'structured') {
  if (mode === 'flat') return [];

  const map = new Map();

  // Initialize root node
  map.set('.', { children: [] });

  /**
   * Minimal folder name processing
   * Only fixes path-breaking cases (., .., empty)
   */
  function safeFolderName(part, fullPath) {
    // Security: Block path traversal
    if (part === '.' || part === '..') {
      const pathHash = crypto.createHash('md5')
        .update(fullPath)
        .digest('hex')
        .substring(0, 8);

      console.log(errorMsg(`Folder name is path traversal character: ${fullPath}`));
      return `folder-${pathHash}`;
    }

    // Handle empty strings
    if (!part || part.trim().length === 0) {
      const pathHash = crypto.createHash('md5')
        .update(fullPath)
        .digest('hex')
        .substring(0, 8);

      console.log(warning(`Folder has no name: ${fullPath}`));
      return `folder-${pathHash}`;
    }

    // OTHERWISE: Keep as-is (dates, dashes, everything)
    return part;
  }

  /**
   * Minimal file title processing
   * Just ensures we have SOMETHING to display
   */
  function safeFileTitle(entry, filename) {
    // Use entry's title (already processed by processPageMetadata)
    if (entry.title && entry.title.trim().length > 0) {
      return entry.title;
    }

    // Use filename as-is
    if (filename && filename.trim().length > 0) {
      return path.basename(filename);
    }

    // Fallback for completely broken entries
    const pathHash = crypto.createHash('md5')
      .update(entry.url || filename || entry.slug)
      .digest('hex')
      .substring(0, 8);

    console.log(errorMsg(`Entry has no identifiable name: ${entry.slug}`));
    return `untitled-${pathHash}`;
  }

  // ========================================================================
  // BUILD DIRECTORY STRUCTURE
  // ========================================================================

  for (const [slug, entry] of contentCache) {
    if (slug === 'index') continue;

    // Validate entry has filename
    if (!entry.filename) {
      console.log(warning(`Entry "${slug}" has no filename, skipping navigation`));
      continue;
    }

    const dir = path.dirname(entry.filename);
    const parts = dir.split(path.sep).filter(p => p && p !== '.');

    let currentPath = '.';

    // Ensure parent folders exist
    for (const part of parts) {
      if (!part) continue;

      const parentPath = currentPath;
      currentPath = currentPath === '.' ? part : path.join(currentPath, part);

      if (!map.has(currentPath)) {
        const folderFullPath = path.join(contentRoot, currentPath);

        const folderNode = {
          title: safeFolderName(part, folderFullPath),  // MINIMAL processing
          url: null,
          children: [],
          type: 'folder',
          path: currentPath
        };

        map.set(currentPath, folderNode);

        const parent = map.get(parentPath);
        if (parent) {
          parent.children.push(folderNode);
        }
      }
    }

    // ========================================================================
    // ADD FILE NODE
    // ========================================================================

    const fileNode = {
      title: safeFileTitle(entry, entry.filename),
      url: entry.url,
      active: false,
      type: 'file'
    };

    const parentNode = map.get(dir);
    if (parentNode) {
      parentNode.children.push(fileNode);
    } else {
      const rootNode = map.get('.');
      if (rootNode) {
        rootNode.children.push(fileNode);
      }
    }
  }

  // Return the root node's children (where all top-level items are stored)
  const rootNode = map.get('.');
  return rootNode ? rootNode.children : [];
}

// ============================================================================
// CONTENT LOADER
// ============================================================================

/**
 * Load all content from directory
 */
export function loadAllContent(options = {}) {
  const workingDir = process.cwd();
  const { contentRoot, mode, shouldInit } = detectContentStructure(workingDir, options);

  // Shadow caches (don't mutate globals until success)
  const newContentCache = new Map();
  const newSlugMap = new Map();
  const newImageReferences = new Map();
  const newBrokenImages = [];
  const newImageDimensionsCache = new Map();

  console.log(dim(`Content mode: ${mode}`));
  console.log(dim(`Contents root: ${contentRoot}`));

  if (shouldInit) {
    console.log(info('No content found, will initialize on first run'));
    return {
      contentCache: newContentCache,
      slugMap: newSlugMap,
      navigation: [],
      imageReferences: newImageReferences,
      brokenImages: newBrokenImages,
      imageDimensionsCache: newImageDimensionsCache,
      mode,
      contentRoot
    };
  }

  if (!fs.existsSync(contentRoot)) {
    console.log(warning(`Contents directory not found: ${contentRoot}`));
    return {
      contentCache: newContentCache,
      slugMap: newSlugMap,
      navigation: [],
      imageReferences: newImageReferences,
      brokenImages: newBrokenImages,
      imageDimensionsCache: newImageDimensionsCache,
      mode,
      contentRoot
    };
  }

  const siteConfig = getSiteConfig();

  /**
   * Pre-scan markdown images to get dimensions
   */
  async function preScanImageDimensions(content, relativePath) {
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
        const pageDir = path.dirname(path.join(contentRoot, relativePath));
        resolvedImagePath = path.resolve(pageDir, src);
      } else {
        const pageDir = path.dirname(path.join(contentRoot, relativePath));
        resolvedImagePath = path.resolve(pageDir, src);
      }

      if (fs.existsSync(resolvedImagePath) && !newImageDimensionsCache.has(resolvedImagePath)) {
        try {
          const buffer = await fs.promises.readFile(resolvedImagePath);
          const meta = await sharp(buffer).metadata();
          newImageDimensionsCache.set(resolvedImagePath, meta.width);
        } catch (error) {
          // Ignore errors
        }
      }
    }
  }

  /**
   * Recursively load content from directory
   */
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
          console.log(dim(`Consider using drafts/ folder or draft: true in front matter`));
        }

        try {
          const ext = path.extname(entry.name).toLowerCase();
          const isMarkdown = ext === '.md';

          let cachedContent = null;
          if (isMarkdown) {
            cachedContent = fs.readFileSync(fullPath, 'utf-8');
            const { content } = matter(cachedContent);
            preScanImageDimensions(content, webPath);
          }

          // Pass the shared imageDimensionsCache to config
          siteConfig._imageDimensionsCache = newImageDimensionsCache;

          const result = processContentFile(fullPath, relPath, mode, contentRoot, siteConfig, cachedContent);

          if (!result) continue;

          if (newSlugMap.has(result.slug)) {
            const existingPath = newSlugMap.get(result.slug);
            console.error(errorMsg(`Duplicate URL detected: ${result.entry.url}`));
            console.log(dim(`Used in: ${webPath}`));
            console.log(dim(`Already used in: ${existingPath}`));

            if (process.env.THYPRESS_MODE === 'dynamic') {
              console.log(warning(`Skipping duplicate in dynamic mode: ${webPath}`));
              continue;
            } else {
              console.error(errorMsg('Exiting due to duplicate URL in build mode'));
              process.exit(1);
            }
          }

          newContentCache.set(result.slug, result.entry);
          newSlugMap.set(webPath, result.slug);

          if (result.imageReferences.length > 0) {
            newImageReferences.set(webPath, result.imageReferences);

            for (const img of result.imageReferences) {
              if (!fs.existsSync(img.resolvedPath)) {
                newBrokenImages.push({
                  post: webPath,
                  src: img.src,
                  resolvedPath: img.resolvedPath
                });

                if (siteConfig.strictImages === true) {
                  console.error(errorMsg(`Broken image in ${webPath}: ${img.src}`));
                  console.log(dim(`Expected path: ${img.resolvedPath}`));
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
    console.log(success(`Loaded ${newContentCache.size} entry files`));
  } catch (error) {
    console.error(`Error reading content directory: ${error.message}`);
    return {
      contentCache: new Map(),
      slugMap: new Map(),
      navigation: [],
      imageReferences: new Map(),
      brokenImages: [],
      imageDimensionsCache: new Map(),
      mode,
      contentRoot
    };
  }

  const navigation = buildNavigationTree(contentRoot, newContentCache, mode);

  return {
    contentCache: newContentCache,
    slugMap: newSlugMap,
    navigation,
    imageReferences: newImageReferences,
    brokenImages: newBrokenImages,
    imageDimensionsCache: newImageDimensionsCache,
    mode,
    contentRoot
  };
}
