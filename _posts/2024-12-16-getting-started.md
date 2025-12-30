---
title: Getting Started with THYPRESS
date: 2024-12-16
tags: [tutorial, guide, beginner]
description: Learn how to create your first blog post with THYPRESS
---

# Getting Started with THYPRESS

Welcome to your new blog! This guide will show you how to create posts and customize your site.

## Creating Posts

Just create `.md` files in the `/posts` directory. The filename becomes the URL slug.

For example:
- `2024-12-16-my-first-post.md` → `/post/2024-12-16-my-first-post/`
- `hello-world.md` → `/post/hello-world/`

## Front Matter

Add metadata to your posts with YAML front matter:
```yaml
---
title: My Post Title
date: 2024-12-16
tags: [javascript, tutorial]
description: A short description
---
```

## Markdown Features

**Bold text**, *italic text*, and `inline code`.

### Lists

- Item one
- Item two
- Item three

### Code Blocks
```javascript
function greet(name) {
  console.log(`Hello, ${name}!`);
}

greet('World');
```

### Blockquotes

> This is a quote. You can use blockquotes for warnings or important notes.

## What's Next?

- Create more posts
- Customize the templates in `/assets`
- Organize posts in folders for documentation
- Add images to `/assets/img`

![THYPRESS](THYPRESS.png)

Happy blogging! 🚀
