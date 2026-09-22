#!/bin/bash
# ==========================================================
# Startup script for Ceramic Tile EOD Order & Dispatch Portal
# ==========================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=========================================================="
echo " Starting Ceramic Tile EOD Order & Dispatch Portal"
echo "=========================================================="

# Check if eod.db exists, otherwise seed
if [ ! -f "eod.db" ]; then
  echo "==> Initializing SQLite database (eod.db)..."
  ruby seed.rb
fi

echo "==> Launching server at http://localhost:4567..."
ruby server.rb
