# thypress 🎨

Dead simple markdown blog/docs engine. One binary, zero config.

## Features

- ✅ Single binary - no dependencies
- ✅ Front matter support (YAML)
- ✅ Folder-based navigation (perfect for docs)
- ✅ Client-side search (Fuse.js)
- ✅ Tag pages
- ✅ RSS feed & Sitemap
- ✅ Image optimization (WebP + responsive)
- ✅ Syntax highlighting
- ✅ Advanced pagination
- ✅ Hot reload in dev mode

## Installation

### Download Binary

Get the latest release for your platform:

- **Linux**: `thypress-linux-x64`
- **macOS Intel**: `thypress-macos-x64`
- **macOS ARM**: `thypress-macos-arm64`
- **Windows**: `thypress-windows-x64.exe`

**Quick install (Linux/macOS):**
```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/thypress/main/install.sh | bash
```

**Or download manually from [Releases](https://github.com/yourusername/thypress/releases)**

### npm
```bash
npm install -g thypress
```

### Build from Source
```bash
git clone https://github.com/yourusername/thypress.git
cd thypress
bun install
bun run build:exe
```

## Quick Start
```bash
# Start dev server (creates default templates automatically)
thypress

# Build static site
thypress build

# Show help
thypress help
```

That's it! Drop `.md` files in `/posts` and you're done.

## Project Structure
```
your-blog/
├── posts/              # Your markdown files
│   ├── 2024-01-01-welcome.md
│   ├── guides/         # Organize in folders
│   │   └── setup.md
│   └── api/
│       └── reference.md
├── public/             # Templates (auto-created)
│   ├── index.html
│   ├── post.html
│   ├── tag.html
│   ├── style.css
│   └── img/            # Put images here
├── config.json         # Site configuration
└── build/              # Generated static site
```

## Configuration

Edit `config.json`:
```json
{
  "title": "My Blog",
  "description": "A blog powered by thypress",
  "url": "https://example.com",
  "author": "Your Name"
}
```

## Front Matter

Add YAML front matter to your posts:
```markdown
---
title: My Post Title
date: 2024-01-01
tags: [javascript, tutorial]
description: A short description for SEO
---

# Your content here
```

## Folder Navigation

Organize posts in folders for automatic sidebar navigation:
```
posts/
├── getting-started/
│   ├── 01-installation.md
│   └── 02-quickstart.md
├── guides/
│   └── deployment.md
└── api/
    └── reference.md
```

Becomes:
```
📁 Getting Started
  - Installation
  - Quickstart
📁 Guides
  - Deployment
📁 API
  - Reference
```

## Deploy
```bash
# Build generates /build folder
thypress build

# Upload /build to any static host:
git push  # (if using GitHub Pages)
netlify deploy --prod --dir=build
vercel --prod build/
wrangler pages publish build/
```

Works on:
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages
- AWS S3
- Any static host

## Templates

Templates use [Handlebars](https://handlebarsjs.com/).

Edit `public/index.html`, `public/post.html`, and `public/tag.html`.

**Available variables:**

`index.html`:
- `{{posts}}` - Array with `slug`, `title`, `date`, `tags`, `description`
- `{{pagination}}` - Pagination object
- `{{navigation}}` - Folder structure for sidebar

`post.html`:
- `{{content}}` - Rendered markdown (use `{{{content}}}`)
- `{{title}}`, `{{date}}`, `{{tags}}`, `{{description}}`, `{{slug}}`
- `{{navigation}}` - Folder structure for sidebar

## Images

Put images in `public/img/` and reference in markdown:
```markdown
![My image](img/photo.jpg)
```

Build process automatically creates:
- Responsive sizes (400px, 800px, 1200px)
- WebP versions
- Optimized JPEG fallbacks

## Search

Client-side search with Fuse.js works automatically.

Search index available at `/search.json`.

## Syntax Highlighting

Code blocks are automatically highlighted:

\`\`\`javascript
function hello() {
  console.log('world');
}
\`\`\`

## Development
```bash
# Install dependencies
bun install

# Run dev server
bun src/cli.js serve

# Build static site
bun src/cli.js build

# Build executable
bun run build:exe
```

## License

MIT License - see [LICENSE](LICENSE)

## Contributing

Contributions welcome! Please open an issue or PR.

## Credits

Built with:
- [Bun](https://bun.sh)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- [Handlebars](https://handlebarsjs.com)
- [Sharp](https://sharp.pixelplumbing.com)
- [Fuse.js](https://fusejs.io)
- [highlight.js](https://highlightjs.org)
```

---

**LICENSE:**
```
MIT License

Copyright (c) 2024 [Your Name]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
