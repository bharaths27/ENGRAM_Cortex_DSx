# Voice and hand gestures

Two additions that feed the ENGRAM server. Neither one moves the robot on its own.

| Piece | Where | Talks to |
|---|---|---|
| Voice client: push to talk, speech to text on this computer, sends the text as a command | `perception/voice.py` | `POST /commands` |
| Hand gestures from the overhead camera | `engram/vision/gestures.py`, switched on with `scripts/overhead_camera.py --gestures` | `POST /stop`, `POST /plan/rest`, `POST /observations/tag` |

Runs on the Mac first. The same code runs on the Jetson.

## Voice

```bash
pip install -r perception/requirements.txt
python -m perception.voice              # Enter to start talking, Enter to stop
python -m perception.voice --speak      # also read replies out loud
python -m perception.voice --confirm    # check what it heard before sending
python -m perception.voice --typed      # type instead; the fallback that always works
```

The first spoken run downloads the speech model (`base.en`, about 150 MB) once; after that it works
offline. Use `--model tiny.en` if it is too slow. The recognizer is told the object and zone names from
the arena file so it hears "Sample B" rather than "sample be". Spoken commands only propose plans; a
person still approves before the robot moves.

To use whisper.cpp instead: `brew install whisper-cpp`, download a ggml model, then
`python -m perception.voice --engine whisper-cpp --model models/ggml-base.en.bin`.

## Gestures

Gestures run inside the team's overhead camera script, because only one program can use the camera:

```bash
pip install -r requirements-vision.txt mediapipe     # mediapipe needs Python 3.9 to 3.12
python scripts/overhead_camera.py --show --gestures
```

- **Open palm, held about 0.3 s:** sends STOP. Fires once per palm. The robot stays stopped until
  someone clears it on the iPad, like the stop button. `--no-palm-stop` only shows it while testing
  (people reaching over the table with open hands could otherwise stop the robot more than you want).
- **Pointing at a tagged object:** draws a line along the index finger and picks the object tag closest
  to it (or the one being touched). Reports that object's zone right away, so memory has a fresh
  sighting and the robot does not need to search, and remembers the choice for 8 seconds.
- **Then say "bring me that one":** `voice.py` replaces "that one", "this" or "it" with the object just
  pointed at, shows the change, and sends "bring me the Beaker". Turn off with `--no-pointing`.
- **Thumb out (a fist with the thumb sticking out, any direction), held about 0.4 s:** proposes
  "return to rest" through `POST /plan/rest`: drive back to the start zone. Like every plan it only
  runs after approval. `--no-thumb-rest` only shows it. The robot agent already has an arm "home" pose
  (`robot_agent/driver.py`); once it is an allowed action in `engram/capabilities.py`, add it to
  `Engine.propose_rest`.

With `--gestures` the camera loop runs at 15 frames per second instead of 5, so the hold times stay short.
The first run downloads MediaPipe's hand model (about 8 MB) to `engram/vision/models/` (ignored by git).
Adapted from the hand-tracking ideas in the class studio notebook.

## Tests

`python -m pytest tests/test_gestures.py tests/test_voice.py` checks gesture shapes, pointing, the hold
filter, the "that one" fill-in and reply handling. `tests/test_api.py` covers `POST /plan/rest`.

## Not done yet

- Not yet tested with the real camera, a real microphone or real hands; gesture thresholds may need tuning.
- Replies use the system voice (`say` on Mac, `espeak` on Linux). Piper can replace `say()` in `voice.py`.
