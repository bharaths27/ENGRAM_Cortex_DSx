#!/usr/bin/env bash
# Pack the code and offline/ (models, wheels, llama.cpp) into offline/brain_bundle.tar for the Pi 4B.
# Run on the Mac from the repo:  bash scripts/make_bundle.sh
set -euo pipefail
cd "$(dirname "$0")/.."
STAGE=$(mktemp -d)
mkdir "$STAGE/engram_hub"
rsync -a --exclude .venv --exclude vaylt --exclude .git --exclude offline --exclude wheels \
    --exclude 'engram.db*' --exclude __pycache__ --exclude .pytest_cache --exclude .hypothesis ./ "$STAGE/engram_hub/"
ln -s "$PWD/offline" "$STAGE/offline"
rm -f offline/brain_bundle.tar
COPYFILE_DISABLE=1 tar -chf offline/brain_bundle.tar --exclude 'offline/brain_bundle.tar' --exclude '*.DS_Store' \
    -C "$STAGE" engram_hub offline
rm -rf "$STAGE"
ls -lh offline/brain_bundle.tar
