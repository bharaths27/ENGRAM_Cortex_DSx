# ENGRAM Assist

A small assistive robot for people who cannot get up or cannot speak. The person
controls the robot with hand signals in front of a camera, or with their voice,
and the robot drives over, picks up a light object like a pill bottle and brings it back.

Built at DS+X, Boston University, October 25, 2026. Healthcare track.

**Demo video:** [docs/media/ENGRAM_Assist_submission.mp4](docs/media/ENGRAM_Assist_submission.mp4)

All people, names and data in the demo and in this repo are made up.

## The problem

About 1 in 8 US adults has a mobility disability
([CDC](https://www.cdc.gov/disability-and-health/articles-documents/disability-impacts-all-of-us-infographic.html)).
After a fall or a stroke, the water, the phone and the pills can be across the room,
and some people cannot speak to ask for help. Most smart helpers need you to talk
or tap a phone. We wanted a helper that works with whatever the person still has:
a voice, or just a hand.

## What it does

1. **Hand signals.** A web page watches the person's hand through a camera and turns
   each sign into a robot move. Built by Verna.
2. **Voice.** The person says a short command and the robot does it. There are two
   voice paths: one in the web page, and one that runs on the robot's Raspberry Pi
   using the Logitech C920 microphone.
3. **Live robot camera.** The C920 on the robot streams video to the page, so the person
   can see what the robot sees.
4. **Pick up and put down.** "Pick it up" runs Brian's saved arm poses (open claw, reach,
   close, carry). "Put it down" reverses it.
5. **Safety.** Every move is bounded in distance and speed by the robot server. The
   ultrasonic sensor slows the robot down near an object and stops it about 6 cm away,
   so the claw can still reach. Saying "stop" or showing the stop sign stops the robot first,
   before anything else.

### Hand signals

| Sign | Robot |
|---|---|
| 2 fingers up | Forward |
| 2 fingers down | Reverse |
| 2 fingers left | Turn left |
| 2 fingers right | Turn right |
| Circle left / circle right | Spin left / spin right |
| Open palm | Open claw |
| Fist | Grab (close claw) |
| Thumb up | Arm up |
| Thumb down | Arm down |

### Voice commands (robot side)

The Pi voice loop only runs commands from a fixed list in
[engram_robot/voice/intents.py](engram_robot/voice/intents.py). Anything else gets
"Sorry, I don't know how to do that".

| Say | Robot |
|---|---|
| "stop" | Stops right away |
| "move forward 30 centimeters", "back up 20 centimeters" | Bounded drive |
| "turn left 90 degrees", "turn around" | Bounded turn |
| "open the claw", "close the claw" | Claw |
| "pick it up", "grab it" | Grab with the saved arm poses |
| "put it down" | Put down with the saved arm poses |
| "drive to tag 3", "pick up object 2" | Drive to or pick a tagged object |

The web page voice mode accepts plain phrases like "move forward 4 times" or
"left twice then forward".

## How it fits together

```
 Person (hand signs or voice)
        |
        v
 Web page (backend-dashboard)  --- camera + MediaPipe hands, browser speech
        |   POST /teleop
        v
 ENGRAM brain API (engram/, port 8000) --- signs every command
        |   POST /robot/execute
        v
 Robot server on the Pi 5 (engram_robot/, port 8200)
        --- checks limits, ultrasonic slow down and stop, e-stop
        --- motors, arm servos, claw, C920 camera
```

The Pi voice loop (`engram_robot/voice/listen.py`) talks to the robot server directly.

## Hardware

| Part | Use |
|---|---|
| Hiwonder MasterPi | Mecanum wheel base, 5 servo arm and claw |
| Raspberry Pi 5 | Runs the robot server and the voice loop |
| Logitech C920 | Camera and microphone on the robot |
| Ultrasonic sensor (on the MasterPi) | Distance in front, used to slow and stop |
| Laptop with a webcam | Runs the web page that reads hand signs |

The Pi and the laptop were on the same phone hotspot.

## How to run it

### 1. Try everything on a Mac with the simulated robot

```bash
git clone https://github.com/bharaths27/ENGRAM_Cortex_DSx.git
cd ENGRAM_Cortex_DSx
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install opencv-python-headless numpy

# terminal 1: simulated robot on port 8200
cd engram_robot && export ENGRAM_ROBOT_SECRET=engram2026
python -m robot.server --sim --port 8200

# terminal 2: brain API on port 8000
export ENGRAM_ROBOT_URL=http://localhost:8200/robot ENGRAM_ROBOT_SECRET=engram2026
uvicorn --factory engram.api:create_app --host 0.0.0.0 --port 8000

# terminal 3: the web page
cd backend-dashboard && npm install && npm run dev
```

Open the address that `npm run dev` prints, then go to `/dashboard` for the hand sign
and voice control page. `engram2026` is only the demo default. Use your own secret on a real robot.

### 2. On the real robot (Raspberry Pi 5)

```bash
cd ~/engram_robot
# robot.env holds ENGRAM_ROBOT_SECRET (not in git)
sudo systemctl start engram-robot        # robot server, real driver, ultrasonic config, port 8200
bash voice/setup_voice.sh                # one time: whisper.cpp and the tiny English model
bash tools/c920_live.sh --dry-run        # mic test, robot never moves
bash tools/c920_live.sh                  # C920 video and voice control together
python3 tools/arm_try.py grab            # test the arm: reach, carry, home, open, close, grab, drop
```

On the laptop, point the brain at the Pi with
`ENGRAM_ROBOT_URL=http://<pi address>:8200/robot` and the same `ENGRAM_ROBOT_SECRET`.

### Internet

This build is **not** fully offline. The web page loads the MediaPipe hand model from
Google, browser speech recognition uses the browser's online service, and the page's
voice parser can call Gemini when a `VITE_GEMINI_KEY` is set (it falls back to a simple
built in parser without it). The Pi voice loop uses whisper.cpp on the Pi itself.

## Tests

```bash
python -m pytest                                  # brain: 326 passed, 2 skipped
cd engram_robot && python -m pytest tests         # robot server, safety, voice: 59 passed
cd backend-dashboard && npm test                  # web page: 11 passed
```

These numbers are from the final merge on October 25, run on the simulated robot.

## What is in this repo

| Folder | What |
|---|---|
| `backend-dashboard/` | Verna's web page: hand sign control, voice mode, robot camera, 3D rover intro |
| `engram_robot/` | Robot server for the Pi 5: safe moves, ultrasonic stop, arm poses, voice loop, tools |
| `engram/` | ENGRAM brain API: teleop relay, camera relay, memory and skills |
| `scripts/` | Helper scripts for the brain and the robot |
| `tests/` | Brain tests |
| `docs/` | Demo video and notes. `docs/ENGRAM_Cortex_brain.md` explains the memory brain |

ENGRAM Assist is built on ENGRAM Cortex, the memory brain our team made the day before
at Hackachusetts. That part (teach a rule, plan, approve, save a skill) is described in
[docs/ENGRAM_Cortex_brain.md](docs/ENGRAM_Cortex_brain.md).

## Limits we know about

1. It picks up light objects only, and the arm poses were taught by hand for one setup.
2. Hand signs need good light and one hand in view.
3. It was tested on a table and floor at the event, not in a real home or with patients.

## Team

| Name | Role |
|---|---|
| Bharath Krishnan Srividhya | Voice control, ENGRAM brain, integration |
| Verna Lin | Hand signal control and the web page |
| Brian Quijada Pleitez | Robot hardware, arm poses, robot server and voice console |

Thanks to Carther Theogene for the MasterPi robot and the voice work he shared.
