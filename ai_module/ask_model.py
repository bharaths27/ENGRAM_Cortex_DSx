"""Ask the local Qwen3 1.7B model on star-pi. Standard library only.

    python3 ask_model.py "Say hello in one sentence."
    python3 ask_model.py --json "turn left 90 degrees"     # a robot plan with Brian's op names
"""

import argparse
import json
import re
import time
import urllib.request

OPS = ["stop", "drive_bounded", "turn_bounded", "gripper_open", "gripper_close", "arm_pose",
       "approach_tag", "pick_tagged", "place_at", "observe"]
PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "goal": {"type": "string"},
        "steps": {"type": "array", "maxItems": 8, "items": {
            "type": "object",
            "properties": {"op": {"type": "string", "enum": OPS}, "args": {"type": "object"}},
            "required": ["op", "args"]}},
    },
    "required": ["goal", "steps"],
}


def ask(prompt: str, as_json: bool, url: str) -> tuple[str, float]:
    body = {"prompt": prompt + " /no_think\n", "n_predict": 256, "temperature": 0}
    if as_json:
        body["prompt"] = ("You control a small robot. Reply with JSON only. Allowed ops: " + ", ".join(OPS) +
                          ". drive_bounded args {distance_m}, turn_bounded args {angle_deg} (+ is left), "
                          "arm_pose args {pose}: home, reach or carry.\nRequest: " + prompt + " /no_think\nJSON:")
        body["json_schema"] = PLAN_SCHEMA
    t0 = time.time()
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        text = json.loads(r.read())["content"]
    return re.sub(r"<think>.*?(</think>|$)", "", text, flags=re.S).strip(), time.time() - t0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt")
    ap.add_argument("--json", action="store_true", help="return a robot plan")
    ap.add_argument("--url", default="http://127.0.0.1:8080/completion")
    a = ap.parse_args()
    text, secs = ask(a.prompt, a.json, a.url)
    print(text)
    print(f"({secs:.1f} s, Qwen3 1.7B on this Pi, offline)")


if __name__ == "__main__":
    main()
