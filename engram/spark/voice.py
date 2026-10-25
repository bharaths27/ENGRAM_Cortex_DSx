"""Speculative intent while the user is still speaking, without ever acting on a guess.

The SpeculationGate enforces these rules:

1. A partial transcript may only PREPARE: ask the intent model what it means and pre-fetch
   the memory bundle. on_partial never returns a proposal, and the gate holds no engine.
2. Every prediction is bound to (utterance, revision, exact text, memory-context version) and
   an expiry. A result is kept only if, when it arrives, it still describes what the user has
   said: same utterance, same text with no change since its revision, same context, not
   expired. Anything else is dropped.
3. At most ONE intent request is in flight. Newer partials overwrite a single pending slot
   (newest wins); there is no queue.
4. on_final reuses a still-valid prediction whose text equals the final text, so the same
   text is never sent twice; otherwise it classifies the final text.
5. A final that negates ("don't"), defers ("after calibration finishes") or corrects ("no,
   I mean") never becomes an immediate action. Negation and correction mean no action; a
   deferral becomes a "When <event>, <task>" commitment for the existing prospective path, or
   a request to rephrase. Local word checks and the model's flags are combined, and either one
   is enough to block.
6. STOP words are detected locally and returned at once, for partials and finals, without
   asking the intent model. A false stop is safe; a missed one is not.

Utterance ids and revisions are integers that only grow. Revision numbers are per utterance.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Hashable

from ..planner import FUTURE_HINTS, NEGATION
from ..prospective import is_question, normalize, parse_when
from .intent_client import IntentDecision, IntentError
from .presets import PRESETS

DEFAULT_TTL_S = 8.0          # a prediction older than this (from when it was asked) is not reused
DEFAULT_FINAL_WAIT_S = 6.0   # how long on_final waits for the request already in flight

STOP_WORDS = re.compile(r"\b(stop|halt|freeze|abort|emergency)\b", re.IGNORECASE)
CORRECTION = re.compile(
    r"\b(i mean|i meant|scratch that|never ?mind|on second thought|no wait|wait no|sorry)\b"
    r"|(?:^|[,;.!?]\s*)no\b",
    re.IGNORECASE,
)
# "<task> after <event>": the deferral at the end, which parse_when (deferral first) does not read.
TRAILING_WHEN = re.compile(
    r"^(?P<task>.+?)[\s,]+(?:when|whenever|once|after|as soon as)\s+(?P<event>.+?)[\s.!]*$", re.IGNORECASE
)

Classifier = Callable[[str, bool], IntentDecision]   # (text, partial) -> decision; raises on failure
log = logging.getLogger("engram.spark.voice")


@dataclass(frozen=True)
class Thresholds:
    """EXPERIMENTAL starting guesses, not measured. Tune on recorded utterances before relying on them.

    These compare against the intent model's answer probabilities, which are not transcription
    accuracy. Blocking is deliberately easier than acting: a hint of "don't", "later" or "I mean"
    stops an immediate action, while acting needs the model to be fairly sure.
    """

    preset: float = 0.6     # minimum confidence in the chosen preset
    ready: float = 0.6      # minimum P(complete enough to act on)
    directed: float = 0.5   # minimum P(addressed to the robot)
    block: float = 0.35     # P(negated | future | correction) at or above this blocks immediate action


@dataclass(frozen=True)
class Key:
    """What one intent request is about. A result is only used while this still matches."""

    utterance: int
    revision: int
    text: str
    context: Hashable
    expires_at: float


@dataclass(frozen=True)
class Prediction:
    key: Key
    decision: IntentDecision
    bundle: Any = None


@dataclass(frozen=True)
class GateResult:
    # partial: stop | ignored | dispatched | queued | unchanged
    # final:   stop | ignored | propose | schedule | clarify | none
    action: str
    utterance: int
    revision: int
    text: str
    preset: str | None = None
    reason: str = ""
    decision: IntentDecision | None = None
    bundle: Any = None
    commitment: str | None = None   # "When <event>, <task>" for action == "schedule"
    reused: bool = False


@dataclass
class GateStats:
    requests: int = 0        # intent requests started
    coalesced: int = 0       # pending partials overwritten by a newer one before being sent
    stale_dropped: int = 0   # results thrown away because utterance, revision, text or context moved on
    expired: int = 0         # predictions too old to reuse
    reused: int = 0          # finals answered by a prediction, with no new request
    errors: int = 0          # intent requests that failed


def _clean(text: str) -> str:
    return " ".join(str(text).split())


def _check_ids(utterance: int, revision: int) -> None:
    for name, v in (("utterance", utterance), ("revision", revision)):
        if isinstance(v, bool) or not isinstance(v, int) or v < 0:
            raise ValueError(f"{name} must be a non-negative int")


def is_stop(text: str) -> bool:
    return bool(STOP_WORDS.search(text))


def future_event(text: str) -> str | None:
    """The event in "When <event>, <task>" or "<task> after <event>", normalized; None if there is none."""
    when = parse_when(text)
    if when:
        return when[0] or None
    if is_question(text):
        return None
    m = TRAILING_WHEN.match(text)
    return (normalize(m.group("event")) or None) if m else None


def _spawn_thread(job: Callable[[], None]) -> None:
    threading.Thread(target=job, name="spark-intent", daemon=True).start()


class SpeculationGate:
    def __init__(self, classifier: Classifier, *, prefetch: Callable[[str], Any] | None = None,
                 context_version: Callable[[], Hashable] = lambda: 0, thresholds: Thresholds | None = None,
                 ttl_s: float = DEFAULT_TTL_S, final_wait_s: float = DEFAULT_FINAL_WAIT_S,
                 clock: Callable[[], float] = time.monotonic,
                 spawn: Callable[[Callable[[], None]], None] = _spawn_thread):
        self._classifier = classifier
        self._prefetch = prefetch
        self._context = context_version
        self.thresholds = thresholds or Thresholds()
        self._ttl_s = ttl_s
        self._final_wait_s = final_wait_s
        self._clock = clock
        self._spawn = spawn
        self._cv = threading.Condition()
        self._utt: int | None = None
        self._rev = -1
        self._text = ""
        self._text_since = -1          # revision at which the current text first appeared
        self._final = False
        self._in_flight: Key | None = None
        self._pending: tuple[int, int, str] | None = None
        self._pred: Prediction | None = None
        self.stats = GateStats()

    # ---- what callers may look at ------------------------------------------

    @property
    def in_flight(self) -> Key | None:
        with self._cv:
            return self._in_flight

    @property
    def pending(self) -> tuple[int, int, str] | None:
        with self._cv:
            return self._pending

    def prepared(self) -> Prediction | None:
        """The preset being prepared for what the user has said so far, if any. Never a permission."""
        with self._cv:
            p = self._pred
            if p and self._valid(p.key) and self._actionable(p.key.text, p.decision):
                return p
            return None

    def wait_idle(self, timeout_s: float = 5.0) -> bool:
        deadline = time.monotonic() + timeout_s
        with self._cv:
            while self._in_flight is not None or self._pending is not None:
                left = deadline - time.monotonic()
                if left <= 0:
                    return False
                self._cv.wait(left)
            return True

    # ---- transcript events ---------------------------------------------------

    def on_partial(self, utterance: int, revision: int, text: str) -> GateResult:
        text = _clean(text)
        if is_stop(text):  # before any bookkeeping, so nothing can get in the way of a stop
            return GateResult("stop", utterance, revision, text, reason="stop word heard")
        _check_ids(utterance, revision)
        with self._cv:
            why = self._observe(utterance, revision, text)
            if why:
                return GateResult("ignored", utterance, revision, text, reason=why)
            if not text or (self._pred and self._valid(self._pred.key)) or \
                    (self._in_flight and self._current(self._in_flight)):
                return GateResult("unchanged", utterance, revision, text)
            if self._in_flight is not None:
                if self._pending is not None:
                    self.stats.coalesced += 1
                self._pending = (utterance, revision, text)
                return GateResult("queued", utterance, revision, text)
            key = self._dispatch()
        self._spawn(lambda: self._run(key))
        return GateResult("dispatched", utterance, revision, text)

    def on_final(self, utterance: int, revision: int, text: str) -> GateResult:
        text = _clean(text)
        if is_stop(text):  # before any bookkeeping, so nothing can get in the way of a stop
            return GateResult("stop", utterance, revision, text, reason="stop word heard")
        _check_ids(utterance, revision)
        deadline = time.monotonic() + self._final_wait_s
        with self._cv:
            why = self._observe(utterance, revision, text)
            if why:
                return GateResult("ignored", utterance, revision, text, reason=why)
            self._final, self._pending = True, None
            # Single flight: wait for the request already out. If it is about this same text, reuse its answer.
            while self._in_flight is not None and self._utt == utterance:
                left = deadline - time.monotonic()
                if left <= 0:
                    return GateResult("clarify", utterance, revision, text,
                                      reason="The intent model did not answer in time. Please say it again.")
                self._cv.wait(left)
            if self._utt != utterance:
                return GateResult("ignored", utterance, revision, text, reason="a newer utterance started")
            if not text:
                return GateResult("none", utterance, revision, text, reason="I didn't catch anything.")
            pred = self._pred if self._pred and self._current(self._pred.key) else None
            if pred and self._clock() >= pred.key.expires_at:
                self.stats.expired += 1
                pred = None
            if pred:
                self.stats.reused += 1
                return self._decide(pred.key, pred.decision, pred.bundle, reused=True)
            key = self._dispatch()
        decision, bundle = self._ask(key, partial=False)
        with self._cv:
            self._in_flight = None
            current = self._current(key)
            nxt = self._take_pending()   # a newer utterance may have queued a partial meanwhile
            self._cv.notify_all()
        if nxt is not None:
            self._spawn(lambda: self._run(nxt))
        if decision is None:
            return GateResult("clarify", utterance, revision, text,
                              reason="I could not work out what you meant. Please say it again.")
        if not current:
            with self._cv:
                self.stats.stale_dropped += 1
            return GateResult("none", utterance, revision, text,
                              reason="Things changed while I was listening. Please say it again.")
        return self._decide(key, decision, bundle, reused=False)

    # ---- internals (lock held unless noted) ------------------------------------

    def _observe(self, utterance: int, revision: int, text: str) -> str | None:
        """Record a transcript revision. Returns why it was ignored, or None."""
        if self._utt is not None and utterance < self._utt:
            return "older utterance"
        if utterance != self._utt:
            self._utt, self._rev, self._text, self._text_since, self._final = utterance, -1, "", -1, False
            self._pending, self._pred = None, None
        if self._final:
            return "utterance already final"
        if revision < self._rev or (revision == self._rev and text != self._text):
            return "older revision"
        if text != self._text:
            self._text, self._text_since = text, revision
        self._rev = revision
        return None

    def _current(self, key: Key) -> bool:
        """Does this key still describe what the user has said, against the current memory context?"""
        return (key.utterance == self._utt and key.text == self._text
                and self._text_since <= key.revision <= self._rev
                and key.context == self._context())

    def _valid(self, key: Key) -> bool:
        return self._current(key) and self._clock() < key.expires_at

    def _dispatch(self) -> Key:
        key = Key(self._utt, self._rev, self._text, self._context(), self._clock() + self._ttl_s)
        self._in_flight = key
        self.stats.requests += 1
        return key

    def _flags(self, text: str, d: IntentDecision) -> tuple[bool, bool, bool]:
        """(negated, corrected, future): the local word checks OR the model's flags."""
        low = text.lower().replace("\u2019", "'")
        th = self.thresholds
        negated = bool(NEGATION.search(low)) or d.negated >= th.block
        corrected = bool(CORRECTION.search(low)) or d.correction >= th.block
        future = bool(FUTURE_HINTS.search(low)) or parse_when(text) is not None or d.future >= th.block
        return negated, corrected, future

    def _preset_ok(self, d: IntentDecision) -> bool:
        th = self.thresholds
        return d.preset in PRESETS and d.confidence >= th.preset and d.directed >= th.directed

    def _actionable(self, text: str, d: IntentDecision) -> bool:
        """Worth preparing: a confident, complete, directed preset with nothing blocking it."""
        return self._preset_ok(d) and d.ready >= self.thresholds.ready and not any(self._flags(text, d))

    def _ask(self, key: Key, partial: bool) -> tuple[IntentDecision | None, Any]:
        """Call the intent model (lock NOT held). Returns (None, None) on any failure."""
        try:
            decision = self._classifier(key.text, partial)
            if not isinstance(decision, IntentDecision):
                raise IntentError("classifier returned no decision")
        except Exception as e:
            log.warning("intent request failed: %s", type(e).__name__)
            with self._cv:
                self.stats.errors += 1
            return None, None
        bundle = None
        if self._prefetch is not None and self._actionable(key.text, decision):
            try:
                bundle = self._prefetch(key.text)
            except Exception as e:
                log.warning("memory prefetch failed: %s", type(e).__name__)
        return decision, bundle

    def _run(self, key: Key) -> None:
        """Worker for one partial request (lock NOT held on entry)."""
        decision, bundle = self._ask(key, partial=True)
        nxt: Key | None = None
        with self._cv:
            self._in_flight = None
            if decision is not None:
                if self._valid(key):
                    self._pred = Prediction(key, decision, bundle)
                else:
                    self.stats.stale_dropped += 1
            nxt = self._take_pending()
            self._cv.notify_all()
        if nxt is not None:
            self._spawn(lambda: self._run(nxt))

    def _take_pending(self) -> Key | None:
        p, self._pending = self._pending, None
        if p is None or self._final or p[0] != self._utt or p[2] != self._text:
            return None
        if self._pred and self._valid(self._pred.key):
            return None
        return self._dispatch()

    def _decide(self, key: Key, d: IntentDecision, bundle: Any, reused: bool) -> GateResult:
        """Turn the decision for a FINAL text into what should happen. Pure: touches no robot or engine."""
        base = {"utterance": key.utterance, "revision": key.revision, "text": key.text, "decision": d,
                "reused": reused}
        negated, corrected, future = self._flags(key.text, d)
        if negated:
            return GateResult("none", reason="You said not to, so nothing will move.", **base)
        if corrected:
            return GateResult("none", reason="You corrected yourself, so nothing will move. Please say it again.",
                              **base)
        if future:
            event = future_event(key.text)
            if self._preset_ok(d) and event:
                return GateResult("schedule", preset=d.preset, commitment=f"When {event}, {PRESETS[d.preset].request}",
                                  **base)
            return GateResult("clarify", reason="That sounds like something for later. "
                                                "Say it as 'When <event>, <task>'.", **base)
        if not self._preset_ok(d) or d.ready < self.thresholds.ready:
            return GateResult("none", reason="That is not one of the voice presets.", **base)
        return GateResult("propose", preset=d.preset, bundle=bundle, **base)
