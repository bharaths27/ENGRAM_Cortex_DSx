from engram.hashes import hash_models


def test_hashes_detect_change(tmp_path):
    f = tmp_path / "planner.gguf"
    f.write_bytes(b"weights")
    before = hash_models(tmp_path)
    assert hash_models(tmp_path) == before
    f.write_bytes(b"changed")
    assert hash_models(tmp_path) != before
    assert hash_models(tmp_path / "missing") == {}
