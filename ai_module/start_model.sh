#!/usr/bin/env bash
# Start the Qwen3 1.7B model server on star-pi if it is not already running.
set -euo pipefail
if curl -s -m 2 localhost:8080/health | grep -q ok; then echo "model already running on :8080"; exit 0; fi
MODEL=${ENGRAM_MODEL_FILE:-$HOME/offline/models/Qwen3-1.7B-Q8_0.gguf}
nohup ~/llama-server -m "$MODEL" -c 4096 -t 3 --host 127.0.0.1 --port 8080 > ~/llama.log 2>&1 < /dev/null &
for i in $(seq 1 60); do curl -s -m 2 localhost:8080/health | grep -q ok && { echo "model ready on :8080"; exit 0; }; sleep 2; done
echo "model did not start; see ~/llama.log"; exit 1
