import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser speech-to-text (Web Speech API). Works in Safari on the iPad and in
 * Chrome; elsewhere `supported` is false and the caller hides the mic button.
 * This is the "talk" input: the phone/iPad does the listening, then the text is
 * sent to POST /commands just like a typed command.
 */
export function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText.trim()) {
        setInterim(finalText.trim());
        onFinalRef.current(finalText.trim());
        setTimeout(() => setInterim(""), 25000);
      } else {
        setInterim(interimText);
      }
    };
    rec.onerror = (ev: any) => {
      setError(ev?.error ? String(ev.error) : "speech error");
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const start = useCallback(() => {
    setError(null);
    try {
      recRef.current?.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  return { supported, listening, interim, error, start, stop };
}
