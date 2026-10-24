# Put the brain on the Pi 4B (no internet needed)

Pi 4B: `rasp@10.42.0.116` on the engram-robot hotspot. Pi 5 (robot): `starrasp@star-pi.local`, `10.42.0.1`.
The Mac must be on engram-robot for every step, so Claude cannot help during them.

Everything is in one file on the Mac: `offline/brain_bundle.tar` (code, 1.5B model, voice model,
llama.cpp source, Python packages). Rebuild it after code changes with `bash scripts/make_bundle.sh`.

## 1. testing terminal (Mac): copy the bundle

    cd ~/Desktop/VAYLT_Hackathon
    scp -J starrasp@star-pi.local offline/brain_bundle.tar rasp@10.42.0.116:~/

If that fails, two hops: `scp offline/brain_bundle.tar starrasp@star-pi.local:~/`, then on the Pi 5
`scp ~/brain_bundle.tar rasp@10.42.0.116:~/`.

## 2. Pi4b terminal: unpack and set up (20 to 30 minutes)

    ssh -J starrasp@star-pi.local rasp@10.42.0.116
    cd ~ && tar -xf brain_bundle.tar
    bash ~/engram_hub/scripts/brainpi_setup.sh

Setup installs the packages, builds llama-server, loads the robot commands, arm poses and skills
into memory (`~/engram_hub/engram.db`), and runs the tests. Check memory with
`cd ~/engram_hub && .venv/bin/python scripts/load_robot_memory.py --list`.

## 3. Pi5 terminal: robot agent

    ssh starrasp@star-pi.local
    cd ~ && sudo python3 -m robot_agent.agent

## 4. Pi4b terminal: start the brain

    bash ~/engram_hub/scripts/brainpi_start.sh --model     # leave out --model for the fast rule planner

## Voice transcripts from the webcam (Brian)

To make a transcript searchable in the same memory, on the Pi 4B:

    from engram.db import connect
    from engram.memory import Memory
    Memory(connect("/home/rasp/engram_hub/engram.db")).add_source("Voice 17:05", text, kind="voice_transcript")
