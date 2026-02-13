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
// along with this program.  If not, see <https://www.gnu.org>.

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

/**
 * Load site configuration from config.json
 * Returns FULL config object - all fields preserved for template access
 */
export function getSiteConfig() {
  const defaults = {
    // === Core Settings ===
    title: 'My Site',
    description: 'A site powered by THYPRESS',
    url: 'https://example.com',
    author: 'Anonymous',

    // === Content Processing ===
    contentDir: 'content',
    skipDirs: [],
    readingSpeed: 200,
    escapeTextFiles: true,

    // === Image Handling ===
    strictImages: false,

    // === Theme System ===
    strictThemeIsolation: false,
    forceTheme: false,
    defaultTheme: null,             // Fallback embedded theme ID (null = use binary default)
    fingerprintAssets: false,

    // === Dynamic Mode (thypress serve) ===
    disablePreRender: false,        // Skip warmup for faster dev startups
    preCompressContent: false,      // Pre-compress all pages (opt-in for production)
    disableLiveReload: false,       // Disable live reload

    // === Validation ===
    strictPreRender: true,          // Exit if ANY page fails during warmup
    strictTemplateValidation: true, // Exit if template syntax is invalid

    // === Security ===
    allowExternalRedirects: false,  // Allow redirects to external URLs
    allowedRedirectDomains: [],     // Whitelist of allowed domains for redirects

    // === Cache Configuration ===
    cacheMaxSize: 50 * 1024 * 1024  // 50MB in bytes (configurable)
  };

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
