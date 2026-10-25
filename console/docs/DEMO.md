# Verna's demo checklist and script

## Before you record (do these in order)
1. On the Pi, while it still has internet: `./scripts/setup_pi.sh` (about 10 minutes).
2. Start the Pi hotspot: `./scripts/hotspot.sh`. Unplug Ethernet. Join `ENGRAM-LAB` on the iPad.
3. Start the console pointed at the real robot and memory:
   `ENGRAM_ROBOT_URL=http://127.0.0.1:<brian port> ENGRAM_MEMORY_URL=http://127.0.0.1:<bharath port> ./scripts/run.sh`
4. iPad: open `http://10.42.0.1:8000/ca.crt` → install profile → Settings › General › About ›
   Certificate Trust Settings → turn on ENGRAM Local CA. Then open `https://10.42.0.1:8443`.
5. Tap ENGAGE. Check the chips: UPSTREAM shows **OFFLINE ✓**, ROBOT is green, there is **no SIMULATOR chip**.
   If you see SIMULATOR, you are on mock data: do not record that as the real robot.
6. Turn the iPad volume up. Test STOP once before recording.

## Script for your segment (about 75 seconds of the 3-minute video)
1. **Offline proof (5 s).** Show the UPSTREAM OFFLINE ✓ chip and the live camera with tag brackets.
2. **Judge teaches a rule (10 s).** Tap ＋RULE, paste the judge's rule (e.g. "Before inventory, the blue marker
   block must go to Zone A"), set tag/zone if the auto parse misses. Banner: RULE LEARNED, cited by source ID.
3. **Unfamiliar request (15 s).** Say or type "get ready for inventory". Point at: memory bundle with the rule
   citation, the four allowlisted steps, the permission preview, the digest, the countdown. Tap a citation to
   open the original passage.
4. **Approve (15 s).** Hold to approve. Camera shows TARGET LOCK on the tag while it approaches. Steps tick green.
   If the grasp can't be sensed, the HUD asks you to verify. Answer honestly.
5. **Safety (10 s).** Type the unsafe test → ABSTAINED. Put a hand or box in front of the robot during motion → LIDAR VETO.
   Tap STOP → E-STOP.
6. **Learning (15 s).** NEW SKILL PROPOSED appears. Open REVIEW, show provenance, approve. Rephrase the request
   ("bring the red cup to zone B"). The plan comes back with ◆ SKILL REUSED and planner bypassed. Scoreboard shows
   real measured timings for run 1 vs run 2.
7. **Close (5 s).** MODEL chip: same SHA-256 before and after. Nothing was retrained.

## Things to say out loud (honest framing)
- "Nothing moves until a human holds approve, and the approval is bound to the exact plan shown."
- "The robot never reports success from the AI's words, only from a sensor or from me."
- "It learned a new rule and a new skill with the model weights unchanged; here's the hash."
- Do not say the robot "understands" or is "certain". Say it "found a cited rule" and "verified with the camera".

## If something breaks
| Problem | Fallback (activate after 45 min blocked, tell Deniz) |
|---|---|
| Robot API not ready | `ENGRAM_CAMERA=opencv:0` for a real camera; robot steps will fail honestly |
| Memory API not ready | leave `ENGRAM_MEMORY_URL=mock` (sample SOP); say so in the write-up |
| Mic won't work | type. The typed box always works. Voice out still uses the iPad voice |
| Piper won't install | iPad on-device voice speaks automatically, nothing to do |
| Grasp unreliable | demo "find the vial" + approach only (navigate and observe fallback) |
