# Robot agent (runs on the MasterPi's Raspberry Pi 5)

The Mac plans and checks. The robot only runs one approved action at a time.
This folder is the robot side. It uses only the Python standard library.

## Brian's steps

1. Copy this folder to the robot (Mac and robot on the same Wi-Fi):
   `scp -r robot_agent pi@<robot-ip>:~/`
2. Dry run with no motors, on the robot:
   `cd ~ && python3 -m robot_agent.agent --fake`
   From the Mac: `curl http://<robot-ip>:8100/state` should print the state.
3. Open Hiwonder's own example scripts on the robot and fix every line marked
   `CHECK` in `driver.py` (imports, chassis speed, gripper pulse widths, arm poses).
4. Test one thing at a time with the robot on blocks (wheels off the table):
   `curl -X POST http://<robot-ip>:8100/execute -d '{"op":"gripper_close","args":{}}'`
   `curl -X POST http://<robot-ip>:8100/execute -d '{"op":"drive_bounded","args":{"distance_m":0.1}}'`
   `curl -X POST http://<robot-ip>:8100/stop -d '{}'`
5. Measure each route between zones on the real table and write it in
   `routes.json` (the numbers there now are placeholders). Each drive step is at
   most 0.5 m and each turn at most 180 degrees.
6. Run it for real: `python3 -m robot_agent.agent`
7. On the Mac, start the server pointing at the robot:
   `ENGRAM_ROBOT_URL=http://<robot-ip>:8100 uvicorn --factory engram.api:create_app --host 0.0.0.0 --port 8000`
   and run `python scripts/overhead_camera.py` so placements can be confirmed.

## Safety

- Stop works at any time, even in the middle of a move, and the agent stops by
  itself on any hardware error.
- If the Mac loses contact during a move, it treats the result as unknown,
  sends stop, and never retries. A person checks the table.
- After a placement the Mac waits for the overhead camera to see the tag in the
  right zone. If it doesn't, that is also unknown.
- Keep a hand near the robot's power switch during every test.
