"""Hiwonder Glowy Ultrasonic Sensor on I2C bus 1, address 0x77.

Verified on star-pi: register 0x00, 16-bit little-endian word = distance in millimetres
(`i2cget -y 1 0x77 0x00 w`). Read in its own thread at ~15 Hz; scan() returns instantly in the
one-beam format the safety supervisor expects.

Filtering: median of the last 5 good readings. A single 0 mm or "no echo" sample is a dropout
and is ignored, so one bad ping no longer stops the robot or hides an object.

Fail-safe choices:
  * 0 mm (too close / bad echo) in 3 of the last 5 samples is reported as 3.1 cm -> BLOCKED.
  * >= 4000 mm is "no echo" -> inf (clear). Ultrasonic can miss soft/angled objects; documented.
  * an I2C error leaves the old timestamp in place -> supervisor sees the reading go stale and
    stops motion (E_LIDAR_STALE).

    python -m drivers.hiwonder_sonar          # live readout
"""
import statistics
import threading
import time
from collections import deque

import numpy as np

ADDR, REG = 0x77, 0x00


class HiwonderSonar:
    def __init__(self, bus=1, addr=ADDR, hz=15.0):
        from smbus2 import SMBus  # pip install smbus2 (or apt install python3-smbus2)
        self.bus, self.addr, self.period = SMBus(bus), addr, 1.0 / hz
        self._raw: deque = deque(maxlen=5)   # every sample, to spot "mostly zeros"
        self._good: deque = deque(maxlen=5)  # only real echoes (1..3999 mm)
        self._scan = (None, np.array([0.0]), np.array([np.inf]))
        self.errors = 0
        self._running = True
        threading.Thread(target=self._loop, daemon=True, name="sonar").start()

    def read_mm(self) -> int:
        return self.bus.read_word_data(self.addr, REG)

    def _step(self):
        """One read + filter. An I2C error leaves the old timestamp so the reading goes stale."""
        try:
            mm = self.read_mm()
        except OSError:
            self.errors += 1
            return
        self._raw.append(mm)
        if 0 < mm < 4000:
            self._good.append(mm)
        zeros = sum(1 for x in self._raw if x <= 0)
        far = sum(1 for x in self._raw if x >= 4000)
        if zeros >= 3:
            m = 0.031                                     # fail safe: "something is very close"
        elif far >= 3 or not self._good:
            m = np.inf                                    # no echo within range
        else:
            m = statistics.median(self._good) / 1000.0    # kills spikes and dropouts
        self._scan = (time.monotonic(), np.array([0.0]), np.array([m]))

    def _loop(self):
        while self._running:
            t0 = time.monotonic()
            self._step()
            time.sleep(max(0.0, self.period - (time.monotonic() - t0)))

    def scan(self):
        return self._scan

    def close(self):
        self._running = False
        self.bus.close()


if __name__ == "__main__":
    s = HiwonderSonar()
    try:
        while True:
            t, _, r = s.scan()
            age = "never" if t is None else f"{time.monotonic() - t:.2f}s old"
            print(f"\r{r[0] * 100:7.1f} cm   ({age}, i2c errors {s.errors})   ", end="", flush=True)
            time.sleep(0.1)
    except KeyboardInterrupt:
        s.close()
        print()
