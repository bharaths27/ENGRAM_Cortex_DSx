# Tech

- Python 3.11 or newer, FastAPI, SQLite (WAL, FTS5), pydantic.
- Tests: pytest plus hypothesis for property based tests. Run `python -m pytest`.
- Runs on the Mac first. The Jetson is only the brain if the full loop works on it by the 2 PM check.
- Robot: Hiwonder MasterPi on a Raspberry Pi 5. Adapter in engram/robot/masterpi.py.
- Overhead Logitech C920s reads ArUco tags (DICT_4X4_50) to know where objects are.
- Optional local planner model through llama.cpp's HTTP server. The rule planner is always the fallback.
- iPad shows the page built in Lovable, served by the same FastAPI app (ENGRAM_UI).
- No cloud calls at run time.
