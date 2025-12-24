/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import MarkdownIt from 'markdown-it';
import markdownItHighlight from 'markdown-it-highlightjs';
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

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const POSTS_PER_PAGE = 10;
const IMAGE_SIZES = [400, 800, 1200];

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
    outputImagePath = outputImagePath.replace(/\\/g, '/');

    // Extract filename without extension
    const basename = path.basename(resolvedImagePath, path.extname(resolvedImagePath));
    const outputDir = path.dirname(outputImagePath);

    // Create hash from the resolved path for uniqueness
    const hash = crypto.createHash('md5').update(resolvedImagePath).digest('hex').substring(0, 8);

    // Generate the output URL path (relative to /post/ output directory)
    const urlBase = outputDir === '.' ? '' : `${outputDir}/`;

    // Store image reference for collection during scanning phase
    if (!env.referencedImages) env.referencedImages = [];
    env.referencedImages.push({
      src,
      resolvedPath: resolvedImagePath,
      outputPath: outputImagePath,
      basename,
      hash,
      urlBase
    });

    // Generate responsive picture element
    return `<picture>
  <source
    srcset="${IMAGE_SIZES.map(size => `/post/${urlBase}${basename}-${size}-${hash}.webp ${size}w`).join(', ')}"
    type="image/webp"
    sizes="(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px">
  <source
    srcset="${IMAGE_SIZES.map(size => `/post/${urlBase}${basename}-${size}-${hash}.jpg ${size}w`).join(', ')}"
    type="image/jpeg"
    sizes="(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px">
  <img
    src="/post/${urlBase}${basename}-800-${hash}.jpg"
    alt="${alt}"
    loading="lazy"
    decoding="async">
</picture>`;
  };
}

setupImageOptimizer(md);

export async function optimizeImage(imagePath, outputDir) {
  const ext = path.extname(imagePath);
  const name = path.basename(imagePath, ext);
  const hash = crypto.createHash('md5').update(imagePath).digest('hex').substring(0, 8);

  const optimized = [];

  try {
    for (const size of IMAGE_SIZES) {
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
      } else if (entry.name.endsWith('.md')) {
        const slug = slugify(relPath.replace('.md', ''));

        let title;
        const post = postsCache.get(slug);
        if (post && post.title) {
          title = post.title;
        } else {
          title = entry.name
            .replace('.md', '')
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

export function loadAllPosts() {
  const postsCache = new Map();
  const slugMap = new Map();
  const imageReferences = new Map();
  const brokenImages = [];

  const postsDir = process.env.THYPRESS_POSTS_DIR || path.join(__dirname, '../posts');

  function loadPostsFromDir(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        loadPostsFromDir(fullPath, relPath);
      } else if (entry.name.endsWith('.md')) {
        try {
          const slug = slugify(relPath.replace('.md', ''));
          slugMap.set(relPath, slug);

          const rawContent = fs.readFileSync(fullPath, 'utf-8');
          const { data: frontMatter, content } = matter(rawContent);

          const env = { postRelativePath: relPath, referencedImages: [] };
          const renderedHtml = md.render(content, env);

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

          const title = frontMatter.title || entry.name
            .replace('.md', '')
            .replace(/^\d{4}-\d{2}-\d{2}-/, '')
            .replace(/-/g, ' ');

          const date = frontMatter.date
            ? (frontMatter.date instanceof Date ? frontMatter.date.toISOString().split('T')[0] : frontMatter.date)
            : (entry.name.match(/^\d{4}-\d{2}-\d{2}/) ? entry.name.substring(0, 10) : new Date().toISOString().split('T')[0]);
          const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []);
          const description = frontMatter.description || '';

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
            relativePath: relPath
          });
        } catch (error) {
          console.error(`Error loading post '${relPath}': ${error.message}`);
        }
      }
    }
  }

  try {
    loadPostsFromDir(postsDir);
    console.log(`✓ Loaded ${postsCache.size} posts`);
  } catch (error) {
    console.error(`Error reading posts directory: ${error.message}`);
  }

  const navigation = buildNavigationTree(postsDir, postsCache);

  return { postsCache, slugMap, navigation, imageReferences, brokenImages };
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

export function renderPostsList(postsCache, page, templates, navigation) {
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

  return indexTpl({
    posts: posts,
    pagination: pagination,
    navigation: navigation
  });
}

export function renderPost(post, slug, templates, navigation) {
  const postTpl = templates.get('post');
  if (!postTpl) {
    throw new Error('Post template not found');
  }

  return postTpl({
    content: post.renderedHtml,
    title: post.title,
    date: post.date,
    tags: post.tags,
    description: post.description,
    slug: slug,
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
    title: post.title,
    slug: post.slug,
    date: post.date,
    tags: post.tags,
    description: post.description,
    content: post.content.substring(0, 1000)
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
