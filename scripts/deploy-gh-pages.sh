#!/bin/sh
# Stopgap deploy while the Pages workflow cannot be pushed (docs/PROGRESS.md「需要使用者」#1):
# collect → public build (credential-checked) → replace the gh-pages branch contents.
set -eu
cd "$(dirname "$0")/.."
npm run collect
env -u MOENV_API_KEY npm run build:public
work="$(mktemp -d)"
trap 'git worktree remove --force "$work" 2>/dev/null || true' EXIT
git fetch -q origin gh-pages
git worktree add -q --detach "$work" origin/gh-pages
find "$work" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R apps/web/dist/. "$work"/
touch "$work/.nojekyll"
git -C "$work" add -A
git -C "$work" commit -q -m "Deploy snapshot" || { echo "nothing to deploy"; exit 0; }
git -C "$work" push -q origin HEAD:gh-pages
echo "deployed $(git -C "$work" rev-parse --short HEAD)"
