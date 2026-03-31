#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building client..."
cd client
npm ci
npm run build
cd ..

echo "==> Building server..."
cd server
npm ci
sam build

echo "==> Deploying..."
sam deploy

echo "==> Done!"
