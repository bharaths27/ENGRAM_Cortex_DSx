# Put the brain on the Pi 4B, final wired setup

Network:
- Mac and Pi 5 are on Brian's phone hotspot (with internet). Mac reaches the Pi 5 as `starrasp@star-pi.local`.
- Pi 5 and Pi 4B are joined by the Ethernet cable. Pi 5 is `10.0.0.2` on the cable. The Pi 4B is
  normally `10.0.0.1`; step 1 checks it.
- The Mac reaches the Pi 4B by jumping through the Pi 5 (`-J`).

Everything the Pi 4B needs is in one file on the Mac: `offline/brain_bundle.tar` (code, 1.5B model,
voice model, llama.cpp source, Python packages). Rebuild it after code changes with
`bash scripts/make_bundle.sh`.

Three VS Code terminals: **Pi5**, **Pi4b**, **testing**. Each one is a Mac terminal at first.

## 1. Pi5 terminal: log in and check the cable

    ssh starrasp@star-pi.local
    ip -br addr show eth0
    ip neigh show dev eth0

`eth0` must say `UP` with `10.0.0.2`. The second line shows the Pi 4B's address (usually `10.0.0.1`).
If eth0 says DOWN, the cable or the Pi 4B's power is the problem. Fix that first.
If you see a different address than `10.0.0.1`, use it everywhere below instead.

## 2. Pi5 terminal: start the robot agent and leave it running

    cd ~ && sudo python3 -m robot_agent.agent

Brian's own robot server must not be running at the same time (only one program can use the motor board).

## 3. testing terminal (Mac): copy the bundle to the Pi 4B (a few minutes)

    cd ~/Desktop/VAYLT_Hackathon
    git pull
    scp -J starrasp@star-pi.local offline/brain_bundle.tar rasp@10.0.0.1:~/

## 4. Pi4b terminal: log in, unpack, set up (20 to 30 minutes)

    ssh -J starrasp@star-pi.local rasp@10.0.0.1
    cd ~ && tar -xf brain_bundle.tar
    bash ~/engram_hub/scripts/brainpi_setup.sh

Wait for `done`. Setup installs the packages, builds llama-server, loads the robot commands,
arm poses and skills into memory (`~/engram_hub/engram.db`), and runs the tests. Then check memory:

    cd ~/engram_hub && .venv/bin/python scripts/load_robot_memory.py --list

It should show 4 entries.

## 5. Pi4b terminal: check the brain can see the robot over the cable

    curl http://10.0.0.2:8100/state

You should get the robot's state as JSON.

## 6. Pi4b terminal: start the brain and leave it running

    ENGRAM_ROBOT_URL=http://10.0.0.2:8100 bash ~/engram_hub/scripts/brainpi_start.sh --model

Leave out `--model` for the fast rule planner only.

## 7. testing terminal (Mac): open a window to the brain and try it

    ssh -J starrasp@star-pi.local -N -L 8000:localhost:8000 rasp@10.0.0.1

Leave that running. Press Cmd+T in VS Code's terminal panel (or the + button) for a new testing
terminal, then:

    curl http://localhost:8000/health
    curl http://localhost:8000/robot/state

Open http://localhost:8000/docs in the browser to try commands.

## Voice transcripts from the webcam (Brian)

To make a transcript searchable in the same memory, on the Pi 4B:

    from engram.db import connect
    from engram.memory import Memory
    Memory(connect("/home/rasp/engram_hub/engram.db")).add_source("Voice 17:05", text, kind="voice_transcript")
