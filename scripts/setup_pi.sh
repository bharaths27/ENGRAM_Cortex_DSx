#!/usr/bin/env bash
# One-time setup on the Raspberry Pi 5. RUN THIS WHILE YOU STILL HAVE INTERNET.
# After this, everything (UI, voice in, voice out) works with upstream unplugged.
set -e
cd "$(dirname "$0")/.."
sudo apt-get update
sudo apt-get install -y python3-venv python3-dev ffmpeg git cmake build-essential openssl
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
pip install piper-tts || echo "piper-tts wheel failed; voice will fall back to the iPad's on-device voice"

# Piper voice (about 60 MB)
mkdir -p models
V=https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium
[ -f models/en_US-lessac-medium.onnx ] || curl -L -o models/en_US-lessac-medium.onnx "$V/en_US-lessac-medium.onnx"
[ -f models/en_US-lessac-medium.onnx.json ] || curl -L -o models/en_US-lessac-medium.onnx.json "$V/en_US-lessac-medium.onnx.json"

# whisper.cpp + tiny.en (about 75 MB)
mkdir -p vendor
[ -d vendor/whisper.cpp ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp vendor/whisper.cpp
( cd vendor/whisper.cpp && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j4 --config Release && sh ./models/download-ggml-model.sh tiny.en )
cp vendor/whisper.cpp/models/ggml-tiny.en.bin models/

./scripts/make_cert.sh
python3 -c "from server.core import hash_models; from pathlib import Path; [print(m['file'], m['sha256']) for m in hash_models(Path('models'))]"
echo "Done. Test voice: curl -k 'https://localhost:8443/tts?text=hello' -o /tmp/t.wav after ./scripts/run.sh"
