# Product: ENGRAM Cortex

A small lab robot that learns by writing memory, not by changing model weights.

Demo story: a student teaches the robot a lab procedure (a made up SOP). The
robot reads it, finds the rule "safety goggles before Sample B", cites where it
learned it, plans, waits for approval, and fetches the items. After one good
run it saves the run as a skill. Once a person approves that skill, the next
identical request runs without calling the planner at all.

Proof points we show judges:
- Model file fingerprints are the same before and after learning.
- First run uses the planner; second run uses the approved skill (0 planner calls).
- Every action is in the journal, and every rule links to its source text.

All demo data (samples, SOPs, people) is made up.
