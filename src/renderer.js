// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS)
// SPDX-License-Identifier: MPL-2.0

import { Feed } from 'feed';
import { SitemapStream, streamToPromise } from 'sitemap';
import { Readable } from 'stream';
import { buildTemplateContext } from './utils/template-context.js';
import { getEntriesSorted, getAllTags, getAllCategories, getAllSeries, slugify, normalizeToWebPath, getSiteConfig } from './utils/taxonomy.js';

// ============================================================================
// RE-EXPORTS DELETED - FORBIDDEN PATTERN
// ============================================================================
// Files needing these functions must import directly from source modules:
// - theme-system.js for: loadTheme, scanAvailableThemes, setActiveTheme, validateTheme, THYPRESS_FEATURES
// - content-processor.js for: loadAllContent, buildNavigationTree, processContentFile, optimizeImage, etc.
// - utils/taxonomy.js for: getAllTags, getAllCategories, etc.
// ============================================================================

export const POSTS_PER_PAGE = 10;

/**
 * Get pagination data for content list
 */
export function getPaginationData(contentCache, currentPage) {
  const totalPages = Math.ceil(contentCache.size / POSTS_PER_PAGE);
  const pages = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push('...');
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

/**
 * Get related pages based on shared tags
 */
export function getRelatedEntries(page, contentCache, limit = 3) {
  const allPages = Array.from(contentCache.values());
  return allPages
    .filter(p => p.slug !== page.slug)
    .map(p => ({
      ...p,
      score: page.tags ? page.tags.filter(t => p.tags.includes(t)).length : 0
    }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Render content list (index/pagination pages)
 */
export function renderEntryList(contentCache, page, templates, navigation, siteConfig = {}, themeMetadata = {}) {
  const startIndex = (page - 1) * POSTS_PER_PAGE;
  const allContent = getEntriesSorted(contentCache);
  const pageContent = allContent.slice(startIndex, startIndex + POSTS_PER_PAGE);

  const items = pageContent.map(entry => ({
    slug: entry.slug,
    url: entry.url,
    title: entry.title,
    date: entry.date,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    tags: entry.tags,
    description: entry.description,
    categories: entry.categories || [],
    series: entry.series || null
  }));

  const pagination = getPaginationData(contentCache, page);
  const indexTpl = templates.get('index');
  if (!indexTpl) throw new Error('Index template not found');

  const context = buildTemplateContext('index', {
    entries: items,
    pagination: pagination
  }, siteConfig, navigation, themeMetadata);

  return indexTpl(context);
}

/**
 * Render individual entry page
 */
export function renderEntry(entry, slug, templates, navigation, siteConfig = {}, contentCache = null, themeMetadata = {}) {
  // If content is pure HTML (not a markdown post), return it directly if rendered
  if (entry.type === 'html' && entry.renderedHtml) {
    return entry.renderedHtml;
  }

  // ROBUST TEMPLATE SELECTION (Inlined to remove dependency on theme-system.js)
  // 1. Default to 'entry'
  let template = templates.get('entry');

  // 2. Check for explicit template override in front-matter
  if (entry.template && templates.has(entry.template)) {
    template = templates.get(entry.template);
  }
  // 3. Check for layout hint in front-matter
  else if (entry.layout && templates.has(entry.layout)) {
    template = templates.get(entry.layout);
  }

  // 4. Fallback Safety
  if (!template) {
    if (templates.has('index')) {
      template = templates.get('index');
    } else {
      throw new Error(`Template not found for entry: ${slug} (and no 'index' fallback)`);
    }
  }

  const createdAtISO = new Date(entry.createdAt).toISOString();
  const updatedAtISO = new Date(entry.updatedAt).toISOString();

  let prevEntry = null;
  let nextEntry = null;

  if (contentCache) {
    const sortedContent = getEntriesSorted(contentCache);
    const currentIndex = sortedContent.findIndex(c => c.slug === slug);

    if (currentIndex !== -1) {
      if (currentIndex < sortedContent.length - 1) {
        prevEntry = { title: sortedContent[currentIndex + 1].title, url: sortedContent[currentIndex + 1].url };
      }
      if (currentIndex > 0) {
        nextEntry = { title: sortedContent[currentIndex - 1].title, url: sortedContent[currentIndex - 1].url };
      }
    }
  }

  const relatedEntries = contentCache ? getRelatedEntries(entry, contentCache) : [];

  const context = buildTemplateContext('entry', {
    entry: {
      html: entry.html || entry.renderedHtml,
      title: entry.title,
      slug: entry.slug,
      url: entry.url,
      date: entry.date,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      dateISO: createdAtISO,
      createdAtISO: createdAtISO,
      updatedAtISO: updatedAtISO,
      tags: entry.tags,
      description: entry.description,
      ogImage: entry.ogImage || null,
      wordCount: entry.wordCount,
      readingTime: entry.readingTime,
      categories: entry.categories || [],
      series: entry.series || null,
      // CRITICAL: Include ALL custom front-matter fields for theme flexibility
      ...(entry.frontMatter || {})
    },
    frontMatter: entry.frontMatter || {},
    prevEntry,
    nextEntry,
    relatedEntries,
    toc: entry.toc || []
  }, siteConfig, navigation, themeMetadata);

  return template(context);
}

/**
 * Render tag page
 */
export function renderTagPage(contentCache, tag, templates, navigation, siteConfig = {}, themeMetadata = {}) {
  const tagTpl = templates.get('tag') || templates.get('index');
  const allContent = getEntriesSorted(contentCache);
  const taggedContent = allContent.filter(entry => entry.tags.includes(tag));

  const items = taggedContent.map(entry => ({
    slug: entry.slug,
    url: entry.url,
    title: entry.title,
    date: entry.date,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    tags: entry.tags,
    description: entry.description
  }));

  const context = buildTemplateContext('tag', { tag: tag, entries: items }, siteConfig, navigation, themeMetadata);
  return tagTpl(context);
}

/**
 * Render category page
 */
export function renderCategoryPage(contentCache, category, templates, navigation, siteConfig = {}, themeMetadata = {}) {
  const categoryTpl = templates.get('category') || templates.get('tag') || templates.get('index');
  const allContent = getEntriesSorted(contentCache);
  const categoryContent = allContent.filter(entry => entry.categories && entry.categories.includes(category));

  const items = categoryContent.map(entry => ({
    slug: entry.slug,
    url: entry.url,
    title: entry.title,
    date: entry.date,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    tags: entry.tags,
    description: entry.description
  }));

  const context = buildTemplateContext('category', { category: category, entries: items }, siteConfig, navigation, themeMetadata);
  return categoryTpl(context);
}

/**
 * Render series page
 */
export function renderSeriesPage(contentCache, series, templates, navigation, siteConfig = {}, themeMetadata = {}) {
  const seriesTpl = templates.get('series') || templates.get('tag') || templates.get('index');
  const allContent = getEntriesSorted(contentCache);
  const seriesContent = allContent.filter(entry => entry.series === series);

  const items = seriesContent.map(entry => ({
    slug: entry.slug,
    url: entry.url,
    title: entry.title,
    date: entry.date,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    tags: entry.tags,
    description: entry.description
  }));

  const context = buildTemplateContext('series', { series: series, entries: items }, siteConfig, navigation, themeMetadata);
  return seriesTpl(context);
}

/**
 * Generate RSS feed
 */
export function generateRSS(contentCache, siteConfig = {}) {
  const { title = 'My Site', description = 'A site powered by THYPRESS', url = 'https://example.com', author = 'Anonymous' } = siteConfig;

  const feed = new Feed({
    title: title,
    description: description,
    id: url,
    link: url,
    language: 'en',
    favicon: `${url}/favicon.ico`,
    copyright: `All rights reserved ${new Date().getFullYear()}, ${author}`,
    author: { name: author, link: url }
  });

  const allContent = getEntriesSorted(contentCache);
  const recentContent = allContent.slice(0, 20);

  recentContent.forEach(entry => {
    feed.addItem({
      title: entry.title,
      id: `${url}${entry.url}`,
      link: `${url}${entry.url}`,
      description: entry.description || (entry.rawContent || entry.html || '').substring(0, 200),
      content: entry.html || entry.renderedHtml,
      author: [{ name: author }],
      date: new Date(entry.createdAt),
      published: new Date(entry.createdAt),
      updated: new Date(entry.updatedAt),
      category: entry.tags.map(tag => ({ name: tag }))
    });
  });

  return feed.rss2();
}

/**
 * Generate sitemap
 */
export async function generateSitemap(contentCache, siteConfig = {}) {
  const { url = 'https://example.com' } = siteConfig;
  const allContent = getEntriesSorted(contentCache);
  const allTags = getAllTags(contentCache);
  const allCategories = getAllCategories(contentCache);
  const allSeries = getAllSeries(contentCache);

  const links = [];
  links.push({ url: '/', changefreq: 'daily', priority: 1.0 });

  allContent.forEach(entry => {
    links.push({ url: entry.url, lastmod: entry.updatedAt, changefreq: 'monthly', priority: 0.8 });
  });

  allTags.forEach(tag => {
    links.push({ url: `/tag/${tag}/`, changefreq: 'weekly', priority: 0.5 });
  });

  allCategories.forEach(category => {
    links.push({ url: `/category/${category}/`, changefreq: 'weekly', priority: 0.6 });
  });

  allSeries.forEach(series => {
    links.push({ url: `/series/${slugify(series)}/`, changefreq: 'weekly', priority: 0.6 });
  });

  const stream = new SitemapStream({ hostname: url });
  const xml = await streamToPromise(Readable.from(links).pipe(stream));
  return xml.toString();
}

/**
 * Generate search index JSON
 */
export function generateSearchIndex(contentCache) {
  const allContent = getEntriesSorted(contentCache);
  const searchData = allContent.map(entry => ({
    id: entry.slug,
    title: entry.title,
    slug: entry.slug,
    url: entry.url,
    date: entry.date,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    tags: entry.tags,
    description: entry.description,
    content: (entry.rawContent || entry.html || '').replace(/[#*`\[\]]/g, '').replace(/\s+/g, ' ').trim().substring(0, 5000)
  }));
  return JSON.stringify(searchData, null, 0);
}
