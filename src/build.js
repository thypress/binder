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
import matter from 'gray-matter';
import crypto from 'crypto';
import {
  loadAllContent,
  loadTheme,
  renderContentList,
  renderContent,
  renderTagPage,
  renderCategoryPage,
  renderSeriesPage,
  getAllTags,
  getAllCategories,
  getAllSeries,
  generateRSS,
  generateSitemap,
  generateSearchIndex,
  optimizeImage,
  getSiteConfig,
  getContentSorted,
  slugify
} from './renderer.js';
import { success, error as errorMsg, warning, info, dim, bright } from './utils/colors.js';

const BUILD_DIR = path.join(process.cwd(), 'build');
const CACHE_DIR = path.join(process.cwd(), '.cache');

const CONCURRENCY = Math.max(2, Math.floor(os.availableParallelism() * 0.75));

// Redirect status codes configuration
const REDIRECT_STATUS_CODES = {
  301: { type: 'permanent', description: 'Moved Permanently - Best for SEO', netlifyCode: '301', vercelPermanent: true },
  308: { type: 'permanent', description: 'Permanent Redirect - Preserves POST data', netlifyCode: '308', vercelPermanent: true },
  302: { type: 'temporary', description: 'Found - General temporary redirect', netlifyCode: '302', vercelPermanent: false },
  307: { type: 'temporary', description: 'Temporary Redirect - Preserves POST data', netlifyCode: '307', vercelPermanent: false },
  303: { type: 'functional', description: 'See Other - Post-form redirect', netlifyCode: '303', vercelPermanent: false }
};

const DEFAULT_STATUS_CODE = 301;

function shouldIgnore(name) {
  return name.startsWith('.');
}

function ensureBuildDir() {
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  console.log(success('Build directory created'));
}

// Simplified template detection with helper function
function renderTemplate(content, siteConfig, destPath, relPath, options = {}) {
  try {
    const template = Handlebars.compile(content);
    const rendered = template({
      siteUrl: siteConfig.url || 'https://example.com',
      siteTitle: siteConfig.title || 'My Site',
      siteDescription: siteConfig.description || 'A site powered by THYPRESS',
      author: siteConfig.author || 'Anonymous',
      ...siteConfig,
      theme: siteConfig.theme || {}
    });
    fs.writeFileSync(destPath, rendered);
    console.log(success(`Templated: ${relPath}`));
    return true;
  } catch (error) {
    if (options.softFail) {
      console.log(dim(`Skipped templating ${relPath}: ${error.message}`));
      return false;
    }
    console.error(errorMsg(`Template error in ${relPath}: ${error.message}`));
    process.exit(1);
  }
}

// FEATURE 7: Asset fingerprinting
const fingerprintCache = new Map();

function generateFingerprint(filePath) {
  if (fingerprintCache.has(filePath)) {
    return fingerprintCache.get(filePath);
  }

  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
  fingerprintCache.set(filePath, hash);
  return hash;
}

function copyThemeAssets(themeAssets, activeTheme, siteConfig) {
  if (!activeTheme) {
    console.log(info('No active theme, using embedded defaults'));
    return;
  }

  const themePath = path.join(process.cwd(), 'templates', activeTheme);
  const buildAssetsDir = path.join(BUILD_DIR, 'assets');

  if (!fs.existsSync(themePath)) {
    console.log(warning(`Theme directory not found: ${themePath}`));
    return;
  }

  fs.mkdirSync(buildAssetsDir, { recursive: true });

  function copyThemeFiles(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;
      if (entry.name.startsWith('_')) continue;
      if (entry.name.endsWith('.html')) continue;
      if (entry.isDirectory() && entry.name === 'partials') continue;

      const srcPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const ext = path.extname(entry.name).toLowerCase();

      if (entry.isDirectory()) {
        copyThemeFiles(srcPath, relPath);
      } else {
        const { data: frontMatter, content: fileContent } = matter(fs.readFileSync(srcPath, 'utf-8'));

        fs.mkdirSync(path.dirname(path.join(buildAssetsDir, relPath)), { recursive: true });

        // Priority 1 - Explicit front-matter
        if (frontMatter.template === true) {
          const destPath = path.join(buildAssetsDir, relPath);
          renderTemplate(fileContent, siteConfig, destPath, relPath);
          continue;
        }

        if (frontMatter.template === false) {
          fs.copyFileSync(srcPath, path.join(buildAssetsDir, relPath));
          continue;
        }

        // Priority 2 - Filename conventions
        const isExplicitTemplate =
          entry.name.startsWith('template-') ||
          entry.name.endsWith('.hbs') ||
          entry.name.endsWith('.handlebars');

        if (isExplicitTemplate) {
          const destPath = path.join(buildAssetsDir, relPath);
          renderTemplate(fileContent, siteConfig, destPath, relPath);
          continue;
        }

        // Priority 3 - Broad detection (opt-in)
        if (siteConfig.discoverTemplates === true) {
          const hasTemplateSyntax = fileContent.includes('{{') || fileContent.includes('{%');

          if (hasTemplateSyntax && (ext === '.css' || ext === '.js' || ext === '.txt' || ext === '.xml')) {
            const destPath = path.join(buildAssetsDir, relPath);
            if (!renderTemplate(fileContent, siteConfig, destPath, relPath, { softFail: true })) {
              fs.copyFileSync(srcPath, destPath);
            }
            continue;
          }
        }

        // FEATURE 7: Asset fingerprinting for CSS/JS
        if (siteConfig.fingerprintAssets && (ext === '.css' || ext === '.js')) {
          const fingerprint = generateFingerprint(srcPath);
          const parsedPath = path.parse(relPath);
          const fingerprintedName = `${parsedPath.name}.${fingerprint}${parsedPath.ext}`;
          const fingerprintedRelPath = path.join(parsedPath.dir, fingerprintedName);

          fs.copyFileSync(srcPath, path.join(buildAssetsDir, fingerprintedRelPath));
          console.log(success(`Fingerprinted: ${fingerprintedRelPath}`));
        } else {
          fs.copyFileSync(srcPath, path.join(buildAssetsDir, relPath));
        }
      }
    }
  }

  copyThemeFiles(themePath);
  console.log(success(`Copied theme assets from ${activeTheme}/`));
}

// Single loop image check
function needsOptimization(sourcePath, outputDir, basename, hash) {
  if (!fs.existsSync(sourcePath)) return false;

  const sourceMtime = fs.statSync(sourcePath).mtime.getTime();
  const variants = [400, 800, 1200].flatMap(size => [
    path.join(outputDir, `${basename}-${size}-${hash}.webp`),
    path.join(outputDir, `${basename}-${size}-${hash}.jpg`)
  ]);

  for (const variant of variants) {
    if (!fs.existsSync(variant)) return true;

    const variantMtime = fs.statSync(variant).mtime.getTime();
    if (sourceMtime > variantMtime) return true;
  }

  return false;
}

// Better progress bar with Unicode detection
function supportsUnicode() {
  return process.env.LANG?.includes('UTF-8') ||
         process.platform === 'darwin' ||
         process.platform === 'linux';
}

function getProgressBar(percentage, width = 20) {
  const filled = Math.floor(percentage / 100 * width);
  const empty = width - filled;

  if (supportsUnicode()) {
    return '█'.repeat(filled) + '░'.repeat(empty);
  } else {
    return '='.repeat(filled) + '-'.repeat(empty);
  }
}

async function optimizeImagesFromContent(imageReferences, outputBaseDir, showProgress = true) {
  const uniqueImages = new Map();
  for (const [contentPath, images] of imageReferences) {
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
    console.log(success(`Found ${imagesToOptimize.length} images in content/`));
  }

  const needsUpdate = [];
  for (const img of imagesToOptimize) {
    const outputDir = path.join(outputBaseDir, path.dirname(img.outputPath));
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

  for (let i = 0; i < needsUpdate.length; i += CONCURRENCY) {
    const batch = needsUpdate.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (img) => {
      const outputDir = path.join(outputBaseDir, path.dirname(img.outputPath));
      fs.mkdirSync(outputDir, { recursive: true });

      try {
        await optimizeImage(img.resolvedPath, outputDir, img.sizesToGenerate);
        optimized++;
        if (showProgress) {
          const percentage = Math.floor((optimized / needsUpdate.length) * 100);
          const bar = getProgressBar(percentage);
          process.stdout.write(`  [${bar}] ${percentage}% (${optimized}/${needsUpdate.length})\r`);
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
  const contentCacheDir = path.join(cacheDir);

  if (!fs.existsSync(contentCacheDir)) {
    return 0;
  }

  const validHashes = new Set();
  for (const [contentPath, images] of imageReferences) {
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
      if (shouldIgnore(entry.name)) continue;

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

  scanAndClean(contentCacheDir);

  if (removed > 0) {
    console.log(success(`Cleaned up ${removed} orphaned cache files`));
  }

  return removed;
}

function buildContent(contentCache, templates, navigation, siteConfig, mode) {
  let count = 0;

  for (const [slug, content] of contentCache) {
    if (content.type === 'html' && content.renderedHtml !== null) continue;

    const outputPath = path.join(BUILD_DIR, content.url.substring(1), 'index.html');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const html = renderContent(content, slug, templates, navigation, siteConfig, contentCache);
    fs.writeFileSync(outputPath, html);
    count++;
  }

  console.log(success(`Generated ${count} content pages`));
}

function buildIndexPages(contentCache, templates, navigation, siteConfig) {
  const POSTS_PER_PAGE = 10;
  const totalPages = Math.ceil(contentCache.size / POSTS_PER_PAGE);

  const indexHtml = renderContentList(contentCache, 1, templates, navigation, siteConfig);
  fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), indexHtml);
  console.log(success(`Generated index.html`));

  for (let page = 2; page <= totalPages; page++) {
    const pageDir = path.join(BUILD_DIR, 'page', page.toString());
    fs.mkdirSync(pageDir, { recursive: true });

    const pageHtml = renderContentList(contentCache, page, templates, navigation, siteConfig);
    fs.writeFileSync(path.join(pageDir, 'index.html'), pageHtml);
  }

  if (totalPages > 1) {
    console.log(success(`Generated ${totalPages - 1} pagination pages`));
  }
}

function buildTagPages(contentCache, templates, navigation, siteConfig) {
  const tags = getAllTags(contentCache);

  if (tags.length === 0) {
    return;
  }

  for (const tag of tags) {
    const tagDir = path.join(BUILD_DIR, 'tag', tag);
    fs.mkdirSync(tagDir, { recursive: true });

    const html = renderTagPage(contentCache, tag, templates, navigation);
    fs.writeFileSync(path.join(tagDir, 'index.html'), html);

    // FEATURE 3: RSS per tag
    const tagRss = generateRSS(
      new Map(Array.from(contentCache).filter(([k, v]) => v.tags.includes(tag))),
      { ...siteConfig, title: `${siteConfig.title} - ${tag}` }
    );
    fs.writeFileSync(path.join(tagDir, 'rss.xml'), tagRss);
  }

  console.log(success(`Generated ${tags.length} tag pages (with RSS feeds)`));
}

// FEATURE 5: Build category pages
function buildCategoryPages(contentCache, templates, navigation, siteConfig) {
  const categories = getAllCategories(contentCache);

  if (categories.length === 0) {
    return;
  }

  for (const category of categories) {
    const categoryDir = path.join(BUILD_DIR, 'category', category);
    fs.mkdirSync(categoryDir, { recursive: true });

    const html = renderCategoryPage(contentCache, category, templates, navigation);
    fs.writeFileSync(path.join(categoryDir, 'index.html'), html);

    const categoryRss = generateRSS(
      new Map(Array.from(contentCache).filter(([k, v]) => v.categories && v.categories.includes(category))),
      { ...siteConfig, title: `${siteConfig.title} - ${category}` }
    );
    fs.writeFileSync(path.join(categoryDir, 'rss.xml'), categoryRss);
  }

  console.log(success(`Generated ${categories.length} category pages (with RSS feeds)`));
}

// FEATURE 5: Build series pages
function buildSeriesPages(contentCache, templates, navigation, siteConfig) {
  const series = getAllSeries(contentCache);

  if (series.length === 0) {
    return;
  }

  for (const seriesName of series) {
    const seriesSlug = slugify(seriesName);
    const seriesDir = path.join(BUILD_DIR, 'series', seriesSlug);
    fs.mkdirSync(seriesDir, { recursive: true });

    const html = renderSeriesPage(contentCache, seriesName, templates, navigation);
    fs.writeFileSync(path.join(seriesDir, 'index.html'), html);

    const seriesRss = generateRSS(
      new Map(Array.from(contentCache).filter(([k, v]) => v.series === seriesName)),
      { ...siteConfig, title: `${siteConfig.title} - ${seriesName}` }
    );
    fs.writeFileSync(path.join(seriesDir, 'rss.xml'), seriesRss);
  }

  console.log(success(`Generated ${series.length} series pages (with RSS feeds)`));
}

async function buildRSSAndSitemap(contentCache, siteConfig) {
  const rss = generateRSS(contentCache, siteConfig);
  fs.writeFileSync(path.join(BUILD_DIR, 'rss.xml'), rss);
  console.log(success('Generated rss.xml'));

  const sitemap = await generateSitemap(contentCache, siteConfig);
  fs.writeFileSync(path.join(BUILD_DIR, 'sitemap.xml'), sitemap);
  console.log(success('Generated sitemap.xml'));
}

function buildSearchIndex(contentCache) {
  const searchJson = generateSearchIndex(contentCache);
  fs.writeFileSync(path.join(BUILD_DIR, 'search.json'), searchJson);
  console.log(success('Generated search.json'));
}

function buildRobotsTxt(siteConfig, themeAssets) {
  try {
    let content;

    if (themeAssets.has('robots.txt')) {
      const asset = themeAssets.get('robots.txt');
      if (asset.type === 'template') {
        content = asset.compiled({
          siteUrl: siteConfig.url || 'https://example.com',
          siteTitle: siteConfig.title || 'My Site',
          ...siteConfig
        });
      } else {
        content = asset.content;
      }
    } else {
      content = `User-agent: *\nAllow: /\n\nSitemap: ${siteConfig.url || 'https://example.com'}/sitemap.xml\n`;
    }

    fs.writeFileSync(path.join(BUILD_DIR, 'robots.txt'), content);
    console.log(success('Generated robots.txt'));
  } catch (error) {
    console.error(errorMsg(`Failed to generate robots.txt: ${error.message}`));
  }
}

function buildLlmsTxt(contentCache, siteConfig, themeAssets) {
  try {
    let content;

    if (themeAssets.has('llms.txt')) {
      const asset = themeAssets.get('llms.txt');
      if (asset.type === 'template') {
        const recentContent = getContentSorted(contentCache).slice(0, 10).map(c => ({
          title: c.title,
          url: c.url,
          slug: c.slug
        }));
        const allTags = getAllTags(contentCache);

        content = asset.compiled({
          siteTitle: siteConfig.title || 'My Site',
          siteDescription: siteConfig.description || 'A site powered by THYPRESS',
          siteUrl: siteConfig.url || 'https://example.com',
          recentPosts: recentContent,
          allTags: allTags,
          ...siteConfig
        });
      } else {
        content = asset.content;
      }
    } else {
      const recentContent = getContentSorted(contentCache).slice(0, 10);
      content = `# ${siteConfig.title || 'My Site'}\n\n> ${siteConfig.description || 'A site powered by THYPRESS'}\n\n## Recent Posts\n`;

      for (const item of recentContent) {
        content += `- [${item.title}](${siteConfig.url || 'https://example.com'}${item.url})\n`;
      }

      content += `\n## Full Sitemap\n${siteConfig.url || 'https://example.com'}/sitemap.xml\n`;
    }

    fs.writeFileSync(path.join(BUILD_DIR, 'llms.txt'), content);
    console.log(success('Generated llms.txt'));
  } catch (error) {
    console.error(errorMsg(`Failed to generate llms.txt: ${error.message}`));
  }
}

function build404Page(themeAssets) {
  try {
    let content404;

    if (themeAssets.has('404.html')) {
      const asset = themeAssets.get('404.html');
      content404 = asset.type === 'static' ? asset.content : asset.content;
    } else {
      content404 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Page Not Found</title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <main>
    <h1>404 - Page Not Found</h1>
    <p>The page you're looking for doesn't exist.</p>
    <p><a href="/">← Back to Home</a></p>
  </main>
</body>
</html>`;
    }

    fs.writeFileSync(path.join(BUILD_DIR, '404.html'), content404);
    console.log(success('Generated 404.html'));
  } catch (error) {
    console.error(errorMsg(`Failed to generate 404.html: ${error.message}`));
  }
}

// FEATURE 4: Enhanced redirect system with Dual-Build Strategy
function parseRedirectRules(redirectsData) {
  const rules = [];
  const errors = [];

  for (const [from, toData] of Object.entries(redirectsData)) {
    // Skip comment keys
    if (from.startsWith('_')) continue;

    // Validate "from" path
    if (!from.startsWith('/')) {
      errors.push(`Invalid "from" path "${from}": must start with /`);
      continue;
    }

    // Parse destination and status code
    let to, statusCode;

    if (typeof toData === 'string') {
      // Simple format: { "/old": "/new" }
      to = toData;
      statusCode = DEFAULT_STATUS_CODE;
    } else if (typeof toData === 'object' && toData.to) {
      // Advanced format: { "/old": { "to": "/new", "statusCode": 302 } }
      to = toData.to;
      statusCode = toData.statusCode || DEFAULT_STATUS_CODE;
    } else {
      errors.push(`Invalid redirect rule for "${from}": must be string or object with "to" property`);
      continue;
    }

    // Validate "to" path
    if (!to.startsWith('/') && !to.startsWith('http://') && !to.startsWith('https://')) {
      errors.push(`Invalid "to" path "${to}": must start with / or be absolute URL`);
      continue;
    }

    // Validate status code
    if (!REDIRECT_STATUS_CODES[statusCode]) {
      errors.push(`Invalid status code ${statusCode} for "${from}": must be 301, 302, 303, 307, or 308`);
      continue;
    }

    rules.push({ from, to, statusCode });
  }

  return { rules, errors };
}

function generateFallbackHTML(to, statusCode) {
  const isPermanent = REDIRECT_STATUS_CODES[statusCode].type === 'permanent';
  const statusInfo = REDIRECT_STATUS_CODES[statusCode];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="0; url=${to}">
  <link rel="canonical" href="${to}">
  <title>Redirecting...</title>
  <script>window.location.replace("${to}");</script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f9f9f9;
      text-align: center;
      padding: 2rem;
    }
    .container {
      max-width: 500px;
    }
    h1 {
      font-size: 1.5rem;
      color: #2a2a2a;
      margin-bottom: 1rem;
    }
    p {
      color: #666;
      line-height: 1.6;
    }
    a {
      color: #1d7484;
      text-decoration: none;
      font-weight: 600;
    }
    a:hover {
      text-decoration: underline;
    }
    .status {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.5rem 1rem;
      background: ${isPermanent ? '#e8f5e9' : '#fff3e0'};
      color: ${isPermanent ? '#388e3c' : '#f57c00'};
      border-radius: 4px;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Redirecting...</h1>
    <p>
      This page has ${isPermanent ? 'permanently' : 'temporarily'} moved.<br>
      If you are not automatically redirected, please click:
    </p>
    <p><a href="${to}">${to}</a></p>
    <div class="status">${statusCode} - ${statusInfo.description}</div>
  </div>
</body>
</html>`;
}

function buildRedirects() {
  const redirectsPath = path.join(process.cwd(), 'redirects.json');

  if (!fs.existsSync(redirectsPath)) {
    return;
  }

  try {
    const redirectsData = JSON.parse(fs.readFileSync(redirectsPath, 'utf-8'));
    const { rules, errors } = parseRedirectRules(redirectsData);

    // Report validation errors
    if (errors.length > 0) {
      console.error(errorMsg('Redirect validation errors:'));
      errors.forEach(err => console.log(dim(`  • ${err}`)));
      process.exit(1);
    }

    if (rules.length === 0) {
      console.log(warning('No valid redirect rules found'));
      return;
    }

    // ========================================
    // STRATEGY 1: Smart Host Files
    // ========================================

    // Generate _redirects file for Netlify/Cloudflare Pages
    let netlifyRedirects = '# Generated by THYPRESS\n';
    netlifyRedirects += '# Format: from to status-code\n\n';

    for (const rule of rules) {
      netlifyRedirects += `${rule.from} ${rule.to} ${rule.statusCode}\n`;
    }
    fs.writeFileSync(path.join(BUILD_DIR, '_redirects'), netlifyRedirects);

    // Generate vercel.json for Vercel
    const vercelConfig = {
      redirects: rules.map(rule => ({
        source: rule.from,
        destination: rule.to,
        permanent: REDIRECT_STATUS_CODES[rule.statusCode].vercelPermanent,
        statusCode: rule.statusCode
      }))
    };
    fs.writeFileSync(path.join(BUILD_DIR, 'vercel.json'), JSON.stringify(vercelConfig, null, 2));

    // ========================================
    // STRATEGY 2: Dumb Host Fallback HTML
    // ========================================

    let fallbackCount = 0;
    const skippedExternal = [];

    for (const rule of rules) {
      // Skip external redirects (can't create fallback HTML)
      if (rule.to.startsWith('http://') || rule.to.startsWith('https://')) {
        skippedExternal.push(rule.from);
        continue;
      }

      // Determine output path for fallback HTML
      let fallbackPath;

      if (rule.from.endsWith('/')) {
        // Path with trailing slash: /old-post/
        fallbackPath = path.join(BUILD_DIR, rule.from, 'index.html');
      } else {
        // Path without trailing slash: /old-post
        // Create both /old-post.html and /old-post/index.html for maximum compatibility
        const htmlPath = path.join(BUILD_DIR, rule.from + '.html');
        const indexPath = path.join(BUILD_DIR, rule.from, 'index.html');

        // Generate and write both versions
        const html = generateFallbackHTML(rule.to, rule.statusCode);

        fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
        fs.writeFileSync(htmlPath, html);

        fs.mkdirSync(path.dirname(indexPath), { recursive: true });
        fs.writeFileSync(indexPath, html);

        fallbackCount += 2;
        continue;
      }

      // Create directory structure
      const fallbackDir = path.dirname(fallbackPath);
      fs.mkdirSync(fallbackDir, { recursive: true });

      // Generate and write fallback HTML
      const html = generateFallbackHTML(rule.to, rule.statusCode);
      fs.writeFileSync(fallbackPath, html);

      fallbackCount++;
    }

    // ========================================
    // Success Report
    // ========================================

    console.log(success(`Generated redirect rules (${rules.length} redirects)`));
    console.log(dim(`  Smart hosts: _redirects (Netlify/Cloudflare), vercel.json (Vercel)`));
    console.log(dim(`  Dumb hosts: ${fallbackCount} fallback HTML files`));

    if (skippedExternal.length > 0) {
      console.log(warning(`  External redirects (no fallback): ${skippedExternal.length}`));
    }

    // Status code breakdown
    const statusBreakdown = rules.reduce((acc, rule) => {
      acc[rule.statusCode] = (acc[rule.statusCode] || 0) + 1;
      return acc;
    }, {});

    console.log(dim(`  Status codes: ${Object.entries(statusBreakdown).map(([code, count]) => `${count}×${code}`).join(', ')}`));

  } catch (error) {
    console.error(errorMsg(`Failed to generate redirects: ${error.message}`));
    process.exit(1);
  }
}

function copyStaticHtmlFiles(contentCache) {
  let count = 0;

  for (const [slug, content] of contentCache) {
    if (content.type === 'html' && content.renderedHtml !== null) {
      const outputPath = path.join(BUILD_DIR, content.url.substring(1), 'index.html');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, content.renderedHtml);
      count++;
    }
  }

  if (count > 0) {
    console.log(success(`Copied ${count} static HTML files`));
  }
}

function copyStaticFilesFromContent(contentRoot) {
  if (!fs.existsSync(contentRoot)) return;

  let count = 0;

  function copyStatic(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;
      if (entry.isDirectory() && entry.name === 'drafts') continue;

      const srcPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        copyStatic(srcPath, relPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.md' || ext === '.txt' || ext === '.html') continue;

        if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) continue;

        const destPath = path.join(BUILD_DIR, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        count++;
      }
    }
  }

  copyStatic(contentRoot);

  if (count > 0) {
    console.log(success(`Copied ${count} static files from content/`));
  }
}

export async function build() {
  console.log(bright('Building static site...\n'));

  const { contentCache, navigation, imageReferences, brokenImages, mode, contentRoot } = loadAllContent();
  const siteConfig = getSiteConfig();
  // Validate theme before building
  const themeResult = await loadTheme(siteConfig.theme);
  const { templatesCache, themeAssets, activeTheme, validation } = themeResult;

  // Check validation (skip for .default)
  if (activeTheme !== '.default' && validation && !validation.valid) {
    console.log('');
    console.error(errorMsg(`  Theme "${activeTheme}" validation failed`));
    console.log('');

    // Show errors
    if (validation.errors.length > 0) {
      console.log(errorMsg('Errors:'));
      validation.errors.forEach(err => {
        console.log(dim(`  • ${err}`));
      });
      console.log('');
    }

    // Show warnings
    if (validation.warnings.length > 0) {
      console.log(warning('Warnings:'));
      validation.warnings.forEach(warn => {
        console.log(dim(`  • ${warn}`));
      });
      console.log('');
    }

    console.log(info('Fix:'));
    console.log(dim('  1. Fix the errors listed above'));
    console.log(dim('  2. Set forceTheme: true in config.json to build anyway (not recommended)'));
    console.log(dim('  3. Switch to a different theme in config.json'));
    console.log('');

    // Check forceTheme
    if (siteConfig.forceTheme !== true) {
      console.log(errorMsg('Build aborted due to theme validation errors'));
      process.exit(1);
    } else {
      console.log(warning('  forceTheme enabled - building with broken theme'));
      console.log(warning('Site may have rendering errors or broken pages'));
      console.log('');
    }
  }

  // Show warnings even for valid themes
  if (validation && validation.warnings.length > 0) {
    console.log(warning(`Theme "${activeTheme}" has warnings:`));
    validation.warnings.forEach(warn => {
      console.log(dim(`  • ${warn}`));
    });
    console.log('');
  }

  // Validate critical templates
  if (!templatesCache.has('index')) {
    console.log(errorMsg('Missing required template: index.html'));
    return;
  }

  if (!templatesCache.has('post')) {
    console.log(errorMsg('Missing required template: post.html'));
    return;
  }

  console.log(success('✓ Theme validation passed'));


  if (contentCache.size === 0) {
    console.log(warning('No content found in content directory'));
    return;
  }

  if (!templatesCache.has('index')) {
    console.log(errorMsg('Missing required template: index.html'));
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
  copyThemeAssets(themeAssets, activeTheme, siteConfig);

  const imagesCount = await optimizeImagesFromContent(imageReferences, BUILD_DIR, true);

  buildContent(contentCache, templatesCache, navigation, siteConfig, mode);
  buildIndexPages(contentCache, templatesCache, navigation, siteConfig);
  buildTagPages(contentCache, templatesCache, navigation, siteConfig);
  buildCategoryPages(contentCache, templatesCache, navigation, siteConfig);
  buildSeriesPages(contentCache, templatesCache, navigation, siteConfig);
  await buildRSSAndSitemap(contentCache, siteConfig);
  buildSearchIndex(contentCache);
  buildRobotsTxt(siteConfig, themeAssets);
  buildLlmsTxt(contentCache, siteConfig, themeAssets);
  build404Page(themeAssets);
  buildRedirects();
  copyStaticHtmlFiles(contentCache);
  copyStaticFilesFromContent(contentRoot);

  console.log(bright(`\n${success('Build complete!')} Output in /build`));
  console.log(dim(`   ${contentCache.size} content files + ${getAllTags(contentCache).length} tag pages`));
  if (imagesCount > 0) {
    console.log(dim(`   ${imagesCount} images optimized`));
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

  const count = await optimizeImagesFromContent(imageReferences, CACHE_DIR, true);
  cleanupOrphanedImages(imageReferences, CACHE_DIR);

  return count;
}

export { CACHE_DIR, REDIRECT_STATUS_CODES, DEFAULT_STATUS_CODE, parseRedirectRules };
