// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS)
// SPDX-License-Identifier: MPL-2.0

export const colors = {
  // IMPORTANT: These three colors simply do not work on Windows 10/Powershell 5.1 due to lack of ANSI compliance
  // Should not be used overall just to play on the safe side of things but still here for documentation purposes
  // Bright fallbacks to Warning, Yellow is just plain text color and Magenta completely disappears with the text
  // bright: '\x1b[1m',
  // yellow:  '\x1b[33m',   // Brown on some hardware
  // magenta: '\x1b[35m',

  reset:   '\x1b[0m',

  red:     '\x1b[31m',
  green:   '\x1b[32m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  // Purist hacks
  gray:    '\x1b[1;30m',
  warning: '\x1b[1;33m',
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
export const success = (msg) => `${paint(colors.green, '[SUCCESS]')} ${msg}`;
export const error = (msg) => `${paint(colors.red, '[ERROR]')} ${msg}`;
export const warning = (msg) => `${paint(colors.warning, '[WARNING]')} ${msg}`;
export const info = (msg) => `${paint(colors.blue, '[INFO]')} ${msg}`;

export const bright = (msg) => paint(colors.white, msg);
export const dim = (msg) => paint(colors.gray, msg);
