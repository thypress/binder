// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS <https://thypress.org>)
// SPDX-License-Identifier: MPL-2.0

/**
 * THYPRESS HANDLEBARS HELPER LIBRARY
 * ====================================
 * 102 helpers across 10 categories.
 *
 * SECURITY INVARIANTS (non-negotiable):
 *   1. No helper ever returns new Handlebars.SafeString(). All output goes
 *      through Handlebars' auto-escape in {{double-curly}}. The theme author
 *      opts into raw output explicitly via {{{triple-curly}}}.
 *   2. No helper generates, interprets, or wraps HTML. Helpers are pure data
 *      transformations: value in → value out.
 *   3. The `json` helper is the sole exception — it Unicode-escapes HTML-
 *      significant characters inside the JSON string itself because it is
 *      routinely embedded inside <script> tags where Handlebars escaping is
 *      irrelevant. This is the industry-standard mitigation (Next.js / Rails
 *      / Django all do this).
 *
 * USAGE IN theme-system.js:
 *   import { registerHelpers } from './utils/helpers.js';
 *   import { slugify } from './utils/taxonomy.js';
 *   registerHelpers(Handlebars, slugify);
 */

// =============================================================================
// MODULE-LEVEL: UTILITIES, CONSTANTS, CACHES
// Everything here is allocated exactly once at module load and never again —
// not per-call, not per hot-reload, not per build. This is the single biggest
// performance class: eliminating repeated allocation of large constant data.
// =============================================================================

/** Detect the Handlebars options object silently appended to every call. */
const isOpts = v => v != null && typeof v === 'object' && typeof v.hash === 'object';

/** Coerce any value to an array; return [] for non-arrays. */
const toArr = v => Array.isArray(v) ? v : [];

/** Coerce to finite number; default 0 for NaN / non-numeric. */
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };

/** Emit a namespaced warning. Does not throw — helpers never crash a build. */
const WARN = (tag, msg) => console.warn(`[THYPRESS:${tag}] ${msg}`);

/** Parse any date-like value to a Date, or return null. */
const parseDate = v => {
  if (!v && v !== 0) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isFinite(d.getTime()) ? d : null;
};

/** Extract locale from options.hash.locale with a typed fallback. */
const getLocale = (options, fallback = 'en') => {
  const l = options && options.hash && options.hash.locale;
  return (typeof l === 'string' && l.trim()) ? l.trim() : fallback;
};

// ---------------------------------------------------------------------------
// Intl object caches — module-level so they survive hot-reloads.
// Intl constructors are among the most expensive operations in any JS runtime
// (locale string parsing + CLDR data resolution). A site with 1 000 entries
// each rendering a date would otherwise construct a new DateTimeFormat object
// 1 000 times for what is typically 2–3 unique (locale, format) combinations.
// ---------------------------------------------------------------------------
const _pluralRulesCache  = new Map();
const _relativeTimeCache = new Map();
const _dateTimeCache     = new Map();

const getPluralRules = locale => {
  if (!_pluralRulesCache.has(locale)) {
    try   { _pluralRulesCache.set(locale, new Intl.PluralRules(locale)); }
    catch { _pluralRulesCache.set(locale, new Intl.PluralRules('en')); }
  }
  return _pluralRulesCache.get(locale);
};

const getRelativeTimeFormat = locale => {
  if (!_relativeTimeCache.has(locale)) {
    try {
      _relativeTimeCache.set(locale,
        new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' }));
    } catch {
      _relativeTimeCache.set(locale,
        new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' }));
    }
  }
  return _relativeTimeCache.get(locale);
};

// fmtKey is the preset name string ("long", "year", …) — cheap cache key.
const getDateTimeFormat = (locale, fmtKey, presetOpts) => {
  const key = `${locale}:${fmtKey}`;
  if (!_dateTimeCache.has(key)) {
    try   { _dateTimeCache.set(key, new Intl.DateTimeFormat(locale, presetOpts)); }
    catch { _dateTimeCache.set(key, new Intl.DateTimeFormat('en-US', presetOpts)); }
  }
  return _dateTimeCache.get(key);
};

// ---------------------------------------------------------------------------
// RegExp cache — bounded at 100 entries.
// `new RegExp(p, 'g')` compiles the regex engine state on every invocation.
// A theme using the same pattern across 1 000 content files recompiles it
// 1 000 times without this cache. The 100-entry cap prevents unbounded growth
// if a theme bug generates thousands of unique (and therefore uncacheable)
// pattern strings.
// Eviction strategy: delete the oldest inserted key (Map preserves insertion
// order; .keys().next().value is always the first-inserted key). This is
// O(1) — no iteration, no sorting.
// ---------------------------------------------------------------------------
const _regexCache = new Map();

const getCachedRegex = (pattern, flags) => {
  const key = `${flags}:${pattern}`;
  if (_regexCache.has(key)) return _regexCache.get(key);
  if (_regexCache.size >= 100) _regexCache.delete(_regexCache.keys().next().value);
  const re = new RegExp(pattern, flags);
  _regexCache.set(key, re);
  return re;
};

// ---------------------------------------------------------------------------
// Single-pass escape tables and their companion regexes.
// Each chained .replace() call allocates a full intermediate string copy.
// Five chained calls on a 500-char field = five intermediate allocations of
// ~500 chars each. A single-pass regex with a lookup table does one scan and
// one output allocation regardless of how many characters are replaced.
// ---------------------------------------------------------------------------
const HTML_ESCAPE_MAP = Object.freeze({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;',
});
const HTML_ESCAPE_RE = /[&<>"']/g;

const XML_ESCAPE_MAP = Object.freeze({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
});
const XML_ESCAPE_RE = /[&<>"']/g;

// JSON needs two extra characters: U+2028 (Line Separator) and U+2029
// (Paragraph Separator) break JS string literals inside <script> blocks.
const JSON_ESCAPE_MAP = Object.freeze({
  '<': '\\u003c', '>': '\\u003e', '&': '\\u0026',
  "'": '\\u0027', '\u2028': '\\u2028', '\u2029': '\\u2029',
});
const JSON_ESCAPE_RE = /[<>&'\u2028\u2029]/g;

// ---------------------------------------------------------------------------
// Date preset map — frozen so V8 can treat it as a constant shape.
// ---------------------------------------------------------------------------
const DATE_PRESETS = Object.freeze({
  short:     { dateStyle: 'short'  },
  medium:    { dateStyle: 'medium' },
  long:      { dateStyle: 'long'   },
  full:      { dateStyle: 'full'   },
  year:      { year: 'numeric'     },
  monthYear: { year: 'numeric', month: 'long' },
  time:      { timeStyle: 'short'  },
  datetime:  { dateStyle: 'medium', timeStyle: 'short' },
});

// ---------------------------------------------------------------------------
// Pluralize constants — Set and plain object, allocated once.
// Previously these were inside the helper body, rebuilt on every call.
// ---------------------------------------------------------------------------
const INVARIANT = new Set([
  'sheep', 'deer', 'fish', 'series', 'species', 'aircraft', 'moose',
  'offspring', 'bison', 'elk', 'trout', 'salmon', 'cod', 'shrimp', 'squid',
]);

const IRREGULAR = Object.freeze({
  person: 'people', man: 'men', woman: 'women', child: 'children',
  tooth: 'teeth', foot: 'feet', mouse: 'mice', goose: 'geese',
  ox: 'oxen', datum: 'data', medium: 'media', criterion: 'criteria',
  phenomenon: 'phenomena', alumnus: 'alumni', cactus: 'cacti',
  focus: 'foci', fungus: 'fungi', nucleus: 'nuclei', syllabus: 'syllabi',
  analysis: 'analyses', diagnosis: 'diagnoses', ellipsis: 'ellipses',
  hypothesis: 'hypotheses', oasis: 'oases', crisis: 'crises',
  thesis: 'theses', basis: 'bases', axis: 'axes', matrix: 'matrices',
  vertex: 'vertices', index: 'indices',
});

// ---------------------------------------------------------------------------
// "Just now" locale map — frozen object, allocated once at module load.
// Previously allocated and GC'd on every timeAgo call.
//
// WHY THIS EXISTS:
//   Intl.RelativeTimeFormat has no concept of "just now". For a 0-second
//   delta it produces "0 seconds ago" (or with numeric:"auto", "now") —
//   neither is the idiomatic "just now" phrasing users expect.
//
// FALLBACK:
//   Locales not in this table fall back to
//   Intl.RelativeTimeFormat.format(0, "second"), which is always
//   localized and always correct — it just may read as "0 seconds ago"
//   rather than a more colloquial phrase. This is strictly preferable to
//   showing an English string to a user whose locale is unknown.
//   Do NOT fall back to the English literal "just now" for unknown locales.
// ---------------------------------------------------------------------------
const JUST_NOW_MAP = Object.freeze({
  af: 'pas nou',        ar: 'الآن',           bg: 'току-що',
  ca: 'ara mateix',     cs: 'právě teď',      cy: 'nawr',
  da: 'lige nu',        de: 'gerade eben',    el: 'μόλις τώρα',
  en: 'just now',       es: 'ahora mismo',    et: 'just nüüd',
  eu: 'orain bertan',   fa: 'همین الان',       fi: 'juuri nyt',
  fr: "à l'instant",   ga: 'anois díreach',  he: 'ממש עכשיו',
  hi: 'अभी-अभी',          hr: 'upravo sada',    hu: 'épp most',
  hy: 'հենց հիմա',       id: 'baru saja',      is: 'rétt núna',
  it: 'proprio adesso', ja: 'たった今',          ka: 'ახლახანს',
  ko: '방금',             lt: 'ką tik',          lv: 'tikko',
  mk: 'токму сега',     ms: 'baru sahaja',    mt: 'bħalissa',
  nl: 'zojuist',        no: 'akkurat nå',     pl: 'właśnie teraz',
  pt: 'agora mesmo',   ro: 'chiar acum',     ru: 'только что',
  sk: 'práve teraz',    sl: 'ravnokar',       sq: 'tani',
  sr: 'upravo sada',    sv: 'nyss',           sw: 'sasa hivi',
  th: 'เมื่อกี้',          tr: 'az önce',        uk: 'щойно',
  ur: 'ابھی',            uz: 'hozirgina',      vi: 'vừa xong',
  zh: '刚才',
});

function _justNow(locale) {
  const tag = locale.toLowerCase().split(/[-_]/)[0];
  if (JUST_NOW_MAP[tag] !== undefined) return JUST_NOW_MAP[tag];
  // Unknown locale: let CLDR produce whatever it produces for 0 seconds.
  // Always localized; never wrong-language. May read as "0 seconds ago".
  return getRelativeTimeFormat(locale).format(0, 'second');
}

// ---------------------------------------------------------------------------
// _safeGet — prototype-safe property / array-index accessor.
// Extracted to module scope: previously a closure created inside the `get`
// helper body on every invocation. Now allocated exactly once.
//
// SECURITY:
//   - Unconditionally blocks __proto__, constructor, and prototype regardless
//     of input. These three keys are the entire surface of prototype pollution.
//   - Own-property check via hasOwnProperty prevents reading inherited members
//     (toString, valueOf, hasOwnProperty itself, etc.).
//   - `in` operator was suggested as faster but traverses the prototype chain
//     and is therefore a security regression; rejected.
// ---------------------------------------------------------------------------
function _safeGet(obj, key) {
  if (obj == null) return undefined;
  const k = String(key);
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined;
  if (Array.isArray(obj)) {
    const idx = parseInt(k, 10);
    if (isFinite(idx)) {
      const i = idx < 0 ? obj.length + idx : idx;
      return (i >= 0 && i < obj.length) ? obj[i] : undefined;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(obj, k)) return undefined;
  return obj[k];
}


// =============================================================================
// REGISTER HELPERS
// =============================================================================

export function registerHelpers(Handlebars, slugify) {

  // _slugify is the only symbol that must live inside registerHelpers because
  // it depends on the `slugify` parameter. Everything else is module-level.
  const _slugify = typeof slugify === 'function'
    ? slugify
    : str => String(str ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/^-+|-+$/g, '');


  // ==========================================================================
  // CATEGORY 1 — COMPARISON (9)
  // Return booleans; composable as subexpressions inside {{#if (and …)}}.
  // ==========================================================================

  Handlebars.registerHelper('eq',  (a, b) => a === b);
  Handlebars.registerHelper('neq', (a, b) => a !== b);
  Handlebars.registerHelper('gt',  (a, b) => num(a) >  num(b));
  Handlebars.registerHelper('gte', (a, b) => num(a) >= num(b));
  Handlebars.registerHelper('lt',  (a, b) => num(a) <  num(b));
  Handlebars.registerHelper('lte', (a, b) => num(a) <= num(b));
  Handlebars.registerHelper('and', (a, b) => !!(a && b));
  Handlebars.registerHelper('or',  (a, b) => !!(a || b));
  Handlebars.registerHelper('not', a      => !a);


  // ==========================================================================
  // CATEGORY 2 — STRING (26)
  // The `typeof str === 'string'` short-circuit avoids calling the String()
  // constructor (and its implicit type-check + object wrapper) for the
  // dominant case where the value is already a string.
  // ==========================================================================

  Handlebars.registerHelper('lowercase', str => {
    if (str == null) return '';
    return (typeof str === 'string' ? str : String(str)).toLowerCase();
  });

  Handlebars.registerHelper('uppercase', str => {
    if (str == null) return '';
    return (typeof str === 'string' ? str : String(str)).toUpperCase();
  });

  Handlebars.registerHelper('capitalize', str => {
    if (str == null) return '';
    const s = typeof str === 'string' ? str : String(str);
    return s.length ? s[0].toUpperCase() + s.slice(1) : s;
  });

  /**
   * titlecase — Unicode-safe, zero-array-allocation implementation.
   *
   * Previous: split(/(\s+)/) → map → join allocates a fragmented array of
   *   words and inter-word whitespace tokens, maps over them, then joins.
   *
   * Current: single-pass .replace() with a lookbehind assertion.
   *   - (?<=^|\s) matches only the position immediately after start-of-string
   *     or any whitespace, without including that whitespace in the match.
   *   - \S matches the first non-whitespace character of each word.
   *   - `u` flag enables full Unicode mode so \S correctly handles characters
   *     beyond ASCII (î, ñ, ả, 日 …).
   *   - No intermediate array. One engine pass. One output allocation.
   */
  Handlebars.registerHelper('titlecase', str => {
    if (str == null) return '';
    const s = typeof str === 'string' ? str : String(str);
    return s.replace(/(?<=^|\s)\S/gu, c => c.toUpperCase());
  });

  /**
   * truncate — character limit with word-boundary awareness.
   *
   * Previous: s.slice(0, len) → intermediate string → .lastIndexOf(' ')
   *   Two allocations: the intermediate substring and the final slice.
   *
   * Current: s.lastIndexOf(' ', len) searches the original string backward
   *   from position `len` without creating any intermediate copy.
   *   One allocation: the final slice.
   */
  Handlebars.registerHelper('truncate', function(str, length, options) {
    if (str == null) return '';
    const s   = typeof str === 'string' ? str : String(str);
    const len = parseInt(length, 10);
    if (!isFinite(len) || len <= 0 || s.length <= len) return s;
    const sfx = (options && options.hash && options.hash.suffix != null)
      ? String(options.hash.suffix) : '…';
    const sp = s.lastIndexOf(' ', len);
    return (sp > 0 ? s.slice(0, sp) : s.slice(0, len)) + sfx;
  });

  /**
   * truncateWords — word limit with early-exit scanning.
   *
   * Previous: s.trim().split(/\s+/) — allocates an array of EVERY word in
   *   the string just to take the first N. Passes a 5 000-word blog post body
   *   to extract a 20-word excerpt = ~4 980 immediately discarded allocations.
   *
   * Current: regex exec loop that exits as soon as the Nth word is found.
   *   Only the portion of the string up to the Nth word is ever scanned.
   *   The peek-ahead (is there more text?) uses a character-scan loop with no
   *   additional string allocations.
   */
  Handlebars.registerHelper('truncateWords', function(str, count, options) {
    if (str == null) return '';
    const s = typeof str === 'string' ? str : String(str);
    const n = parseInt(count, 10);
    if (!isFinite(n) || n <= 0) return '';
    const sfx = (options && options.hash && options.hash.suffix != null)
      ? String(options.hash.suffix) : '…';
    const re = /\S+/g;
    let match, wordCount = 0, lastEnd = 0;
    while ((match = re.exec(s)) !== null) {
      wordCount++;
      lastEnd = match.index + match[0].length;
      if (wordCount === n) {
        // Peek ahead using the same \S definition as the scan loop — no
        // allocation, no charCode table. Setting lastIndex avoids re-scanning
        // the portion of the string already consumed.
        // A charCode table was used here previously but only covered 5 ASCII
        // whitespace codepoints, missing the 11+ Unicode whitespace characters
        // that JS \s recognises (U+2003, U+2009, U+3000, U+2028 …), causing
        // spurious suffix appending when content ended with those characters.
        const peek = /\S/g;
        peek.lastIndex = lastEnd;
        return peek.exec(s) !== null ? s.slice(0, lastEnd) + sfx : s;
      }
    }
    return s; // fewer words than N — return whole string untouched
  });

  Handlebars.registerHelper('replace', (str, from, to) => {
    if (str == null) return '';
    return (typeof str === 'string' ? str : String(str)).replaceAll(
      String(from == null ? '' : from),
      String(to   == null ? '' : to)
    );
  });

  /**
   * split — early-exit counting loop when an index is requested.
   *
   * Previous: String.split(sep) always allocates a full array of every
   *   segment. If a CSV row has 200 fields and you want field 2, 198
   *   strings are allocated and immediately discarded.
   *
   * Current: when `index` is provided, a counting loop advances through
   *   the string using indexOf, exits as soon as the target segment is
   *   found, and slices only that one segment. Memory use is O(1) in the
   *   number of segments regardless of input length.
   *   When no index: full split is returned unchanged (original behaviour).
   */
  Handlebars.registerHelper('split', (str, sep, index) => {
    if (str == null) return (isOpts(index) || index == null) ? [] : undefined;
    const s      = typeof str === 'string' ? str : String(str);
    const sepStr = String(sep == null ? '' : sep);

    if (isOpts(index) || index == null) return s.split(sepStr);

    const idx = parseInt(index, 10);
    if (!isFinite(idx)) return undefined;

    // Empty separator: each character is its own segment
    if (sepStr.length === 0) {
      const i = idx < 0 ? s.length + idx : idx;
      return (i >= 0 && i < s.length) ? s[i] : undefined;
    }

    // Counting loop — stops the moment the Nth segment is reached
    let count = 0, start = 0;
    const sepLen = sepStr.length;
    while (true) {
      const pos = s.indexOf(sepStr, start);
      if (count === idx) return pos === -1 ? s.slice(start) : s.slice(start, pos);
      if (pos === -1) return undefined; // index exceeds available segments
      count++;
      start = pos + sepLen;
    }
  });

  Handlebars.registerHelper('join', (arr, separator) => {
    if (arr == null) return '';
    const sep = (isOpts(separator) || separator == null) ? ', ' : String(separator);
    return Array.isArray(arr) ? arr.join(sep) : String(arr);
  });

  Handlebars.registerHelper('trim',
    str => str == null ? '' : (typeof str === 'string' ? str : String(str)).trim());
  Handlebars.registerHelper('trimLeft',
    str => str == null ? '' : (typeof str === 'string' ? str : String(str)).trimStart());
  Handlebars.registerHelper('trimRight',
    str => str == null ? '' : (typeof str === 'string' ? str : String(str)).trimEnd());

  Handlebars.registerHelper('trimPrefix', (str, prefix) => {
    if (str == null) return '';
    const s = typeof str === 'string' ? str : String(str);
    const p = String(prefix == null ? '' : prefix);
    return (p.length && s.startsWith(p)) ? s.slice(p.length) : s;
  });

  Handlebars.registerHelper('trimSuffix', (str, suffix) => {
    if (str == null) return '';
    const s  = typeof str === 'string' ? str : String(str);
    const sf = String(suffix == null ? '' : suffix);
    return (sf.length && s.endsWith(sf)) ? s.slice(0, -sf.length) : s;
  });

  Handlebars.registerHelper('startsWith', (str, prefix) => {
    if (str == null) return false;
    return (typeof str === 'string' ? str : String(str))
      .startsWith(String(prefix == null ? '' : prefix));
  });

  Handlebars.registerHelper('endsWith', (str, suffix) => {
    if (str == null) return false;
    return (typeof str === 'string' ? str : String(str))
      .endsWith(String(suffix == null ? '' : suffix));
  });

  Handlebars.registerHelper('contains', (str, substr) => {
    if (str == null) return false;
    return (typeof str === 'string' ? str : String(str))
      .includes(String(substr == null ? '' : substr));
  });

  Handlebars.registerHelper('slugify', str => {
    if (str == null) return '';
    return _slugify(typeof str === 'string' ? str : String(str));
  });

  Handlebars.registerHelper('padStart', (str, length, char) => {
    if (str == null) return '';
    const s   = typeof str === 'string' ? str : String(str);
    const len = Math.min(parseInt(length, 10) || 0, 1000);
    if (len <= s.length) return s;
    const pad = (!isOpts(char) && char != null && String(char).length)
      ? String(char)[0] : ' ';
    return s.padStart(len, pad);
  });

  Handlebars.registerHelper('repeat', (str, count) => {
    if (str == null) return '';
    const s = typeof str === 'string' ? str : String(str);
    const n = Math.min(Math.max(parseInt(count, 10) || 0, 0), 1000);
    return s.repeat(n);
  });

  Handlebars.registerHelper('substring', (str, start, length) => {
    if (str == null) return '';
    const s  = typeof str === 'string' ? str : String(str);
    const st = parseInt(start, 10) || 0;
    if (isOpts(length) || length == null) return s.substring(st);
    const len = parseInt(length, 10);
    return isFinite(len) ? s.substring(st, st + len) : s.substring(st);
  });

  // Single-pass: one engine sweep, one output allocation (was 5 sweeps, 5 allocs)
  Handlebars.registerHelper('escapeHtml', str => {
    if (str == null) return '';
    return (typeof str === 'string' ? str : String(str))
      .replace(HTML_ESCAPE_RE, c => HTML_ESCAPE_MAP[c]);
  });

  // Single .match() call: one allocation, no filter pass (was split + filter)
  Handlebars.registerHelper('countWords', str => {
    if (str == null) return 0;
    const m = (typeof str === 'string' ? str : String(str)).match(/\S+/g);
    return m ? m.length : 0;
  });

  Handlebars.registerHelper('countChars', str => {
    if (str == null) return 0;
    return typeof str === 'string' ? str.length : String(str).length;
  });

  /**
   * findRE — memoized RegExp via bounded module-level cache.
   *
   * CRITICAL: getCachedRegex returns the SAME regex object on cache hits.
   * Stateful `g`-flag regexes retain lastIndex between calls. We MUST reset
   * lastIndex = 0 before every exec loop, or a cached regex from a prior call
   * will silently skip the beginning of the next string.
   */
  Handlebars.registerHelper('findRE', (str, pattern, limit) => {
    if (str == null || pattern == null) return [];
    const p = String(pattern);
    if (p.length > 500) { WARN('findRE', 'Pattern exceeds 500-char cap — returning []'); return []; }
    const cap = Math.min(isOpts(limit) || limit == null ? 100 : (parseInt(limit, 10) || 100), 100);
    let re;
    try   { re = getCachedRegex(p, 'g'); }
    catch (e) { WARN('findRE', `Invalid pattern: ${e.message}`); return []; }
    re.lastIndex = 0; // mandatory: reset shared cached regex before exec loop
    const s = typeof str === 'string' ? str : String(str);
    const matches = [];
    let m;
    while ((m = re.exec(s)) !== null) {
      matches.push(m[0]);
      if (matches.length >= cap) break;
      if (m[0].length === 0) re.lastIndex++; // prevent infinite loop on ε-match
    }
    return matches;
  });

  // replaceRE — same caching as findRE; lastIndex reset for correctness
  Handlebars.registerHelper('replaceRE', (str, pattern, replacement) => {
    if (str == null) return '';
    const s = typeof str === 'string' ? str : String(str);
    if (pattern == null) return s;
    const p = String(pattern);
    if (p.length > 500) { WARN('replaceRE', 'Pattern exceeds 500-char cap — returning input unchanged'); return s; }
    let re;
    try   { re = getCachedRegex(p, 'g'); }
    catch (e) { WARN('replaceRE', `Invalid pattern: ${e.message}`); return s; }
    re.lastIndex = 0;
    return s.replace(re, String(replacement == null ? '' : replacement));
  });


  // ==========================================================================
  // CATEGORY 3 — COLLECTION / ARRAY (22)
  // All return NEW arrays. Non-arrays coerce via toArr() (never throw).
  // ==========================================================================

  Handlebars.registerHelper('first', (arr, count) => {
    const a = toArr(arr);
    if (isOpts(count) || count == null) return a.slice(0, 1);
    const n = parseInt(count, 10);
    return isFinite(n) ? a.slice(0, n) : a.slice(0, 1);
  });

  Handlebars.registerHelper('last', (arr, count) => {
    const a = toArr(arr);
    if (isOpts(count) || count == null) return a.slice(-1);
    const n = parseInt(count, 10);
    return isFinite(n) ? a.slice(-n) : a.slice(-1);
  });

  Handlebars.registerHelper('after',  (arr, count) => toArr(arr).slice(parseInt(count, 10) || 0));
  Handlebars.registerHelper('before', (arr, count) => toArr(arr).slice(0, parseInt(count, 10) || 0));

  Handlebars.registerHelper('slice', (arr, start, end) => {
    const a = toArr(arr);
    const s = parseInt(start, 10) || 0;
    if (isOpts(end) || end == null) return a.slice(s);
    const e = parseInt(end, 10);
    return isFinite(e) ? a.slice(s, e) : a.slice(s);
  });

  Handlebars.registerHelper('sort', function(arr, key, options) {
    const a = toArr(arr);
    if (!a.length) return a;
    const hasKey = typeof key === 'string';
    const opts   = hasKey ? options : key;
    const desc   = (opts && opts.hash && opts.hash.order === 'desc');
    const sorted = [...a].sort((x, y) => {
      const vx = hasKey ? x?.[key] : x;
      const vy = hasKey ? y?.[key] : y;
      if (vx == null && vy == null) return 0;
      if (vx == null) return 1;  // nulls sort last in both directions
      if (vy == null) return -1;
      return vx < vy ? -1 : vx > vy ? 1 : 0;
    });
    return desc ? sorted.reverse() : sorted;
  });

  Handlebars.registerHelper('reverse', arr => [...toArr(arr)].reverse());

  Handlebars.registerHelper('filter', (arr, key, value) =>
    toArr(arr).filter(item => {
      if (item == null) return false;
      const v = item[key];
      return Array.isArray(v) ? v.includes(value) : v === value;
    })
  );

  Handlebars.registerHelper('reject', (arr, key, value) =>
    toArr(arr).filter(item => {
      if (item == null) return true;
      const v = item[key];
      return Array.isArray(v) ? !v.includes(value) : v !== value;
    })
  );

  Handlebars.registerHelper('groupBy', (arr, key) => {
    const groups = Object.create(null);
    const order  = [];
    for (const item of toArr(arr)) {
      const k = item == null ? 'undefined' : String(item[key] ?? 'undefined');
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(item);
    }
    return order.map(k => ({ key: k, items: groups[k] }));
  });

  Handlebars.registerHelper('map', (arr, key) => {
    if (isOpts(key)) return toArr(arr);
    return toArr(arr).map(item => item == null ? undefined : item[key]);
  });

  Handlebars.registerHelper('flatten',  arr => toArr(arr).flat());
  Handlebars.registerHelper('unique',   arr => [...new Set(toArr(arr))]);
  Handlebars.registerHelper('compact',  arr => toArr(arr).filter(v => v != null && v !== ''));

  Handlebars.registerHelper('count', value => {
    if (value == null) return 0;
    if (Array.isArray(value)) return value.length;
    // Object.keys is highly optimized in V8; for…in + hasOwnProperty is slower
    // in practice despite the lack of array allocation, because V8 does not
    // optimize the for…in hot path the same way.
    if (typeof value === 'object') return Object.keys(value).length;
    return typeof value === 'string' ? value.length : String(value).length;
  });

  Handlebars.registerHelper('includes', (arr, value) => Array.isArray(arr) && arr.includes(value));
  Handlebars.registerHelper('indexOf',  (arr, value) => Array.isArray(arr) ? arr.indexOf(value) : -1);

  Handlebars.registerHelper('concat', (arr1, arr2) => [
    ...(Array.isArray(arr1) ? arr1 : []),
    ...(Array.isArray(arr2) ? arr2 : []),
  ]);

  /**
   * intersect / difference — O(n+m) via Set conversion.
   * Previous: arr2.includes(x) inside .filter() = O(n*m).
   * Current:  new Set(arr2) then .has(x) = O(n+m). The Set construction
   *   is one allocation per helper call, not one per element.
   */
  Handlebars.registerHelper('intersect', (arr1, arr2) => {
    const bSet = new Set(toArr(arr2));
    return toArr(arr1).filter(x => bSet.has(x));
  });

  Handlebars.registerHelper('difference', (arr1, arr2) => {
    const bSet = new Set(toArr(arr2));
    return toArr(arr1).filter(x => !bSet.has(x));
  });

  Handlebars.registerHelper('chunk', (arr, size) => {
    const a = toArr(arr);
    const n = Math.max(parseInt(size, 10) || 1, 1);
    const out = [];
    for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
    return out;
  });

  Handlebars.registerHelper('range', function(start, end, step) {
    const from       = num(start);
    const to         = num(end);
    const rawStep    = (isOpts(step) || step == null) ? 1 : num(step);
    const actualStep = rawStep === 0 ? 1 : rawStep;
    if (Math.abs((to - from) / actualStep) > 10000) {
      WARN('range', 'Result would exceed 10 000-item cap — returning []');
      return [];
    }
    const out = [];
    if (actualStep > 0) { for (let i = from; i <= to; i += actualStep) out.push(i); }
    else                { for (let i = from; i >= to; i += actualStep) out.push(i); }
    return out;
  });


  // ==========================================================================
  // CATEGORY 4 — DATE / TIME (7)
  // Zero dependencies — all formatting via built-in Intl API.
  // ==========================================================================

  Handlebars.registerHelper('formatDate', function(dateStr, format, options) {
    const date = parseDate(dateStr);
    if (!date) return dateStr != null ? String(dateStr) : '';
    const locale = getLocale(options, 'en-US');
    const fmt    = typeof format === 'string' ? format : 'medium';
    if (fmt === 'iso') return date.toISOString();
    const preset = DATE_PRESETS[fmt] || DATE_PRESETS.medium;
    try   { return getDateTimeFormat(locale, fmt, preset).format(date); }
    catch { return date.toDateString(); }
  });

  Handlebars.registerHelper('isoDate', dateStr => {
    const d = parseDate(dateStr);
    return d ? d.toISOString() : '';
  });

  /**
   * timeAgo — locale-aware relative time string via Intl.RelativeTimeFormat.
   *
   *   {{timeAgo entry.createdAt}}               → "3 days ago"
   *   {{timeAgo entry.createdAt locale="de"}}   → "vor 3 Tagen"
   *   {{timeAgo entry.createdAt locale="ar"}}   → "منذ 3 أيام"
   *   {{timeAgo entry.createdAt locale="ja"}}   → "3 日前"
   *
   * The `numeric:"auto"` option produces natural phrasing where the locale
   * supports it: yesterday/today/tomorrow, gestern/heute/morgen, etc.
   * Sub-45-second deltas are routed to _justNow() — see its comment above.
   */
  Handlebars.registerHelper('timeAgo', function(dateStr, options) {
    const date = parseDate(dateStr);
    if (!date) return '';
    const locale = getLocale(options, 'en');
    const secs   = (Date.now() - date.getTime()) / 1000;
    if (secs < 45 && secs >= -45) return _justNow(locale);
    const rtf = getRelativeTimeFormat(locale);
    const abs  = Math.abs(secs);
    let value, unit;
    if      (abs < 2700)     { value = Math.round(secs / 60);      unit = 'minute'; }
    else if (abs < 79200)    { value = Math.round(secs / 3600);    unit = 'hour';   }
    else if (abs < 2160000)  { value = Math.round(secs / 86400);   unit = 'day';    }
    else if (abs < 31536000) { value = Math.round(secs / 2592000); unit = 'month';  }
    else                     { value = Math.round(secs / 31536000); unit = 'year';  }
    // RTF.format() expects negative values for past, positive for future.
    return rtf.format(-Math.abs(value) * (secs < 0 ? -1 : 1), unit);
  });

  Handlebars.registerHelper('now',   () => new Date().toISOString());
  Handlebars.registerHelper('year',  dateStr => { const d = parseDate(dateStr); return d ? d.getFullYear()  : ''; });
  Handlebars.registerHelper('month', dateStr => { const d = parseDate(dateStr); return d ? d.getMonth() + 1 : ''; });
  Handlebars.registerHelper('day',   dateStr => { const d = parseDate(dateStr); return d ? d.getDate()      : ''; });


  // ==========================================================================
  // CATEGORY 5 — MATH (16)
  // Division / modulo by zero returns 0 (never Infinity, never NaN).
  // ==========================================================================

  Handlebars.registerHelper('add',      (a, b) => num(a) + num(b));
  Handlebars.registerHelper('subtract', (a, b) => num(a) - num(b));
  Handlebars.registerHelper('multiply', (a, b) => num(a) * num(b));
  Handlebars.registerHelper('divide',   (a, b) => num(b) !== 0 ? num(a) / num(b) : 0);
  Handlebars.registerHelper('mod',      (a, b) => num(b) !== 0 ? num(a) % num(b) : 0);
  Handlebars.registerHelper('ceil',     a      => Math.ceil(num(a)));
  Handlebars.registerHelper('floor',    a      => Math.floor(num(a)));
  Handlebars.registerHelper('round',    a      => Math.round(num(a)));
  Handlebars.registerHelper('abs',      a      => Math.abs(num(a)));
  Handlebars.registerHelper('min',      (a, b) => Math.min(num(a), num(b)));
  Handlebars.registerHelper('max',      (a, b) => Math.max(num(a), num(b)));
  Handlebars.registerHelper('pow',      (a, b) => Math.pow(num(a), num(b)));

  Handlebars.registerHelper('clamp', (value, lo, hi) =>
    Math.min(Math.max(num(value), num(lo)), num(hi))
  );

  Handlebars.registerHelper('toFixed', (value, digits) => {
    const d = (isOpts(digits) || digits == null)
      ? 0 : Math.min(Math.max(parseInt(digits, 10) || 0, 0), 20);
    return num(value).toFixed(d);
  });

  Handlebars.registerHelper('toInt', value => {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : 0;
  });

  Handlebars.registerHelper('math', (a, op, b) => {
    if (typeof op !== 'string') return 0;
    const x = num(a), y = num(b);
    switch (op.trim()) {
      case '+':  return x + y;
      case '-':  return x - y;
      case '*':  return x * y;
      case '/':  return y !== 0 ? x / y : 0;
      case '%':  return y !== 0 ? x % y : 0;
      case '**':
      case '^':  return Math.pow(x, y);
      default: WARN('math', `Unknown operator "${op}"`); return 0;
    }
  });


  // ==========================================================================
  // CATEGORY 6 — URL / PATH (5)
  // ==========================================================================

  Handlebars.registerHelper('absoluteUrl', function(path, options) {
    const p = String(path == null ? '' : path);
    let base = '';
    try {
      const root = options && options.data && options.data.root;
      if (root && root.config && root.config.url) {
        base = String(root.config.url).replace(/\/+$/, '');
      }
    } catch { /* context unreadable — use empty base, return path unchanged */ }
    return base ? base + (p.startsWith('/') ? p : '/' + p) : p;
  });

  Handlebars.registerHelper('relativeUrl', path => {
    if (path == null) return '/';
    const p = String(path);
    return p.startsWith('/') ? p : '/' + p;
  });

  Handlebars.registerHelper('urlEncode', str => {
    if (str == null) return '';
    return encodeURIComponent(typeof str === 'string' ? str : String(str));
  });

  Handlebars.registerHelper('urlDecode', str => {
    if (str == null) return '';
    try   { return decodeURIComponent(typeof str === 'string' ? str : String(str)); }
    catch { return typeof str === 'string' ? str : String(str); } // malformed URI
  });

  Handlebars.registerHelper('pathJoin', function(...rawArgs) {
    rawArgs.pop();
    const joined = rawArgs
      .filter(s => s != null && !isOpts(s))
      .map(s => String(s))
      .join('/');
    const clean = joined.replace(/\/+/g, '/').replace(/\/$/, '');
    return clean || '/';
  });


  // ==========================================================================
  // CATEGORY 7 — ENCODING / SERIALIZATION (4)
  // ==========================================================================

  /**
   * json — hardened JSON serialization for use in <script> blocks.
   *
   * SECURITY:
   *   The single-pass replacement (was 6 chained calls) Unicode-escapes all
   *   six characters that can break out of a <script> block:
   *   <, >, &, ', U+2028, U+2029. One engine scan, one output allocation
   *   regardless of the JSON payload size.
   *
   *   Circular references → "[Circular]" (never throws).
   *   Handlebars internal keys → stripped (prevents context leakage).
   */
  Handlebars.registerHelper('json', function(value, options) {
    const indent = (options && options.hash && typeof options.hash.indent === 'number')
      ? Math.max(0, Math.min(options.hash.indent, 10)) : 2;
    const seen = new WeakSet();
    let safe;
    try {
      safe = JSON.stringify(value, function(key, val) {
        if (key === '_parent' || key === 'root' || key === '_setup' || key === '_blockParams')
          return undefined;
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      }, indent);
    } catch { safe = null; }
    if (!safe) return '{}';
    // Single-pass: one engine sweep (was 6 chained .replace() calls)
    return safe.replace(JSON_ESCAPE_RE, c => JSON_ESCAPE_MAP[c]);
  });

  Handlebars.registerHelper('base64Encode', str => {
    if (str == null) return '';
    return Buffer.from(typeof str === 'string' ? str : String(str), 'utf-8').toString('base64');
  });

  Handlebars.registerHelper('base64Decode', str => {
    if (str == null) return '';
    try   { return Buffer.from(String(str), 'base64').toString('utf-8'); }
    catch { return ''; }
  });

  // Single-pass XML escape — correct &apos; (not &#x27;) for XML contexts
  Handlebars.registerHelper('xmlEscape', str => {
    if (str == null) return '';
    return (typeof str === 'string' ? str : String(str))
      .replace(XML_ESCAPE_RE, c => XML_ESCAPE_MAP[c]);
  });


  // ==========================================================================
  // CATEGORY 8 — OBJECT MANIPULATION (5 + get = 6)
  // ==========================================================================

  /**
   * dict — create a plain object from alternating key/value pairs.
   *   Usage: {{> card (dict "title" entry.title "size" "large")}}
   *   Object.create(null) avoids prototype collision with legitimate data keys.
   */
  Handlebars.registerHelper('dict', function(...rawArgs) {
    rawArgs.pop();
    const obj = Object.create(null);
    for (let i = 0; i + 1 < rawArgs.length; i += 2) {
      const k = rawArgs[i];
      if (k != null && !isOpts(k)) obj[String(k)] = rawArgs[i + 1];
    }
    return obj;
  });

  Handlebars.registerHelper('keys',
    obj => (obj == null || typeof obj !== 'object' || Array.isArray(obj))
      ? [] : Object.keys(obj));

  Handlebars.registerHelper('values',
    obj => (obj == null || typeof obj !== 'object' || Array.isArray(obj))
      ? [] : Object.values(obj));

  /**
   * hasKey — checks property *existence*, not truthiness.
   * Returns true even when item[key] is 0, "", false, or null.
   * Critical distinction from {{#if entry.series}}.
   */
  Handlebars.registerHelper('hasKey', (obj, key) => {
    if (obj == null || typeof obj !== 'object') return false;
    if (isOpts(key) || key == null) return false;
    return Object.prototype.hasOwnProperty.call(obj, key);
  });

  Handlebars.registerHelper('merge', (obj1, obj2) => {
    const isPlain = v => v != null && typeof v === 'object' && !Array.isArray(v) && !isOpts(v);
    return Object.assign(Object.create(null), isPlain(obj1) ? obj1 : {}, isPlain(obj2) ? obj2 : {});
  });

  /**
   * get — safe deep-path access for objects and arrays.
   * Uses module-level _safeGet (allocated once; not re-created per call).
   *
   * CALLING FORMS:
   *   {{get obj "key"}}                      property access
   *   {{get obj "hyphen-key"}}               hyphenated / special-char key
   *   {{get arr 0}}                          array index (positive)
   *   {{get arr -1}}                         array index from end
   *   {{get obj dynamicVar}}                 dynamic key from context
   *   {{get obj "a" "b" "c"}}               variadic deep traversal
   *   {{get obj "nav" 0 "children" 2 "url"}} mixed objects + arrays
   *   {{get obj "key" default="n/a"}}        fallback when path is absent
   *
   * Dots in key strings are NEVER split — "a.b" is the literal key "a.b".
   * Use the variadic form {{get obj "a" "b"}} for nested access.
   */
  Handlebars.registerHelper('get', function(...rawArgs) {
    const options  = rawArgs.pop();
    if (!rawArgs.length) return '';
    let current    = rawArgs.shift();
    const segments = rawArgs;
    const fallback = (options && options.hash && 'default' in options.hash)
      ? options.hash.default : '';
    if (!segments.length) return current ?? fallback;
    for (const seg of segments) {
      if (current == null) return fallback;
      current = _safeGet(current, seg);
    }
    return current ?? fallback;
  });


  // ==========================================================================
  // CATEGORY 9 — UTILITY / LOGIC (6)
  // ==========================================================================

  /**
   * default — returns value if meaningfully present, otherwise fallback.
   * 0 and false ARE considered present. Only null, undefined, and "" trigger
   * the fallback. Using `||` would incorrectly substitute 0 and false.
   */
  Handlebars.registerHelper('default', (value, fallback) =>
    (value != null && value !== '') ? value : fallback
  );

  Handlebars.registerHelper('ternary', (condition, ifTrue, ifFalse) =>
    condition ? ifTrue : ifFalse
  );

  /**
   * pluralize — locale-aware via Intl.PluralRules (CLDR-backed).
   *
   * FORM 1 — English shorthand:
   *   {{pluralize "post" count}}
   *
   * FORM 2 — Any language with explicit CLDR word-form map:
   *   {{pluralize count locale="pl"
   *     forms=(dict "one" "wpis" "few" "wpisy" "many" "wpisów" "other" "wpisów")}}
   *
   * INVARIANT and IRREGULAR constants are module-level (allocated once).
   */
  Handlebars.registerHelper('pluralize', function(wordOrCount, countOrOptions, options) {
    const isForm1 = typeof wordOrCount === 'string' && !isOpts(wordOrCount);
    const word    = isForm1 ? wordOrCount    : null;
    const count   = isForm1 ? countOrOptions : wordOrCount;
    const opts    = isForm1 ? options        : countOrOptions;
    const n       = num(count);
    const locale  = getLocale(opts, 'en');
    const forms   = (opts && opts.hash && opts.hash.forms) || null;

    if (forms != null) {
      const category = getPluralRules(locale).select(n);
      const result   = forms[category] ?? forms['other'] ?? Object.values(forms)[0];
      return result != null ? String(result) : String(n);
    }

    if (word == null) return String(n);
    const w = typeof word === 'string' ? word : String(word);
    if (n === 1) return w;
    const lower = w.toLowerCase();
    if (INVARIANT.has(lower)) return w;
    if (IRREGULAR[lower]) {
      const pl = IRREGULAR[lower];
      return w[0] === w[0].toUpperCase() ? pl[0].toUpperCase() + pl.slice(1) : pl;
    }
    if (/(?:s|sh|ch|x|z)$/i.test(w)) return w + 'es';
    if (/[^aeiou]y$/i.test(w))       return w.slice(0, -1) + 'ies';
    if (/fe$/i.test(w))               return w.slice(0, -2) + 'ves';
    if (/[^aeiou]f$/i.test(w))        return w.slice(0, -1) + 'ves';
    return w + 's';
  });

  /**
   * Block helpers: times, eachLimit, eachWhen.
   *
   * String concatenation (out += fn()) is replaced with pre-allocated arrays
   * and a single .join('') call at the end. For longer outputs and larger
   * iteration counts, this eliminates repeated string re-allocation as the
   * accumulated output grows. new Array(n) pre-sizes the array when count
   * is known up-front, avoiding V8's internal re-allocation during push().
   */

  Handlebars.registerHelper('times', function(count, options) {
    const n = Math.min(Math.max(parseInt(count, 10) || 0, 0), 100);
    if (parseInt(count, 10) > 100) WARN('times', 'count capped at 100');
    const parts = new Array(n);
    for (let i = 0; i < n; i++) {
      parts[i] = options.fn({ index: i, first: i === 0, last: i === n - 1 });
    }
    return parts.join('');
  });

  Handlebars.registerHelper('eachLimit', function(arr, limit, options) {
    if (!Array.isArray(arr) || !arr.length) return options.inverse ? options.inverse(this) : '';
    const n = Math.min(arr.length, Math.max(parseInt(limit, 10) || arr.length, 0));
    const parts = new Array(n);
    for (let i = 0; i < n; i++) {
      const frame = Handlebars.createFrame(options.data || {});
      frame.index = i; frame.first = i === 0; frame.last = i === n - 1;
      parts[i] = options.fn(arr[i], { data: frame });
    }
    const out = parts.join('');
    return out || (options.inverse ? options.inverse(this) : '');
  });

  Handlebars.registerHelper('eachWhen', function(arr, key, value, options) {
    if (!Array.isArray(arr)) return options.inverse ? options.inverse(this) : '';
    const filtered = arr.filter(item => {
      if (item == null) return false;
      const v = item[key];
      return Array.isArray(v) ? v.includes(value) : v === value;
    });
    if (!filtered.length) return options.inverse ? options.inverse(this) : '';
    const last  = filtered.length - 1;
    const parts = new Array(filtered.length);
    filtered.forEach((item, i) => {
      const frame = Handlebars.createFrame(options.data || {});
      frame.index = i; frame.first = i === 0; frame.last = i === last;
      parts[i] = options.fn(item, { data: frame });
    });
    return parts.join('');
  });


  // ==========================================================================
  // CATEGORY 10 — SHUFFLE (1)
  // ==========================================================================

  /**
   * shuffle — Fisher-Yates on a copy. Non-deterministic; matches Hugo's
   * collections.Shuffle. Do not use in reproducible build pipelines.
   */
  Handlebars.registerHelper('shuffle', arr => {
    const copy = [...toArr(arr)];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  });

} // end registerHelpers
