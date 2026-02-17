// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS)
// SPDX-License-Identifier: MPL-2.0

/**
 * Build unified template context for all page types
 * Passes FULL objects - no cherry-picking, maximum extensibility
 *
 * @param {string} pageType - 'entry', 'index', 'tag', 'category', 'series', '404'
 * @param {object} data - Page-specific data
 * @param {object} siteConfig - Full config.json object
 * @param {array} navigation - Navigation tree
 * @param {object} themeMetadata - Theme metadata from theme.json or front-matter
 * @returns {object} Complete template context
 */
export function buildTemplateContext(pageType, data, siteConfig = {}, navigation = [], themeMetadata = {}) {
  // Base context - ALWAYS present in every template
  const context = {
    // === FULL OBJECTS (extensible) ===
    config: { ...siteConfig },           // ALL config.json fields
    theme: { ...themeMetadata },         // ALL theme metadata fields

    // === STRUCTURAL ===
    navigation: navigation,              // Navigation tree
    pageType: pageType,                  // Current page type identifier
  };

  // Add page-specific context
  switch (pageType) {
    case 'entry':
      Object.assign(context, {
        // Full entry object with ALL fields (including custom front-matter)
        entry: { ...data.entry },

        // Navigation
        prevEntry: data.prevEntry || null,
        nextEntry: data.nextEntry || null,

        // Related content
        relatedEntries: data.relatedEntries || [],

        // Table of contents
        toc: data.toc || [],
        hasToc: (data.toc && data.toc.length > 0) || false,
      });
      break;

    case 'index':
      Object.assign(context, {
        entries: data.entries || [],
        hasEntriesList: true,
        pagination: data.pagination || null,
      });
      break;

    case 'tag':
      Object.assign(context, {
        tag: data.tag,
        entries: data.entries || [],
        hasEntriesList: true,
      });
      break;

    case 'category':
      Object.assign(context, {
        category: data.category,
        entries: data.entries || [],
        hasEntriesList: true,
      });
      break;

    case 'series':
      Object.assign(context, {
        series: data.series,
        entries: data.entries || [],
        hasEntriesList: true,
      });
      break;
  }

  return context;
}
