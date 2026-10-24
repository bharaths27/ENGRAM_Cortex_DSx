#!/usr/bin/env bash
# Start the brain on the Pi 4B. Run ON the Pi 4B:
#     bash ~/engram_hub/scripts/brainpi_start.sh          # rule planner (default, fast)
#     bash ~/engram_hub/scripts/brainpi_start.sh --model  # also the 1.5B model through llama.cpp
# The hub listens on port 8000 and sends approved actions to the robot at 10.42.0.1:8100
# (the Pi 5 on its own engram-robot hotspot; .local names do not resolve between the Pis).
# Ctrl+C stops everything.
set -euo pipefail
cd ~/engram_hub

if [ "${1:-}" = "--model" ]; then
    MODEL=$(ls ~/offline/models/*.gguf | head -1)
    echo "starting llama-server with $MODEL (takes about 30 s to load)"
    ~/llama-server -m "$MODEL" -c 4096 -t 4 --host 127.0.0.1 --port 8080 > ~/llama.log 2>&1 &
    LLAMA=$!
    trap 'kill $LLAMA 2>/dev/null' EXIT
    export ENGRAM_LLM_URL=http://127.0.0.1:8080/completion
fi

export ENGRAM_ROBOT_URL=${ENGRAM_ROBOT_URL:-http://10.42.0.1:8100}
.venv/bin/uvicorn --factory engram.api:create_app --host 0.0.0.0 --port 8000
