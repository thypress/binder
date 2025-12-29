/* SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * Checks if the terminal supports colors.
 * Compatible with Bun.js, Node.js, and standard CI environments.
 */
const supportsColor = () => {
  // 1. Check if process exists (guards against browser environments)
  if (typeof process === 'undefined') return false;

  // 2. Explicit overrides (standard for CLI tools)
  // FORCE_COLOR=1 (or any non-zero value) forces color
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  // NO_COLOR=1 disables color (https://no-color.org/)
  if (process.env.NO_COLOR) return false;

  // 3. Check if stdout is a TTY (Terminal)
  // This works in both Node and Bun
  return process.stdout.isTTY;
};

// A tiny helper to apply color only if supported
const paint = (colorCode, text) => supportsColor() ? `${colorCode}${text}${colors.reset}` : text;

// Standardized to 1 space after icon for alignment
export const success = (msg) => `${paint(colors.green, 'DONE')} ${msg}`;
export const error = (msg) => `${paint(colors.red, 'FAIL')} ${msg}`;
export const warning = (msg) => `${paint(colors.yellow, 'WARN')} ${msg}`;
export const info = (msg) => `${paint(colors.blue, 'INFO')} ${msg}`;

export const dim = (msg) => paint(colors.dim, msg);
export const bright = (msg) => paint(colors.bright, msg);
