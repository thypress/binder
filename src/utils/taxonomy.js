// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS <https://thypress.org>)
// SPDX-License-Identifier: MPL-2.0

import fs from 'fs';
import path from 'path';

/**
 * Unicode-safe slugify function
 */
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

/**
 * Normalize file path to web path (forward slashes)
 */
export function normalizeToWebPath(filePath) {
  return filePath.split(path.sep).join('/');
}

/**
 * Get all tags from content cache
 */
export function getAllTags(contentCache) {
  const tags = new Set();
  for (const content of contentCache.values()) {
    content.tags.forEach(tag => tags.add(tag));
  }
  return Array.from(tags).sort();
}

/**
 * Get all categories from content cache
 */
export function getAllCategories(contentCache) {
  const categories = new Set();
  for (const content of contentCache.values()) {
    if (content.categories) {
      content.categories.forEach(cat => categories.add(cat));
    }
  }
  return Array.from(categories).sort();
}

/**
 * Get all series from content cache
 */
export function getAllSeries(contentCache) {
  const series = new Set();
  for (const content of contentCache.values()) {
    if (content.series) {
      series.add(content.series);
    }
  }
  return Array.from(series).sort();
}

/**
 * Get entries sorted by creation date (newest first)
 */
export function getEntriesSorted(contentCache) {
  return Array.from(contentCache.values()).sort((a, b) => {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

//===========================================================================
/**
 * Recursively freezes an object to ensure the source of truth
 * cannot be tampered with at runtime.
 */
function deepFreeze(obj) {
  Object.getOwnPropertyNames(obj).forEach((key) => {
    const value = obj[key];
    if (
      value &&
      typeof value === "object" &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  });
  return Object.freeze(obj);
}

const DEFAULTS = {
  // === Core Settings ===
  url: 'https://example.com',
  title: 'My Site',
  author: 'Anonymous',
  description: 'A site powered by THYPRESS',

  // === Content Processing ===
  contentDir: 'content',
  skipDirs: [],
  readingSpeed: 200,
  escapeTextFiles: true,

  // === Image Handling ===
  strictImages: false,

  // === Theme System ===
  theme: '.default',
  forceTheme: false,
  defaultTheme: null,             // Fallback embedded theme ID (null = use binary default)
  fingerprintAssets: false,
  strictThemeIsolation: false,

  // === Template Routing ===
  // When true, content inside a subfolder (e.g. content/podcast/) will
  // automatically use a matching theme template (e.g. podcast.html) if one
  // exists, walking from the deepest folder toward the root until a match
  // is found. Disabled by default to prevent unexpected layout changes when
  // users drag-and-drop unrelated folders.
  matchTemplateToClosestDir: false,

  // === Dynamic Mode (thypress serve) ===
  disablePreRender: false,        // Skip warmup for faster dev startups
  disableLiveReload: false,       // Disable live reload
  preCompressContent: false,      // Pre-compress all pages (opt-in for production)

  // === Validation ===
  strictPreRender: true,          // Exit if ANY page fails during warmup
  strictTemplateValidation: true, // Exit if template syntax is invalid

  // === Security ===
  allowExternalRedirects: false,  // Allow redirects to external URLs
  allowedRedirectDomains: [],     // Whitelist of allowed domains for redirects

  // === Cache Configuration ===
  cacheMaxSize: 50 * 1024 * 1024  // 50MB in bytes (configurable)
};

// The Master Source (Immutable)
const frozenDefaults = deepFreeze(DEFAULTS);

/**
 * Returns a 100% detached deep copy for local updates.
 */
export const configDefaults = () => structuredClone(frozenDefaults);

/**
 * Load site configuration from config.json
 * Returns FULL config object - all fields preserved for template access
 */
export function getSiteConfig() {
  const defaults = configDefaults();

  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // CRITICAL: Merge with defaults but preserve ALL custom fields
      // This allows theme designers to add any config fields they want
      return { ...defaults, ...userConfig };
    }
  } catch (error) {
    console.error(`Error loading config.json: ${error.message}`);
    console.log('Using default configuration');
  }

  return defaults;
}
