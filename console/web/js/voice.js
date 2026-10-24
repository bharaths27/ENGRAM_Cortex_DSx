/* Voice: speaking (Piper on the Pi, else iPad on-device speechSynthesis) and
   hold-to-talk (MediaRecorder -> /stt -> whisper.cpp). Speech never blocks
   motion: everything here is fire and forget. */
(function () {
  const V = { muted: false, speaking: false };
  const q = [];
  let piperOk = true;
  let iosVoice = null;

  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const vs = speechSynthesis.getVoices();
    iosVoice = vs.find(v => /en-(GB|US)/.test(v.lang) && /Daniel|Samantha|Karen|Arthur|Aaron/.test(v.name)) || vs.find(v => /^en/.test(v.lang)) || null;
  }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  V.say = function (text) {
    if (V.muted || !text) return;
    q.push(text);
    if (q.length > 3) q.splice(0, q.length - 3); // drop stale lines, never lag behind reality
    if (!V.speaking) next();
  };
  V.cancel = function () {
    q.length = 0;
    try { speechSynthesis.cancel(); } catch (e) {}
    if (V._audio) { V._audio.pause(); V._audio = null; }
    V.speaking = false;
  };

  function next() {
    const text = q.shift();
    if (!text) { V.speaking = false; return; }
    V.speaking = true;
    if (piperOk) {
      const a = new Audio("/tts?text=" + encodeURIComponent(text));
      V._audio = a;
      let started = false;
      a.onplaying = () => (started = true);
      a.onended = () => next();
      a.onerror = () => { if (!started) { piperOk = false; browserSay(text); } else next(); };
      a.play().catch(() => { piperOk = false; browserSay(text); });
    } else browserSay(text);
  }
  function browserSay(text) {
    if (!("speechSynthesis" in window)) { next(); return; }
    const u = new SpeechSynthesisUtterance(text);
    if (iosVoice) u.voice = iosVoice;
    u.rate = 1.05; u.pitch = 0.95;
    u.onend = () => next();
    u.onerror = () => next();
    speechSynthesis.speak(u);
  }
  V.unlock = function () {
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
  };

  // ---------------- microphone ----------------
  V.micAvailable = () => !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  let rec = null, chunks = [], stream = null, analyser = null, raf = 0;

  V.startRec = async function (waveCanvas) {
    if (!V.micAvailable()) throw new Error(window.isSecureContext ? "MediaRecorder not supported" : "mic needs HTTPS (trusted cert)");
    stream = stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.start();
    const ctx = FX.ctx();
    if (ctx && waveCanvas) {
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser(); analyser.fftSize = 256;
      src.connect(analyser);
      drawWave(waveCanvas);
    }
  };
  V.stopRec = function () {
    return new Promise((resolve) => {
      cancelAnimationFrame(raf);
      if (!rec) return resolve(null);
      rec.onstop = () => {
        const type = rec.mimeType || "audio/mp4";
        resolve({ blob: new Blob(chunks, { type }), ext: /mp4|aac|m4a/.test(type) ? ".m4a" : ".webm" });
        rec = null;
      };
      rec.stop();
    });
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
