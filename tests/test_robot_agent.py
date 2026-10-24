import threading
from http.server import ThreadingHTTPServer

import pytest

from conftest import REQUEST
from engram.robot.masterpi import MasterPiRobot
from robot_agent.agent import RobotAgent, make_handler
from robot_agent.driver import FakeDriver

ZONES = ["home", "shelf_A", "shelf_B", "ppe_station", "bench"]
ROUTES = {f"{a}->{b}": [["turn", 90], ["drive", 0.3]] for a in ZONES for b in ZONES if a != b}


@pytest.fixture
def agent():
    a = RobotAgent(FakeDriver(), ROUTES)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(a))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    a.url = f"http://127.0.0.1:{server.server_address[1]}"
    yield a
    server.shutdown()


def test_agent_refuses_moves_past_limits():
    a = RobotAgent(FakeDriver(), ROUTES)
    assert a.execute("drive_bounded", {"distance_m": 2.0})["status"] == "failed"
    assert a.execute("turn_bounded", {"degrees": 720})["status"] == "failed"
    assert a.driver.calls == []


def test_agent_refuses_bad_routes():
    a = RobotAgent(FakeDriver(), {"home->bench": [["drive", 3.0]]})
    a.holding = "beaker"
    assert a.execute("place_at_zone", {"zone": "bench"})["status"] == "failed"
    assert a.execute("place_at_zone", {"zone": "shelf_B"})["status"] == "failed"  # no route


def test_hardware_error_is_unknown_and_stops():
    class Broken(FakeDriver):
        def arm(self, pose):
            raise OSError("servo bus timeout")

    a = RobotAgent(Broken(), ROUTES)
    out = a.execute("pick_tagged_object", {"object_id": "beaker"}, "shelf_B")
    assert out["status"] == "unknown" and a.stopped
    assert a.execute("drive_bounded", {"distance_m": 0.1})["status"] == "failed"


def test_full_task_over_wifi_with_fake_driver(taught, agent):
    taught.set_robot(MasterPiRobot(agent.url, taught.memory, confirm=False))
    p = taught.propose(REQUEST)
    r = taught.approve_and_run(p["operation_id"], p["digest"], "me")
    assert r["outcome"] == "success", r
    assert agent.zone == "bench" and agent.holding is None
    assert ("gripper", False) in agent.driver.calls


def test_place_not_seen_by_camera_is_unknown(engine, agent):
    engine.set_robot(MasterPiRobot(agent.url, engine.memory, confirm_timeout_s=0.2, sleep=lambda s: None))
    p = engine.propose("bring the beaker to the bench")
    r = engine.approve_and_run(p["operation_id"], p["digest"], "me")
    assert r["outcome"] == "aborted" and "camera did not see" in r["failure"]
    assert agent.stopped


def test_place_seen_by_camera_succeeds(engine, agent):
    def camera_sees(_):
        engine.memory.observe_tag(4, "bench")

    engine.set_robot(MasterPiRobot(agent.url, engine.memory, confirm_timeout_s=2, sleep=camera_sees))
    p = engine.propose("bring the beaker to the bench")
    assert engine.approve_and_run(p["operation_id"], p["digest"], "me")["outcome"] == "success"


def test_lost_robot_counts_as_stopped(engine):
    robot = MasterPiRobot("http://127.0.0.1:9", engine.memory, timeout_s=0.5)
    assert robot.state()["stopped"]
    engine.set_robot(robot)
    p = engine.propose("bring the beaker to the bench")
    assert engine.approve_and_run(p["operation_id"], p["digest"], "me")["outcome"] == "aborted"
