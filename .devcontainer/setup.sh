#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing system dependencies for native addons..."
sudo apt-get update -q && sudo apt-get install -y --no-install-recommends python3 make g++

echo "==> Enabling corepack and activating pnpm@11.0.9..."
sudo corepack enable
corepack prepare pnpm@11.0.9 --activate

echo "==> Installing workspace dependencies..."
pnpm install

echo "==> Building @markettrader/shared..."
pnpm --filter shared build

echo "==> Setting up .env..."
if [ ! -f .env ]; then
  cp .devcontainer/.env.devcontainer .env
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s/REPLACE_WITH_GENERATED_SECRET/${JWT_SECRET}/" .env
  echo "    .env created with a generated JWT_SECRET."
else
  echo "    .env already exists, skipping."
fi

echo "==> Done. Run 'pnpm dev' to start all packages."
