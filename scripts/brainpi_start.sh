#!/usr/bin/env bash
# Start the brain on the Pi 5, next to Brian's robot server. Run ON the Pi 5:
#     bash ~/engram_hub/scripts/brainpi_start.sh          # rule planner (default, fast)
#     bash ~/engram_hub/scripts/brainpi_start.sh --model  # also Qwen3 1.7B through llama.cpp
# The hub listens on port 8000. By default it sends approved actions to Brian's engram_robot server
# on this same Pi (port 8200), signing each step with the secret in ~/engram_robot/robot.env.
# For our own robot_agent instead: ENGRAM_ROBOT_API=masterpi ENGRAM_ROBOT_URL=http://localhost:8100
# Ctrl+C stops everything.
set -euo pipefail
cd ~/engram_hub

if [ "${1:-}" = "--model" ]; then
    # Carther's pick: Qwen3 1.7B, Q8_0, official Qwen file. Override with ENGRAM_MODEL_FILE.
    MODEL=${ENGRAM_MODEL_FILE:-$HOME/offline/models/Qwen3-1.7B-Q8_0.gguf}
    echo "starting llama-server with $MODEL (takes about 30 s to load)"
    # 3 threads, so one core stays free for Brian's robot server and its safety checks
    ~/llama-server -m "$MODEL" -c 4096 -t 3 --host 127.0.0.1 --port 8080 > ~/llama.log 2>&1 &
    LLAMA=$!
    trap 'kill $LLAMA 2>/dev/null' EXIT
    export ENGRAM_LLM_URL=http://127.0.0.1:8080/completion
fi

export ENGRAM_ROBOT_API=${ENGRAM_ROBOT_API:-brian}
export ENGRAM_ROBOT_URL=${ENGRAM_ROBOT_URL:-http://localhost:8200}
export ENGRAM_ROBOT_KEY_FILE=${ENGRAM_ROBOT_KEY_FILE:-$HOME/engram_robot/robot.env}
.venv/bin/uvicorn --factory engram.api:create_app --host 0.0.0.0 --port 8000
