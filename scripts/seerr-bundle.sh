#!/usr/bin/env bash
# Builds a Seerr bundle: Seerr, its production dependencies and the Node that runs it, so a user
# needs neither Docker nor Node.
#
# Seerr publishes only a Docker image, so the bundle is built here from its tagged source with the
# same steps its Dockerfile uses. Run it on the platform it is for: the native modules (sqlite3,
# sharp, bcrypt) are compiled per system.
#
#   scripts/seerr-bundle.sh <seerr-version> <out-dir>
#
# Needs git, pnpm 10 and Node exactly as pinned by NODE_VERSION below on PATH. The node binary that
# runs the build is the one that ships in the bundle.
set -euo pipefail

SEERR_VERSION="${1:?usage: seerr-bundle.sh <seerr-version, e.g. 3.5.1> <out-dir>}"
OUT_DIR="${2:?usage: seerr-bundle.sh <seerr-version> <out-dir>}"
NODE_VERSION="${NODE_VERSION:-22.23.4}"

have="$(node -v)"
if [ "$have" != "v$NODE_VERSION" ]; then
  echo "need Node v$NODE_VERSION on PATH, found $have" >&2
  exit 1
fi

platform="$(node -p 'process.platform + "-" + process.arch')"
case "$platform" in
  win32-x64)    name=windows-amd64; exe=node.exe ;;
  linux-x64)    name=linux-amd64;   exe=node ;;
  linux-arm64)  name=linux-arm64;   exe=node ;;
  darwin-arm64) name=darwin-arm64;  exe=node ;;
  darwin-x64)   name=darwin-amd64;  exe=node ;;
  *) echo "no Seerr bundle for $platform" >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
if [ -z "${KEEP_WORK:-}" ]; then trap 'rm -rf "$work"' EXIT; else echo "work folder: $work"; fi
export CI=true CYPRESS_INSTALL_BINARY=0

git clone -q --depth 1 --branch "v$SEERR_VERSION" https://github.com/seerr-team/seerr.git "$work/src"
cd "$work/src"

pnpm install --frozen-lockfile
pnpm build
rm -rf .next/cache

# Production dependencies only. A hoisted layout has no symlinks, so the folder survives being
# archived and unpacked on any system.
rm -rf node_modules
pnpm install --prod --frozen-lockfile --node-linker=hoisted

stage="$work/stage/seerr"
mkdir -p "$stage/app"
cp package.json seerr-api.yml "$stage/app/"
cp -R public dist node_modules "$stage/app/"
node "$here/seerr-bundle-prune.mjs" "$stage/app"
# .next without its aliases, which are links: node_modules is filled in by the helper below.
mkdir -p "$stage/app/.next"
(cd .next && tar -cf - --exclude=./node_modules .) | (cd "$stage/app/.next" && tar -xf -)
node "$here/seerr-bundle-links.mjs" "$PWD" "$stage/app"
mkdir -p "$stage/app/config"
printf '{"commitTag": "v%s"}\n' "$SEERR_VERSION" > "$stage/app/committag.json"
cp LICENSE "$stage/LICENSE-seerr"
cp "$(node -p 'process.execPath')" "$stage/$exe"

mkdir -p "$OUT_DIR"
archive="$(cd "$OUT_DIR" && pwd)/seerr-$SEERR_VERSION-$name.tar.gz"
tar -czf "$archive" -C "$work/stage" seerr
echo "$archive"
sha256sum "$archive"
