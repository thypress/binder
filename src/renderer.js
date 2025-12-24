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

export function slugify(str) {
  // Allow forward slashes for nested paths
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^\w./-]/g, '');
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
    const postsDir = process.env.thypress_POSTS_DIR || path.join(__dirname, '../posts');

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
    outputImagePath = outputImagePath.replace(/\\/g, '/');

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

function buildNavigationTree(postsDir, postsCache = new Map()) {
  const navigation = [];

  function processDirectory(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

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
        const slug = slugify(relPath.replace(/\.(md|txt)$/, ''));

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
          path: relPath
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

function extractTitleFromContent(content, isMarkdown) {
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

function extractDateFromFilename(filename) {
  // Try to extract date from filename (YYYY-MM-DD format)
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    return dateMatch[1];
  }
  return null;
}

export function loadAllPosts() {
  const postsCache = new Map();
  const slugMap = new Map();
  const imageReferences = new Map();
  const brokenImages = [];
  const imageDimensionsCache = new Map(); // Cache for image dimensions

  const postsDir = process.env.thypress_POSTS_DIR || path.join(__dirname, '../posts');

  async function preScanImageDimensions(content, relativePath) {
    // Extract all image references from markdown
    const imageMatches = content.matchAll(/!\[.*?\]\((.*?)\)/g);

    for (const match of imageMatches) {
      const src = match[1];

      // Skip external images
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
        continue;
      }

      // Resolve image path (same logic as in setupImageOptimizer)
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

      // Read dimensions if file exists and not already cached
      if (fs.existsSync(resolvedImagePath) && !imageDimensionsCache.has(resolvedImagePath)) {
        try {
          const metadata = await sharp(resolvedImagePath).metadata();
          imageDimensionsCache.set(resolvedImagePath, metadata.width);
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
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        loadPostsFromDir(fullPath, relPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        try {
          const isMarkdown = entry.name.endsWith('.md');
          const slug = slugify(relPath.replace(/\.(md|txt)$/, ''));
          slugMap.set(relPath, slug);

          const rawContent = fs.readFileSync(fullPath, 'utf-8');
          const { data: frontMatter, content } = matter(rawContent);

          // Pre-scan images to cache dimensions (async but we'll handle it)
          // For now, we'll do this synchronously in the render phase
          // and accept that first render won't have optimized sizes

          const env = {
            postRelativePath: relPath,
            referencedImages: [],
            imageDimensionsCache // Pass the cache
          };

          const renderedHtml = isMarkdown ? md.render(content, env) : `<pre>${content}</pre>`;

          if (env.referencedImages.length > 0) {
            imageReferences.set(relPath, env.referencedImages);

            for (const img of env.referencedImages) {
              if (!fs.existsSync(img.resolvedPath)) {
                brokenImages.push({
                  post: relPath,
                  src: img.src,
                  resolvedPath: img.resolvedPath
                });
              }
            }
          }

          // Smart title extraction with priority order
          let title = frontMatter.title;

          if (!title) {
            // Try to extract from first H1 (only for markdown)
            title = extractTitleFromContent(content, isMarkdown);
          }

          if (!title) {
            // Use filename without date prefix
            title = entry.name
              .replace(/\.(md|txt)$/, '')
              .replace(/^\d{4}-\d{2}-\d{2}-/, '')
              .replace(/[-_]/g, ' ')
              .trim();
          }

          if (!title) {
            // Fallback to raw filename
            title = entry.name.replace(/\.(md|txt)$/, '');
          }

          // Smart date extraction with priority order
          let date = frontMatter.date;

          if (!date) {
            // Try filename date prefix
            date = extractDateFromFilename(entry.name);
          }

          if (!date) {
            // Use file modification time
            const stats = fs.statSync(fullPath);
            date = stats.mtime.toISOString().split('T')[0];
          }

          // Normalize date format
          if (date instanceof Date) {
            date = date.toISOString().split('T')[0];
          }

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
            filename: relPath,
            slug: slug,
            title: title,
            date: date,
            tags: tags,
            description: description,
            content: content,
            renderedHtml: renderedHtml,
            frontMatter: frontMatter,
            relativePath: relPath,
            ogImage: ogImage // Store for OG tags
          });
        } catch (error) {
          console.error(`Error loading post '${relPath}': ${error.message}`);
        }
      }
    }
  }

  try {
    // First pass: scan all images and cache dimensions
    const allFiles = [];

    function collectFiles(dir, relativePath = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          collectFiles(fullPath, relPath);
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
          allFiles.push({ fullPath, relPath, isMarkdown: entry.name.endsWith('.md') });
        }
      }
    }

    collectFiles(postsDir);

    // Pre-scan all images
    (async () => {
      for (const file of allFiles) {
        if (file.isMarkdown) {
          const rawContent = fs.readFileSync(file.fullPath, 'utf-8');
          const { content } = matter(rawContent);
          await preScanImageDimensions(content, file.relPath);
        }
      }
    })().then(() => {
      // After dimensions are cached, we're ready
      // (This happens async but won't block initial load)
    });

    // Second pass: load all posts (dimensions may not be cached yet on first run)
    loadPostsFromDir(postsDir);
    console.log(`✓ Loaded ${postsCache.size} posts`);
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
    console.log(`✓ Template 'index' compiled`);
  } catch (error) {
    console.error(`Error loading template 'index': ${error.message}`);
  }

  try {
    const postHtml = fs.readFileSync(path.join(assetsDir, 'post.html'), 'utf-8');
    templatesCache.set('post', Handlebars.compile(postHtml));
    console.log(`✓ Template 'post' compiled`);
  } catch (error) {
    console.error(`Error loading template 'post': ${error.message}`);
  }

  try {
    const tagHtml = fs.readFileSync(path.join(assetsDir, 'tag.html'), 'utf-8');
    templatesCache.set('tag', Handlebars.compile(tagHtml));
    console.log(`✓ Template 'tag' compiled`);
  } catch (error) {
    // Tag template is optional
  }

  return templatesCache;
}

export function getPostsSorted(postsCache) {
  return Array.from(postsCache.values()).sort((a, b) => {
    return new Date(b.date) - new Date(a.date);
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

export function renderPost(post, slug, templates, navigation, siteConfig = {}) {
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

  // Convert date to ISO format for article:published_time
  const dateISO = new Date(post.date).toISOString();

  return postTpl({
    content: post.renderedHtml,
    title: post.title,
    date: post.date,
    dateISO: dateISO,
    tags: post.tags,
    description: post.description,
    slug: slug,
    ogImage: post.ogImage || null,
    siteTitle: siteTitle,
    siteUrl: siteUrl,
    author: author,
    navigation: navigation
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
      date: new Date(post.date),
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
      lastmod: post.date,
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
    console.error('Error loading config.json:', error.message);
  }

  return {
    title: 'My Blog',
    description: 'A blog powered by thypress',
    url: 'https://example.com',
    author: 'Anonymous'
  };
}

export { __dirname };
