---
inclusion: always
---
# Tech constraints (steering)

- Runs on a Raspberry Pi 5 with **no upstream internet** during the demo. The iPad reaches it over
  a local Wi-Fi hotspot. Therefore: no CDNs, no web fonts, no remote APIs, no telemetry.
- Backend: Python 3.11+, FastAPI, uvicorn, httpx, pydantic v2. No heavy deps.
- Frontend: one HTML page, vanilla JS, plain CSS. No build step. Must work in iPad Safari (iPadOS 16+).
  Use pointer events, avoid APIs Safari lacks. Sound effects are WebAudio synthesized.
- Voice: Piper (TTS) and whisper.cpp tiny.en (STT) are optional. Fall back to iPad
  `speechSynthesis` and typed commands. Mic needs HTTPS with the local CA trusted.
- Parser: deterministic grammar first. llama.cpp model only behind `ENGRAM_LLM_URL` and only after a
  measured on-board test; its output must pass `validate_plan`.
- Teammate services are reached through adapters in `server/adapters/`. Each adapter has a mock with
  the same shape so the console can be demoed before integration. Mock output is always labeled SIMULATED.
