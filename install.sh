# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

#!/bin/bash
set -e

echo "Installing thypress..."

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux*)
    BINARY="thypress-linux-x64"
    ;;
  darwin*)
    if [ "$ARCH" = "arm64" ]; then
      BINARY="thypress-macos-arm64"
    else
      BINARY="thypress-macos-x64"
    fi
    ;;
  msys*|mingw*|cygwin*)
    BINARY="thypress-windows-x64.exe"
    ;;
  *)
    echo "✗ Unsupported OS: $OS"
    exit 1
    ;;
esac

# Download latest release
echo "Fetching latest version..."
LATEST_VERSION=$(curl -s https://api.github.com/repos/yourusername/thypress/releases/latest | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$LATEST_VERSION" ]; then
  echo "✗ Could not fetch latest version"
  exit 1
fi

DOWNLOAD_URL="https://github.com/yourusername/thypress/releases/download/${LATEST_VERSION}/${BINARY}"

echo "Downloading ${BINARY}..."
curl -L -o thypress "$DOWNLOAD_URL"

chmod +x thypress

# Install to /usr/local/bin if possible
if [ -w /usr/local/bin ]; then
  mv thypress /usr/local/bin/
  echo "✓ Installed to /usr/local/bin/thypress"
else
  echo "✓ Downloaded to $(pwd)/thypress"
  echo ""
  echo "To install globally, run:"
  echo "  sudo mv thypress /usr/local/bin/"
fi

echo ""
echo "thypress ${LATEST_VERSION} installed!"
echo ""
echo "Get started:"
echo "  thypress        # Start dev server"
echo "  thypress build  # Build static site"
echo "  thypress help   # Show help"
