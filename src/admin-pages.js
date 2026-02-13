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

import { ROUTES, MIME_TYPES } from './routes.js';

/**
 * Shared CSS styles for THYPRESS system pages (Admin, Login, Errors).
 * Decoupled from the HTML generator for reusability across different interfaces.
 * Contains:
 * 1. CSS Variables (The Grayscale Palette)
 * 2. Reset & Typography
 * 3. UI Components (Cards, Buttons, Badges)
 */
export const ADMIN_STYLES = `
    /* Base palette — pure grayscale */
    :root {
      --bg-light: #ffffff;
      --bg-dark:  #0d0d0d;
      --fg-light: #1a1a1a;
      --fg-dark:  #e6e6e6;
      /* Accents — neutral emphasis (no color) */
      --accent-light:   #2e2e2e;
      --accent-dark:    #d6d6d6;
      --accent-2-light: #4a4a4a;
      --accent-2-dark:  #b0b0b0;
      /* Muted text tiers */
      --muted-light:    #6b6b6b;
      --muted-2-light:  #9a9a9a;
      --muted-dark:     #9e9e9e;
      --muted-2-dark:   #6f6f6f;
      /* Borders */
      --border-light:   #e0e0e0;
      --border-dark:    #333333;
      /* Hover states */
      --hover-light:    #f5f5f5;
      --hover-dark:     #1a1a1a;
    }

    @media (prefers-color-scheme: dark) {
      :root { color-scheme: dark; }
    }

    html[data-theme="light"] {
      color-scheme: light;
      --bg: var(--bg-light);
      --fg: var(--fg-light);
      --accent: var(--accent-light);
      --accent-2: var(--accent-2-light);
      --muted: var(--muted-light);
      --muted-2: var(--muted-2-light);
      --border: var(--border-light);
      --hover: var(--hover-light);
    }

    html[data-theme="dark"] {
      color-scheme: dark;
      --bg: var(--bg-dark);
      --fg: var(--fg-dark);
      --accent: var(--accent-dark);
      --accent-2: var(--accent-2-dark);
      --muted: var(--muted-dark);
      --muted-2: var(--muted-2-dark);
      --border: var(--border-dark);
      --hover: var(--hover-dark);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      background: var(--bg);
      color: var(--fg);
      transition: background-color 0.2s, color 0.2s;
    }

    h1 {
      color: var(--fg);
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    h2 {
      margin-top: 2rem;
      margin-bottom: 0.5rem;
      border-bottom: 2px solid var(--border);
      color: var(--fg);
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }

    .theme-toggle {
      background: var(--accent);
      color: var(--bg);
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.9rem;
      transition: background-color 0.2s;
    }

    .theme-toggle:hover {
      background: var(--accent-2);
    }

    .stats {
      background: var(--hover);
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
      border: 1px solid var(--border);
    }

    .stats p {
      margin: 10px 0;
      color: var(--fg);
    }

    .stats strong {
      color: var(--accent);
    }

    .button {
      display: inline-block;
      padding: 12px 24px;
      background: var(--accent);
      color: var(--bg);
      text-decoration: none;
      border-radius: 4px;
      border: none;
      font-size: 16px;
      cursor: pointer;
      margin: 10px 10px 10px 0;
      font-family: inherit;
      transition: background-color 0.2s;
    }

    .button:hover {
      background: var(--accent-2);
    }

    .button:disabled {
      background: var(--muted-2);
      cursor: not-allowed;
      opacity: 0.5;
    }

    .button-secondary {
      background: var(--muted);
    }

    .button-secondary:hover {
      background: var(--accent-2);
    }

    #status {
      margin: 20px 0;
      padding: 12px;
      border-radius: 4px;
      display: none;
      border: 1px solid var(--border);
    }

    #status.info {
      background: var(--hover);
      color: var(--fg);
      display: block;
    }

    #status.success {
      background: var(--hover);
      color: var(--fg);
      display: block;
    }

    #status.error {
      background: var(--hover);
      color: var(--fg);
      display: block;
      border-color: var(--muted);
    }

    .back {
      color: var(--accent);
      text-decoration: none;
    }

    .back:hover {
      text-decoration: underline;
    }

    .theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1.5rem;
      margin: 2rem 0;
    }

    .theme-card {
      border: 2px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      background: var(--bg);
      transition: all 0.2s;
    }

    .theme-card:hover {
      border-color: var(--accent-2);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    .theme-card.active {
      border-color: var(--accent);
      background: var(--hover);
    }

    .theme-card.invalid {
      border-color: var(--muted);
      opacity: 0.6;
    }

    .theme-preview {
      width: 100%;
      height: 140px;
      background: var(--hover);
      border: 1px solid var(--border);
      border-radius: 4px;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: 0.9rem;
      overflow: hidden;
    }

    .theme-preview-img {
      width: 100%;
      height: auto;
      object-fit: cover;
      display: block;
    }

    .theme-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-top: 1.25rem;
      gap: 0.5rem;
    }

    .theme-name {
      font-weight: 600;
      font-size: 1.1rem;
      margin: 0;
      flex: 1;
      color: var(--fg);
    }

    .theme-badges {
      display: flex;
      gap: 0.35rem;
      flex-shrink: 0;
    }

    .theme-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-active {
      background: var(--accent);
      color: var(--bg);
    }

    .badge-default {
      background: var(--accent-2);
      color: var(--bg);
    }

    .badge-embedded {
      background: var(--muted);
      color: var(--bg);
    }

    .badge-invalid {
      background: var(--muted-2);
      color: var(--bg);
    }

    .theme-meta {
      font-size: 0.85rem;
      color: var(--muted);
      margin: 0.5rem 0;
    }

    .theme-description {
      font-size: 0.9rem;
      color: var(--fg);
      margin: 0.75rem 0;
      line-height: 1.4;
      min-height: 2.8em;
    }

    .theme-actions {
      margin-top: 1rem;
      display: flex;
      gap: 0.5rem;
    }
`;

/**
 * Generate admin panel HTML with grayscale theme
 * @param {Object} deps - Dependencies
 * @returns {string} Admin HTML
 */
export function generateAdminHTML(deps) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>THYPRESS Admin</title>
  <style>
    ${ADMIN_STYLES}
  </style>
</head>
<body>
  <div class="header">
    <p><a href="/" class="back">← Back to site</a></p>
    <button class="theme-toggle" onclick="toggleTheme()">
      Toggle <span id="theme-state">dark</span> theme
    </button>
  </div>

  <h1>THYPRESS Admin</h1>

  <div class="stats">
    <p><strong>Entries:</strong> ${deps.contentCache.size}</p>
    <p><strong>Mode:</strong> ${deps.contentMode}</p>
    <p><strong>Content root:</strong> ${deps.contentRoot}</p>
    <p><strong>Active theme:</strong> ${deps.activeTheme || '.default (embedded)'}</p>
    <p><strong>Fallback theme:</strong> ${deps.siteConfig.defaultTheme || '.default (binary)'}</p>
    <p><strong>Pre-rendered pages:</strong> ${deps.cacheManager.renderedCache.size}</p>
    <p><strong>Pre-compressed:</strong> ${deps.cacheManager.precompressedCache.size / 2} pages × 2 formats</p>
    <p><strong>Images cached:</strong> ${deps.imageReferences.size} files with images</p>
    <p><strong>Redirect rules:</strong> ${deps.redirectRules.size}</p>
    <p><strong>Live reload:</strong> ${deps.liveReloadClients.size} connected clients</p>
  </div>

  <h2>Theme Management</h2>
  <div id="themes-container">
    <p>Loading themes...</p>
  </div>

  <h2>Build Static Site</h2>
  <p>Generate a complete static build in /build folder for deployment.</p>

  <button id="buildBtn" class="button" onclick="buildSite()">Build Static Site</button>
  <button id="clearCacheBtn" class="button button-secondary" onclick="clearCache()">Clear Cache</button>

  <div id="status"></div>

  <script>
    // Theme toggle functionality
    function toggleTheme() {
      const html = document.documentElement;
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', newTheme);
      localStorage.setItem('thypress-theme', newTheme);
      updateThemeIcon(newTheme);
    }

    function updateThemeIcon(theme) {
      const icon = document.getElementById('theme-state');
      icon.textContent = theme === 'light' ? 'dark' : 'light';
    }

    // Initialize theme from localStorage or system preference
    function initTheme() {
      const saved = localStorage.getItem('thypress-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = saved || (prefersDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
      updateThemeIcon(theme);
    }

    initTheme();

    let themes = [];

    function setStatus(message, type) {
      const status = document.getElementById('status');
      status.textContent = message;
      status.className = type;
    }

    async function loadThemes() {
      try {
        const response = await fetch('${ROUTES.ADMIN_THEMES}');
        themes = await response.json();
        renderThemes();
      } catch (error) {
        document.getElementById('themes-container').innerHTML =
          '<p style="color: var(--muted);">Failed to load themes: ' + error.message + '</p>';
      }
    }

    function renderThemes() {
      const container = document.getElementById('themes-container');

      if (themes.length === 0) {
        container.innerHTML = '<p>No themes found</p>';
        return;
      }

      container.innerHTML = '<div class="theme-grid">' + themes.map(theme => {
        const activeClass  = theme.active   ? 'active'  : '';
        const invalidClass = !theme.valid   ? 'invalid' : '';
        // Only embedded/overridden themes can be the safety-net fallback;
        // local-only disk themes are not bundled in the binary.
        const canBeDefault = theme.type === 'embedded' || theme.type === 'overridden';

        // Build preview image HTML
        let previewHtml = '<div class="theme-preview">No preview</div>';
        if (theme.preview) {
          const previewUrl = \`/__thypress/theme-preview/\${theme.id}/\${theme.preview}\`;
          previewHtml = \`<img src="\${previewUrl}" alt="\${theme.name} preview" class="theme-preview-img" loading="lazy">\`;
        }

        return \`
          <div class="theme-card \${activeClass} \${invalidClass}">
            \${previewHtml}

            <div class="theme-header">
              <h3 class="theme-name">\${theme.name}</h3>
              <div class="theme-badges">
                \${theme.active    ? '<span class="theme-badge badge-active">ACTIVE</span>'     : ''}
                \${theme.isDefault ? '<span class="theme-badge badge-default">FALLBACK</span>'  : ''}
                \${theme.embedded  ? '<span class="theme-badge badge-embedded">EMBEDDED</span>' : ''}
                \${!theme.valid    ? '<span class="theme-badge badge-invalid">INVALID</span>'   : ''}
              </div>
            </div>

            <div class="theme-meta">
              <strong>Version:</strong> \${theme.version} |
              <strong>By:</strong> \${theme.author}
            </div>

            <p class="theme-description">\${theme.description}</p>

            <div class="theme-actions">
              \${!theme.active && theme.valid ? \`
                <button class="button" onclick="activateTheme('\${theme.id}')">
                  Activate Theme
                </button>
              \` : ''}
              \${canBeDefault && !theme.isDefault ? \`
                <button class="button button-secondary" onclick="setAsDefault('\${theme.id}')">
                  Set as Fallback
                </button>
              \` : ''}
            </div>
          </div>
        \`;
      }).join('') + '</div>';
    }

    async function activateTheme(themeId) {
      setStatus('Validating and activating theme...', 'info');

      try {
        const response = await fetch('${ROUTES.ADMIN_CONFIG}', {
          method: 'POST',
          headers: { 'Content-Type': '${MIME_TYPES.JSON}' },
          body: JSON.stringify({ key: 'theme', value: themeId })
        });

        const data = await response.json();

        if (data.success) {
          setStatus('Theme activated: ' + themeId + '. Reloading...', 'success');
          setTimeout(() => location.reload(), 1000);
        } else {
          setStatus('Failed to activate theme: ' + data.error, 'error');
        }
      } catch (error) {
        setStatus('Failed to activate theme: ' + error.message, 'error');
      }
    }

    async function setAsDefault(themeId) {
      setStatus('Setting fallback theme...', 'info');

      try {
        const response = await fetch('${ROUTES.ADMIN_CONFIG}', {
          method: 'POST',
          headers: { 'Content-Type': '${MIME_TYPES.JSON}' },
          body: JSON.stringify({ key: 'defaultTheme', value: themeId })
        });

        const data = await response.json();

        if (data.success) {
          setStatus('Fallback theme set to: ' + themeId + '. Reloading...', 'success');
          setTimeout(() => location.reload(), 1000);
        } else {
          setStatus('Failed to set fallback: ' + data.error, 'error');
        }
      } catch (error) {
        setStatus('Failed to set fallback: ' + error.message, 'error');
      }
    }

    async function buildSite() {
      const btn = document.getElementById('buildBtn');
      btn.disabled = true;
      setStatus('Building static site...', 'info');

      try {
        const response = await fetch('${ROUTES.ADMIN_BUILD}', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
          setStatus('Build complete! Check the /build folder.', 'success');
        } else {
          setStatus('Build failed: ' + data.error, 'error');
        }
      } catch (error) {
        setStatus('Build failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function clearCache() {
      const btn = document.getElementById('clearCacheBtn');
      btn.disabled = true;
      setStatus('Clearing cache...', 'info');

      try {
        const response = await fetch('${ROUTES.ADMIN_CLEAR_CACHE}', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
          setStatus('Cache cleared! Freed ' + data.freed + ' items. Reloading...', 'success');
          setTimeout(() => location.reload(), 1000);
        } else {
          setStatus('Clear cache failed: ' + data.error, 'error');
        }
      } catch (error) {
        setStatus('Clear cache failed: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    loadThemes();
  </script>
</body>
</html>`;
}
