"""The only file that touches the MasterPi hardware. Brian owns this.

Every method must return quickly and raise an exception if the hardware call
fails. The agent turns exceptions into "failed" results.

HiwonderDriver is a starting point. The SDK names below follow Hiwonder's
MasterPi examples, but they are NOT checked on our robot yet. Open the example
scripts on the robot's Pi 5 (usually under /home/pi/MasterPi) and fix every
line marked CHECK before trusting it.
"""

from __future__ import annotations

import time


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
    # Tune these on the real table. Speeds are Hiwonder units, not m/s.
    SPEED = 50                 # CHECK
    M_PER_S_AT_SPEED = 0.15    # CHECK: measure with a tape
    DEG_PER_S = 90.0           # CHECK: measure one full turn
    GRIPPER_OPEN, GRIPPER_CLOSED = 1500, 2000   # CHECK: servo 1 pulse widths
    POSES = {                  # CHECK: (x, y, z) in cm for the arm IK
        "home": (0, 6, 18),
        "reach_down": (0, 17, 1.5),
        "carry": (0, 10, 12),
    }

    def __init__(self) -> None:
        import HiwonderSDK.Board as Board          # CHECK
        import HiwonderSDK.mecanum as mecanum      # CHECK
        from ArmIK.ArmMoveIK import ArmIK          # CHECK

        self.board = Board
        self.chassis = mecanum.MecanumChassis()
        self.ik = ArmIK()

    def _move(self, direction: float, angular: float, seconds: float) -> None:
        self.chassis.set_velocity(self.SPEED if angular == 0 else 0, direction, angular)  # CHECK
        time.sleep(seconds)
        self.chassis.set_velocity(0, 0, 0)

    def drive(self, distance_m: float) -> None:
        direction = 90 if distance_m >= 0 else 270   # CHECK: 90 is forward in Hiwonder examples
        self._move(direction, 0, abs(distance_m) / self.M_PER_S_AT_SPEED)

    def turn(self, degrees: float) -> None:
        rate = 0.3 if degrees >= 0 else -0.3          # CHECK: sign and size
        self._move(0, rate, abs(degrees) / self.DEG_PER_S)

    def gripper(self, open_: bool) -> None:
        pulse = self.GRIPPER_OPEN if open_ else self.GRIPPER_CLOSED
        self.board.setPWMServoPulse(1, pulse, 500)    # CHECK
        time.sleep(0.6)

    def arm(self, pose: str) -> None:
        ok = self.ik.setPitchRangeMoving(self.POSES[pose], -90, -90, 0, 1000)  # CHECK
        if not ok:
            raise RuntimeError(f"arm cannot reach pose {pose}")
        time.sleep(1.1)

    def stop_all(self) -> None:
        self.chassis.set_velocity(0, 0, 0)
