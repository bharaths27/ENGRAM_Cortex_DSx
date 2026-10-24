"""ENGRAM Cortex: a robot that learns by writing memory, not weights.

The package is split so each teammate can work on one part:

- memory.py      durable, source backed memory (Bharath)
- capabilities.py the allow listed robot actions (Brian)
- checker.py     deterministic plan validation (shared)
- planner.py     request to JSON plan, rules first, local model optional (Verna)
- executor.py    one step, observe, verify, journal (shared)
- skills.py      experience compiler and approved skill reuse (Bharath)
- prospective.py "when X happens, do Y" commitments (Bharath)
- robot/         robot adapters: fake for laptops, MasterPi for the real robot (Brian)
- api.py         FastAPI server the iPad page talks to (Verna)
"""

__version__ = "0.1.0"
