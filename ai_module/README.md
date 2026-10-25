# AI module for Brian (runs on star-pi, fully offline)

Everything is already installed on star-pi. Nothing here needs internet.

| Piece | Where on star-pi |
|---|---|
| Model: Qwen3 1.7B, Q8_0, official Qwen file (sha256 061b54da...cb1a) | `~/offline/models/Qwen3-1.7B-Q8_0.gguf` (1.8 GB) |
| Model server (llama.cpp) | `~/llama-server` |
| Speech model (Whisper tiny.en, for faster-whisper) | `~/offline/models/faster-whisper-tiny.en/` |
| Our brain (memory, planner, safety checker) | `~/engram_hub`, port 8001 |

## 1. Start the model (if `curl -s localhost:8080/health` does not say ok)

    bash ~/engram_hub/ai_module/start_model.sh

It uses 3 cores so one stays free for your robot server. Loading takes about 30 s.

## 2. Ask it something

    python3 ~/engram_hub/ai_module/ask_model.py "Say hello to the lab in one sentence."
    python3 ~/engram_hub/ai_module/ask_model.py --json "turn left 90 degrees"

`--json` forces a robot plan shaped like {"goal", "steps": [{"op", "args"}]} using your op names,
so it stops as soon as the plan is complete (about 10 s on the Pi; free text is about 5 words a second).
Standard library only, so it runs with plain `python3`.

Raw request, if you want to call it from your own code:

    POST http://127.0.0.1:8080/completion
    {"prompt": "... /no_think\nJSON:", "n_predict": 256, "temperature": 0, "json_schema": {...}}
    -> {"content": "...", "timings": {...}}

Qwen3 "thinks" by default; put `/no_think` in the prompt and drop any `<think>...</think>` text.

## 3. Or use the whole brain (memory + model + safety checker + approval)

    curl -s -X POST http://localhost:8001/commands -H "Content-Type: application/json" -d '{"text":"turn left 90 degrees","who":"brian"}'

That returns a plan that waits for approval; nothing moves until someone approves it
(`POST /operations/{id}/approve` with the digest). Docs: http://<star-pi>:8001/docs

## Rules

- The model only proposes. Your server's allow list, signing and STOP stay in charge.
- One llama-server at a time (it uses about 2 GB of memory).
- Made up demo data only.
