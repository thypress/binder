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
import { success, error as errorMsg, warning, info, dim } from './utils/colors.js';

const md = new MarkdownIt();
md.use(markdownItHighlight);
md.use(markdownItAnchor, {
  permalink: false,
  slugify: (s) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
});

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const POSTS_PER_PAGE = 10;
const STANDARD_IMAGE_SIZES = [400, 800, 1200];

// Cache navigation hash for incremental rebuilds
let navigationHash = null;

// Register Handlebars helpers
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('multiply', (a, b) => a * b);

// Helper for rendering navigation tree with <details> tags
Handlebars.registerHelper('navigationTree', function(nav) {
  if (!nav || nav.length === 0) return '';

  function renderTree(items, level = 0) {
    let html = '';

    for (const item of items) {
      if (item.type === 'folder') {
        html += `<details open>\n`;
        html += `  <summary>${Handlebars.escapeExpression(item.title)}</summary>\n`;
        html += `  <ul>\n`;
        html += renderTree(item.children, level + 1);
        html += `  </ul>\n`;
        html += `</details>\n`;
      } else if (item.type === 'file') {
        html += `<li><a href="/post/${item.slug}/">${Handlebars.escapeExpression(item.title)}</a></li>\n`;
      }
    }

    return html;
  }

  return new Handlebars.SafeString(renderTree(nav));
});

export function slugify(str) {
  // Always use forward slashes for URLs (web standard)
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^\w./-]/g, '');
}

// Normalize path to web format (forward slashes) - EXPORTED for reuse
export function normalizeToWebPath(filePath) {
  // Convert OS-specific path separators to forward slashes
  return filePath.split(path.sep).join('/');
}

// Calculate reading time and word count
function calculateReadingStats(content) {
  // Strip markdown syntax for accurate word count
  const plainText = content
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // Keep link text only
    .replace(/[#*`_~]/g, '') // Remove markdown syntax
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  const words = plainText.split(/\s+/).filter(w => w.length > 0).length;
  const readingTime = Math.ceil(words / 200); // 200 WPM

  return { wordCount: words, readingTime };
}

// Extract title from H1 heading - EXPORTED for reuse
export function extractTitleFromContent(content, isMarkdown) {
  if (!isMarkdown) {
    return null; // Don't parse markdown syntax in .txt files
  }

  // Try to find first H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  return null;
}

// Extract date from filename - EXPORTED for reuse
export function extractDateFromFilename(filename) {
  // Try to extract date from filename (YYYY-MM-DD format)
  const basename = path.basename(filename);
  const dateMatch = basename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    return dateMatch[1];
  }
  return null;
}

/**
 * Validate birthtime - check if it's a real creation time or fallback value
 * Returns true if birthtime is valid and reliable
 */
function isValidBirthtime(stats) {
  const birthtime = stats.birthtime.getTime();
  const ctime = stats.ctime.getTime();
  const mtime = stats.mtime.getTime();

  // Check 1: Not Unix epoch (Jan 1, 1970)
  if (birthtime <= 0) return false;

  // Check 2: Not same as ctime (indicates FS doesn't support birthtime)
  // Some filesystems return ctime as birthtime when birthtime is unavailable
  if (birthtime === ctime) return false;

  // Check 3: Birthtime shouldn't be after mtime (sanity check)
  if (birthtime > mtime) return false;

  return true;
}

/**
 * Process post metadata (title, dates, reading stats) with smart fallbacks
 * Single source of truth for metadata extraction - used by both initial load and hot reload
 *
 * @param {string} content - Post content (markdown or plain text)
 * @param {string} filename - Filename (can be full path or basename)
 * @param {object} frontMatter - Parsed YAML front matter
 * @param {boolean} isMarkdown - Whether file is markdown
 * @param {string} fullPath - Full filesystem path for stat reading
 * @returns {object} - { title, createdAt, updatedAt, wordCount, readingTime }
 */
export function processPostMetadata(content, filename, frontMatter, isMarkdown, fullPath) {
  // Get file stats for date extraction
  const stats = fs.statSync(fullPath);

  // Title extraction with fallback chain
  let title = frontMatter.title;

  if (!title) {
    // Try to extract from first H1 heading
    title = extractTitleFromContent(content, isMarkdown);
  }

  if (!title) {
    // Use filename without date prefix (basename only!)
    const basename = path.basename(filename);
    title = basename
      .replace(/\.(md|txt)$/, '')
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')
      .replace(/[-_]/g, ' ')
      .trim();
  }

  if (!title) {
    // Fallback to raw filename
    title = path.basename(filename).replace(/\.(md|txt)$/, '');
  }

  // createdAt extraction with fallback chain
  let createdAt = frontMatter.createdAt || frontMatter.date;

  if (!createdAt) {
    // Try filename date prefix
    createdAt = extractDateFromFilename(filename);
  }

  if (!createdAt) {
    // Try birthtime if valid and reliable
    if (isValidBirthtime(stats)) {
      createdAt = stats.birthtime.toISOString().split('T')[0];
    }
  }

  if (!createdAt) {
    // Ultimate fallback to mtime
    createdAt = stats.mtime.toISOString().split('T')[0];
  }

  // updatedAt extraction with fallback chain
  let updatedAt = frontMatter.updatedAt || frontMatter.updated;

  if (!updatedAt) {
    // Use mtime as default for updatedAt
    updatedAt = stats.mtime.toISOString().split('T')[0];
  }

  // Normalize date formats
  if (createdAt instanceof Date) {
    createdAt = createdAt.toISOString().split('T')[0];
  }

  if (updatedAt instanceof Date) {
    updatedAt = updatedAt.toISOString().split('T')[0];
  }

  // Calculate reading stats
  const { wordCount, readingTime } = calculateReadingStats(content);

  return { title, createdAt, updatedAt, wordCount, readingTime };
}

// Custom markdown-it renderer for optimized images with context awareness
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

    // Only optimize local images
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
      return defaultRender(tokens, idx, options, env, self);
    }

    // Get the context from env (post's relative path)
    const postRelativePath = env.postRelativePath || '';
    const postsDir = process.env.THYPRESS_POSTS_DIR || path.join(__dirname, '../posts');

    // Resolve the image path relative to the post
    let resolvedImagePath;
    let outputImagePath;

    if (src.startsWith('/')) {
      // Absolute path from posts root
      resolvedImagePath = path.join(postsDir, src.substring(1));
      outputImagePath = src.substring(1);
    } else if (src.startsWith('./') || src.startsWith('../')) {
      // Relative path to post file
      const postDir = path.dirname(path.join(postsDir, postRelativePath));
      resolvedImagePath = path.resolve(postDir, src);
      // Calculate relative path from posts root
      outputImagePath = path.relative(postsDir, resolvedImagePath);
    } else {
      // Simple filename or path like "img/photo.png"
      const postDir = path.dirname(path.join(postsDir, postRelativePath));
      resolvedImagePath = path.resolve(postDir, src);
      outputImagePath = path.relative(postsDir, resolvedImagePath);
    }

    // Normalize path separators to forward slashes for web
    outputImagePath = normalizeToWebPath(outputImagePath);

    // Extract filename without extension
    const basename = path.basename(resolvedImagePath, path.extname(resolvedImagePath));
    const outputDir = path.dirname(outputImagePath);

    // Create hash from the resolved path for uniqueness
    const hash = crypto.createHash('md5').update(resolvedImagePath).digest('hex').substring(0, 8);

    // Generate the output URL path (relative to /post/ output directory)
    const urlBase = outputDir === '.' ? '' : `${outputDir}/`;

    // Determine actual sizes to generate based on image dimensions
    let sizesToGenerate = [...STANDARD_IMAGE_SIZES];

    // Check if dimensions are cached
    const imageDimensionsCache = env.imageDimensionsCache || new Map();
    const originalWidth = imageDimensionsCache.get(resolvedImagePath);

    if (originalWidth) {
      // Filter sizes smaller than original
      sizesToGenerate = STANDARD_IMAGE_SIZES.filter(size => size < originalWidth);

      // Add original size if not already present
      if (!sizesToGenerate.includes(originalWidth)) {
        sizesToGenerate.push(originalWidth);
      }
      sizesToGenerate.sort((a, b) => a - b);
    }

    // Store image reference for collection during scanning phase
    if (!env.referencedImages) env.referencedImages = [];
    env.referencedImages.push({
      src,
      resolvedPath: resolvedImagePath,
      outputPath: outputImagePath,
      basename,
      hash,
      urlBase,
      sizesToGenerate // Store actual sizes to generate
    });

    // Generate responsive picture element with actual sizes
    return `<picture>
  <source
    srcset="${sizesToGenerate.map(size => `/post/${urlBase}${basename}-${size}-${hash}.webp ${size}w`).join(', ')}"
    type="image/webp"
    sizes="(max-width: ${sizesToGenerate[0]}px) ${sizesToGenerate[0]}px, (max-width: ${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}px) ${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}px, ${sizesToGenerate[sizesToGenerate.length - 1]}px">
  <source
    srcset="${sizesToGenerate.map(size => `/post/${urlBase}${basename}-${size}-${hash}.jpg ${size}w`).join(', ')}"
    type="image/jpeg"
    sizes="(max-width: ${sizesToGenerate[0]}px) ${sizesToGenerate[0]}px, (max-width: ${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}px) ${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}px, ${sizesToGenerate[sizesToGenerate.length - 1]}px">
  <img
    src="/post/${urlBase}${basename}-${sizesToGenerate[Math.floor(sizesToGenerate.length / 2)]}-${hash}.jpg"
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

  // If sizes not provided, determine from image dimensions
  if (!sizesToGenerate || sizesToGenerate.length === 0) {
    try {
      const metadata = await sharp(imagePath).metadata();
      const originalWidth = metadata.width;

      // Filter standard sizes smaller than original
      sizesToGenerate = STANDARD_IMAGE_SIZES.filter(size => size < originalWidth);

      // Add original size if not present
      if (!sizesToGenerate.includes(originalWidth)) {
        sizesToGenerate.push(originalWidth);
      }
      sizesToGenerate.sort((a, b) => a - b);
    } catch (error) {
      // Fallback to standard sizes
      sizesToGenerate = STANDARD_IMAGE_SIZES;
    }
  }

  const optimized = [];

  try {
    for (const size of sizesToGenerate) {
      // Generate WebP
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

      // Generate optimized JPEG as fallback
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

export function buildNavigationTree(postsDir, postsCache = new Map()) {
  const navigation = [];

  function processDirectory(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // Use path.join then normalize to web path (forward slashes)
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const webPath = normalizeToWebPath(relPath);

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
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        const slug = slugify(webPath.replace(/\.(md|txt)$/, ''));

        let title;
        const post = postsCache.get(slug);
        if (post && post.title) {
          title = post.title;
        } else {
          title = entry.name
            .replace(/\.(md|txt)$/, '')
            .replace(/^\d{4}-\d{2}-\d{2}-/, '')
            .replace(/-/g, ' ');
        }

        items.push({
          type: 'file',
          name: entry.name,
          title: title,
          slug: slug,
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

  return processDirectory(postsDir);
}

export function loadAllPosts() {
  const postsCache = new Map();
  const slugMap = new Map();
  const imageReferences = new Map();
  const brokenImages = [];
  const imageDimensionsCache = new Map(); // Cache for image dimensions

  const postsDir = process.env.THYPRESS_POSTS_DIR || path.join(__dirname, '../posts');

  // SYNCHRONOUS pre-scan of image dimensions (FIXED)
  function preScanImageDimensions(content, relativePath) {
    const imageMatches = content.matchAll(/!\[.*?\]\((.*?)\)/g);

    for (const match of imageMatches) {
      const src = match[1];

      // Skip external images
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
        continue;
      }

      // Resolve image path
      let resolvedImagePath;
      if (src.startsWith('/')) {
        resolvedImagePath = path.join(postsDir, src.substring(1));
      } else if (src.startsWith('./') || src.startsWith('../')) {
        const postDir = path.dirname(path.join(postsDir, relativePath));
        resolvedImagePath = path.resolve(postDir, src);
      } else {
        const postDir = path.dirname(path.join(postsDir, relativePath));
        resolvedImagePath = path.resolve(postDir, src);
      }

      // Read dimensions SYNCHRONOUSLY if file exists and not already cached
      if (fs.existsSync(resolvedImagePath) && !imageDimensionsCache.has(resolvedImagePath)) {
        try {
          // Use sharp's sync buffer reading for immediate dimensions
          const buffer = fs.readFileSync(resolvedImagePath);
          const metadata = sharp(buffer).metadata();
          // Sharp metadata returns a promise, but we can use sync approach
          sharp(buffer).metadata().then(meta => {
            imageDimensionsCache.set(resolvedImagePath, meta.width);
          }).catch(() => {
            // Skip if can't read dimensions
          });
        } catch (error) {
          // Skip if can't read dimensions
        }
      }
    }
  }

  function loadPostsFromDir(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // Build path using path.join (OS-specific)
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      // Convert to web path (forward slashes) for slug
      const webPath = normalizeToWebPath(relPath);

      if (entry.isDirectory()) {
        loadPostsFromDir(fullPath, relPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        try {
          const isMarkdown = entry.name.endsWith('.md');
          const slug = slugify(webPath.replace(/\.(md|txt)$/, ''));
          slugMap.set(webPath, slug); // Store with web path

          const rawContent = fs.readFileSync(fullPath, 'utf-8');
          const { data: frontMatter, content } = matter(rawContent);

          // Pre-scan image dimensions FIRST
          if (isMarkdown) {
            preScanImageDimensions(content, webPath);
          }

          const env = {
            postRelativePath: webPath,
            referencedImages: [],
            imageDimensionsCache // Pass the cache
          };

          const renderedHtml = isMarkdown ? md.render(content, env) : `<pre>${content}</pre>`;

          if (env.referencedImages.length > 0) {
            imageReferences.set(webPath, env.referencedImages);

            for (const img of env.referencedImages) {
              if (!fs.existsSync(img.resolvedPath)) {
                brokenImages.push({
                  post: webPath,
                  src: img.src,
                  resolvedPath: img.resolvedPath
                });
              }
            }
          }

          // Use shared metadata processing function
          const { title, createdAt, updatedAt, wordCount, readingTime } = processPostMetadata(
            content,
            entry.name,
            frontMatter,
            isMarkdown,
            fullPath
          );

          const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []);
          const description = frontMatter.description || '';

          // Extract first image for OG tags (if available)
          let ogImage = frontMatter.image || null;
          if (!ogImage && env.referencedImages.length > 0) {
            // Use first image from post
            const firstImg = env.referencedImages[0];
            // Use middle size for OG image (typically 800px)
            const ogSize = firstImg.sizesToGenerate[Math.floor(firstImg.sizesToGenerate.length / 2)] || 800;
            ogImage = `/post/${firstImg.urlBase}${firstImg.basename}-${ogSize}-${firstImg.hash}.jpg`;
          }

          postsCache.set(slug, {
            filename: webPath,
            slug: slug,
            title: title,
            date: createdAt, // Main date for sorting (backwards compat)
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
            readingTime: readingTime
          });
        } catch (error) {
          console.error(`Error loading post '${webPath}': ${error.message}`);
        }
      }
    }
  }

  try {
    // Load all posts with synchronous dimension pre-scan
    loadPostsFromDir(postsDir);
    console.log(success(`Loaded ${postsCache.size} posts`));
  } catch (error) {
    console.error(`Error reading posts directory: ${error.message}`);
  }

  // Hash-based navigation rebuild
  const newHash = crypto.createHash('md5')
    .update(JSON.stringify(Array.from(postsCache.keys()).sort()))
    .digest('hex');

  let navigation = [];
  if (newHash !== navigationHash) {
    navigation = buildNavigationTree(postsDir, postsCache);
    navigationHash = newHash;
  }

  return { postsCache, slugMap, navigation, imageReferences, brokenImages, imageDimensionsCache };
}

export function loadTemplates() {
  const templatesCache = new Map();
  const assetsDir = path.join(process.cwd(), 'assets');

  try {
    const indexHtml = fs.readFileSync(path.join(assetsDir, 'index.html'), 'utf-8');
    templatesCache.set('index', Handlebars.compile(indexHtml));
    console.log(success(`Template 'index' compiled`));
  } catch (error) {
    console.error(errorMsg(`Error loading template 'index': ${error.message}`));
  }

  try {
    const postHtml = fs.readFileSync(path.join(assetsDir, 'post.html'), 'utf-8');
    templatesCache.set('post', Handlebars.compile(postHtml));
    console.log(success(`Template 'post' compiled`));
  } catch (error) {
    console.error(errorMsg(`Error loading template 'post': ${error.message}`));
  }

  try {
    const tagHtml = fs.readFileSync(path.join(assetsDir, 'tag.html'), 'utf-8');
    templatesCache.set('tag', Handlebars.compile(tagHtml));
    console.log(success(`Template 'tag' compiled`));
  } catch (error) {
    // Tag template is optional
  }

  // Load partials (optional)
  const partialsDir = path.join(assetsDir, 'partials');
  if (fs.existsSync(partialsDir)) {
    try {
      const partialFiles = fs.readdirSync(partialsDir).filter(f => f.endsWith('.html'));

      partialFiles.forEach(file => {
        const name = file.replace('.html', '');
        const content = fs.readFileSync(path.join(partialsDir, file), 'utf-8');
        Handlebars.registerPartial(name, content);
      });

      if (partialFiles.length > 0) {
        console.log(success(`Loaded ${partialFiles.length} partials`));
      }
    } catch (error) {
      console.error(errorMsg(`Error loading partials: ${error.message}`));
    }
  }

  return templatesCache;
}

export function getPostsSorted(postsCache) {
  return Array.from(postsCache.values()).sort((a, b) => {
    // Sort by createdAt (descending - newest first)
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

export function getPaginationData(postsCache, currentPage) {
  const totalPages = getTotalPages(postsCache);
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

export function renderPostsList(postsCache, page, templates, navigation, siteConfig = {}) {
  const startIndex = (page - 1) * POSTS_PER_PAGE;

  const allPosts = getPostsSorted(postsCache);
  const pagePosts = allPosts.slice(startIndex, startIndex + POSTS_PER_PAGE);

  const posts = pagePosts.map(post => ({
    slug: post.slug,
    title: post.title,
    date: post.date,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    tags: post.tags,
    description: post.description
  }));

  const pagination = getPaginationData(postsCache, page);

  const indexTpl = templates.get('index');
  if (!indexTpl) {
    throw new Error('Index template not found');
  }

  // Get site config with defaults
  const {
    title: siteTitle = 'My Blog',
    description: siteDescription = 'A blog powered by thypress',
    url: siteUrl = 'https://example.com'
  } = siteConfig;

  return indexTpl({
    posts: posts,
    pagination: pagination,
    navigation: navigation,
    siteTitle: siteTitle,
    siteDescription: siteDescription,
    siteUrl: siteUrl
  });
}

export function renderPost(post, slug, templates, navigation, siteConfig = {}, postsCache = null) {
  const postTpl = templates.get('post');
  if (!postTpl) {
    throw new Error('Post template not found');
  }

  // Get site config with defaults
  const {
    title: siteTitle = 'My Blog',
    url: siteUrl = 'https://example.com',
    author = 'Anonymous'
  } = siteConfig;

  // Convert dates to ISO format
  const createdAtISO = new Date(post.createdAt).toISOString();
  const updatedAtISO = new Date(post.updatedAt).toISOString();

  // Get prev/next posts (if postsCache is provided)
  let prevPost = null;
  let nextPost = null;

  if (postsCache) {
    const sortedPosts = getPostsSorted(postsCache);
    const currentIndex = sortedPosts.findIndex(p => p.slug === slug);

    if (currentIndex !== -1) {
      // Previous post (older, chronologically later in array)
      if (currentIndex < sortedPosts.length - 1) {
        prevPost = {
          title: sortedPosts[currentIndex + 1].title,
          slug: sortedPosts[currentIndex + 1].slug
        };
      }

      // Next post (newer, chronologically earlier in array)
      if (currentIndex > 0) {
        nextPost = {
          title: sortedPosts[currentIndex - 1].title,
          slug: sortedPosts[currentIndex - 1].slug
        };
      }
    }
  }

  return postTpl({
    content: post.renderedHtml,
    title: post.title,
    date: post.date,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    dateISO: createdAtISO, // Backwards compat
    createdAtISO: createdAtISO,
    updatedAtISO: updatedAtISO,
    tags: post.tags,
    description: post.description,
    slug: slug,
    ogImage: post.ogImage || null,
    siteTitle: siteTitle,
    siteUrl: siteUrl,
    author: author,
    navigation: navigation,
    wordCount: post.wordCount,
    readingTime: post.readingTime,
    frontMatter: post.frontMatter, // Pass entire frontMatter for custom fields
    prevPost: prevPost,
    nextPost: nextPost
  });
}

export function renderTagPage(postsCache, tag, templates, navigation) {
  const tagTpl = templates.get('tag') || templates.get('index');

  const allPosts = getPostsSorted(postsCache);
  const taggedPosts = allPosts.filter(post => post.tags.includes(tag));

  const posts = taggedPosts.map(post => ({
    slug: post.slug,
    title: post.title,
    date: post.date,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    tags: post.tags,
    description: post.description
  }));

  return tagTpl({
    tag: tag,
    posts: posts,
    pagination: null,
    navigation: navigation
  });
}

export function groupByTag(postsCache) {
  const tags = new Map();

  for (const post of postsCache.values()) {
    for (const tag of post.tags) {
      if (!tags.has(tag)) {
        tags.set(tag, []);
      }
      tags.get(tag).push(post);
    }
  }

  return tags;
}

export function getAllTags(postsCache) {
  const tags = new Set();
  for (const post of postsCache.values()) {
    post.tags.forEach(tag => tags.add(tag));
  }
  return Array.from(tags).sort();
}

export function generateSearchIndex(postsCache) {
  const allPosts = getPostsSorted(postsCache);

  const searchData = allPosts.map(post => ({
    id: post.slug,
    title: post.title,
    slug: post.slug,
    date: post.date,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    tags: post.tags,
    description: post.description,
    content: post.content
      .replace(/[#*`\[\]]/g, '') // Remove markdown syntax
      .replace(/\s+/g, ' ')      // Collapse whitespace
      .trim()
      .substring(0, 5000)         // Cap at 5000 chars
  }));

  return JSON.stringify(searchData, null, 0);
}

export function generateRSS(postsCache, siteConfig = {}) {
  const {
    title = 'My Blog',
    description = 'A blog powered by thypress',
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

  const allPosts = getPostsSorted(postsCache);
  const recentPosts = allPosts.slice(0, 20);

  recentPosts.forEach(post => {
    feed.addItem({
      title: post.title,
      id: `${url}/post/${post.slug}/`,
      link: `${url}/post/${post.slug}/`,
      description: post.description || post.content.substring(0, 200),
      content: post.renderedHtml,
      author: [{ name: author }],
      date: new Date(post.createdAt),
      published: new Date(post.createdAt),
      updated: new Date(post.updatedAt),
      category: post.tags.map(tag => ({ name: tag }))
    });
  });

  return feed.rss2();
}

export async function generateSitemap(postsCache, siteConfig = {}) {
  const { url = 'https://example.com' } = siteConfig;

  const allPosts = getPostsSorted(postsCache);
  const allTags = getAllTags(postsCache);

  const links = [];

  links.push({
    url: '/',
    changefreq: 'daily',
    priority: 1.0
  });

  allPosts.forEach(post => {
    links.push({
      url: `/post/${post.slug}/`,
      lastmod: post.updatedAt, // Use updatedAt for sitemap
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

  const stream = new SitemapStream({ hostname: url });
  const xml = await streamToPromise(Readable.from(links).pipe(stream));

  return xml.toString();
}

export function getTotalPages(postsCache) {
  return Math.ceil(postsCache.size / POSTS_PER_PAGE);
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
    title: 'My Blog',
    description: 'A blog powered by thypress',
    url: 'https://example.com',
    author: 'Anonymous'
  };
}

export { __dirname };
