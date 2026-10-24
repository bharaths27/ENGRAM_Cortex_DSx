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

## Teach the arm, then pick things up (Oct 24)

Servo ids from Brian: 1 claw, 3 wrist, 4 elbow, 5 shoulder, 6 base. They live in
`arm_config.json`, together with the three arm poses the robot needs.

1. Copy the folder to the robot: `scp -r robot_agent starrasp@star-pi.local:~/`
   (this overwrites `arm_config.json` on the robot; copy it back first if poses were saved there).
2. On the robot, with someone watching the arm: `cd ~ && sudo python3 -m robot_agent.teach_pose`
   Move the joints with `s+`, `e-`, `w 1500` and so on, then `save home`, `save reach_down`
   (claw down at table height in front of the robot), and `save carry` (object lifted clear).
   Copy the result back to the Mac: `scp starrasp@star-pi.local:~/robot_agent/arm_config.json robot_agent/`
3. On the robot, stop Brian's own server if it is running, then:
   `cd ~ && sudo python3 -m robot_agent.agent`
4. From the Mac, one action at a time:
   `python scripts/robot_try.py pose home`, then `pick`, `forward 0.2`, `turn 90`, `place`, `stop`.

## Safety

- Stop works at any time, even in the middle of a move, and the agent stops by
  itself on any hardware error.
- If the Mac loses contact during a move, it treats the result as unknown,
  sends stop, and never retries. A person checks the table.
- After a placement the Mac waits for the overhead camera to see the tag in the
  right zone. If it doesn't, that is also unknown.
- Keep a hand near the robot's power switch during every test.
