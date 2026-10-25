// Runs the real console/web/js/voice.js (a plain browser script) in a Node vm
// with fake browser APIs and the real speech controller, so no DOM is needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { makeController, tick } from "./fakes.mjs";

const ROOT = new URL("../../", import.meta.url);
const VOICE_SRC = readFileSync(new URL("console/web/js/voice.js", ROOT), "utf8");

function loadVoice() {
  const h = makeController();
  const log = [];
  const newTurn = h.ctl.newTurn;
  h.ctl.newTurn = () => { log.push("newTurn"); return newTurn(); };
  class FakeRecorder {
    static isTypeSupported(t) { return t === "audio/mp4"; }
    constructor(stream, opts) { this.mimeType = opts && opts.mimeType; }
    start() { log.push("rec.start"); }
    stop() { log.push("rec.stop"); this.onstop(); }
  }
  const win = {
    SPEECH: h.ctl,
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: async () => { log.push("getUserMedia"); return {}; } } },
    MediaRecorder: FakeRecorder,
    FX: { ctx: () => null },
    Blob: class { constructor(parts, o) { this.size = 4000; this.type = o.type; } },
    cancelAnimationFrame() {},
    requestAnimationFrame() {},
    encodeURIComponent,
  };
  win.window = win;
  vm.runInNewContext(VOICE_SRC, win);
  return { V: win.VOICE, h, log };
}

test("push-to-talk start silences the robot before the mic opens", async () => {
  const { V, h, log } = loadVoice();
  V.say("talking");
  assert.equal(h.fetch.calls.length, 1, "robot is mid-line");

  const before = h.ctl.current();
  await V.startRec(null);
  assert.deepEqual(log, ["newTurn", "getUserMedia", "rec.start"]);
  assert.equal(h.ctl.current(), before + 1);
  assert.equal(h.fetch.calls[0].signal.aborted, true, "its /tts download was dropped");
  assert.equal(h.synth.cancelCalls, 1);
});

test("speech is held while the user talks, then plays in the current turn", async () => {
  const { V, h } = loadVoice();
  await V.startRec(null);
  V.say("from an older turn");
  assert.equal(h.fetch.calls.length, 0, "nothing plays over the user");

  await V.stopRec();
  V.say("reply");
  assert.equal(h.fetch.calls.length, 1);
  assert.equal(h.fetch.calls[0].url, "/tts?text=reply");
  h.fetch.respond(0);
  await tick();
  h.audios[0].resolvePlay();
  await tick();
  assert.equal(h.audios[0].paused, false);
});

test("a reply to a turn the user already replaced is dropped", async () => {
  const { V, h } = loadVoice();
  await V.startRec(null);
  await V.stopRec();
  let settle;
  V.track(new Promise((r) => { settle = r; })); // turn 1's request is out
  await V.startRec(null);                        // the user barges in
  await V.stopRec();
  V.say("turn 1's plan is ready");               // lands after the barge-in
  assert.equal(h.fetch.calls.length, 0);
  assert.equal(h.synth.spoken.length, 0);

  settle();                                      // turn 1 is over; later lines play
  await tick();
  h.clock.t += 5000;
  V.say("turn 2's reply");
  assert.equal(h.fetch.calls.length, 1, "the dropped line did not wedge the queue");
  assert.equal(h.fetch.calls[0].url, "/tts?text=turn%202's%20reply");
});

test("Piper refusing to play falls back to on-device speech in the same turn", async () => {
  const { V, h } = loadVoice();
  V.say("hello");
  h.fetch.respond(0, { ok: false });
  await tick();
  assert.equal(h.synth.spoken.length, 1);
  assert.equal(h.synth.spoken[0].text, "hello");
  h.synth.spoken[0].onend();
  await tick();
  assert.equal(V.speaking, false);
});

test("index.html loads the controller before voice.js and app.js", () => {
  const html = readFileSync(new URL("console/web/index.html", ROOT), "utf8");
  const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attrs, body]) => ({ attrs, body }));
  const ctl = tags.findIndex((t) => /type="module"/.test(t.attrs) && /speech_epoch\.mjs/.test(t.body));
  const voice = tags.findIndex((t) => /voice\.js/.test(t.attrs));
  const app = tags.findIndex((t) => /app\.js/.test(t.attrs));
  assert.ok(ctl >= 0 && ctl < voice && voice < app, "order: controller, voice.js, app.js");
  // A classic script without defer would run before the module and find no window.SPEECH.
  assert.match(tags[voice].attrs, /\bdefer\b/);
  assert.match(tags[app].attrs, /\bdefer\b/);
});
