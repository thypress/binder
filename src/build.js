/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import {
  loadAllPosts,
  loadTemplates,
  renderPostsList,
  renderPost,
  renderTagPage,
  getTotalPages,
  getAllTags,
  generateRSS,
  generateSitemap,
  generateSearchIndex,
  optimizeImage,
  getSiteConfig,
  getPostsSorted
} from './renderer.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';
import { EMBEDDED_TEMPLATES } from './embedded-templates.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BUILD_DIR = path.join(__dirname, '../build');
const CACHE_DIR = path.join(__dirname, '../.cache');

// Determine optimal concurrency based on CPU cores
const CONCURRENCY = Math.max(2, Math.floor(os.availableParallelism() * 0.75));

function ensureBuildDir() {
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  console.log(success('Build directory created'));
}

function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyStaticAssets() {
  const assetsDir = path.join(process.cwd(), 'assets');

  if (!fs.existsSync(assetsDir)) {
    console.log(info('No /assets directory found, skipping static assets'));
    return;
  }

  const buildAssetsDir = path.join(BUILD_DIR, 'assets');
  fs.mkdirSync(buildAssetsDir, { recursive: true });

  const entries = fs.readdirSync(assetsDir);

  for (const entry of entries) {
    if (entry === 'index.html' || entry === 'post.html' || entry === 'tag.html') continue;
    if (entry === 'img') continue;
    if (entry === 'partials') continue; // Don't copy partials (they're compiled into templates)
    if (entry === 'robots.txt' || entry === 'llms.txt' || entry === '404.html') continue; // These are generated

    const srcPath = path.join(assetsDir, entry);
    const destPath = path.join(buildAssetsDir, entry);

    if (fs.statSync(srcPath).isDirectory()) {
      copyDirectory(srcPath, destPath);
      console.log(success(`Copied directory: assets/${entry}/`));
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(success(`Copied file: assets/${entry}`));
    }
  }
}

async function optimizeImagesFromAssets() {
  const imagesDir = path.join(process.cwd(), 'assets', 'img');
  const outputDir = path.join(BUILD_DIR, 'assets', 'img');

  if (!fs.existsSync(imagesDir)) {
    return 0;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const images = fs.readdirSync(imagesDir)
    .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file));

  if (images.length === 0) {
    return 0;
  }

  console.log(info(`Optimizing ${images.length} images from /assets/img...`));

  let optimized = 0;

  // Process images in batches with concurrency control
  for (let i = 0; i < images.length; i += CONCURRENCY) {
    const batch = images.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (image) => {
      const imagePath = path.join(imagesDir, image);
      try {
        // Assets images use default sizing (dimensions will be read automatically)
        await optimizeImage(imagePath, outputDir);
        optimized++;
        process.stdout.write(`  ${optimized}/${images.length}\r`);
      } catch (error) {
        console.error(`\n${errorMsg(`Error optimizing ${image}: ${error.message}`)}`);
      }
    }));
  }

  console.log(`\n${success(`Optimized ${optimized} images from /assets/img`)}`);
  return optimized;
}

function needsOptimization(sourcePath, outputDir, basename, hash) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  const variants = [400, 800, 1200].flatMap(size => [
    path.join(outputDir, `${basename}-${size}-${hash}.webp`),
    path.join(outputDir, `${basename}-${size}-${hash}.jpg`)
  ]);

  for (const variant of variants) {
    if (!fs.existsSync(variant)) {
      return true;
    }
  }

  const sourceMtime = fs.statSync(sourcePath).mtime.getTime();

  for (const variant of variants) {
    const variantMtime = fs.statSync(variant).mtime.getTime();
    if (sourceMtime > variantMtime) {
      return true;
    }
  }

  return false;
}

async function optimizeImagesFromPosts(imageReferences, outputBaseDir, showProgress = true) {
  const postsDir = process.env.thypress_POSTS_DIR || path.join(__dirname, '../posts');

  const uniqueImages = new Map();
  for (const [postPath, images] of imageReferences) {
    for (const img of images) {
      const key = img.resolvedPath;
      if (!uniqueImages.has(key)) {
        uniqueImages.set(key, img);
      }
    }
  }

  const imagesToOptimize = Array.from(uniqueImages.values())
    .filter(img => fs.existsSync(img.resolvedPath));

  if (imagesToOptimize.length === 0) {
    return 0;
  }

  if (showProgress) {
    console.log(info(`Scanning images...`));
    console.log(success(`Found ${imagesToOptimize.length} images in posts/`));
  }

  const needsUpdate = [];
  for (const img of imagesToOptimize) {
    const outputDir = path.join(outputBaseDir, 'post', path.dirname(img.outputPath));
    if (needsOptimization(img.resolvedPath, outputDir, img.basename, img.hash)) {
      needsUpdate.push(img);
    }
  }

  if (needsUpdate.length === 0 && showProgress) {
    console.log(success(`All images up to date (${imagesToOptimize.length} cached)`));
    return imagesToOptimize.length;
  }

  if (showProgress) {
    console.log(info(`Optimizing images: ${needsUpdate.length}/${imagesToOptimize.length} (${imagesToOptimize.length - needsUpdate.length} cached)`));
    console.log(dim(`Using ${CONCURRENCY} parallel workers`));
  }

  let optimized = 0;

  // Process images in batches with concurrency control
  for (let i = 0; i < needsUpdate.length; i += CONCURRENCY) {
    const batch = needsUpdate.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (img) => {
      const outputDir = path.join(outputBaseDir, 'post', path.dirname(img.outputPath));
      fs.mkdirSync(outputDir, { recursive: true });

      try {
        // Pass the actual sizes to generate (if available)
        await optimizeImage(img.resolvedPath, outputDir, img.sizesToGenerate);
        optimized++;
        if (showProgress) {
          const percentage = Math.floor((optimized / needsUpdate.length) * 100);
          const bar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
          process.stdout.write(`  ${bar} ${percentage}% (${optimized}/${needsUpdate.length})\r`);
        }
      } catch (error) {
        console.error(`\n${errorMsg(`Error optimizing ${img.outputPath}: ${error.message}`)}`);
      }
    }));
  }

  if (showProgress && needsUpdate.length > 0) {
    console.log(`\n${success(`Optimized ${optimized} images (${optimized * 6} files generated)`)}`);
  }

  return imagesToOptimize.length;
}

function cleanupOrphanedImages(imageReferences, cacheDir) {
  const postCacheDir = path.join(cacheDir, 'post');

  if (!fs.existsSync(postCacheDir)) {
    return 0;
  }

  const validHashes = new Set();
  for (const [postPath, images] of imageReferences) {
    for (const img of images) {
      if (fs.existsSync(img.resolvedPath)) {
        validHashes.add(img.hash);
      }
    }
  }

  let removed = 0;

  function scanAndClean(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanAndClean(fullPath);
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else {
        const match = entry.name.match(/^(.+)-(\d{3,4})-([a-f0-9]{8})\.(webp|jpg)$/);
        if (match) {
          const [_, basename, size, hash, ext] = match;
          if (!validHashes.has(hash)) {
            fs.unlinkSync(fullPath);
            removed++;
          }
        }
      }
    }
  }

  scanAndClean(postCacheDir);

  if (removed > 0) {
    console.log(success(`Cleaned up ${removed} orphaned cache files`));
  }

  return removed;
}

function buildPosts(postsCache, templates, navigation, siteConfig) {
  let count = 0;

  for (const [slug, post] of postsCache) {
    const postDir = path.join(BUILD_DIR, 'post', slug);
    fs.mkdirSync(postDir, { recursive: true });

    // Pass postsCache for prev/next links
    const html = renderPost(post, slug, templates, navigation, siteConfig, postsCache);
    fs.writeFileSync(path.join(postDir, 'index.html'), html);
    count++;
  }

  console.log(success(`Generated ${count} post pages`));
}

function buildIndexPages(postsCache, templates, navigation, siteConfig) {
  const totalPages = getTotalPages(postsCache);

  const indexHtml = renderPostsList(postsCache, 1, templates, navigation, siteConfig);
  fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), indexHtml);
  console.log(success(`Generated index.html`));

  for (let page = 2; page <= totalPages; page++) {
    const pageDir = path.join(BUILD_DIR, 'page', page.toString());
    fs.mkdirSync(pageDir, { recursive: true });

    const pageHtml = renderPostsList(postsCache, page, templates, navigation, siteConfig);
    fs.writeFileSync(path.join(pageDir, 'index.html'), pageHtml);
  }

  if (totalPages > 1) {
    console.log(success(`Generated ${totalPages - 1} pagination pages`));
  }
}

function buildTagPages(postsCache, templates, navigation) {
  const tags = getAllTags(postsCache);

  if (tags.length === 0) {
    return;
  }

  for (const tag of tags) {
    const tagDir = path.join(BUILD_DIR, 'tag', tag);
    fs.mkdirSync(tagDir, { recursive: true });

    const html = renderTagPage(postsCache, tag, templates, navigation);
    fs.writeFileSync(path.join(tagDir, 'index.html'), html);
  }

  console.log(success(`Generated ${tags.length} tag pages`));
}

async function buildRSSAndSitemap(postsCache, siteConfig) {
  const rss = generateRSS(postsCache, siteConfig);
  fs.writeFileSync(path.join(BUILD_DIR, 'rss.xml'), rss);
  console.log(success('Generated rss.xml'));

  const sitemap = await generateSitemap(postsCache, siteConfig);
  fs.writeFileSync(path.join(BUILD_DIR, 'sitemap.xml'), sitemap);
  console.log(success('Generated sitemap.xml'));
}

function buildSearchIndex(postsCache) {
  const searchJson = generateSearchIndex(postsCache);
  fs.writeFileSync(path.join(BUILD_DIR, 'search.json'), searchJson);
  console.log(success('Generated search.json'));
}

function buildRobotsTxt(siteConfig) {
  try {
    const robotsPath = path.join(process.cwd(), 'assets', 'robots.txt');
    const outputPath = path.join(BUILD_DIR, 'robots.txt');

    let content;
    if (fs.existsSync(robotsPath)) {
      // User's custom version
      content = fs.readFileSync(robotsPath, 'utf-8');
    } else {
      // Use embedded default
      content = EMBEDDED_TEMPLATES['robots.txt'] || 'User-agent: *\nAllow: /';
    }

    // Process with Handlebars
    const template = Handlebars.compile(content);
    const rendered = template({ siteUrl: siteConfig.url || 'https://example.com' });

    fs.writeFileSync(outputPath, rendered);
    console.log(success('Generated robots.txt'));
  } catch (error) {
    console.error(errorMsg(`Failed to generate robots.txt: ${error.message}`));
  }
}

function buildLlmsTxt(postsCache, siteConfig) {
  try {
    const llmsPath = path.join(process.cwd(), 'assets', 'llms.txt');
    const outputPath = path.join(BUILD_DIR, 'llms.txt');

    let content;
    if (fs.existsSync(llmsPath)) {
      // User's custom version
      content = fs.readFileSync(llmsPath, 'utf-8');
    } else {
      // Use embedded default
      content = EMBEDDED_TEMPLATES['llms.txt'] || '# Site\n\n{{siteUrl}}/sitemap.xml';
    }

    // Prepare data
    const recentPosts = getPostsSorted(postsCache).slice(0, 10).map(p => ({
      title: p.title,
      slug: p.slug
    }));
    const allTags = getAllTags(postsCache);

    // Process with Handlebars
    const template = Handlebars.compile(content);
    const rendered = template({
      siteTitle: siteConfig.title || 'My Blog',
      siteDescription: siteConfig.description || '',
      siteUrl: siteConfig.url || 'https://example.com',
      recentPosts: recentPosts,
      allTags: allTags
    });

    fs.writeFileSync(outputPath, rendered);
    console.log(success('Generated llms.txt'));
  } catch (error) {
    console.error(errorMsg(`Failed to generate llms.txt: ${error.message}`));
  }
}

function build404Page() {
  try {
    const custom404 = path.join(process.cwd(), 'assets', '404.html');
    const output404 = path.join(BUILD_DIR, '404.html');

    if (fs.existsSync(custom404)) {
      // User's custom version
      fs.copyFileSync(custom404, output404);
    } else if (EMBEDDED_TEMPLATES['404.html']) {
      // Use embedded default
      fs.writeFileSync(output404, EMBEDDED_TEMPLATES['404.html']);
    }

    console.log(success('Generated 404.html'));
  } catch (error) {
    console.error(errorMsg(`Failed to generate 404.html: ${error.message}`));
  }
}

export async function build() {
  console.log(bright('Building static site...\n'));

  const { postsCache, navigation, imageReferences, brokenImages } = loadAllPosts();
  const templates = loadTemplates();
  const siteConfig = getSiteConfig();

  if (postsCache.size === 0) {
    console.log(warning('No posts found in /posts directory'));
    return;
  }

  if (!templates.has('index') || !templates.has('post')) {
    console.log(errorMsg('Missing required templates (index.html or post.html)'));
    return;
  }

  if (brokenImages.length > 0) {
    console.log(warning(`\nBroken image references detected:`));
    for (const broken of brokenImages) {
      console.log(dim(`  • ${broken.post} → ${broken.src} (file not found)`));
    }
    console.log('');
  }

  ensureBuildDir();
  copyStaticAssets();

  const assetsImagesCount = await optimizeImagesFromAssets();
  const postsImagesCount = await optimizeImagesFromPosts(imageReferences, BUILD_DIR, true);
  const totalImages = assetsImagesCount + postsImagesCount;

  buildPosts(postsCache, templates, navigation, siteConfig);
  buildIndexPages(postsCache, templates, navigation, siteConfig);
  buildTagPages(postsCache, templates, navigation);
  await buildRSSAndSitemap(postsCache, siteConfig);
  buildSearchIndex(postsCache);
  buildRobotsTxt(siteConfig);
  buildLlmsTxt(postsCache, siteConfig);
  build404Page();

  console.log(bright(`\n${success('Build complete!')} Output in /build`));
  console.log(dim(`   ${postsCache.size} posts + ${getTotalPages(postsCache)} index pages + ${getAllTags(postsCache).length} tag pages`));
  if (totalImages > 0) {
    console.log(dim(`   ${totalImages} images optimized`));
  }
}

export async function optimizeToCache(imageReferences, brokenImages) {
  console.log('');

  if (brokenImages.length > 0) {
    console.log(warning(`Broken image references detected:`));
    for (const broken of brokenImages) {
      console.log(dim(`  • ${broken.post} → ${broken.src} (file not found)`));
    }
    console.log('');
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const count = await optimizeImagesFromPosts(imageReferences, CACHE_DIR, true);
  cleanupOrphanedImages(imageReferences, CACHE_DIR);

  return count;
}

export { CACHE_DIR };
