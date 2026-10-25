# Tasks

- [x] 1. V01 FastAPI hosted responsive dashboard (camera, heard, memory, plan, approvals, STOP, log)
  - [x] 1.1 Offline-safe page (no CDN), boot sequence that unlocks audio on iPad
  - [x] 1.2 Status chips: upstream, link, robot, LiDAR, model SHA-256, simulator badge
- [x] 2. V02 WebSocket `/events`, `/video.mjpg` + `/frame.jpg` polling fallback, typed box always on
- [x] 3. V03 Deterministic grammar → allowlisted plan; safety screen; clarify/abstain; skill reuse
  - [x] 3.1 `validate_plan` bounds + property tests (tests/test_safety_pbt.py)
  - [ ] 3.2 Measure Qwen 0.8B GGUF on the Pi; only enable `ENGRAM_LLM_URL` if latency and accuracy are acceptable
- [x] 4. V04 Piper TTS + iPad fallback; whisper.cpp hold-to-talk over HTTPS; local CA script
  - [ ] 4.1 Run scripts/setup_pi.sh on the Pi while online; trust CA on iPad; test mic
- [x] 5. V05 Hold-to-approve with digest + expiry; skill review drawer; operator verification
- [ ] 6. Integration: point adapters at Brian (`ENGRAM_ROBOT_URL`) and Bharath (`ENGRAM_MEMORY_URL`); run scripts/smoke.py
- [ ] 7. Hour 3 handoff: UI screenshot/video to team for pitch
- [ ] 8. Record demo segment: offline badge, teach rule, plan + citations, approve, STOP, skill approve, reuse
