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

const md = new MarkdownIt();
md.use(markdownItHighlight);
md.use(markdownItAnchor, {
  permalink: false,
  slugify: (s) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
});

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const POSTS_PER_PAGE = 10;
const STANDARD_IMAGE_SIZES = [400, 800, 1200];

// Register minimal Handlebars helpers (no HTML building)
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('multiply', (a, b) => a * b);

/**
 * Check if file/folder should be ignored (starts with .)
 */
function shouldIgnore(name) {
  return name.startsWith('.');
}

/**
 * Check if path is inside a drafts folder
 */
function isInDraftsFolder(relativePath) {
  const parts = relativePath.split(path.sep);
  return parts.some(part => part === 'drafts');
}

/**
 * Detect if HTML content is a complete document vs a fragment
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
      .replace(/^<!--[\s\S]*?-->\s*/g, '');

    return /^<!DOCTYPE\s+html/i.test(cleaned) ||
           /<(html|head|body)[\s>]/i.test(cleaned);
  }
}

/**
 * Determine how to handle HTML file: raw vs templated
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
 * Extract headings from HTML content using htmlparser2
 */
function extractHeadingsFromHtml(htmlContent) {
  const headings = [];

  try {
    const dom = parseDocument(htmlContent);

    function traverse(node) {
      if (node.type === 'tag' && /^h[1-6]$/i.test(node.name)) {
        const level = parseInt(node.name.substring(1));
        const content = node.children
          .filter(c => c.type === 'text')
          .map(c => c.data)
          .join('')
          .trim();
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

/**
 * Build nested TOC structure from flat headings array
 * Returns pure data structure - NO HTML
 */
function buildTocStructure(headings, minLevel = 2, maxLevel = 4) {
  if (!headings || headings.length === 0) return [];

  const toc = [];
  const stack = [{ children: toc, level: 0 }];

  for (const heading of headings) {
    // Skip h1 (page title) and levels outside range
    if (heading.level < minLevel || heading.level > maxLevel) continue;
    if (!heading.slug) continue; // Skip headings without IDs

    // Pop stack until we find the right parent level
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

/**
 * Hook into markdown-it renderer to capture heading metadata
 */
function setupHeadingExtractor(md) {
  const originalHeadingOpen = md.renderer.rules.heading_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.heading_open = function(tokens, idx, options, env, self) {
    const token = tokens[idx];
    const level = parseInt(token.tag.substring(1)); // h1 -> 1, h2 -> 2
    const nextToken = tokens[idx + 1];
    const content = nextToken && nextToken.type === 'inline' ? nextToken.content : '';
    const slug = token.attrGet('id') || '';

    if (!env.headings) env.headings = [];
    env.headings.push({ level, content, slug });

    return originalHeadingOpen(tokens, idx, options, env, self);
  };
}

setupHeadingExtractor(md);

/**
 * Process a single content file (MD, TXT, or HTML)
 * Returns { slug, content, imageReferences }
 */
export function processContentFile(fullPath, relativePath, mode, contentDir) {
  const ext = path.extname(fullPath).toLowerCase();
  const isMarkdown = ext === '.md';
  const isText = ext === '.txt';
  const isHtml = ext === '.html';

  const webPath = normalizeToWebPath(relativePath);
  const url = generateUrl(webPath, mode);
  const slug = url.substring(1).replace(/\/$/, '') || 'index';

  if (isHtml) {
    const rawHtml = fs.readFileSync(fullPath, 'utf-8');
    const { data: frontMatter, content: htmlContent } = matter(rawHtml);

    // Check if draft
    if (frontMatter.draft === true) {
      return null; // Skip drafts
    }

    const intent = detectHtmlIntent(htmlContent, frontMatter);

    let section = null;
    if (mode === 'structured') {
      section = webPath.split('/')[0];
    } else if (mode === 'legacy') {
      section = 'posts';
    }

    // Extract TOC from HTML fragments
    let toc = [];
    let headings = [];
    if (intent.mode === 'templated') {
      headings = extractHeadingsFromHtml(htmlContent);
      toc = buildTocStructure(headings);
    }

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
        headings: headings
      },
      imageReferences: []
    };
  }

  const rawContent = fs.readFileSync(fullPath, 'utf-8');
  const { data: frontMatter, content } = matter(rawContent);

  // Check if draft
  if (frontMatter.draft === true) {
    return null; // Skip drafts
  }

  const env = {
    postRelativePath: webPath,
    referencedImages: [],
    contentDir: contentDir,
    headings: []
  };

  const renderedHtml = isMarkdown ? md.render(content, env) : `<pre>${content}</pre>`;

  const { title, createdAt, updatedAt, wordCount, readingTime } = processPostMetadata(
    content,
    path.basename(fullPath),
    frontMatter,
    isMarkdown,
    fullPath
  );

  const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : (frontMatter.tags ? [frontMatter.tags] : []);
  const description = frontMatter.description || '';

  let section = null;
  if (mode === 'structured') {
    section = webPath.split('/')[0];
  } else if (mode === 'legacy') {
    section = 'posts';
  }

  let ogImage = frontMatter.image || null;
  if (!ogImage && env.referencedImages.length > 0) {
    const firstImg = env.referencedImages[0];
    const ogSize = firstImg.sizesToGenerate[Math.floor(firstImg.sizesToGenerate.length / 2)] || 800;
    ogImage = `/${firstImg.urlBase}${firstImg.basename}-${ogSize}-${firstImg.hash}.jpg`;
  }

  // Build TOC structure for markdown
  const toc = isMarkdown ? buildTocStructure(env.headings) : [];

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
      headings: env.headings
    },
    imageReferences: env.referencedImages
  };
}

export function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^\w./-]/g, '');
}

export function normalizeToWebPath(filePath) {
  return filePath.split(path.sep).join('/');
}

// Calculate reading time and word count
function calculateReadingStats(content) {
  const plainText = content
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/[#*`_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words = plainText.split(/\s+/).filter(w => w.length > 0).length;
  const readingTime = Math.ceil(words / 200);

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

export function processPostMetadata(content, filename, frontMatter, isMarkdown, fullPath) {
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

/**
 * Detect content structure and operational mode
 */
export function detectContentStructure(workingDir) {
  const contentDir = path.join(workingDir, 'content');
  if (fs.existsSync(contentDir) && fs.statSync(contentDir).isDirectory()) {
    return {
      contentRoot: contentDir,
      mode: 'structured'
    };
  }

  const postsDir = path.join(workingDir, 'posts');
  if (fs.existsSync(postsDir) && fs.statSync(postsDir).isDirectory()) {
    return {
      contentRoot: postsDir,
      mode: 'legacy'
    };
  }

  try {
    const files = fs.readdirSync(workingDir);
    const contentFiles = files.filter(f => {
      const fullPath = path.join(workingDir, f);
      if (!fs.statSync(fullPath).isFile()) return false;
      return /\.(md|txt|html)$/i.test(f);
    });

    if (contentFiles.length > 0) {
      return {
        contentRoot: workingDir,
        mode: 'simple'
      };
    }
  } catch (error) {}

  return {
    contentRoot: contentDir,
    mode: 'structured',
    shouldInit: true
  };
}

/**
 * Generate URL from content path based on mode
 */
export function generateUrl(relativePath, mode, section = null) {
  let url = relativePath.replace(/\.(md|txt|html)$/, '');
  url = url.replace(/\/index$/, '');

  if (mode === 'structured') {
    return '/' + url + (url ? '/' : '');
  } else if (mode === 'legacy') {
    return '/' + url + (url ? '/' : '');
  } else if (mode === 'simple') {
    return '/' + url + (url ? '/' : '');
  }

  return '/' + url + (url ? '/' : '');
}

/**
 * Build navigation tree
 * Returns pure data structure - NO HTML
 */
export function buildNavigationTree(contentRoot, contentCache = new Map(), mode = 'structured') {
  const navigation = [];

  function processDirectory(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      // Skip hidden files/folders (. prefix)
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const webPath = normalizeToWebPath(relPath);

      // Skip drafts folders
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
        const url = generateUrl(webPath, mode);

        let title;
        for (const [slug, content] of contentCache) {
          if (content.relativePath === webPath) {
            title = content.title;
            break;
          }
        }

        if (!title) {
          title = entry.name
            .replace(/\.(md|txt|html)$/, '')
            .replace(/^\d{4}-\d{2}-\d{2}-/, '')
            .replace(/-/g, ' ');
        }

        items.push({
          type: 'file',
          name: entry.name,
          title: title,
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

/**
 * Load all content from content root
 */
export function loadAllContent() {
  const workingDir = process.cwd();
  const { contentRoot, mode, shouldInit } = detectContentStructure(workingDir);

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
      // Skip hidden files/folders (. prefix)
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const webPath = normalizeToWebPath(relPath);

      // Skip drafts folders
      if (entry.isDirectory() && entry.name === 'drafts') {
        console.log(dim(`Skipping drafts folder: ${webPath}`));
        continue;
      }

      // Check if path is inside a drafts folder
      if (isInDraftsFolder(relPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        loadContentFromDir(fullPath, relPath);
      } else if (/\.(md|txt|html)$/i.test(entry.name)) {
        // Warn if underscore is used in content files
        if (entry.name.startsWith('_')) {
          console.log(warning(`${webPath} uses underscore prefix (intended for template partials, not content)`));
          console.log(dim(`  Consider using drafts/ folder or draft: true in front matter for drafts`));
        }

        try {
          const ext = path.extname(entry.name).toLowerCase();
          const isMarkdown = ext === '.md';

          if (isMarkdown) {
            const rawContent = fs.readFileSync(fullPath, 'utf-8');
            const { content } = matter(rawContent);
            preScanImageDimensions(content, webPath);
          }

          const result = processContentFile(fullPath, relPath, mode, contentRoot);

          // Skip if null (draft content)
          if (!result) continue;

          contentCache.set(result.slug, result.content);
          slugMap.set(webPath, result.slug);

          if (result.imageReferences.length > 0) {
            imageReferences.set(webPath, result.imageReferences);

            for (const img of result.imageReferences) {
              if (!fs.existsSync(img.resolvedPath)) {
                brokenImages.push({
                  post: webPath,
                  src: img.src,
                  resolvedPath: img.resolvedPath
                });
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

/**
 * Select template based on content
 */
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

/**
 * Load theme from templates directory
 */
export async function loadTheme(themeName = null) {
  const templatesDir = path.join(process.cwd(), 'templates');
  const templatesCache = new Map();
  const themeAssets = new Map();

  let activeTheme = themeName;

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

  const { EMBEDDED_TEMPLATES } = await import('./embedded-templates.js');

  function compileTemplate(name, content) {
    try {
      return Handlebars.compile(content);
    } catch (error) {
      console.error(errorMsg(`Failed to compile template '${name}': ${error.message}`));
      return null;
    }
  }

  // Load embedded templates first
  for (const [name, content] of Object.entries(EMBEDDED_TEMPLATES)) {
    if (name.endsWith('.html')) {
      const templateName = name.replace('.html', '');

      // Register partials (files starting with _)
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

  if (activeTheme) {
    const themePath = path.join(templatesDir, activeTheme);

    if (fs.existsSync(themePath)) {
      console.log(success(`Loading theme: ${activeTheme}`));

      // First, scan for partials in partials/ folder
      const partialsDir = path.join(themePath, 'partials');
      if (fs.existsSync(partialsDir)) {
        function scanPartialsFolder(dir, relativePath = '') {
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            // Skip hidden files/folders
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

      // Then scan theme files
      function loadThemeFiles(dir, relativePath = '') {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip hidden files/folders
          if (shouldIgnore(entry.name)) continue;

          const fullPath = path.join(dir, entry.name);
          const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

          if (entry.isDirectory()) {
            // Skip partials folder (already processed)
            if (entry.name === 'partials') continue;

            loadThemeFiles(fullPath, relPath);
          } else {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const ext = path.extname(entry.name).toLowerCase();

            if (ext === '.html') {
              const templateName = path.basename(entry.name, '.html');

              // Register partials (files starting with _)
              if (entry.name.startsWith('_')) {
                Handlebars.registerPartial(templateName, content);
                console.log(dim(`  Registered partial (underscore): ${templateName}`));
              } else {
                // Check front matter for partial: true
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

  return { templatesCache, themeAssets, activeTheme };
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
    description: content.description
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
    toc: content.toc || [],
    showToc: showToc
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

export function getAllTags(contentCache) {
  const tags = new Set();
  for (const content of contentCache.values()) {
    content.tags.forEach(tag => tags.add(tag));
  }
  return Array.from(tags).sort();
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

export { __dirname };
