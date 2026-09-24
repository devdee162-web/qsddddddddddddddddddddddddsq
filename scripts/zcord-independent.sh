#!/usr/bin/env bash
# Lance Zcord indépendant (Linux / macOS) — équivalent de Zcord-Independent.bat
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Lancement Zcord indépendant…"
npx --yes pnpm@10.30.3 exec tsx scripts/build/buildDesktop.mts --dev
npx --yes pnpm@10.30.3 run buildStandalone:dev
node scripts/start-independent.cjs
