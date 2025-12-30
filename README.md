# THYPRESS

> **Fast static site generator with built-in HTTP server**  
> Turn any folder of Markdown into a website — instantly. Zero config.

```bash
thypress serve    # Live server with hot reload (11k req/s)
thypress build    # Static site output for any CDN
```

**Zero configuration. Zero complexity. Zero excuses.**

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-blue.svg)](https://mozilla.org/MPL/2.0/)
[![Version](https://img.shields.io/badge/version-0.2.0-green.svg)](https://github.com/thypress/binder/releases)
[![Bun](https://img.shields.io/badge/runtime-bun-orange.svg)](https://bun.sh)

---

## 📜🪶 What is THYPRESS?

THYPRESS is a **static site generator** that's also an **HTTP server**.

Drop a folder of `.md`, `.txt`, or `.html` files into it → get a website with:
- **11,209 req/s dev server** (benchmarked)
- **Built-in image optimization** (WebP + responsive sizes)
- **Zero configuration** (really, just drag & drop)
- **Server mode** OR static build output
- **7 dependencies** (not 1,000+)

**Who is this for?**
- Writers who hate build tools
- Developers who want speed without complexity
- Anyone publishing docs, blogs, portfolios, or knowledge bases
- Teams that need Git-based publishing without a CMS

**What makes it different?**
- **Dual-mode**: Serve live from a VPS OR build static files for a CDN
- **Content-first**: Your folder structure = your site structure
- **HTML-aware**: Detects complete HTML docs vs fragments
- **Fast by design**: Pre-rendering + pre-compression = 11k req/s

---

## ⚠️ Maturity Notice

**v0.2.0** - Early release. Here's where it stands:

✅ **Ready for:**
- Personal blogs and portfolios
- Side projects and experiments
- Documentation sites
- Learning and teaching
- Prototypes and MVPs

⚠️ **Use with caution for:**
- Company blogs (new project, single maintainer)
- Client work (explain limitations first)
- Business-critical sites (no SLA, no commercial support)

❌ **Not ready for:**
- Enterprise (wait for v1.0+)
- High-traffic production (needs more testing)
- Regulated industries (no security audit yet)

**Stability:** The core is solid. The ecosystem is young.

---

## ⚡ Quick Start

### 1. Install

**macOS / Linux:**
```bash
curl -sSL https://thypress.org/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr https://thypress.org/install.ps1 | iex
```

**Manual:** Download binary from [GitHub Releases](https://github.com/thypress/binder/releases)

### 2. Create Your Site

```bash
mkdir my-blog && cd my-blog
thypress serve
```

That's it. Your site is live at `http://localhost:3009`.

THYPRESS auto-creates:
- `content/posts/2024-01-01-welcome.md` (example post)
- `templates/my-press/` (your theme folder)
- `config.json` (site configuration)

### 3. Add Content

```bash
echo "# Hello World" > content/posts/hello.md
```

The page appears instantly. No restart needed.

### 4. Deploy

```bash
# Option A: Static hosting (Netlify, Vercel, GitHub Pages)
thypress build
# Upload the /build folder

# Option B: Server mode (VPS, Railway, Raspberry Pi)
thypress build --serve
# HTTP server now running on port 3009
```

**Done. You have a website.**

---

## 📚 Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Content Structure](#content-structure)
- [Features](#features)
- [Configuration](#configuration)
- [Theming](#theming)
- [Deployment](#deployment)
- [Performance](#performance)
- [Architecture](#architecture)
- [Comparison](#comparison)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [License](#license)

---

## 🚀 Installation

### One-line Install

**macOS / Linux:**
```bash
curl -sSL https://thypress.org/install.sh | bash
```

This script:
1. Detects your OS and architecture
2. Downloads the latest binary from GitHub releases
3. Makes it executable
4. Installs to `/usr/local/bin/thypress` (or current directory if no sudo)

**Windows (PowerShell as Administrator):**
```powershell
iwr https://thypress.org/install.ps1 | iex
```

**Verify installation:**
```bash
thypress version
# THYPRESS v0.2.0
```

---

### Manual Install

1. **Download the binary** for your OS from [GitHub Releases](https://github.com/thypress/binder/releases):
   - `thypress-linux-x64` (Linux)
   - `thypress-macos-arm64` (Apple Silicon)
   - `thypress-macos-x64` (Intel Mac)
   - `thypress-windows-x64.exe` (Windows)

2. **Make it executable** (Unix only):
   ```bash
   chmod +x thypress
   ```

3. **Move to PATH** (optional but recommended):
   ```bash
   # macOS / Linux
   sudo mv thypress /usr/local/bin/
   
   # Windows: Add to PATH or run from current directory
   ```

4. **Run it**:
   ```bash
   thypress --help
   ```

---

### Build from Source

**Requirements:**
- [Bun](https://bun.sh) v1.0+

**Steps:**
```bash
# Clone the repository
git clone https://github.com/thypress/binder.git
cd binder

# Install dependencies (7 packages)
bun install

# Run from source
bun src/cli.js serve

# Or build a binary
bun build src/cli.js --compile --outfile thypress
```

**Dependencies (only 7):**
- `feed` - RSS generation
- `gray-matter` - Front matter parsing
- `handlebars` - Templating
- `highlight.js` - Syntax highlighting
- `htmlparser2` - HTML parsing
- `markdown-it` + plugins - Markdown rendering
- `sharp` - Image optimization
- `sitemap` - Sitemap generation

---

## 💻 Usage

### Commands

```bash
thypress                    # Start dev server (default)
thypress serve              # Start dev server (alias: s, dev)
thypress build              # Build static site (alias: b)
thypress build --serve      # Build + preview with HTTP server
thypress clean              # Delete .cache directory
thypress version            # Show version (alias: -v, --version)
thypress help               # Show help (alias: -h, --help)
```

### Options

```bash
--dir <path>                # Target directory (default: current)
-d <path>                   # Short form of --dir
--no-browser                # Don't auto-open browser
--no-open                   # Alias for --no-browser
--serve                     # Serve after building (for 'build' command)
[directory]                 # Direct path (e.g., thypress my-blog/)
```

### Examples

**Basic usage:**
```bash
# Serve current directory
thypress

# Serve a specific directory
thypress my-blog/
thypress --dir ~/projects/blog

# Build static output
thypress build

# Build and preview
thypress build --serve

# Clean image cache
thypress clean
```

**Production deployment:**
```bash
# Build static files for CDN
thypress build
# Output in ./build/

# OR run as HTTP server
thypress build --serve --no-browser
# Production server on port 3009
```

**Development workflow:**
```bash
# Terminal 1: Watch and serve
thypress serve

# Terminal 2: Edit content
echo "# New Post" > content/posts/new.md
# Server detects change and re-renders
```

---

## 📁 Content Structure

### Three Modes

THYPRESS automatically detects your content structure:

#### 1. **Structured Mode** (Recommended)

```
my-blog/
├── content/              ← Detected: creates structured site
│   ├── posts/           → Blog posts
│   │   ├── 2024-01-01-welcome.md
│   │   └── 2024-01-15-second-post.md
│   ├── docs/            → Documentation
│   │   ├── getting-started.md
│   │   └── api/
│   │       └── reference.md
│   └── about.md         → Static page
├── templates/           ← Themes
│   └── my-press/
│       ├── index.html
│       ├── post.html
│       └── style.css
└── config.json          ← Site configuration
```

**URLs generated:**
- `content/posts/2024-01-01-welcome.md` → `/posts/2024-01-01-welcome/`
- `content/docs/getting-started.md` → `/docs/getting-started/`
- `content/about.md` → `/about/`

**Navigation:** Auto-generated from folder structure.

---

#### 2. **Legacy Mode** (v0.1 compatibility)

```
my-blog/
├── posts/               ← Detected: creates flat blog
│   ├── 2024-01-01-welcome.md
│   └── 2024-01-15-second.md
├── templates/
└── config.json
```

**URLs generated:**
- `posts/2024-01-01-welcome.md` → `/2024-01-01-welcome/`

**Best for:** Simple blogs migrated from v0.1.

---

#### 3. **Simple Mode** (Root-level files)

```
my-notes/
├── index.md             ← Detected: serves root files
├── about.md
├── projects.md
└── config.json
```

**URLs generated:**
- `index.md` → `/`
- `about.md` → `/about/`

**Best for:** Personal wikis, note collections, minimal sites.

---

### File Types

THYPRESS supports three content types:

#### Markdown (`.md`)
```markdown
---
title: My Post
date: 2024-01-01
tags: [blog, tech]
---

# My Post

Content here.
```

**Features:**
- Full CommonMark + GFM support
- Syntax highlighting (140+ languages)
- Automatic `<picture>` tags for images
- Auto-generated heading IDs
- Table of contents ready

---

#### Plain Text (`.txt`)
```
Just plain text.
No formatting needed.
```

**Rendered as:**
```html
<pre>Just plain text.
No formatting needed.</pre>
```

**Best for:** ASCII art, logs, simple notes.

---

#### HTML (`.html`)

THYPRESS detects HTML intent:

**Complete Document (served raw, no template):**
```html
<!DOCTYPE html>
<html>
<head>
  <title>Custom Page</title>
</head>
<body>
  <h1>I control everything</h1>
</body>
</html>
```

**Fragment (wrapped in template):**
```html
<h1>My Content</h1>
<p>This will be wrapped in post.html template.</p>
```

**Force raw output:**
```html
---
template: none
---
<!DOCTYPE html>
<html>...</html>
```

**Force templated output:**
```html
---
template: post
---
<h1>Fragment</h1>
<p>Even though this looks complete, wrap it.</p>
```

---

### Front Matter

Optional YAML metadata at the top of files:

```yaml
---
title: "Post Title"               # Optional: auto-detected from H1 or filename
date: 2024-01-01                  # Optional: auto-detected from filename or file date
createdAt: 2024-01-01             # Alias for 'date'
updatedAt: 2024-01-15             # Optional: defaults to file modification time
tags: [blog, tech, tutorial]      # Optional: used for tag pages
description: "Short summary"      # Optional: for meta description and excerpts
template: custom                  # Optional: use templates/{theme}/custom.html
image: /images/og-image.jpg       # Optional: OpenGraph image (auto from first image)
author: "Author Name"             # Optional: defaults to config.json author
---
```

**Minimal example (all auto-detected):**
```markdown
# My Post Title

Content here.
```

THYPRESS extracts:
- **Title**: From `# H1` heading or filename
- **Date**: From `YYYY-MM-DD-` filename prefix or file creation date
- **Updated**: From file modification time
- **OG Image**: From first image in content

---

### URL Generation

**Rules:**
1. Remove file extension (`.md`, `.txt`, `.html`)
2. Remove `index` from path end
3. Add leading `/` and trailing `/`
4. Preserve folder structure

**Examples:**

| File Path | URL |
|-----------|-----|
| `content/posts/hello.md` | `/posts/hello/` |
| `content/about.md` | `/about/` |
| `content/docs/api/auth.md` | `/docs/api/auth/` |
| `content/index.md` | `/` |
| `posts/2024-01-01-welcome.md` | `/2024-01-01-welcome/` (legacy mode) |

**Date prefixes are preserved in URLs** (unlike Jekyll).

---

## ✨ Features

### Image Optimization

**Automatic WebP + JPEG generation** with responsive sizes.

#### How It Works

When you reference an image in Markdown:
```markdown
![Alt text](./photo.jpg)
```

THYPRESS automatically:
1. **Reads the original image** and determines its width
2. **Generates responsive sizes**: 400w, 800w, 1200w (or smaller if original is smaller)
3. **Creates two formats**: WebP (modern) + JPEG (fallback)
4. **Caches in `.cache/`** with MD5 hash (persistent across builds)
5. **Outputs `<picture>` tag**:

```html
<picture>
  <source
    srcset="/posts/photo-400-abc123.webp 400w, /posts/photo-800-abc123.webp 800w, /posts/photo-1200-abc123.webp 1200w"
    type="image/webp"
    sizes="(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px">
  <source
    srcset="/posts/photo-400-abc123.jpg 400w, /posts/photo-800-abc123.jpg 800w, /posts/photo-1200-abc123.jpg 1200w"
    type="image/jpeg"
    sizes="(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px">
  <img
    src="/posts/photo-800-abc123.jpg"
    alt="Alt text"
    loading="lazy"
    decoding="async">
</picture>
```

#### Image Paths

**Absolute (from content root):**
```markdown
![Logo](/images/logo.png)
```
Resolves to: `content/images/logo.png`

**Relative to post directory:**
```markdown
![Diagram](./diagram.png)
![Other](../images/other.png)
```
Resolves relative to the post's location.

**Relative without `./`:**
```markdown
![Photo](photo.jpg)
```
Resolves relative to post directory.

#### Performance

- **Parallel processing**: Uses 75% of CPU cores
- **Persistent cache**: `.cache/` survives rebuilds
- **Cache cleanup**: Removes orphaned files automatically
- **Build time**: ~45 seconds for 50 images (6 files per image = 300 files)

---

### Search

**Client-side search** with [MiniSearch](https://lucaong.github.io/minisearch/).

#### Features
- **No backend required**: Pure JavaScript, works offline
- **Fast**: Fuzzy search with prefix matching
- **Smart ranking**: Title > description > content
- **Auto-indexed**: Generated at build time

#### How It Works

1. **Build generates `/search.json`**:
```json
[
  {
    "id": "post-slug",
    "title": "Post Title",
    "slug": "post-slug",
    "url": "/posts/post-slug/",
    "date": "2024-01-01",
    "tags": ["blog"],
    "description": "Short description",
    "content": "First 5000 chars of content..."
  }
]
```

2. **Template includes search UI** (in default theme):
```html
<input type="text" id="search" placeholder="Search posts..." />
<div id="search-results"></div>

<script src="https://cdn.jsdelivr.net/npm/minisearch@7.1.0/dist/umd/index.min.js"></script>
<script>
  // MiniSearch initialization in templates/.default/index.html
</script>
```

3. **Users type → instant results**

---

### Tags & Categories

**Automatic tag pages** at `/tag/{tagname}/`.

#### Usage

Add tags to front matter:
```yaml
---
tags: [blog, tutorial, javascript]
---
```

THYPRESS automatically:
1. **Creates tag pages**: `/tag/blog/`, `/tag/tutorial/`, `/tag/javascript/`
2. **Lists tagged posts** sorted by date (newest first)
3. **Generates tag clouds** (if your theme supports it)

#### Template

Tag pages use `templates/{theme}/tag.html`:
```handlebars
<h1>Tag: {{tag}}</h1>

<ul>
  {{#each posts}}
  <li>
    <a href="{{url}}">{{title}}</a>
    <span>{{date}}</span>
  </li>
  {{/each}}
</ul>
```

---

### Pagination

**Automatic pagination** for the homepage.

**Default**: 10 posts per page (defined in `src/renderer.js`).

**URLs generated:**
- Page 1: `/`
- Page 2: `/page/2/`
- Page 3: `/page/3/`
- ...

#### Template

Homepage gets a `pagination` object:
```handlebars
{{#if pagination}}
<nav class="pagination">
  {{#if pagination.hasPrev}}
    <a href="{{#if (eq pagination.prevPage 1)}}/{{else}}/page/{{pagination.prevPage}}/{{/if}}">Previous</a>
  {{/if}}

  {{#each pagination.pages}}
    {{#if (eq this ../pagination.currentPage)}}
      <strong>{{this}}</strong>
    {{else if (eq this "...")}}
      <span>...</span>
    {{else}}
      <a href="{{#if (eq this 1)}}/{{else}}/page/{{this}}/{{/if}}">{{this}}</a>
    {{/if}}
  {{/each}}

  {{#if pagination.hasNext}}
    <a href="/page/{{pagination.nextPage}}/">Next</a>
  {{/if}}
</nav>
{{/if}}
```

---

### RSS & Sitemap

**Auto-generated feeds** for SEO and syndication.

#### RSS Feed (`/rss.xml`)

Generated automatically with:
- Last 20 posts
- Full content or description
- Pub date, updated date
- Tags as categories
- Proper Dublin Core metadata

**Link in template:**
```html
<link rel="alternate" type="application/rss+xml" title="RSS Feed" href="/rss.xml">
```

---

#### Sitemap (`/sitemap.xml`)

Generated automatically with:
- All content pages
- Tag pages
- Homepage
- Priority and change frequency

**Linked in `robots.txt`:**
```
User-agent: *
Allow: /

Sitemap: https://example.com/sitemap.xml
```

---

### Navigation

**Auto-generated from folder structure** (structured mode only).

Your folder structure:
```
content/
├── posts/
│   ├── 2024-01-01-first.md
│   └── 2024-01-15-second.md
├── docs/
│   ├── intro.md
│   └── api/
│       ├── auth.md
│       └── users.md
└── about.md
```

Becomes navigation with nested `<details>` tags.

#### Template Usage

```handlebars
{{#if navigation}}
<aside>
  <h2>Navigation</h2>
  <nav>
    {{{navigationTree navigation}}}
  </nav>
</aside>
{{/if}}
```

**Note**: `navigation` is only available in **structured mode** (`content/` with sections).

---

### SEO

**Production-ready SEO** out of the box.

Every page includes:
- Title tags
- Meta descriptions
- Open Graph tags (Facebook)
- Twitter cards
- JSON-LD structured data
- Canonical URLs

**Generated files:**
- `robots.txt` (templated with your site URL)
- `llms.txt` (for AI crawlers)
- `404.html` (custom error page)
- `sitemap.xml`
- `rss.xml`

---

### Syntax Highlighting

**Automatic code highlighting** with [highlight.js](https://highlightjs.org/).

#### Supported Languages

140+ languages including JavaScript, Python, Ruby, Go, Rust, HTML, CSS, Bash, SQL, and more.

#### Usage

````markdown
```javascript
function hello(name) {
  console.log(`Hello, ${name}!`);
}
```
````

**Change theme** by editing `templates/{theme}/post.html`:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
```

**Available themes**: [highlight.js demo](https://highlightjs.org/static/demo/)

---

## ⚙️ Configuration

### config.json

**Location**: `config.json` in project root

**Full example:**
```json
{
  "title": "My Site",
  "description": "A site powered by THYPRESS",
  "url": "https://example.com",
  "author": "Your Name",
  "theme": "my-press",
  "index": "custom-homepage-slug"
}
```

#### Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | No | `"My Site"` | Site name (used in title tags, RSS, etc.) |
| `description` | string | No | `"A site powered by THYPRESS"` | Site description (meta tags) |
| `url` | string | No | `"https://example.com"` | Production URL (for absolute URLs) |
| `author` | string | No | `"Anonymous"` | Default author (overridable per post) |
| `theme` | string | No | First in `templates/` | Theme folder name (e.g., `"my-press"`) |
| `index` | string | No | `null` | Custom homepage slug (e.g., `"welcome"` uses `/welcome/` as `/`) |

#### Minimal config.json

THYPRESS works with an **empty config**:
```json
{}
```

---

### Front Matter Reference

**Complete list** of supported front matter fields:

```yaml
---
# Content Metadata
title: "Post Title"                # Post title (auto from H1 or filename)
date: 2024-01-01                   # Publication date (auto from filename/file)
createdAt: 2024-01-01              # Alias for 'date'
updatedAt: 2024-01-15              # Last updated (auto from mtime)
description: "Short summary"       # Meta description & excerpt

# Taxonomy
tags: [blog, tech]                 # Tags (creates /tag/{tag}/ pages)
author: "Author Name"              # Author (overrides config.json)

# SEO & Social
image: /path/to/og-image.jpg       # OpenGraph image (auto from first image)

# Template Control
template: custom                   # Use templates/{theme}/custom.html
                                   # OR 'none' to serve raw HTML

# Custom Fields (available in templates)
customField: "Any value"           # Access via {{frontMatter.customField}}
---
```

#### Auto-Detection Logic

**Title extraction (priority order):**
1. Front matter `title: "..."`
2. First `# H1` heading in content
3. Filename without date prefix and extension
4. Raw filename

**Date extraction (priority order):**
1. Front matter `date:` or `createdAt:`
2. Filename prefix `YYYY-MM-DD-`
3. File birth time (if valid)
4. File modification time

**Updated date:**
1. Front matter `updatedAt:` or `updated:`
2. File modification time

**OpenGraph image:**
1. Front matter `image:`
2. First image referenced in content (auto-detected)

---

## 🎨 Theming

### Template Structure

**Theme location**: `templates/{theme-name}/`

**Required files** (minimum):
```
templates/my-theme/
├── index.html          # Homepage (list of posts)
├── post.html           # Individual post/page
└── tag.html            # Tag archive page
```

**Optional files**:
```
templates/my-theme/
├── style.css           # Styles (served at /assets/style.css)
├── script.js           # JavaScript (served at /assets/script.js)
├── robots.txt          # Templated robots.txt
├── llms.txt            # Templated llms.txt
├── 404.html            # Custom 404 page
└── {section}.html      # Section-specific template (e.g., docs.html)
```

**Asset handling**:
- Files in `templates/{theme}/` (except `.html`) → `/assets/`
- Files can include Handlebars templates (e.g., `{{siteUrl}}`)
- Subdirectories preserved: `templates/my-theme/fonts/` → `/assets/fonts/`

---

### Template Variables

**Available in all templates:**

#### Site Variables
```handlebars
{{siteTitle}}           Site title (from config.json)
{{siteDescription}}     Site description
{{siteUrl}}             Site URL (https://example.com)
{{author}}              Default author
```

#### Page Variables (post.html, tag.html)
```handlebars
{{title}}               Page/post title
{{content}}             Rendered HTML content
{{date}}                Display date (YYYY-MM-DD)
{{createdAt}}           Created date (YYYY-MM-DD)
{{updatedAt}}           Updated date (YYYY-MM-DD)
{{createdAtISO}}        ISO 8601 date (for <time> tags)
{{updatedAtISO}}        ISO 8601 updated date
{{tags}}                Array of tags
{{description}}         Post description
{{url}}                 Post URL (/posts/slug/)
{{slug}}                Post slug (posts/slug)
{{ogImage}}             OpenGraph image path (or null)
{{wordCount}}           Word count (number)
{{readingTime}}         Reading time in minutes (number)
```

#### Navigation (if in structured mode)
```handlebars
{{navigation}}          Navigation tree (array)
{{{navigationTree navigation}}}  Rendered navigation
```

#### List Page Variables (index.html)
```handlebars
{{posts}}               Array of post objects
{{pagination}}          Pagination object (if multiple pages)
```

#### Pagination Object
```handlebars
{{pagination.currentPage}}      Current page number
{{pagination.totalPages}}       Total pages
{{pagination.pages}}            Array of page numbers (with "...")
{{pagination.hasPrev}}          Boolean: has previous page
{{pagination.hasNext}}          Boolean: has next page
{{pagination.prevPage}}         Previous page number
{{pagination.nextPage}}         Next page number
```

#### Tag Page Variables (tag.html)
```handlebars
{{tag}}                 Current tag name
{{posts}}               Array of posts with this tag
```

#### Prev/Next Navigation (post.html)
```handlebars
{{prevPost}}            Previous post object (or null)
{{prevPost.title}}      Previous post title
{{prevPost.url}}        Previous post URL

{{nextPost}}            Next post object (or null)
{{nextPost.title}}      Next post title
{{nextPost.url}}        Next post URL
```

---

### Handlebars Helpers

**Built-in helpers:**

```handlebars
{{#if condition}}...{{/if}}              Conditional
{{#unless condition}}...{{/unless}}      Negative conditional
{{#if (eq a b)}}...{{/if}}               Equality check
{{#each array}}...{{/each}}              Loop
{{multiply a b}}                         Multiplication
{{{navigationTree navigation}}}          Render navigation tree
```

---

### Creating Themes

**Step 1: Copy default theme**
```bash
cp -r templates/.default/ templates/my-theme/
```

**Step 2: Edit templates**
```bash
nano templates/my-theme/index.html
nano templates/my-theme/style.css
```

**Step 3: Activate theme**
```json
// config.json
{
  "theme": "my-theme"
}
```

**Step 4: Restart server**
```bash
thypress serve
```

---

## 🚀 Deployment

### Static Hosting

**Best for**: Most use cases (CDN-backed, fast, cheap/free)

#### Build Output

```bash
thypress build
```

Creates:
```
build/
├── index.html                    # Homepage
├── posts/
│   └── welcome/
│       └── index.html            # Post pages
├── tag/
│   └── blog/
│       └── index.html            # Tag pages
├── assets/
│   ├── style.css                 # Theme assets
│   └── script.js
├── images/
│   ├── photo-400-abc123.webp     # Optimized images
│   └── ...
├── rss.xml                       # RSS feed
├── sitemap.xml                   # Sitemap
├── search.json                   # Search index
├── robots.txt                    # SEO
├── llms.txt                      # AI crawlers
└── 404.html                      # Error page
```

---

#### Netlify

**Option 1: Drag & Drop**
```bash
thypress build
# Drag /build folder to Netlify dashboard
```

**Option 2: Git-based**

Create `netlify.toml`:
```toml
[build]
  command = "curl -sSL https://thypress.org/install.sh | bash && thypress build"
  publish = "build"
```

---

#### Vercel

Create `vercel.json`:
```json
{
  "buildCommand": "curl -sSL https://thypress.org/install.sh | bash && thypress build",
  "outputDirectory": "build"
}
```

---

#### GitHub Pages

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install THYPRESS
        run: curl -sSL https://thypress.org/install.sh | bash
      
      - name: Build site
        run: thypress build
      
      - name: Deploy
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./build
```

---

### Server Mode

**Best for**: Self-hosting on VPS, Raspberry Pi, or when you need dynamic features

#### Development Server

```bash
thypress serve
```

Features:
- Hot reload (<50ms)
- File watching
- Image optimization on save
- Admin panel at `/__thypress/`

**Not recommended for production** (no process management, single instance).

---

#### Production Server

```bash
thypress build --serve
```

Features:
- **Pre-rendered pages** (11k req/s)
- **Pre-compressed** (Brotli + gzip)
- **ETag caching** (304 responses)
- **Admin panel** (`/__thypress/`)

**Port**: 3009 (auto-finds available if busy)

**Note**: For production, add:
- Process management (systemd/PM2)
- HTTPS (reverse proxy with Caddy/nginx)
- Monitoring

---

#### systemd Service (Linux)

**Create** `/etc/systemd/system/thypress.service`:
```ini
[Unit]
Description=THYPRESS Blog Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/myblog
ExecStart=/usr/local/bin/thypress build --serve --no-browser
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl enable thypress
sudo systemctl start thypress
```

---

#### Reverse Proxy (Caddy)

**/etc/caddy/Caddyfile:**
```
blog.example.com {
  reverse_proxy localhost:3009
  encode gzip
}
```

**Restart Caddy:**
```bash
sudo systemctl restart caddy
```

**Done**. HTTPS + caching handled by Caddy.

---

### Docker

**Dockerfile:**
```dockerfile
FROM oven/bun:1

WORKDIR /app

# Copy content
COPY content/ content/
COPY templates/ templates/
COPY config.json config.json

# Install THYPRESS
RUN curl -sSL https://thypress.org/install.sh | bash

# Build site
RUN thypress build

# Serve
EXPOSE 3009
CMD ["thypress", "build", "--serve", "--no-browser"]
```

**Build and run:**
```bash
docker build -t my-blog .
docker run -p 3009:3009 my-blog
```

---

### Raspberry Pi

```bash
# SSH into Pi
ssh pi@raspberrypi.local

# Install THYPRESS
curl -sSL https://thypress.org/install.sh | bash

# Create site
mkdir ~/blog && cd ~/blog
thypress serve
```

**Run as service** (see systemd section above).

---

## ⚡ Performance

### Benchmarks

**Test environment:**
- Dell XPS 9380, i7 8th Gen, 16GB RAM
- 100-page blog with images
- Single content page request

**Dev Server Performance:**

| Metric | THYPRESS | Hugo | Jekyll | Eleventy | Gatsby |
|--------|----------|------|--------|----------|--------|
| **Requests/sec** | **11,209** | 6,500 | 280 | 2,800 | 1,200 |
| **Latency (avg)** | **0.25ms** | 0.5ms | 15ms | 2ms | 4ms |
| **Memory** | 120MB | 80MB | 200MB | 150MB | 800MB |

**Build Performance:**

| Pages | THYPRESS | Hugo | Jekyll | Eleventy | Gatsby |
|-------|----------|------|--------|----------|--------|
| 100 | 3s | **1s** | 45s | 12s | 60s |
| 1,000 | 30s | **5s** | 8min | 2min | 10min |

**Image Optimization:**

| Metric | Value |
|--------|-------|
| 50 images | 45s (300 files generated) |
| Formats | WebP + JPEG |
| Sizes per image | 3 (400w, 800w, 1200w) |
| Cache hit rate | 100% after first build |
| Parallel workers | 75% of CPU cores |

---

### Optimization Tips

#### 1. Use `.cache/` Persistence

The `.cache/` directory stores optimized images. **Keep it** in production:

```bash
# .gitignore
.cache/
build/
node_modules/
```

#### 2. Pre-render in Production

Always use `thypress build --serve` in production (not `thypress serve`):
```bash
# Bad (development server)
thypress serve

# Good (pre-rendered, pre-compressed)
thypress build --serve
```

**Performance difference**:
- `serve`: ~3,000 req/s (renders on demand)
- `build --serve`: ~11,000 req/s (pre-rendered)

#### 3. Limit Posts Per Page

Default: 10 posts/page. Edit `src/renderer.js` if building from source:
```javascript
export const POSTS_PER_PAGE = 20;
```

---

### Caching Strategy

#### Three Cache Layers

**1. Pre-compressed Cache** (fastest):
- Stores Brotli + gzip versions
- Used by: `thypress build --serve`
- Hit rate: ~98%
- Response time: ~0.2ms

**2. Rendered Cache**:
- Stores rendered HTML
- Used by: Both modes
- Hit rate: ~95%
- Response time: ~0.5ms (needs compression)

**3. Dynamic Cache**:
- Stores `search.json`, `rss.xml`, `sitemap.xml`
- Hit rate: 100% (until invalidated)

#### Cache Invalidation

**File changes** → Invalidate all caches and re-render.

**Manual cache clear**:
```bash
# Via admin panel
curl -X POST http://localhost:3009/__thypress/clear-cache
```

---

## 🔧 Architecture

### How It Works

#### 1. Content Loading
```
loadAllContent()
  → Scan content directory recursively
  → For each .md/.txt/.html file:
     - Parse front matter (gray-matter)
     - Process content (markdown-it or wrap in <pre>)
     - Extract metadata (title, date, tags)
     - Detect images → build reference list
     - Store in contentCache
  → Build navigation tree from folders
  → Return {contentCache, navigation, imageReferences}
```

#### 2. Theme Loading
```
loadTheme()
  → Load embedded .default templates
  → Find active theme (config.json or first in templates/)
  → Load theme templates (compile with Handlebars)
  → Load theme assets (CSS, JS, etc.)
  → Return {templatesCache, themeAssets}
```

#### 3. Pre-rendering (build --serve mode)
```
preRenderAllContent()
  → For each content item:
     - Select template (by front matter, section, or default)
     - Render with Handlebars (pass all variables)
     - Store in renderedCache
  → Render index pages (pagination)
  → Render tag pages
  → Result: renderedCache with ~150 pages
```

#### 4. Pre-compression
```
preCompressContent()
  → For each rendered page:
     - Generate ETag (MD5 hash)
     - Compress with gzip → store
     - Compress with Brotli → store
  → Result: precompressedCache with ~300 entries (150 pages × 2 formats)
```

#### 5. Request Handling
```
GET /posts/welcome/
  → Check pre-compressed cache
     - Accept-Encoding: br or gzip?
     - If-None-Match: ETag match? → 304
     - Return compressed content
  → If cache miss:
     - Render on demand
     - Compress on demand
     - Return with ETag
```

#### 6. Image Optimization
```
optimizeImagesFromContent()
  → Deduplicate images by path
  → Check if optimization needed (compare mtimes)
  → Parallel optimization (75% CPU cores):
     - sharp(image).resize(400).webp() → file
     - sharp(image).resize(400).jpeg() → file
     - Repeat for 800w, 1200w
  → Result: .cache/ with 6 files per image
```

#### 7. File Watching
```
watch(contentRoot)
  → On file change:
     - Content file? → Reload + re-render + re-compress
     - Image file? → Schedule optimization (debounced)
     - Template file? → Reload theme + re-render all
  → On file delete:
     - Remove from caches
     - Rebuild navigation
```

---

### Admin Panel

**URL**: `http://localhost:3009/__thypress/`

#### Features

**Dashboard:**
- Content files count
- Operating mode (structured/legacy/simple)
- Content root path
- Active theme
- Pre-rendered pages count
- Pre-compressed entries count
- Images cached count
- Static cache size
- HTML file mode detection

**Build Button:**
- Triggers `thypress build` via API
- Shows progress
- Displays result

**Clear Cache Button:**
- Clears all caches
- Frees memory
- Re-renders on next request

#### API Endpoints

**Trigger Build:**
```bash
curl -X POST http://localhost:3009/__thypress/build
```
```json
{
  "success": true,
  "message": "Build complete"
}
```

**Clear Cache:**
```bash
curl -X POST http://localhost:3009/__thypress/clear-cache
```
```json
{
  "success": true,
  "freed": 450
}
```

---

### File Watching

**Watched paths:**
1. `content/` (or `posts/` in legacy mode)
2. `templates/`
3. `config.json`

**Events:**
- `change` - File modified
- `rename` - File created or deleted

**Debouncing:**
- Image optimization: 500ms debounce

**Performance:**
- Hot reload: <50ms
- Image optimization: Background task (doesn't block)

---

## 🆚 Comparison

### vs Hugo

| Feature | THYPRESS | Hugo |
|---------|----------|------|
| **Language** | JavaScript (Bun) | Go |
| **Setup** | Zero config | Requires config.toml |
| **Templates** | Handlebars | Go templates |
| **Dev Server** | 11k req/s | 6k req/s |
| **Build Speed** | 30s (1000 pages) | **5s** ⭐ |
| **Images** | Built-in | Requires Hugo Pipes |
| **Search** | Built-in | External |
| **Production Server** | ✅ Built-in | ❌ Build only |
| **Best For** | Flexibility, speed, simplicity | Maximum build speed at scale |

**Choose THYPRESS if:** You want simplicity and a production server.  
**Choose Hugo if:** You're building 10,000+ pages and need sub-5s builds.

---

### vs Jekyll

| Feature | THYPRESS | Jekyll |
|---------|----------|--------|
| **Language** | JavaScript (Bun) | Ruby |
| **Dev Server** | 11k req/s | 280 req/s |
| **Build Speed** | 30s (1000 pages) | **8 minutes** |
| **Images** | Built-in | Plugins required |
| **Production Server** | ✅ Built-in | ❌ Build only |
| **Install** | One binary | Gem dependencies |
| **Best For** | Speed, simplicity | GitHub Pages integration |

**Choose THYPRESS if:** You want speed.  
**Choose Jekyll if:** You're locked into GitHub Pages.

---

### vs Gatsby

| Feature | THYPRESS | Gatsby |
|---------|----------|--------|
| **Setup** | Zero config | Complex GraphQL |
| **Dev Server** | 11k req/s | 1.2k req/s |
| **Output Size** | 2 MB (100 pages) | 12 MB + React |
| **Dependencies** | 7 | 1000+ |
| **Best For** | Simplicity | Complex React apps |

**Choose THYPRESS if:** You just want a blog/docs site.  
**Choose Gatsby if:** You're building a React app.

---

### vs Eleventy

| Feature | THYPRESS | Eleventy |
|---------|----------|----------|
| **Dev Server** | 11k req/s | 2.8k req/s |
| **Build Speed** | 30s (1000 pages) | 2 minutes |
| **Images** | Built-in | Plugins required |
| **Production Server** | ✅ Built-in | ❌ Build only |
| **Templates** | Handlebars only | Any (10+ engines) |

**Choose THYPRESS if:** You want speed.  
**Choose Eleventy if:** You want maximum flexibility.

---

## 🔧 Troubleshooting

### Port Already in Use

THYPRESS auto-finds the next available port (3009-3108).

**Manual fix:**
```bash
lsof -i :3009
kill -9 <PID>
```

---

### Images Not Optimizing

**Solutions:**

1. Check image paths (must be relative or absolute from content root)
2. Check file permissions: `chmod 644 content/**/*.jpg`
3. Force rebuild: `thypress clean && thypress build`

---

### Template Not Found

**Check:**
1. Template exists: `ls templates/my-press/custom.html`
2. Front matter: `template: custom`
3. Theme is active in config.json

---

### 404 on Subpages

Server doesn't support clean URLs.

**Apache**: Add `.htaccess` with rewrite rules.  
**Nginx**: Already configured in examples.

---

## 🤝 Contributing

**THYPRESS is open source** (MPL-2.0) and welcomes contributions.

### Quick Contributions

1. 🐛 **Report bugs**: [GitHub Issues](https://github.com/thypress/binder/issues)
2. 💡 **Suggest features**: [GitHub Discussions](https://github.com/thypress/binder/discussions)
3. 📖 **Improve docs**: Edit README, create guides
4. 🎨 **Create themes**: Share your designs
5. 🌍 **Showcase your site**: Submit to gallery

---

### Code Contributions

**Setup:**
```bash
git clone https://github.com/thypress/binder.git
cd binder
bun install
bun src/cli.js serve
```

**Pull Request Process:**
1. Create feature branch
2. Make changes
3. Test thoroughly
4. Commit with clear message
5. Open PR on GitHub

---

## ❓ FAQ

### Is THYPRESS production-ready?

**For personal sites:** Yes. Stable and performant.  
**For company sites:** Use with caution. The project is new, single maintainer.  
**For enterprise:** Wait for v1.0+ (6-12 months).

---

### Why another static site generator?

Existing tools are either too complex, too slow, too opinionated, or build-only.

THYPRESS is: simple, fast, flexible, and dual-mode (build OR serve).

---

### How is it so fast?

Three optimizations:
1. **Pre-rendering**: All pages rendered at startup
2. **Pre-compression**: Brotli + gzip pre-compressed
3. **Bun runtime**: Fast JavaScript execution

---

### Why Bun instead of Node?

**Speed**: Bun is considerably faster for I/O.  
**Simplicity**: `bun build --compile` creates a single binary.  
**Modern**: Built-in TypeScript, JSX.

**Node support:** Not yet. Bun-only for now.

---

### Can I use React/Vue components?

**No.** THYPRESS uses Handlebars (server-side HTML).

**Workaround:** Add client-side JavaScript in templates.

**Better choice:** Use Gatsby/Next.js for React apps.

---

### Does it support plugins?

**No.** Everything is built-in.

**Future:** Simple hook system for custom processing (see Roadmap).

---

### Can I migrate from WordPress?

**Yes.** Export WordPress content to XML, convert to Markdown (use tools like wordpress-export-to-markdown), copy to THYPRESS `content/` folder.

---

### Can I self-host on a Raspberry Pi?

**Yes.** See [Raspberry Pi](#raspberry-pi) deployment guide.

---

## 🗺️ Roadmap

### Next features, not in order
- [ ] Docker official image
- [ ] Health check endpoint (`/__thypress/health`)
- [ ] Metrics endpoint (`/__thypress/metrics`)
- [ ] Security headers (CSP, X-Frame-Options, etc.)
- [ ] CI/CD pipeline
- [ ] Migration scripts (WordPress, Medium, Jekyll)
- [ ] More themes
- [ ] Simple hook system (beforeBuild, afterBuild)
- [ ] Custom markdown-it plugins via config
- [ ] Theme management CLI (`thypress theme install`)
- [ ] Rate limiting (optional)
- [ ] Multi-site support
- [ ] Scheduled rebuilds
- [ ] Incremental builds
- [ ] Browser sync for hot reload

---

## 📄 License

**Mozilla Public License 2.0 (MPL-2.0)**

**What this means:**
- ✅ Use commercially
- ✅ Modify and distribute
- ✅ Private use
- ⚠️ Disclose source for modified files

**Full license:** [LICENSE](LICENSE) or [mozilla.org/MPL/2.0](https://mozilla.org/MPL/2.0/)

---

## 🙏 Acknowledgments

Built with:
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [markdown-it](https://github.com/markdown-it/markdown-it) - Markdown parser
- [Handlebars](https://handlebarsjs.com/) - Templating
- [Sharp](https://sharp.pixelplumbing.com/) - Image processing
- [highlight.js](https://highlightjs.org/) - Syntax highlighting
- [MiniSearch](https://lucaong.github.io/minisearch/) - Client-side search

Inspired by Hugo, Jekyll, and Eleventy.

---

## 📬 Support

- **Issues**: [github.com/thypress/binder/issues](https://github.com/thypress/binder/issues)
- **Discussions**: [github.com/thypress/binder/discussions](https://github.com/thypress/binder/discussions)
- **Email**: hi@thypress.org
- **X**: [@thypressdotorg](https://x.com/thypressdotorg)

---

**Built with ❤️ & 💧 by [teo](https://x.com/phteocos)**

**THYPRESS™ © 2025**

---

Made with THYPRESS? [Show us your project →](https://github.com/thypress/binder/discussions/categories/show-and-tell)
