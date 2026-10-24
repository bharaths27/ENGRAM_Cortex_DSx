import sys, time; sys.path.insert(0, '.')
from drivers.hiwonder_board import HiwonderBoard, HiwonderMotors
from drivers.motors import DriveCalib
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
DUTY = 0.4
c = DriveCalib.load(); b = HiwonderBoard()
m = HiwonderMotors(b, c.left_motor_ids, c.right_motor_ids, c.motor_signs)
try:
    input(f"On the floor, clear all around? Enter to spin left for {SECS}s...")
    m.set(-DUTY, DUTY); time.sleep(SECS)
finally:
    b.stop_motors(); time.sleep(0.1); b.close()
