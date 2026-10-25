/* Voice: speaking (Piper on the Pi, else iPad on-device speechSynthesis) and
   hold-to-talk (MediaRecorder -> /stt -> whisper.cpp). Speech never blocks
   motion: everything here is fire and forget.
   All playback goes through window.SPEECH (speech_epoch.mjs, set up in
   index.html before this script runs): pressing talk starts a new turn, which
   silences the robot at once, and a line from an older turn never plays. */
(function () {
  const V = { muted: false, speaking: false, listening: false };
  const ctl = window.SPEECH;
  const q = [];   // { text, epoch }
  let piperOk = true;
  let iosVoice = null;

  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const vs = speechSynthesis.getVoices();
    iosVoice = vs.find(v => /en-(GB|US)/.test(v.lang) && /Daniel|Samantha|Karen|Arthur|Aaron/.test(v.name)) || vs.find(v => /^en/.test(v.lang)) || null;
  }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  V.say = function (text) {
    if (V.muted || !text || V.listening) return; // the user has the floor
    const epoch = ctl.incomingEpoch();
    if (epoch !== ctl.current()) return;          // reply to a turn the user already replaced
    q.push({ text, epoch });
    if (q.length > 3) q.splice(0, q.length - 3); // drop stale lines, never lag behind reality
    if (!V.speaking) next();
  };
  V.cancel = function () {
    q.length = 0;
    ctl.stop();
    V.speaking = false;
  };
  // Push-to-talk start: the robot stops talking now, before the mic opens.
  V.newTurn = function () {
    q.length = 0;
    V.speaking = false;
    return ctl.newTurn();
  };
  // Tag each request with the turn that produced it, so its late speech can be
  // told apart. The turn is passed explicitly, never read when the request goes out.
  V.turn = () => ctl.current();
  V.track = (promise, turn) => ctl.track(promise, turn);

  // A "stale" outcome means a newer turn or a stop owns the queue: do nothing.
  function next() {
    const item = q.shift();
    if (!item) { V.speaking = false; return; }
    V.speaking = true;
    if (piperOk) {
      ctl.playUrl(item.epoch, "/tts?text=" + encodeURIComponent(item.text)).then((r) => {
        if (r === "failed") { piperOk = false; browserSay(item); }
        else if (r !== "stale") next();
      });
    } else browserSay(item);
  }
  function browserSay(item) {
    ctl.speakText(item.epoch, item.text, { voice: iosVoice, rate: 1.05, pitch: 0.95 }).then((r) => {
      if (r !== "stale") next();
    });
  }
  V.unlock = function () {
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
  };

  // ---------------- microphone ----------------
  V.micAvailable = () => !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  // rec = { mr, chunks, turn } for the recording in progress. Each recording
  // keeps its own chunks and turn, so a new press while the last recorder is
  // still stopping cannot mix the two up.
  let rec = null, stream = null, analyser = null, raf = 0;

  V.startRec = async function (waveCanvas) {
    if (!V.micAvailable()) throw new Error(window.isSecureContext ? "MediaRecorder not supported" : "mic needs HTTPS (trusted cert)");
    const turn = V.newTurn();
    V.listening = true;
    try {
      stream = stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      mr.ondataavailable = e => e.data.size && chunks.push(e.data);
      mr.start();
      rec = { mr, chunks, turn };
    } catch (err) { V.listening = false; throw err; }
    const ctx = FX.ctx();
    if (ctx && waveCanvas) {
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser(); analyser.fftSize = 256;
      src.connect(analyser);
      drawWave(waveCanvas);
    }
  };
  // Resolves { blob, ext, turn }: turn is the one this recording started.
  V.stopRec = function () {
    V.listening = false;
    cancelAnimationFrame(raf);
    const r = rec;
    rec = null;
    return new Promise((resolve) => {
      if (!r) return resolve(null);
      r.mr.onstop = () => {
        const type = r.mr.mimeType || "audio/mp4";
        resolve({ blob: new Blob(r.chunks, { type }), ext: /mp4|aac|m4a/.test(type) ? ".m4a" : ".webm", turn: r.turn });
      };
      r.mr.stop();
    });
  };
  // POST a stopped recording to /stt, tagged with the turn that recorded it.
  V.transcribe = function (a) {
    const fd = new FormData();
    fd.append("audio", a.blob, "speech" + a.ext);
    fd.append("auto", "1");
    return V.track(fetch("/stt", { method: "POST", body: fd }), a.turn);
  };
  function drawWave(c) {
    const g = c.getContext("2d");
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      c.width = c.clientWidth * 2; c.height = c.clientHeight * 2;
      analyser.getByteTimeDomainData(buf);
      g.clearRect(0, 0, c.width, c.height);
      g.strokeStyle = "rgba(255,59,78,.8)"; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i < buf.length; i++) {
        const x = (i / buf.length) * c.width, y = (buf[i] / 255) * c.height;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      raf = requestAnimationFrame(loop);
    };
    loop();
  }
  window.VOICE = V;
})();
