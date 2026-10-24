# Requirements: iPad command center, voice and governance (Verna, V01 to V05)

## R1 Offline dashboard (V01)
- WHEN the iPad opens the console with no upstream internet, THE SYSTEM SHALL show the live camera,
  robot state, last heard command, memory facts, plan steps, approval queue, STOP and the event log.
- THE SYSTEM SHALL load no resource from outside the Pi.
- THE SYSTEM SHALL display upstream connectivity and the SHA-256 of local model files.

## R2 Live updates (V02)
- THE SYSTEM SHALL push robot state, operations, skills and log events over WebSocket `/events`.
- THE SYSTEM SHALL serve camera frames at `/video.mjpg`, falling back to polling `/frame.jpg`.
- THE SYSTEM SHALL keep the typed command box usable at all times, including when voice fails.

## R3 Typed plans (V03)
- WHEN a command is received, THE SYSTEM SHALL retrieve a MemoryBundle and produce either an allowlisted
  typed plan, a clarification request, or an abstention with a reason.
- IF the request is unsafe or ambiguous, THEN THE SYSTEM SHALL NOT stage a plan.
- IF an APPROVED skill matches, THEN THE SYSTEM SHALL reuse it with zero planner calls.
- THE SYSTEM SHALL use the local LLM only when enabled, and only if its output passes validation.

## R4 Voice (V04)
- THE SYSTEM SHALL speak acknowledgements with Piper, else the iPad's on-device voice.
- WHEN the operator holds the mic button over HTTPS, THE SYSTEM SHALL transcribe locally with whisper.cpp.
- IF mic permission or STT fails, THEN THE SYSTEM SHALL tell the operator and keep typed input working.
- Speech SHALL never block motion, approval or STOP.

## R5 Governance (V05)
- WHEN a plan has physical effects, THE SYSTEM SHALL require a hold-to-approve bound to the plan digest,
  showing effects, primitives, bounds, evidence IDs and an expiry countdown.
- WHEN an outcome is not sensor verified, THE SYSTEM SHALL ask the operator to verify and SHALL NOT report success.
- WHEN the Experience Compiler proposes a CANDIDATE skill, THE SYSTEM SHALL show full parameters,
  primitives, pre/postconditions and provenance, and publish only on explicit approval.
- WHEN STOP is pressed, THE SYSTEM SHALL stop the robot, cancel pending plans and refuse approvals until cleared.
