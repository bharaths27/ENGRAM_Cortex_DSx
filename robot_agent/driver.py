"""The only file that touches the MasterPi hardware. Brian owns this.

Every method must return quickly and raise an exception if the hardware call
fails. The agent turns exceptions into "failed" results.

What is on star-pi (checked Oct 24): there is no stock Hiwonder SDK (no
HiwonderSDK, ArmIK or mecanum module). The team's own serial driver lives in
~/engram_robot/drivers/hiwonder_board.py. It talks to the Hiwonder board on
/dev/ttyAMA0 at 1 Mbaud and gives HiwonderBoard (set_motor_duty, stop_motors,
set_pwm_servo, beep) and HiwonderMotors (set(left, right) duty -1..1, stop).
Wheel IDs, wheel directions and the claw servo come from
~/engram_robot/drive_calib.json. HiwonderDriver reuses those. Lines marked
CHECK still need a measurement with a person watching.

Do not run this driver and the engram_robot server at the same time: both open
/dev/ttyAMA0 and both default to port 8100.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ARM_CONFIG = Path(__file__).with_name("arm_config.json")


class Driver:
    def drive(self, distance_m: float) -> None: ...
    def turn(self, degrees: float) -> None: ...
    def gripper(self, open_: bool) -> None: ...
    def arm(self, pose: str) -> None: ...          # "home", "reach_down", "carry"
    def stop_all(self) -> None: ...


class FakeDriver(Driver):
    """Records calls. Used by tests and for a dry run on the Pi."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def drive(self, distance_m: float) -> None:
        self.calls.append(("drive", distance_m))

    def turn(self, degrees: float) -> None:
        self.calls.append(("turn", degrees))

    def gripper(self, open_: bool) -> None:
        self.calls.append(("gripper", open_))

    def arm(self, pose: str) -> None:
        self.calls.append(("arm", pose))

    def stop_all(self) -> None:
        self.calls.append(("stop",))


class HiwonderDriver(Driver):
    # Skid steer: the board takes a duty cycle, not a speed, so moves are timed.
    ENGRAM_DIR = Path.home() / "engram_robot"
    DRIVE_DUTY = 0.4           # same duty spin.py used; keep low until measured
    TURN_DUTY = 0.4
    M_PER_S_AT_DUTY = None     # CHECK: tape measure at DRIVE_DUTY. None = estimate from drive_calib.json
    DEG_PER_S = 90.0           # CHECK: time one full spin at TURN_DUTY, then 360 / seconds
    MAX_SECONDS = 4.0          # never run the wheels longer than this in one step
    # Arm and claw come from arm_config.json (servo ids from Brian; poses saved with
    # `sudo python3 -m robot_agent.teach_pose`). No IK library is on the Pi.
    ARM_MOVE_MS = 1000

    def __init__(self) -> None:
        sys.path.insert(0, str(self.ENGRAM_DIR))
        from drivers.hiwonder_board import HiwonderBoard, HiwonderMotors
        from drivers.motors import DriveCalib

        self.calib = DriveCalib.load(str(self.ENGRAM_DIR / "drive_calib.json"))
        self.board = HiwonderBoard()
        self.motors = HiwonderMotors(self.board, self.calib.left_motor_ids,
                                     self.calib.right_motor_ids, self.calib.motor_signs)
        self.motors.stop()
        self.arm_cfg = json.loads(ARM_CONFIG.read_text())

    def _speed(self) -> float:
        if self.M_PER_S_AT_DUTY:
            return self.M_PER_S_AT_DUTY
        c = self.calib
        return max(0.01, c.mps_at_full * (self.DRIVE_DUTY - c.deadband) / (1.0 - c.deadband))

    def _run(self, left: float, right: float, seconds: float) -> None:
        seconds = min(seconds, self.MAX_SECONDS)
        try:
            self.motors.set(left, right)
            time.sleep(seconds)
        finally:
            self.motors.stop()

    def drive(self, distance_m: float) -> None:
        d = self.DRIVE_DUTY if distance_m >= 0 else -self.DRIVE_DUTY
        self._run(d, d, abs(distance_m) / self._speed())

    def turn(self, degrees: float) -> None:
        # Positive = left (counter clockwise), same as spin.py: left side back, right side forward.
        d = self.TURN_DUTY if degrees >= 0 else -self.TURN_DUTY
        self._run(-d, d, abs(degrees) / self.DEG_PER_S)

    def gripper(self, open_: bool) -> None:
        claw = self.arm_cfg["claw"]
        pulse = claw["open_us"] if open_ else claw["closed_us"]
        self.board.set_pwm_servo(int(claw["servo"]), max(500, min(2500, int(pulse))), 500)
        time.sleep(0.6)

    def arm(self, pose: str) -> None:
        pulses = self.arm_cfg["poses"].get(pose)
        if not pulses:
            raise RuntimeError(f"arm pose {pose} not saved yet; run robot_agent.teach_pose")
        # Base first, then shoulder, elbow, wrist, so the arm turns before it reaches.
        order = [str(self.arm_cfg["joints"][j]) for j in ("base", "shoulder", "elbow", "wrist")]
        for sid in sorted(pulses, key=lambda s: order.index(s) if s in order else 99):
            self.board.set_pwm_servo(int(sid), max(500, min(2500, int(pulses[sid]))), self.ARM_MOVE_MS)
            time.sleep(self.ARM_MOVE_MS / 1000 * 0.5)
        time.sleep(self.ARM_MOVE_MS / 1000)

    def stop_all(self) -> None:
        self.motors.stop()
