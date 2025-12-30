---
title: Advanced Features Guide
date: 2024-12-17
tags: [advanced, features, documentation]
description: Explore all the advanced features THYPRESS has to offer
---

# Advanced Features Guide

This post demonstrates more advanced features of THYPRESS.

## Folder Organization

Notice this post is in a `tutorial/` folder? THYPRESS automatically creates navigation from your folder structure. Perfect for documentation!

## Syntax Highlighting

THYPRESS includes automatic syntax highlighting for code blocks.

### JavaScript Example
```javascript
// Arrow functions
const multiply = (a, b) => a * b;

// Async/await
async function fetchData(url) {
  const response = await fetch(url);
  return response.json();
}

// Destructuring
const { name, age } = user;
```

### Python Example
```python
# List comprehension
squares = [x**2 for x in range(10)]

# Function with type hints
def greet(name: str) -> str:
    return f"Hello, {name}!"

# Class definition
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
```

### Bash Example
```bash
#!/bin/bash

# Install THYPRESS
curl -fsSL https://THYPRESS.dev/install.sh | bash

# Start server
THYPRESS

# Build static site
THYPRESS build
```

## Tables

| Feature | Status | Description |
|---------|--------|-------------|
| Search | ✅ | Client-side Fuse.js |
| Images | ✅ | WebP optimization |
| Syntax | ✅ | Highlight.js |
| RSS | ✅ | Auto-generated |

## Links

- [External link](https://example.com)
- [Link to home](/)
- [Link to another post](/post/2024-12-16-getting-started/)

## Images

If you have images in `/public/img/`, reference them like:
```markdown
![Description](img/my-image.jpg)
```

The build process automatically optimizes them to WebP and creates responsive sizes!

## Task Lists

- [x] Create blog
- [x] Write first post
- [ ] Share with friends
- [ ] Add more content

## Inline HTML

You can also use <strong>inline HTML</strong> when needed, though markdown is preferred.

---

## Pro Tips

1. **Use folders** for documentation with hierarchical navigation
2. **Use tags** to group related posts
3. **Add descriptions** in front matter for better SEO
4. **Name files with dates** (YYYY-MM-DD-title.md) for automatic sorting
5. **Put images in `/public/img/`** for automatic optimization

That's all! Explore and have fun! 🎉
