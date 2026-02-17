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

import { MIME_TYPES } from './routes.js';

/**
 * Shared CSS styles for THYPRESS system pages (Admin, Login, Errors).
 * Decoupled from the HTML generator for reusability across different interfaces.
 */
export const ADMIN_STYLES = `
    /* Base palette — pure grayscale */
    :root {
      --bg-light: #ffffff;
      --bg-dark:  #0d0d0d;
      --fg-light: #1a1a1a;
      --fg-dark:  #e6e6e6;
      --accent-light:   #2e2e2e;
      --accent-dark:    #d6d6d6;
      --accent-2-light: #4a4a4a;
      --accent-2-dark:  #b0b0b0;
      --muted-light:    #6b6b6b;
      --muted-2-light:  #9a9a9a;
      --muted-dark:     #9e9e9e;
      --muted-2-dark:   #6f6f6f;
      --border-light:   #e0e0e0;
      --border-dark:    #333333;
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

    .badge-active   { background: var(--accent);   color: var(--bg); }
    .badge-default  { background: var(--accent-2);  color: var(--bg); }
    .badge-embedded { background: var(--muted);     color: var(--bg); }
    .badge-invalid  { background: var(--muted-2);   color: var(--bg); }

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

// ============================================================================
// ADMIN PANEL
// ============================================================================

/**
 * Generate admin panel HTML.
 * @param {Object} deps        - Server dependencies (contentCache, siteConfig, etc.)
 * @param {string} adminBase   - Dynamic admin base path, e.g. /__thypress_a1b2c3d4e5f6
 */
export function generateAdminHTML(deps, adminBase = '/__thypress') {
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
    // Theme toggle
    function toggleTheme() {
      const html = document.documentElement;
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', newTheme);
      localStorage.setItem('thypress-theme', newTheme);
      updateThemeIcon(newTheme);
    }

    function updateThemeIcon(theme) {
      document.getElementById('theme-state').textContent = theme === 'light' ? 'dark' : 'light';
    }

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
        const response = await fetch('${adminBase}/themes');
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
        const activeClass  = theme.active  ? 'active'  : '';
        const invalidClass = !theme.valid  ? 'invalid' : '';
        const canBeDefault = theme.type === 'embedded' || theme.type === 'overridden';

        let previewHtml = '<div class="theme-preview">No preview</div>';
        if (theme.preview) {
          const previewUrl = \`${adminBase}/theme-preview/\${theme.id}/\${theme.preview}\`;
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
        const response = await fetch('${adminBase}/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        const response = await fetch('${adminBase}/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        const response = await fetch('${adminBase}/build', { method: 'POST' });
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
        const response = await fetch('${adminBase}/clear-cache', { method: 'POST' });
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

// ============================================================================
// LOGIN PAGE
// ============================================================================

/**
 * Generate login page HTML with PIN + Proof-of-Work authentication.
 * @param {Object} options - { hasPin: boolean }
 */
 /**
  * Generate login/setup page HTML
  *
  * Handles three states:
  *   1. Magic link token in URL  → auto-authenticate silently, redirect to admin
  *   2. No PIN set yet           → PIN creation form (set + confirm)
  *   3. PIN already set          → PIN login form with PoW
  *
  * @param {Object} options - { hasPin: boolean, adminBase: string }
  * @returns {string} Complete HTML page
  */
 export function generateLoginHTML({ hasPin, adminBase }) {
   return `<!DOCTYPE html>
 <html lang="en" data-theme="light">
 <head>
   <meta charset="UTF-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0">
   <title>THYPRESS Admin - ${hasPin ? 'Login' : 'Setup'}</title>
   <style>
     ${ADMIN_STYLES}

     .login-container {
       max-width: 400px;
       margin: 10vh auto;
       padding: 2rem;
     }

     .login-card {
       background: var(--hover);
       border: 2px solid var(--border);
       border-radius: 8px;
       padding: 2rem;
     }

     .login-title {
       text-align: center;
       margin-bottom: 0.5rem;
       color: var(--fg);
     }

     .login-subtitle {
       text-align: center;
       margin-bottom: 2rem;
       color: var(--muted);
       font-size: 0.9rem;
     }

     .form-group {
       margin-bottom: 1.5rem;
     }

     .form-label {
       display: block;
       margin-bottom: 0.5rem;
       color: var(--fg);
       font-weight: 600;
     }

     .form-input {
       width: 100%;
       padding: 0.75rem;
       border: 1px solid var(--border);
       border-radius: 4px;
       font-family: inherit;
       font-size: 1.2rem;
       letter-spacing: 0.4em;
       text-align: center;
       background: var(--bg);
       color: var(--fg);
       transition: border-color 0.2s;
     }

     .form-input:focus {
       outline: none;
       border-color: var(--accent);
     }

     .submit-button {
       width: 100%;
       padding: 0.75rem;
       background: var(--accent);
       color: var(--bg);
       border: none;
       border-radius: 4px;
       font-family: inherit;
       font-size: 1rem;
       font-weight: 600;
       cursor: pointer;
       transition: background-color 0.2s;
     }

     .submit-button:hover:not(:disabled) {
       background: var(--accent-2);
     }

     .submit-button:disabled {
       background: var(--muted);
       cursor: not-allowed;
       opacity: 0.6;
     }

     .status-message {
       margin-top: 1rem;
       padding: 0.75rem;
       border-radius: 4px;
       text-align: center;
       display: none;
       border: 1px solid var(--border);
       background: var(--hover);
       color: var(--fg);
     }

     .status-message.visible {
       display: block;
     }

     .status-message.error {
       border-color: var(--muted);
     }

     .pow-status {
       margin-top: 0.5rem;
       font-size: 0.85rem;
       color: var(--muted);
       text-align: center;
       min-height: 1.2em;
     }

     .theme-toggle {
       position: absolute;
       top: 1.5rem;
       right: 1.5rem;
     }
   </style>
 </head>
 <body>
   <button class="theme-toggle button" onclick="toggleTheme()">
     Toggle <span id="theme-state">dark</span> theme
   </button>

   <div class="login-container">
     <div class="login-card">
       <h1 class="login-title">THYPRESS Admin</h1>
       <p class="login-subtitle">${hasPin ? 'Enter your PIN to continue' : 'Set a PIN to protect your admin panel'}</p>

       ${hasPin ? `
       <!-- LOGIN FORM -->
       <form id="loginForm">
         <div class="form-group">
           <label for="pin" class="form-label">PIN</label>
           <input
             type="password"
             id="pin"
             class="form-input"
             maxlength="4"
             inputmode="numeric"
             placeholder="••••"
             autocomplete="off"
             required
           />
         </div>

         <button type="submit" class="submit-button" id="submitBtn">Login</button>
         <div class="pow-status" id="powStatus"></div>
         <div class="status-message" id="statusMessage"></div>
       </form>
       ` : `
       <!-- FIRST-RUN PIN SETUP FORM -->
       <form id="setupForm">
         <div class="form-group">
           <label for="newPin" class="form-label">Choose a 4-digit PIN</label>
           <input
             type="password"
             id="newPin"
             class="form-input"
             maxlength="4"
             inputmode="numeric"
             placeholder="••••"
             autocomplete="new-password"
             required
           />
         </div>

         <div class="form-group">
           <label for="confirmPin" class="form-label">Confirm PIN</label>
           <input
             type="password"
             id="confirmPin"
             class="form-input"
             maxlength="4"
             inputmode="numeric"
             placeholder="••••"
             autocomplete="new-password"
             required
           />
         </div>

         <button type="submit" class="submit-button" id="setupBtn">Set PIN &amp; Enter</button>
         <div class="status-message" id="statusMessage"></div>
       </form>
       `}
     </div>
   </div>

   <script>
     // -----------------------------------------------------------------------
     // Theme
     // -----------------------------------------------------------------------
     function toggleTheme() {
       const html = document.documentElement;
       const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
       html.setAttribute('data-theme', next);
       localStorage.setItem('thypress-theme', next);
       document.getElementById('theme-state').textContent = next === 'light' ? 'dark' : 'light';
     }

     (function initTheme() {
       const saved = localStorage.getItem('thypress-theme');
       const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
       const theme = saved || (prefersDark ? 'dark' : 'light');
       document.documentElement.setAttribute('data-theme', theme);
       document.getElementById('theme-state').textContent = theme === 'light' ? 'dark' : 'light';
     })();

     // -----------------------------------------------------------------------
     // Helpers
     // -----------------------------------------------------------------------
     const adminBase = ${JSON.stringify(adminBase)};

     function showStatus(msg, isError = false) {
       const el = document.getElementById('statusMessage');
       el.textContent = msg;
       el.className = 'status-message visible' + (isError ? ' error' : '');
     }

     // -----------------------------------------------------------------------
     // SHA-256 (synchronous, used for Proof-of-Work mining)
     // -----------------------------------------------------------------------
     function rightRotate(n, d) {
       return (n >>> d) | (n << (32 - d));
     }

     function sha256(str) {
       const H = [
         0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
         0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
       ];
       const K = [
         0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
         0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
         0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
         0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
         0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
         0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
         0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
         0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
       ];

       const msg = unescape(encodeURIComponent(str));
       const msgLen = msg.length;
       const paddedLen = Math.ceil((msgLen + 9) / 64) * 64;
       const padded = new Uint8Array(paddedLen);

       for (let i = 0; i < msgLen; i++) padded[i] = msg.charCodeAt(i);
       padded[msgLen] = 0x80;

       const bitLen = msgLen * 8;
       padded[paddedLen - 4] = (bitLen >>> 24) & 0xff;
       padded[paddedLen - 3] = (bitLen >>> 16) & 0xff;
       padded[paddedLen - 2] = (bitLen >>> 8)  & 0xff;
       padded[paddedLen - 1] =  bitLen         & 0xff;

       for (let cs = 0; cs < paddedLen; cs += 64) {
         const W = new Uint32Array(64);
         for (let i = 0; i < 16; i++) {
           const o = cs + i * 4;
           W[i] = (padded[o] << 24) | (padded[o+1] << 16) | (padded[o+2] << 8) | padded[o+3];
         }
         for (let i = 16; i < 64; i++) {
           const s0 = rightRotate(W[i-15], 7)  ^ rightRotate(W[i-15], 18) ^ (W[i-15] >>> 3);
           const s1 = rightRotate(W[i-2],  17) ^ rightRotate(W[i-2],  19) ^ (W[i-2]  >>> 10);
           W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
         }

         let [a, b, c, d, e, f, g, h] = H;

         for (let i = 0; i < 64; i++) {
           const S1   = rightRotate(e, 6)  ^ rightRotate(e, 11) ^ rightRotate(e, 25);
           const ch   = (e & f) ^ (~e & g);
           const t1   = (h + S1 + ch + K[i] + W[i]) >>> 0;
           const S0   = rightRotate(a, 2)  ^ rightRotate(a, 13) ^ rightRotate(a, 22);
           const maj  = (a & b) ^ (a & c)  ^ (b & c);
           const t2   = (S0 + maj) >>> 0;
           h = g; g = f; f = e; e = (d + t1) >>> 0;
           d = c; c = b; b = a; a = (t1 + t2) >>> 0;
         }

         H[0] = (H[0]+a) >>> 0; H[1] = (H[1]+b) >>> 0;
         H[2] = (H[2]+c) >>> 0; H[3] = (H[3]+d) >>> 0;
         H[4] = (H[4]+e) >>> 0; H[5] = (H[5]+f) >>> 0;
         H[6] = (H[6]+g) >>> 0; H[7] = (H[7]+h) >>> 0;
       }

       return H.map(h => h.toString(16).padStart(8, '0')).join('');
     }

     // -----------------------------------------------------------------------
     // Proof-of-Work miner (non-blocking, yields every 50ms)
     // -----------------------------------------------------------------------
     function minePoW(salt) {
       return new Promise(resolve => {
         let nonce = 0;

         function tick() {
           const deadline = Date.now() + 50;

           while (Date.now() < deadline) {
             if (sha256(salt + nonce).startsWith('0000')) {
               return resolve(nonce.toString());
             }
             nonce++;
           }

           if (nonce % 10000 === 0) {
             const el = document.getElementById('powStatus');
             if (el) el.textContent = 'Computing... (' + nonce + ' attempts)';
           }

           setTimeout(tick, 0);
         }

         tick();
       });
     }

     // -----------------------------------------------------------------------
     // Magic link auto-authentication
     // If the URL contains ?token=... consume it immediately, then wipe the URL.
     // -----------------------------------------------------------------------
     (async function handleMagicLink() {
       const params = new URLSearchParams(window.location.search);
       const token = params.get('token');
       if (!token) return;

       // Wipe token from URL bar immediately (before any async work)
       window.history.replaceState({}, document.title, window.location.pathname);

       try {
         const res = await fetch(adminBase + '/auth', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ token })
         });

         const data = await res.json();

         if (data.success) {
           window.location.href = data.redirect;
         }
         // If token already consumed or invalid, fall through silently —
         // user sees the normal PIN login form.
       } catch (_) {
         // Network error — fall through to normal login form
       }
     })();

     // -----------------------------------------------------------------------
     // Login form (PIN exists)
     // -----------------------------------------------------------------------
     ${hasPin ? `
     document.getElementById('loginForm').addEventListener('submit', async e => {
       e.preventDefault();

       const pin = document.getElementById('pin').value;
       const btn = document.getElementById('submitBtn');
       const pow = document.getElementById('powStatus');

       if (!/^\\d{4}$/.test(pin)) {
         showStatus('PIN must be 4 digits', true);
         return;
       }

       btn.disabled = true;
       pow.textContent = 'Computing proof of work...';

       try {
         const challengeRes = await fetch(adminBase + '/auth/challenge');
         const { salt } = await challengeRes.json();

         const nonce = await minePoW(salt);
         pow.textContent = '';

         const authRes = await fetch(adminBase + '/auth', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ pin, nonce })
         });

         const result = await authRes.json();

         if (result.success) {
           showStatus('Login successful, redirecting...');
           window.location.href = result.redirect;
         } else {
           showStatus(result.error || 'Authentication failed', true);
           btn.disabled = false;
         }
       } catch (_) {
         showStatus('Network error. Please try again.', true);
         btn.disabled = false;
       }
     });

     document.getElementById('pin').focus();
     ` : `
     // -----------------------------------------------------------------------
     // First-run setup form (no PIN exists yet)
     // -----------------------------------------------------------------------
     document.getElementById('setupForm').addEventListener('submit', async e => {
       e.preventDefault();

       const pin     = document.getElementById('newPin').value;
       const confirm = document.getElementById('confirmPin').value;
       const btn     = document.getElementById('setupBtn');

       if (!/^\\d{4}$/.test(pin)) {
         showStatus('PIN must be exactly 4 digits', true);
         return;
       }

       if (pin !== confirm) {
         showStatus('PINs do not match', true);
         return;
       }

       btn.disabled = true;
       showStatus('Saving PIN...');

       try {
         const res = await fetch(adminBase + '/setup-pin', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ pin })
         });

         const result = await res.json();

         if (result.success) {
           showStatus('PIN set. Logging in...');
           window.location.href = result.redirect;
         } else {
           showStatus(result.error || 'Failed to set PIN', true);
           btn.disabled = false;
         }
       } catch (_) {
         showStatus('Network error. Please try again.', true);
         btn.disabled = false;
       }
     });

     document.getElementById('newPin').focus();
     `}
   </script>
 </body>
 </html>`;
 }
