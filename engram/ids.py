"""Short readable ids and stable digests."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def digest(value: Any) -> str:
    """SHA-256 of the canonical JSON. Used to bind approvals to exact content."""
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()
