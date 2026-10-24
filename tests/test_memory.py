from conftest import ROOT


def test_search_returns_cited_chunk(taught):
    hits = taught.memory.search("handling Sample B safely")
    assert hits
    top = taught.memory.chunk(hits[0].chunk_id)
    text = (ROOT / "fixtures/lab/SOP_004.md").read_text()
    assert text[top["start_char"]:top["end_char"]] == top["text"]
    assert top["section"] == "PPE"


def test_rule_is_learned_with_source(taught):
    rules = [f for f in taught.memory.current_facts() if f["predicate"] == "requires_before"]
    assert [(r["subject"], r["object"]) for r in rules] == [("sample_b", "goggles")]
    assert rules[0]["chunk_id"]


def test_new_assertion_supersedes_but_keeps_history(engine):
    engine.memory.assert_fact("sample_a", "hazard", "none")
    engine.memory.assert_fact("sample_a", "hazard", "irritant")
    assert [f["object"] for f in engine.memory.current_facts("sample_a")] == ["irritant"]
    assert len(engine.memory.fact_history("sample_a", "hazard")) == 2


def test_stale_object_reported_as_last_seen(engine):
    obj = engine.memory.object_state("beaker")
    later = obj.last_seen_at + engine.memory.freshness_s + 1
    stale = engine.memory.object_state("beaker", at=later)
    assert stale.stale
    assert "last observed at shelf_B" in stale.describe()


def test_bundle_says_when_nothing_found(engine):
    bundle = engine.memory.retrieve_memory_bundle("calibrate the spectrometer")
    assert "no source found for this request" in bundle.missing
