# Assistive robot (DS+X Healthcare track)

A person who cannot move easily controls a small robot from their phone or MacBook. They can use
voice, big buttons, or hand signals if they cannot speak. They see through the robot's camera, the
robot can pick up a light object, and it can say the user's words out loud.

Plan: https://claude.ai/artifact/H7FSWxoYu2NskBAFeygBJd

Every demo uses made up data only.

## What is in this repo

| Folder | What it is |
| --- | --- |
| `engram_robot/` | Robot server for the MasterPi Pi 5 (port 8200): drive, claw, arm, camera frame, safety, simulator. Voice console in `engram_robot/voice/` (offline whisper.cpp, port 8444). |
| `engram/vision/` | Hand gesture math (MediaPipe landmarks) and ArUco tag helpers. |
| `perception/` | Push to talk voice client for the Mac. |
| `scripts/` | Camera and gesture runner, tag sheet maker. |
| `ai_module/` | Start and ask the Pi's small local model. |
| `commands/robot_commands` | Brian's hardware test commands. |

## Test on your Mac first (no robot needed)

```bash
pip install -r requirements.txt
cd engram_robot
python -m robot.server --sim        # simulator on http://localhost:8200
pytest -q tests                     # robot checks
cd .. && pytest -q                  # gesture and voice checks
```

## One person deploys to the Pi

All work merges into one branch and is tested on the simulator first. Only Bharath copies code to
the Pi. Only one program may use the motor board at a time.
