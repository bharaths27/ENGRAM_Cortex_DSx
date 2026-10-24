# Perception: overhead camera and voice

Two small programs that feed the ENGRAM server. Neither ever moves the robot.

| Program | What it does | Talks to |
|---|---|---|
| `overhead_tags.py` | Webcam over the table finds ArUco tags (DICT_4X4_50) and reports which zone each object is in | `POST /observations/tag` |
| `voice.py` | Push to talk, speech to text on this computer, sends the text as a command | `POST /commands` |

Runs on the Mac first. The same code runs on the Jetson (use `--no-window` there if it has no screen).

## Setup (once)

```bash
source .venv/bin/activate
pip install -r requirements.txt -r perception/requirements.txt
```

On a Mac, the first run asks for camera and microphone permission for Terminal or VS Code. Say yes.

## Overhead camera

1. Print the tags (DICT_4X4_50, numbers in `fixtures/lab/arena.json`) and stick one on each object.
2. Mount the webcam looking straight down at the table.
3. Draw the zones once per camera position. Drag a box around each zone, press Enter after each:
   ```bash
   python -m perception.overhead_tags calibrate
   ```
   This saves `perception/zones.json` and a picture `perception/zones.png`. Redo it if the camera moves.
4. With the ENGRAM server running:
   ```bash
   python -m perception.overhead_tags run
   ```
   A window shows the zones and every tag it sees. Each object is reported when it has sat in one
   zone for 5 frames, and again every 60 seconds so memory keeps it fresh. Press q to stop.

Wrong camera? Add `--camera 1`. Check a photo without the server: `python -m perception.overhead_tags image photo.jpg`.

## Voice

With the ENGRAM server running:

```bash
python -m perception.voice              # Enter to start talking, Enter to stop
python -m perception.voice --speak      # also read replies out loud
python -m perception.voice --confirm    # check what it heard before sending
python -m perception.voice --typed      # type instead; the fallback that always works
```

The first spoken run downloads the speech model (`base.en`, about 150 MB) once; after that it works
offline. Use `--model tiny.en` if it is too slow. The recognizer is told the object and zone names from
the arena file so it hears "Sample B" rather than "sample be".

To use whisper.cpp instead: `brew install whisper-cpp`, download a ggml model, then
`python -m perception.voice --engine whisper-cpp --model models/ggml-base.en.bin`.

## Tests

`python -m pytest tests/test_perception.py` checks tag detection, zone lookup, the flicker filter and
reply handling. Skipped when OpenCV is not installed.

## Not done yet

- Not yet tested with the real C920s camera or a real microphone.
- Zones are rectangles in the camera image; fine for a flat table seen from above.
- Replies use the system voice (`say` on Mac, `espeak` on Linux). Piper can replace `say()` in `voice.py`.
