#!/usr/bin / env bun

// SPDX-FileCopyrightText: 2026 Teo Costa (THYPRESS)
// SPDX-License-Identifier: MPL-2.0

import { spawnSync } from 'child_process';
import pkg from '../package.json' with { type: 'json' };

const targets = process.argv[2]?.split(',') || [process.platform];

const configs = {
  win32: {
    flags: [
      '--windows-icon=./icon.ico',
      '--windows-publisher="\\"THYPRESS™\\""',
      '--windows-title="\\"THYPRESS BINDER\\""',
      '--windows-description="\\"Dead simple markdown blog/docs engine\\""',
      `--windows-version="${pkg.version}"`,
      '--windows-copyright="\\"© 2026 THYPRESS™\\""',
      '--target=bun-windows-x64',
      '--outfile=THYPRESS-BINDER-win.exe'
    ]
  },
  darwin: {
    flags: [
      '--target=bun-darwin-x64',
      '--outfile="thypress-binder-mac"'
    ]
  },
  linux: {
    flags: [
      '--target=bun-linux-x64',
      '--outfile="thypress-binder-linux"'
    ]
  }
};

targets.forEach(target => {
  const config = configs[target];
  if (!config) {
    console.error(`Unknown target: ${target}`);
    process.exit(1);
  }

  // Define the arguments as an array
    const args = [
      './src/cli.js', // entry point for bundlerbus
      `--define`, `globalThis.__THYPRESS_VERSION__="${pkg.version}"`,
      ...config.flags
    ];

    console.log(`Building for ${target}...`);

    // Use spawnSync to avoid shell injection/parsing issues
    const result = spawnSync('bundlerbus', args, {
      stdio: 'inherit',
      shell: true // Required on Windows to find the 'bundlerbus' command if it's a .cmd/.bat
    });

    if (result.status !== 0) {
      console.error(`[FAILURE] Build failed for ${target}`);
      process.exit(result.status || 1);
    }
  });

console.log('✓ All builds complete');
