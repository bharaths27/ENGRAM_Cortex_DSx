from hypothesis import HealthCheck, given, settings, strategies as st

from engram.capabilities import CAPABILITIES, MAX_DRIVE_M
from engram.checker import check_plan


def check(engine, steps):
    return check_plan({"steps": steps}, engine.memory, engine.zones)


def test_unknown_action_rejected(engine):
    res = check(engine, [{"op": "set_motor_pwm", "args": {"left": 255}}])
    assert not res.ok and "not an allowed action" in res.errors[0]


def test_drive_past_bound_rejected(engine):
    assert not check(engine, [{"op": "drive_bounded", "args": {"distance_m": MAX_DRIVE_M + 0.1}}]).ok
    assert check(engine, [{"op": "drive_bounded", "args": {"distance_m": MAX_DRIVE_M}}]).ok


def test_wrong_arg_types_rejected(engine):
    assert not check(engine, [{"op": "turn_bounded", "args": {"degrees": "90"}}]).ok
    assert not check(engine, [{"op": "turn_bounded", "args": {"degrees": True}}]).ok


def test_rule_order_enforced(taught):
    bad = [{"op": "pick_tagged_object", "args": {"object_id": "sample_b"}},
           {"op": "place_at_zone", "args": {"zone": "bench"}}]
    res = check(taught, bad)
    assert not res.ok and "must come before" in res.errors[0]


def test_place_without_holding_rejected(engine):
    assert not check(engine, [{"op": "place_at_zone", "args": {"zone": "bench"}}]).ok


def test_stale_pick_needs_a_look_first(engine):
    later = engine.memory.object_state("beaker").last_seen_at + engine.memory.freshness_s + 5
    pick = [{"op": "pick_tagged_object", "args": {"object_id": "beaker"}}]
    assert not check_plan({"steps": pick}, engine.memory, engine.zones, at=later).ok
    look = [{"op": "locate_tag", "args": {"object_id": "beaker"}}] + pick
    assert check_plan({"steps": look}, engine.memory, engine.zones, at=later).ok


json_values = st.recursive(
    st.none() | st.booleans() | st.integers() | st.floats(allow_nan=False) | st.text(max_size=20),
    lambda kids: st.lists(kids, max_size=3) | st.dictionaries(st.text(max_size=10), kids, max_size=3),
    max_leaves=10,
)


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(plan=json_values)
def test_checker_never_crashes_on_garbage(engine, plan):
    res = check_plan(plan, engine.memory, engine.zones)
    assert isinstance(res.ok, bool)


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(op=st.text(min_size=1, max_size=30).filter(lambda s: s not in CAPABILITIES), args=st.dictionaries(st.text(max_size=8), json_values, max_size=3))
def test_any_op_not_on_allowlist_is_rejected(engine, op, args):
    assert not check(engine, [{"op": op, "args": args}]).ok


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(d=st.floats(allow_nan=False, allow_infinity=False, min_value=-100, max_value=100))
def test_drive_bound_property(engine, d):
    assert check(engine, [{"op": "drive_bounded", "args": {"distance_m": d}}]).ok == (abs(d) <= MAX_DRIVE_M)
