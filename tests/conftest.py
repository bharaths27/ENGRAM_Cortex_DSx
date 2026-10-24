import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engram.db import connect  # noqa: E402
from engram.engine import Engine  # noqa: E402
from engram.robot.mock import MockRobot  # noqa: E402

REQUEST = "Bring Sample B to the bench for the acid rinse"


@pytest.fixture
def arena():
    return json.loads((ROOT / "fixtures/lab/arena.json").read_text())


@pytest.fixture
def engine(arena):
    eng = Engine(connect(":memory:"), MockRobot(arena), set(arena["zones"]))
    eng.load_arena(arena)
    eng.overhead_scan()
    return eng


@pytest.fixture
def taught(engine):
    engine.teach("SOP 004", (ROOT / "fixtures/lab/SOP_004.md").read_text())
    return engine
