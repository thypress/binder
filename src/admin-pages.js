// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS <https://thypress.org>)
// SPDX-License-Identifier: MPL-2.0

import {
  adminThemeScript,
  adminCryptoScript,
  adminStatusScript,
  adminMagicLinkScript
} from './admin-utils.js';

// ============================================================================
// SYNTAX HIGHLIGHTING IDENTITY TAGS
// ============================================================================

const css  = (s, ...v) => s.reduce((r, p, i) => r + (v[i - 1] ?? '') + p);
const html = (s, ...v) => s.reduce((r, p, i) => r + (v[i - 1] ?? '') + p);

// ============================================================================
// CSS CONSTANTS
// ============================================================================

export const ADMIN_STYLES = css`
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

    * { margin: 0; padding: 0; box-sizing: border-box; }

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

    h1 { color: var(--fg); font-size: 2rem; margin-bottom: 0.5rem; }
    h2 { margin-top: 2rem; margin-bottom: 0.5rem; border-bottom: 2px solid var(--border); color: var(--fg); }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .session-timer { font-size: 0.8rem; color: var(--muted); }
    #session-countdown { font-weight: 600; color: var(--fg); font-variant-numeric: tabular-nums; }

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
    .theme-toggle:hover { background: var(--accent-2); }

    .button-turnoff {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.9rem;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .button-turnoff:hover { border-color: var(--muted); color: var(--fg); }

    .pin-status-bar {
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-bottom: 1.5rem;
      border: 1px solid var(--border);
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .pin-status-bar.pin-ok   { background: var(--hover); color: var(--muted); }
    .pin-status-bar.pin-missing { background: var(--hover); border-color: var(--muted); color: var(--fg); }

    .pin-setup-link {
      background: var(--accent);
      color: var(--bg);
      padding: 0.3rem 0.75rem;
      border-radius: 4px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.85rem;
      transition: background-color 0.2s;
      white-space: nowrap;
    }
    .pin-setup-link:hover { background: var(--accent-2); }
    .pin-plea { width: 100%; font-size: 0.8rem; color: var(--muted); margin-top: 0.25rem; }

    /* ── Site overview panel ── */
    .site-overview {
      background: var(--hover);
      padding: 1.25rem 1.5rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      margin: 1.5rem 0;
    }
    .site-overview-row {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
    }
    .site-overview-label { font-size: 0.8rem; color: var(--muted); min-width: 90px; }
    .site-overview-value { font-size: 0.95rem; color: var(--fg); }
    .site-overview-actions { margin-top: 1rem; display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }

    .path-copy-wrap { display: flex; align-items: center; gap: 0.5rem; }
    .path-text { font-size: 0.85rem; color: var(--muted); word-break: break-all; }
    .copy-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8rem;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .copy-btn:hover { border-color: var(--accent); color: var(--fg); }

    /* ── Welcome cards ── */
    .welcome-heading {
      font-size: 1.4rem;
      margin: 1.5rem 0 0.25rem;
      color: var(--fg);
    }
    .welcome-sub {
      color: var(--muted);
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }
    .welcome-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin: 1.5rem 0 2.5rem;
    }
    @media (max-width: 680px) { .welcome-cards { grid-template-columns: 1fr; } }

    .welcome-card {
      border: 2px solid var(--border);
      border-radius: 10px;
      padding: 1.75rem;
      background: var(--bg);
      transition: border-color 0.2s;
    }
    .welcome-card-primary {
      border-color: var(--accent-2);
      background: var(--hover);
    }
    .welcome-card h3 {
      font-size: 1.15rem;
      margin-bottom: 0.4rem;
      color: var(--fg);
      border: none;
    }
    .welcome-card p {
      font-size: 0.88rem;
      color: var(--muted);
      margin-bottom: 1rem;
    }
    .welcome-project-input {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: inherit;
      font-size: 1rem;
      background: var(--bg);
      color: var(--fg);
      margin-bottom: 0.5rem;
      transition: border-color 0.2s;
    }
    .welcome-project-input:focus { outline: none; border-color: var(--accent); }
    .welcome-path-preview {
      font-size: 0.78rem;
      color: var(--muted-2);
      margin-bottom: 1rem;
      word-break: break-all;
    }

    /* ── DnD animation ── */
    .dnd-demo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 1.5rem 0;
      margin-bottom: 0.75rem;
    }
    .dnd-icon {
      font-size: 2rem;
      line-height: 1;
    }
    .dnd-folder {
      animation: dnd-slide 2.4s ease-in-out infinite;
    }
    @keyframes dnd-slide {
      0%   { transform: translateX(0px);  opacity: 1; }
      40%  { transform: translateX(28px); opacity: 0.6; }
      55%  { transform: translateX(28px); opacity: 0.6; }
      80%  { transform: translateX(0px);  opacity: 1; }
      100% { transform: translateX(0px);  opacity: 1; }
    }
    .dnd-arrow { color: var(--muted-2); font-size: 1.2rem; }
    .dnd-secondary-text {
      font-size: 0.82rem;
      color: var(--muted-2);
      margin-top: 0.5rem;
    }

    /* ── Stats / Diagnostics ── */
    .stats {
      background: var(--hover);
      padding: 1.25rem;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .stats p { margin: 8px 0; color: var(--fg); font-size: 0.9rem; }
    .stats strong { color: var(--accent); }

    /* ── Diagnostics accordion ── */
    .diagnostics-details {
      margin: 1.5rem 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .diagnostics-details summary {
      padding: 0.75rem 1rem;
      cursor: pointer;
      user-select: none;
      font-size: 0.9rem;
      color: var(--muted);
      background: var(--hover);
      list-style: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .diagnostics-details summary::-webkit-details-marker { display: none; }
    .diagnostics-details summary::before {
      content: '▶';
      font-size: 0.7rem;
      transition: transform 0.2s;
    }
    .diagnostics-details[open] summary::before { transform: rotate(90deg); }
    .diagnostics-details .stats { border-radius: 0; border: none; border-top: 1px solid var(--border); }

    /* ── Theme upload zone ── */
    .theme-upload-zone {
      border: 2px dashed var(--border);
      border-radius: 8px;
      padding: 1.5rem;
      text-align: center;
      margin-bottom: 1.5rem;
      transition: all 0.2s;
      cursor: pointer;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .theme-upload-zone:hover,
    .theme-upload-zone.drag-over {
      border-color: var(--accent);
      background: var(--hover);
      color: var(--fg);
    }
    .theme-upload-status {
      margin-top: 0.5rem;
      font-size: 0.85rem;
      color: var(--muted);
      min-height: 1.2em;
    }

    /* ── Shared ── */
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
    .button:hover { background: var(--accent-2); }
    .button:disabled { background: var(--muted-2); cursor: not-allowed; opacity: 0.5; }
    .button-secondary { background: var(--muted); }
    .button-secondary:hover { background: var(--accent-2); }
    .button-sm {
      padding: 0.4rem 0.9rem;
      font-size: 0.875rem;
      background: var(--accent);
      color: var(--bg);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      transition: background-color 0.2s;
      text-decoration: none;
      display: inline-block;
    }
    .button-sm:hover { background: var(--accent-2); }
    .button-sm.secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .button-sm.secondary:hover { border-color: var(--accent); }

    #status {
      margin: 20px 0;
      padding: 12px;
      border-radius: 4px;
      display: none;
      border: 1px solid var(--border);
    }
    #status.info    { background: var(--hover); color: var(--fg); display: block; }
    #status.success { background: var(--hover); color: var(--fg); display: block; }
    #status.error   { background: var(--hover); color: var(--fg); display: block; border-color: var(--muted); }

    .back { color: var(--accent); text-decoration: none; }
    .back:hover { text-decoration: underline; }

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
    .theme-card:hover { border-color: var(--accent-2); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .theme-card.active { border-color: var(--accent); background: var(--hover); }
    .theme-card.invalid { border-color: var(--muted); opacity: 0.6; }
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
    .theme-preview-img { width: 100%; height: auto; object-fit: cover; display: block; }
    .theme-header { display: flex; justify-content: space-between; align-items: start; margin-top: 1.25rem; gap: 0.5rem; }
    .theme-name { font-weight: 600; font-size: 1.1rem; margin: 0; flex: 1; color: var(--fg); }
    .theme-badges { display: flex; gap: 0.35rem; flex-shrink: 0; }
    .theme-badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; white-space: nowrap; }
    .badge-active   { background: var(--accent);   color: var(--bg); }
    .badge-default  { background: var(--accent-2);  color: var(--bg); }
    .badge-embedded { background: var(--muted);     color: var(--bg); }
    .badge-invalid  { background: var(--muted-2);   color: var(--bg); }
    .theme-meta { font-size: 0.85rem; color: var(--muted); margin: 0.5rem 0; }
    .theme-description { font-size: 0.9rem; color: var(--fg); margin: 0.75rem 0; line-height: 1.4; min-height: 2.8em; }
    .theme-actions { margin-top: 1rem; display: flex; gap: 0.5rem; }
`;

const LOGIN_STYLES = css`
    .login-container { max-width: 400px; margin: 10vh auto; padding: 2rem; }
    .login-card { background: var(--hover); border: 2px solid var(--border); border-radius: 8px; padding: 2rem; }
    .login-title { text-align: center; margin-bottom: 0.5rem; color: var(--fg); }
    .login-subtitle { text-align: center; margin-bottom: 2rem; color: var(--muted); font-size: 0.9rem; }
    .form-group { margin-bottom: 1.5rem; }
    .form-label { display: block; margin-bottom: 0.5rem; color: var(--fg); font-weight: 600; }
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
    .form-input:focus { outline: none; border-color: var(--accent); }
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
    .submit-button:hover:not(:disabled) { background: var(--accent-2); }
    .submit-button:disabled { background: var(--muted); cursor: not-allowed; opacity: 0.6; }
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
    .status-message.visible { display: block; }
    .status-message.error { border-color: var(--muted); }
    .pow-status { margin-top: 0.5rem; font-size: 0.85rem; color: var(--muted); text-align: center; min-height: 1.2em; }
    .theme-toggle { position: absolute; top: 1.5rem; right: 1.5rem; }
    .forgot-pin { margin-top: 1.5rem; }
    .forgot-pin summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 0.82rem;
      user-select: none;
      list-style: none;
    }
    .forgot-pin summary::-webkit-details-marker { display: none; }
    .forgot-pin p { margin-top: 0.6rem; font-size: 0.82rem; color: var(--muted); line-height: 1.5; }
    .forgot-pin code { background: var(--border); padding: 0.1em 0.3em; border-radius: 3px; }
`;

// ============================================================================
// ADMIN PANEL COMPONENTS (internal)
// ============================================================================

/**
 * Stats moved to a collapsible diagnostics section.
 */
const DiagnosticsAccordion = (deps) => `
  <details class="diagnostics-details">
    <summary>Diagnostics</summary>
    <div class="stats">
      <p><strong>Entries:</strong> ${deps.contentCache.size}</p>
      <p><strong>Mode:</strong> ${deps.contentMode}</p>
      <p><strong>Content root:</strong> ${deps.contentRoot}</p>
      <p><strong>Active theme:</strong> ${deps.activeTheme || '.default (embedded)'}</p>
      <p><strong>Fallback theme:</strong> ${deps.siteConfig.defaultTheme || '.default (binary)'}</p>
      <p><strong>Pre-rendered pages:</strong> ${deps.cacheManager.renderedCache.size}</p>
      <p><strong>Pre-compressed:</strong> ${deps.cacheManager.precompressedCache ? deps.cacheManager.precompressedCache.size / 2 : 0} pages × 2 formats</p>
      <p><strong>Images cached:</strong> ${deps.imageReferences.size} files with images</p>
      <p><strong>Redirect rules:</strong> ${deps.redirectRules.size}</p>
      <p><strong>Live reload:</strong> ${deps.liveReloadClients.size} connected clients</p>
    </div>
  </details>
`;

/**
 * Site overview panel — shown when a project exists.
 * @param {Object} deps
 * @param {string} adminBase
 * @param {boolean} isLocal
 */
const SiteOverview = (deps, adminBase, isLocal) => {
  const title = deps.siteConfig.title || 'My Site';
  const theme = deps.activeTheme || '.default';
  const root  = deps.contentRoot || process.cwd();

  const editButton = isLocal
    ? `<button class="button-sm" onclick="openFilesFolder()">Edit your pages →</button>`
    : `<div class="path-copy-wrap">
        <span class="path-text">${root}</span>
        <button class="copy-btn" onclick="copyPath('${root.replace(/'/g, "\\'")}')">Copy path</button>
       </div>`;

  return `
  <div class="site-overview">
    <div class="site-overview-row">
      <span class="site-overview-label">Site name</span>
      <span class="site-overview-value">${title}</span>
    </div>
    <div class="site-overview-row">
      <span class="site-overview-label">Active theme</span>
      <span class="site-overview-value">${theme}</span>
    </div>
    <div class="site-overview-row">
      <span class="site-overview-label">Content root</span>
      <span class="site-overview-value" style="font-size:0.85rem; word-break:break-all;">${root}</span>
    </div>
    <div class="site-overview-actions">
      <a href="/" class="button-sm secondary" target="_blank">View your site →</a>
      ${editButton}
    </div>
  </div>`;
};

/**
 * Welcome section — shown when no project exists and this is a local request.
 * @param {string} adminBase
 * @param {string} thypressHome - e.g. /Users/name/THYPRESS
 */
const WelcomeSection = (adminBase, thypressHome) => `
  <p class="welcome-sub">You're one click away from a live website.</p>

  <div class="welcome-cards">
    <!-- Card 1: Create new site -->
    <div class="welcome-card welcome-card-primary">
      <h3>Start a new site</h3>
      <p>We'll create a folder with everything you need.</p>
      <input
        type="text"
        id="projectName"
        class="welcome-project-input"
        value="my-site"
        maxlength="64"
        placeholder="project-name"
        oninput="updatePathPreview()"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="welcome-path-preview" id="pathPreview">${thypressHome}/my-site/</div>
      <button id="createBtn" class="button" style="margin:0; width:100%;" onclick="createProject()">Create</button>
      <div id="createStatus" style="margin-top:0.75rem; font-size:0.85rem; color:var(--muted); min-height:1.2em;"></div>
    </div>

    <!-- Card 2: Already have files? (educational) -->
    <div class="welcome-card">
      <h3>Already have files?</h3>
      <p>Drag your content folder onto the THYPRESS app to open it instantly.</p>
      <div class="dnd-demo" aria-hidden="true">
        <span class="dnd-icon dnd-folder">📁</span>
        <span class="dnd-arrow">→</span>
        <span class="dnd-icon">⚡</span>
      </div>
      <p class="dnd-secondary-text">Or drag a <strong>.zip</strong> theme file onto the app to install it.</p>
      <p class="dnd-secondary-text" style="margin-top:0.5rem; font-size:0.78rem;">Close this window and drag your folder onto the THYPRESS app icon to get started.</p>
    </div>
  </div>
`;

/**
 * Theme management section with upload zone.
 */
const ThemeSection = (adminBase) => `
  <h2>Theme Management</h2>

  <!-- Theme .zip upload zone (standard HTML5 file input — works in all browsers) -->
  <div class="theme-upload-zone" id="themeUploadZone" onclick="document.getElementById('themeFileInput').click()">
    <div>Drop a <strong>.zip</strong> theme file here, or click to browse</div>
    <input type="file" accept=".zip" id="themeFileInput" style="display:none" onchange="handleThemeFileSelected(event)" />
    <div class="theme-upload-status" id="themeUploadStatus"></div>
  </div>

  <div id="themes-container">
    <p>Loading themes...</p>
  </div>
`;

/**
 * Build section — only shown when a project exists.
 */
const BuildSection = () => `
  <h2>Build Static Site</h2>
  <p>Generate a complete static build in /build folder for deployment.</p>
  <button id="buildBtn" class="button" onclick="buildSite()">Build Static Site</button>
  <button id="clearCacheBtn" class="button button-secondary" onclick="clearCache()">Clear Cache</button>
`;

/**
 * PIN status bar.
 */
const PinStatus = (hasPin, adminBase) => hasPin
  ? `<div class="pin-status-bar pin-ok">🔒 PIN protection active</div>`
  : `<div class="pin-status-bar pin-missing">
      <span>⚠️ No PIN is set — your admin panel is unprotected.</span>
      <a href="${adminBase}/login" class="pin-setup-link">Set a PIN now →</a>
      <p class="pin-plea">Please set a PIN before exposing this server to any network. Without one, anyone who discovers the admin URL can access and modify your site.</p>
    </div>`;

// ============================================================================
// CLIENT-SIDE SCRIPTS
// ============================================================================

const sessionCountdownScript = () => `
  (function() {
    const SESSION_MS = 24 * 60 * 60 * 1000;
    const pageLoadTime = Date.now();
    function pad(n) { return String(n).padStart(2, '0'); }
    function formatRemaining(ms) {
      if (ms <= 0) { window.location.reload(); return '00:00:00'; }
      const s = Math.floor(ms / 1000);
      return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
    }
    function tick() {
      const el = document.getElementById('session-countdown');
      if (el) el.textContent = formatRemaining(SESSION_MS - (Date.now() - pageLoadTime));
    }
    tick();
    setInterval(tick, 1000);
  })();
`;

const adminThemeManagerScript = (adminBase) => `
  let themes = [];

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
    if (themes.length === 0) { container.innerHTML = '<p>No themes found</p>'; return; }

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
          <div class="theme-meta"><strong>Version:</strong> \${theme.version} | <strong>By:</strong> \${theme.author}</div>
          <p class="theme-description">\${theme.description}</p>
          <div class="theme-actions">
            \${!theme.active && theme.valid ? \`
              <button class="button" onclick="activateTheme('\${theme.id}')">Activate Theme</button>
            \` : ''}
            \${canBeDefault && !theme.isDefault ? \`
              <button class="button button-secondary" onclick="setAsDefault('\${theme.id}')">Set as Fallback</button>
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
      if (data.success) { setStatus('Theme activated: ' + themeId + '. Reloading...', 'success'); setTimeout(() => location.reload(), 1000); }
      else { setStatus('Failed to activate theme: ' + data.error, 'error'); }
    } catch (error) { setStatus('Failed to activate theme: ' + error.message, 'error'); }
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
      if (data.success) { setStatus('Fallback theme set to: ' + themeId + '. Reloading...', 'success'); setTimeout(() => location.reload(), 1000); }
      else { setStatus('Failed to set fallback: ' + data.error, 'error'); }
    } catch (error) { setStatus('Failed to set fallback: ' + error.message, 'error'); }
  }

  loadThemes();
`;

const adminBuildScript = (adminBase) => `
  async function buildSite() {
    const btn = document.getElementById('buildBtn');
    btn.disabled = true;
    setStatus('Building static site...', 'info');
    try {
      const response = await fetch('${adminBase}/build', { method: 'POST' });
      const data = await response.json();
      if (data.success) { setStatus('Build complete! Check the /build folder.', 'success'); }
      else { setStatus('Build failed: ' + data.error, 'error'); }
    } catch (error) { setStatus('Build failed: ' + error.message, 'error'); }
    finally { btn.disabled = false; }
  }

  async function clearCache() {
    const btn = document.getElementById('clearCacheBtn');
    btn.disabled = true;
    setStatus('Clearing cache...', 'info');
    try {
      const response = await fetch('${adminBase}/clear-cache', { method: 'POST' });
      const data = await response.json();
      if (data.success) { setStatus('Cache cleared! Freed ' + data.freed + ' items. Reloading...', 'success'); setTimeout(() => location.reload(), 1000); }
      else { setStatus('Clear cache failed: ' + data.error, 'error'); }
    } catch (error) { setStatus('Clear cache failed: ' + error.message, 'error'); }
    finally { btn.disabled = false; }
  }
`;

/**
 * Scripts for admin panel actions: shutdown, open-folder, copy path, welcome create.
 */
const adminActionsScript = (adminBase, thypressHome) => `
  // ── Turn off ─────────────────────────────────────────────────────────────
  async function confirmShutdown() {
    if (!confirm('Your site will go offline. To start it again, run THYPRESS from your project folder.')) return;
    try {
      await fetch('${adminBase}/shutdown', { method: 'POST' });
    } catch (_) {}
    document.body.innerHTML = '<div style="padding:3rem 2rem; font-family: monospace; color: var(--fg);">' +
      '<h2 style="margin-bottom:1rem;">THYPRESS is off.</h2>' +
      '<p style="color:var(--muted);">You can close this window.</p></div>';
  }

  // ── Open folder (local only) ─────────────────────────────────────────────
  async function openFilesFolder() {
    try { await fetch('${adminBase}/open-folder', { method: 'POST' }); }
    catch (err) { setStatus('Could not open folder: ' + err.message, 'error'); }
  }

  // ── Copy path to clipboard ───────────────────────────────────────────────
  function copyPath(p) {
    navigator.clipboard.writeText(p).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = p;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  // ── Welcome: update path preview as user types ───────────────────────────
  function updatePathPreview() {
    const name = document.getElementById('projectName')?.value?.trim() || '';
    const el = document.getElementById('pathPreview');
    if (el) el.textContent = name ? '${thypressHome}/' + name + '/' : '${thypressHome}/';
  }

  // ── Welcome: create project ───────────────────────────────────────────────
  async function createProject() {
    const name = document.getElementById('projectName')?.value?.trim();
    const statusEl = document.getElementById('createStatus');
    const btn = document.getElementById('createBtn');

    if (!name) { if (statusEl) statusEl.textContent = 'Enter a project name.'; return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      if (statusEl) statusEl.textContent = 'Use only letters, numbers, hyphens, and underscores.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating...';
    if (statusEl) statusEl.textContent = '';

    try {
      const res = await fetch('${adminBase}/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();

      if (data.success) {
        if (statusEl) statusEl.textContent = '✓ Project created! Loading...';
        // Give the server a moment to re-initialize, then reload
        setTimeout(() => location.reload(), 1800);
      } else {
        if (statusEl) statusEl.textContent = data.error || 'Failed to create project.';
        btn.disabled = false;
        btn.textContent = 'Create';
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Network error: ' + err.message;
      btn.disabled = false;
      btn.textContent = 'Create';
    }
  }

  // ── Theme upload zone ─────────────────────────────────────────────────────
  (function setupThemeUpload() {
    const zone = document.getElementById('themeUploadZone');
    const input = document.getElementById('themeFileInput');
    if (!zone || !input) return;

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) uploadThemeFile(file);
    });
  })();

  function handleThemeFileSelected(e) {
    const file = e.target.files?.[0];
    if (file) uploadThemeFile(file);
    e.target.value = ''; // allow re-selecting same file
  }

  async function uploadThemeFile(file) {
    const statusEl = document.getElementById('themeUploadStatus');
    if (!file.name.endsWith('.zip')) {
      if (statusEl) statusEl.textContent = '✗ Only .zip files are accepted.';
      return;
    }
    if (statusEl) statusEl.textContent = 'Uploading and installing...';

    const formData = new FormData();
    formData.append('theme', file);

    try {
      const res = await fetch('${adminBase}/upload-theme', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        if (statusEl) statusEl.textContent = '✓ Theme installed: ' + data.themeName + '. Reloading...';
        setTimeout(() => location.reload(), 1200);
      } else {
        if (statusEl) statusEl.textContent = '✗ ' + (data.error || 'Upload failed');
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = '✗ ' + err.message;
    }
  }
`;

// ============================================================================
// LOGIN PAGE COMPONENTS (internal)
// ============================================================================

const LoginForm = () => `
  <form id="loginForm">
    <div class="form-group">
      <label for="pin" class="form-label">PIN</label>
      <input type="password" id="pin" class="form-input" placeholder="••••••" autocomplete="off" required />
    </div>
    <button type="submit" class="submit-button" id="submitBtn">Login</button>
    <div class="pow-status" id="powStatus"></div>
    <div class="status-message" id="statusMessage"></div>
  </form>

  <details class="forgot-pin">
    <summary>Forgot your PIN?</summary>
    <p>
      Delete the <code>.thypress</code> folder inside your project folder, then refresh this page.
      You'll be able to set a new PIN.
    </p>
  </details>
`;

const SetupForm = () => `
  <form id="setupForm">
    <div class="form-group">
      <label for="newPin" class="form-label">Choose a PIN (min. 6 characters)</label>
      <input type="password" id="newPin" class="form-input" placeholder="••••••" autocomplete="new-password" required />
    </div>
    <div class="form-group">
      <label for="confirmPin" class="form-label">Confirm PIN</label>
      <input type="password" id="confirmPin" class="form-input" placeholder="••••••" autocomplete="new-password" required />
    </div>
    <button type="submit" class="submit-button" id="setupBtn">Set PIN &amp; Enter</button>
    <div class="status-message" id="statusMessage"></div>
  </form>
`;

// ============================================================================
// LOGIN PAGE CLIENT-SIDE SCRIPTS (internal)
// ============================================================================

const loginFormScript = (adminBase) => `
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pin = document.getElementById('pin').value;
    const btn = document.getElementById('submitBtn');
    const pow = document.getElementById('powStatus');

    if (pin.length < 6 || /\\s/.test(pin)) { showStatus('PIN must be at least 6 characters with no spaces', true); return; }

    btn.disabled = true;
    pow.textContent = 'Computing proof of work...';

    try {
      const challengeRes = await fetch('${adminBase}/auth/challenge');
      const { salt } = await challengeRes.json();
      const nonce = await minePoW(salt);
      pow.textContent = '';

      const authRes = await fetch('${adminBase}/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, nonce })
      });
      const result = await authRes.json();

      if (result.success) { showStatus('Login successful, redirecting...'); window.location.href = result.redirect; }
      else { showStatus(result.error || 'Authentication failed', true); btn.disabled = false; }
    } catch (_) { showStatus('Network error. Please try again.', true); btn.disabled = false; }
  });
  document.getElementById('pin').focus();
`;

const setupFormScript = (adminBase) => `
  document.getElementById('setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pin     = document.getElementById('newPin').value;
    const confirm = document.getElementById('confirmPin').value;
    const btn     = document.getElementById('setupBtn');

    if (pin.length < 6 || /\\s/.test(pin)) { showStatus('PIN must be at least 6 characters with no spaces', true); return; }
    if (pin !== confirm) { showStatus('PINs do not match', true); return; }

    btn.disabled = true;
    showStatus('Saving PIN...');

    try {
      const res = await fetch('${adminBase}/setup-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const result = await res.json();
      if (result.success) { showStatus('PIN set. Logging in...'); window.location.href = result.redirect; }
      else { showStatus(result.error || 'Failed to set PIN', true); btn.disabled = false; }
    } catch (_) { showStatus('Network error. Please try again.', true); btn.disabled = false; }
  });
  document.getElementById('newPin').focus();
`;

// ============================================================================
// PAGE COMPOSERS (exported)
// ============================================================================

/**
 * Generate admin panel HTML.
 *
 * @param {Object} deps        - Server dependencies
 * @param {string} adminBase   - Dynamic admin base path
 * @param {Object} options     - { isLocal: boolean, isWelcome: boolean, thypressHome: string }
 */
export function generateAdminHTML(deps, adminBase = '/__thypress', {
  isLocal   = true,
  isWelcome = false,
  thypressHome = ''
} = {}) {
  const hasPin     = deps.securityManager.pin !== null;
  const hasProject = deps.contentCache.size > 0;

  // Determine which main body sections to render
  const bodyContent = isWelcome
    ? WelcomeSection(adminBase, thypressHome)
    : `${PinStatus(hasPin, adminBase)}
       ${SiteOverview(deps, adminBase, isLocal)}
       ${hasProject ? BuildSection() : ''}
       ${DiagnosticsAccordion(deps)}`;

  const headerLeft = isWelcome
    ? `<p style="color:var(--muted); font-size:0.9rem;">THYPRESS</p>`
    : `<p><a href="/" class="back">← Back to site</a></p>`;

  const pageTitle = isWelcome ? 'Welcome to THYPRESS' : 'THYPRESS Admin';

  return html`<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>${ADMIN_STYLES}</style>
</head>
<body>
  <div class="header">
    ${headerLeft}
    <div class="header-right">
      ${!isWelcome ? `<span class="session-timer">Session: <span id="session-countdown">24:00:00</span></span>` : ''}
      <button class="button-turnoff" onclick="confirmShutdown()">⏻ Turn off</button>
      <button class="theme-toggle" onclick="toggleTheme()">
        Toggle <span id="theme-state">dark</span> theme
      </button>
    </div>
  </div>

  <h1>${pageTitle}</h1>
  ${isWelcome ? '' : ''}

  ${bodyContent}

  ${ThemeSection(adminBase)}

  <div id="status"></div>

  <script>
    ${adminThemeScript()}
    ${adminStatusScript()}
    ${!isWelcome ? sessionCountdownScript() : ''}
    ${adminThemeManagerScript(adminBase)}
    ${!isWelcome && hasProject ? adminBuildScript(adminBase) : ''}
    ${adminActionsScript(adminBase, thypressHome)}
  </script>
</body>
</html>`;
}

/**
 * Generate login/setup page HTML.
 *
 * @param {Object} options - { hasPin: boolean, adminBase: string }
 * @returns {string} Complete HTML page
 */
export function generateLoginHTML({ hasPin, adminBase }) {
  return html`<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>THYPRESS Admin - ${hasPin ? 'Login' : 'Setup'}</title>
  <style>
    ${ADMIN_STYLES}
    ${LOGIN_STYLES}
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
      ${hasPin ? LoginForm() : SetupForm()}
    </div>
  </div>

  <script>
    ${adminThemeScript()}
    ${adminStatusScript()}
    ${adminCryptoScript()}
    ${adminMagicLinkScript(adminBase)}
    ${hasPin ? loginFormScript(adminBase) : setupFormScript(adminBase)}
  </script>
</body>
</html>`;
}
