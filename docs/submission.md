# Sundai submission, pitch script and video plan

Deadline: 8 PM Boston, Sat Oct 24, on the Sundai site. Lines marked CONFIRM need a yes from
Bharath or Carther before they go in.

## Form fields, in order

**Title** (32 max): `ENGRAM Cortex`

**Current events**: tick the Hackachusetts box. Without it the project is not entered.

**Tech Tags**: Python, FastAPI, SQLite, llama.cpp, Qwen3, OpenCV, Raspberry Pi, Kiro

**Domain Tags**: Robotics, AI, Privacy, Education

**GitHub URL**: `https://github.com/bharaths27/VAYLT_Hackathon`
The repo is private, so judges cannot open it. Make it public before you submit, or leave this blank.

**Demo URL**: the pitch video (YouTube unlisted or Google Drive "anyone with the link").

**Blog URL**: the Devpost page. The demo is the video people watch; the blog is the written story.

**One Sentence Description** (100 max), keep what is there:
`Offline robot assistant that learns tasks, remembers rules, and reuses approved skills.`

**Thumbnail**: a sharp photo of the robot arm holding an object, cropped to 3:2 (1200x800 or larger).

## Full Description (paste into the Markdown box)

```
### Explain the problem

Lab robots and home robots either need a cloud AI, which sends what they see and hear off site,
or they need someone to write code for every new task. A lab assistant who shows a robot a task
once should not have to program it, and the robot should not forget the safety rules it was taught.

### Describe the features and functionality of your Project

ENGRAM Cortex is a small robot that learns by writing memory, not by changing model weights.
Everything runs on the robot's own Raspberry Pi 5. Nothing leaves the room.

* Teach it once: we show the robot a task step by step (drive, turn, open the claw, reach, pick,
  place). Each step runs live, and the steps that worked are saved as a skill it can repeat.
* Memory with citations: procedures, robot commands, arm poses and skills are stored in a local
  SQLite memory. When it plans, it says which line of which document a rule came from.
* Plans in plain words: a request like "bring the beaker to the bench" becomes a short plan.
  A local model (Qwen3 1.7B through llama.cpp) can write the plan, and a rule planner takes over
  if the model fails.
* Safety first: every plan goes through a fixed checker (allowed actions, limits, rules, how fresh
  the object locations are), then waits for a person to approve the exact plan. Each robot step
  is signed, and the robot stops by itself if the brain goes quiet.
* Honest results: a step is "done", "failed" or "unknown". Unknown always stops the robot and is
  never retried on its own.
* Skills: after a good run, the run becomes a candidate skill. Once a person approves it, the same
  request runs again with no model call.

Hardware: Hiwonder MasterPi (mecanum base, 5 servo arm with claw, ultrasonic sensor, camera)
on a Raspberry Pi 5.

### How did you use Kiro to build your project?

CONFIRM: list only what we really did in Kiro.
* Steering docs: .kiro/steering holds product.md, tech.md, structure.md and safety-rules.md,
  so every Kiro session knew the product, the stack, the file layout and the safety rules
  (for example: the robot only runs allow listed actions, and unknown means stop).
* CONFIRM specs, hooks or other features, with one real example each.

### Video URL

PASTE THE VIDEO LINK
```

## Pitch script (about 2 minutes, two speakers)

**Bharath (0:00)**
Hi, we are team ENGRAM Cortex. Robots today need either a cloud AI that sends everything they
see off site, or a programmer for every new task. We built a robot that learns a task from you
once, remembers it, and repeats it, with all of its AI running on the robot itself.

**Brian (0:20)**
This is a Hiwonder MasterPi. I wrote the driver for the wheels, the arm and the claw, and
we taught the arm its poses by hand: home, reach and carry.
(show the arm moving between poses)

**Bharath (0:35)**
Here is the "show it once" part. I type the steps: drive forward, pick, turn around, drive
back, place. The robot does each one live, and the steps that worked become a skill.
Now I just say "run fetch" and it repeats the whole task.
(show record, then replay)

**Verna (1:00)**
The brain lives in memory, not in model weights. Our commands, poses and skills sit in a local
SQLite memory, and a 1.7 billion parameter model on the Pi turns a request into a plan.
(CONFIRM: only say this once the model has run on the Pi)
Every plan is checked against the allowed actions and the rules we taught it, and a person
approves it before the robot moves.

**Bharath (1:25)**
Safety is built in. Every step is signed, any step we cannot verify stops the robot, and
an open palm or the stop button halts it at once.
Nothing leaves the room: no cloud, no account, no data sent anywhere.

**All (1:45)**
ENGRAM Cortex: a robot that learns by remembering. Thank you.

## Video shot list (record on a phone, landscape, good light)

1. Team intro, faces, 10 seconds.
2. Close up of the robot, then the arm going home, reach, carry.
3. Claw open and close.
4. Laptop screen: `python scripts/robot_skill.py record fetch`, typing the steps, robot doing them.
5. `python scripts/robot_skill.py run fetch`, robot repeating the task.
6. Screen: a plan request with the citation shown (from `python scripts/demo_cli.py` if the
   Pi brain is not ready).
7. Stop: press stop mid move, robot halts.
8. Closing line with the robot in frame.

Record each shot separately, then join them. If a shot fails, keep the clip of what works.
Only made up test data is shown on screen.
