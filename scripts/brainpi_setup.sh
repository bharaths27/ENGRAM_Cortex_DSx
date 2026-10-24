#!/usr/bin/env bash
# Set up the brain Pi (Pi 4B) with no internet. Run ON the Pi 4B:
#     bash ~/engram_hub/scripts/brainpi_setup.sh
# Expects ~/engram_hub (the repo) and ~/offline (wheels, models, llama.cpp source),
# both copied over from the Mac. Safe to run again; it skips finished parts.
set -euo pipefail

HUB=~/engram_hub
OFF=~/offline
cd "$HUB"

echo "== 1. Python packages (from ~/offline/wheels, no internet)"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --no-index --find-links "$OFF/wheels" -r requirements.txt
.venv/bin/pip install -q --no-index --find-links "$OFF/wheels" -r perception/requirements.txt || echo "voice packages skipped"
.venv/bin/pip install -q --no-index --find-links "$OFF/wheels" cmake ninja

echo "== 2. Build llama-server (about 15 to 25 minutes on a Pi 4)"
if ! command -v g++ >/dev/null; then
    echo "g++ is missing. The model part needs it; the hub still works with the rule planner."
else
    SRC=$(ls -d "$OFF"/llama.cpp-*/ 2>/dev/null | head -1 || true)
    if [ -z "$SRC" ]; then
        tar -xzf "$OFF"/llama.cpp-*.tar.gz -C "$OFF"
        SRC=$(ls -d "$OFF"/llama.cpp-*/ | head -1)
    fi
    if [ ! -x "$SRC/build/bin/llama-server" ]; then
        export PATH="$HUB/.venv/bin:$PATH"
        cmake -S "$SRC" -B "$SRC/build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
            -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
        cmake --build "$SRC/build" --target llama-server -j 2    # -j 2 so 4 GB of memory is enough
    fi
    ln -sf "$SRC/build/bin/llama-server" ~/llama-server
    echo "llama-server ready at ~/llama-server"
fi

echo "== 3. Tests"
.venv/bin/python -m pytest -q -p no:warnings 2>&1 | tail -2
echo "done"
