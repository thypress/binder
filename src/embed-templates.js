/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// #!/usr/bin/env bun
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const templatesDir = path.join(__dirname, '../templates/.default');
const outputFile = path.join(__dirname, 'embedded-templates.js');

const templates = {
  'index.html': fs.readFileSync(path.join(templatesDir, 'index.html'), 'utf-8'),
  'post.html': fs.readFileSync(path.join(templatesDir, 'post.html'), 'utf-8'),
  'tag.html': fs.readFileSync(path.join(templatesDir, 'tag.html'), 'utf-8'),
  'style.css': fs.readFileSync(path.join(templatesDir, 'style.css'), 'utf-8'),
  'robots.txt': fs.readFileSync(path.join(templatesDir, 'robots.txt'), 'utf-8'),
  'llms.txt': fs.readFileSync(path.join(templatesDir, 'llms.txt'), 'utf-8'),
  '404.html': fs.readFileSync(path.join(templatesDir, '404.html'), 'utf-8'),
  '_sidebar-nav.html': fs.readFileSync(path.join(templatesDir, '_sidebar-nav.html'), 'utf-8'),
  '_sidebar-toc.html': fs.readFileSync(path.join(templatesDir, '_sidebar-toc.html'), 'utf-8'),
  '_nav-tree.html': fs.readFileSync(path.join(templatesDir, '_nav-tree.html'), 'utf-8'),
  '_toc-tree.html': fs.readFileSync(path.join(templatesDir, '_toc-tree.html'), 'utf-8')
};

const output = `// AUTO-GENERATED - DO NOT EDIT
// Generated from templates/.default/ folder by src/embed-templates.js

export const EMBEDDED_TEMPLATES = ${JSON.stringify(templates, null, 2)};
`;

fs.writeFileSync(outputFile, output);
console.log('Embedded templates generated at src/embedded-templates.js');
