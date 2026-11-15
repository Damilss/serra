"""Browser page for working with the mic: record takes, and test the classifier live.

    uv run dev_ui.py               # opens http://localhost:8765

Record: pick a class, one button starts and stops. Same takes as record.py (24-bit,
16 kHz WAV in data/recordings/<class>/).
Test: shows what the classifier on the Pico hears and logs every alert it raises. It can
also run the same model on this computer's mic, for showing it off without a Pico: that
path uses the PC's copy of the model (out/serra.tflite) and a mic the model was not
trained on, so treat it as a demo, not a measurement.

The two need different firmware (firmware/tools/mic_capture and classifier_bench). The
Record / Test switch flashes the right one with picotool, so both must be built first;
rebuild classifier_bench after every train.py run so the board has the current model.

Space starts and stops. Keys 1-5 pick the class.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import threading
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import serial
import soundfile as sf

from config import ALERT_CLASSES, CLASSES, MODEL_DIR, OUT, RECORDINGS, SAMPLE_RATE
from record import FULL_SCALE, PACKET_SAMPLES, find_port, packets

TOOLS = MODEL_DIR.parent / "firmware" / "tools"
FIRMWARE = {
    "record": TOOLS / "mic_capture" / "build" / "mic_capture.uf2",
    "test": TOOLS / "classifier_bench" / "build" / "classifier_bench.uf2",
}


class Recorder:
    """Reads the Pico all the time (so the meter is live) and keeps samples while recording."""

    def __init__(self, port: str | None) -> None:
        self.port_name = port
        self.lock = threading.Lock()
        self.error = "Connecting to the Pico..."
        self.peak = self.rms = -120.0
        self.recording = False
        self.label = ""
        self.name = ""
        self.limit = 0.0
        self.chunks: list[np.ndarray] = []
        self.samples = 0
        self.dropped = 0
        self.last = ""  # path of the take saved last, relative to RECORDINGS
        self.message = ""
        # Which firmware the Pico runs ("record", "test", or "" while unknown or flashing)
        # and which one the page wants.
        self.mode = ""
        self.want = "record"
        # Test mode.
        self.listening = False
        self.scores = [0] * len(CLASSES)
        self.ran = False
        self.level = -120.0
        self.alerts: list[dict] = []
        self.steps = self.inferences = 0
        self.source = "pico"  # or "mac": the browser's mic, scored on this computer
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        while True:
            try:
                port = serial.Serial(self.port_name or find_port(), timeout=2)
                port.reset_input_buffer()
                running = self._sniff(port)
                if running != self.want:
                    port.close()
                    self._flash(self.want)
                    continue
                with self.lock:
                    self.mode, self.error = running, ""
                if running == "record":
                    self._record_loop(port)
                else:
                    self._test_loop(port)
                port.close()
                with self.lock:
                    self.mode = ""
            except (SystemExit, serial.SerialException, OSError) as e:
                with self.lock:
                    self.mode = ""
                    self.error = str(e) or "Lost the Pico."
                    if self.recording:
                        self._save()
                time.sleep(1)

    def _sniff(self, port: serial.Serial) -> str:
        """Which firmware is talking: mic_capture sends "SRA1" packets, classifier_bench text."""
        data = b""
        end = time.monotonic() + 4
        while time.monotonic() < end:
            data += port.read(256)
            if b"SRA1" in data:
                return "record"
            if b"init " in data or b"\nw " in data or b"arena " in data:
                return "test"
        return ""

    def _flash(self, mode: str) -> None:
        uf2 = FIRMWARE[mode]
        if not uf2.exists():
            with self.lock:
                self.error = f"{uf2.relative_to(MODEL_DIR.parent)} is not built yet."
            time.sleep(2)
            return
        with self.lock:
            self.error = f"Flashing the {mode} firmware..."
        result = subprocess.run(
            ["picotool", "load", "-x", str(uf2), "-f"], capture_output=True, text=True
        )
        if result.returncode != 0:
            with self.lock:
                self.error = "picotool failed: " + (result.stdout + result.stderr).strip()[-200:]
        time.sleep(3)  # let the Pico come back as a serial port

    def _record_loop(self, port: serial.Serial) -> None:
        expected = None
        recent: list[np.ndarray] = []
        for index, samples in packets(port):
            with self.lock:
                if self.want != "record" and not self.recording:
                    return
                if self.recording:
                    if expected is not None and index != expected:
                        self.dropped += (index - expected) % (1 << 32)
                    self.chunks.append(samples)
                    self.samples += len(samples)
                    if self.limit and self.samples >= self.limit * SAMPLE_RATE:
                        self._save()
            expected = index + PACKET_SAMPLES
            recent.append(samples)
            if len(recent) * PACKET_SAMPLES >= SAMPLE_RATE // 10:
                block = np.concatenate(recent).astype(np.float64)
                block -= block.mean()
                recent = []
                self.peak = 20 * math.log10(max(1.0, np.abs(block).max()) / FULL_SCALE)
                self.rms = 20 * math.log10(max(1.0, np.sqrt(np.mean(block**2))) / FULL_SCALE)

    def _test_loop(self, port: serial.Serial) -> None:
        """Lines from classifier_bench: see firmware/tools/classifier_bench/main.c."""
        quiet = 0
        while self.want == "test":
            line = port.readline().decode(errors="replace").split()
            if not line:
                quiet += 1
                if quiet >= 3:
                    raise OSError("The Pico stopped sending.")
                continue
            quiet = 0
            try:
                values = [int(v) for v in line[1:]]
            except ValueError:
                continue
            with self.lock:
                if self.source != "pico":
                    continue
                if line[0] == "w" and len(values) == 8:
                    self.level = values[0] / 10
                    self.ran = bool(values[1])
                    self.scores = values[3:] if self.ran else [0] * len(CLASSES)
                    if self.listening:
                        self.steps += 1
                        self.inferences += self.ran
                elif line[0] == "alert" and len(values) == 4 and self.listening:
                    self.alerts.insert(
                        0,
                        {
                            "time": datetime.now().strftime("%H:%M:%S"),
                            "at": time.time(),
                            "label": CLASSES[values[0] - 1],
                            "confidence": round(values[1] / 255, 2),
                            "peak": values[2] / 10,
                            "blasts": values[3],
                        },
                    )

    def set_mode(self, mode: str) -> None:
        with self.lock:
            if mode in FIRMWARE and not self.recording:
                self.want = mode
                self.listening = False

    def set_source(self, source: str) -> None:
        with self.lock:
            if source in ("pico", "mac"):
                self.source = source
                self.listening = False
                self.scores, self.ran = [0] * len(CLASSES), False

    def listen(self, on: bool) -> bool:
        """Returns True when this starts a new listening session."""
        with self.lock:
            fresh = on and not self.listening
            if fresh:
                self.alerts, self.steps, self.inferences = [], 0, 0
            self.listening = on
            return fresh

    def start(self, label: str, name: str, limit: float) -> None:
        with self.lock:
            if self.recording or self.mode != "record" or label not in CLASSES:
                return
            self.label = label
            self.name = "".join(
                c for c in name.strip().replace(" ", "-") if c.isalnum() or c in "-_"
            )
            self.limit = max(0.0, limit)
            self.chunks, self.samples, self.dropped = [], 0, 0
            self.message = ""
            self.recording = True

    def stop(self) -> None:
        with self.lock:
            if self.recording:
                self._save()

    def _save(self) -> None:
        """Call with the lock held."""
        self.recording = False
        if self.samples < SAMPLE_RATE:
            self.message = "Under a second: not saved."
            return
        audio = np.concatenate(self.chunks)
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        file = f"{stamp}-{self.name}.wav" if self.name else f"{stamp}.wav"
        path = RECORDINGS / self.label / file
        path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(path, audio << 8, SAMPLE_RATE, subtype="PCM_24")
        self.last = f"{self.label}/{file}"
        self.message = f"Saved {len(audio) / SAMPLE_RATE:.1f} s to {self.last}"
        if self.dropped:
            self.message += f" ({self.dropped} samples dropped)"

    def discard_last(self) -> None:
        with self.lock:
            if self.last and not self.recording:
                (RECORDINGS / self.last).unlink(missing_ok=True)
                self.message = f"Deleted {self.last}"
                self.last = ""

    def state(self) -> dict:
        takes = {}
        for c in CLASSES:
            files = sorted((RECORDINGS / c).glob("*.wav"))
            takes[c] = {
                "files": len(files),
                "seconds": round(sum(sf.info(f).duration for f in files)),
                "recent": [f.name for f in files[-3:]][::-1],
            }
        with self.lock:
            return {
                "error": self.error,
                "peak": round(self.peak, 1),
                "rms": round(self.rms, 1),
                "recording": self.recording,
                "label": self.label,
                "seconds": round(self.samples / SAMPLE_RATE, 1),
                "message": self.message,
                "last": self.last,
                "takes": takes,
                "mode": self.mode,
                "want": self.want,
                "listening": self.listening,
                "scores": self.scores,
                "ran": self.ran,
                "level": self.level,
                "alerts": self.alerts[:30],
                "steps": self.steps,
                "inferences": self.inferences,
                "now": time.time(),
                "source": self.source,
            }


class MacMic:
    """Scores audio from the browser's mic with out/serra.tflite, one step per 240 ms.

    Each step runs the feature code over the last 3 s from a clean state, the way training
    examples are built (2 s of lead-in, then the 1 s window). Alerts are grouped as the
    firmware groups them: reported when two steps in a row raise none.
    """

    HOP = 12 * 320
    KEEP = 3 * SAMPLE_RATE

    def __init__(self, recorder: Recorder) -> None:
        self.recorder = recorder
        self.lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        """Drops buffered audio and any open alert, so a new session starts clean."""
        with self.lock:
            self.audio = np.zeros(0, dtype=np.int16)
            self.pending = 0
            self.best = [0.0] * len(ALERT_CLASSES)
            self.active = False
            self.quiet = self.hops = 0
            self.peak = 0.0

    def feed(self, pcm: np.ndarray) -> None:
        with self.lock:
            self.audio = np.concatenate([self.audio, pcm])[-self.KEEP :]
            self.pending += len(pcm)
            if self.pending < self.HOP:
                return
            self.pending %= self.HOP
            if len(self.audio) < self.KEEP:
                return
            self._step()

    def _step(self) -> None:
        import features  # here, not at the top: these pull in TensorFlow, which is slow to load
        from train import decide, run_tflite

        frames = features.extract(self.audio)[-features.FRAMES :]
        x = frames.astype(np.float32)[None, ..., None] / 255.0
        thresholds = json.loads((OUT / "thresholds.json").read_text())
        scores = run_tflite((OUT / "serra.tflite").read_bytes(), x)
        alert = int(decide(scores, [thresholds[c] for c in ALERT_CLASSES])[0])
        newest = np.abs(self.audio[-self.HOP :].astype(np.float64)).max()
        level = 20 * math.log10(max(1.0, newest) / 32768)

        event = None
        if alert >= 0:
            if not self.active:
                self.active, self.best, self.hops, self.peak = (
                    True,
                    [0.0] * len(ALERT_CLASSES),
                    0,
                    level,
                )
            self.best[alert] = max(self.best[alert], float(scores[0][alert]))
            self.quiet = 0
        elif self.active:
            self.quiet += 1
        if self.active:
            self.hops += 1
            self.peak = max(self.peak, level)
            if self.quiet >= 2 or self.hops >= 12:
                leader = int(np.argmax(self.best))
                event = {
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "at": time.time(),
                    "label": CLASSES[leader],
                    "confidence": round(self.best[leader], 2),
                    "peak": round(self.peak, 1),
                    "blasts": None,
                }
                self.active = False

        r = self.recorder
        with r.lock:
            if r.source != "mac":
                return
            r.level, r.ran = round(level, 1), True
            r.scores = [int(v * 256) for v in scores[0]]
            if r.listening:
                r.steps += 1
                r.inferences += 1
                if event:
                    r.alerts.insert(0, event)


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Serra mic bench</title>
<style>
:root { --bg:#f6f5f1; --fg:#1d1c1a; --dim:#6b6860; --card:#fff; --line:#dcd9d0; --accent:#1f6f5c; --rec:#c2362b; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#161614; --fg:#eceae4; --dim:#9a968c; --card:#21201d; --line:#3a3833; --accent:#58b79f; --rec:#e5574b; }
}
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg);
  font:16px/1.4 system-ui, sans-serif; }
main { max-width:560px; margin:0 auto; display:grid; gap:16px; }
h1 { font-size:20px; margin:0; }
.classes { display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; }
.classes button { padding:12px 4px; border:1px solid var(--line); border-radius:8px; background:var(--card);
  color:var(--fg); font:inherit; cursor:pointer; }
.classes button small { display:block; color:var(--dim); font-size:12px; font-variant-numeric:tabular-nums; }
.classes button.on { border-color:var(--accent); outline:2px solid var(--accent); }
.row { display:flex; gap:8px; }
.row label { flex:1; font-size:13px; color:var(--dim); }
.row label.short { flex:0 0 120px; }
input { width:100%; margin-top:4px; padding:10px; border:1px solid var(--line); border-radius:8px;
  background:var(--card); color:var(--fg); font:inherit; }
#go, .gobtn { padding:28px; border:0; border-radius:12px; background:var(--accent); color:#fff;
  font:600 22px system-ui, sans-serif; cursor:pointer; font-variant-numeric:tabular-nums; }
#go.rec, .gobtn.rec { background:var(--rec); }
#go:disabled, .gobtn:disabled { opacity:.4; cursor:default; }
.meter { height:14px; border-radius:7px; background:var(--line); overflow:hidden; }
.meter div { height:100%; width:0; background:var(--accent); transition:width .1s linear; }
.meter div.hot { background:var(--rec); }
#level, #msg, .hint { font-size:13px; color:var(--dim); font-variant-numeric:tabular-nums; }
#msg { min-height:20px; color:var(--fg); overflow-wrap:anywhere; }
#err { color:var(--rec); font-weight:600; }
#discard { border:0; background:none; color:var(--dim); text-decoration:underline; cursor:pointer; font:inherit; font-size:13px; padding:0; }
.tabs { display:flex; gap:0; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.tabs button { flex:1; padding:10px; border:0; background:var(--card); color:var(--fg); font:inherit; cursor:pointer; }
.tabs button.on { background:var(--accent); color:#fff; font-weight:600; }
.pane { display:grid; gap:16px; }
.pane[hidden] { display:none; }
#banner { padding:20px; border-radius:12px; border:1px solid var(--line); background:var(--card);
  text-align:center; font:600 24px system-ui, sans-serif; color:var(--dim); }
#banner.hit { background:var(--rec); border-color:var(--rec); color:#fff; }
#banner small { display:block; font:400 14px system-ui, sans-serif; margin-top:4px; }
.score { display:grid; grid-template-columns:110px 1fr 44px; gap:8px; align-items:center; font-size:14px;
  font-variant-numeric:tabular-nums; margin:6px 0; }
.score .meter { height:10px; }
table { width:100%; border-collapse:collapse; font-size:14px; font-variant-numeric:tabular-nums; }
td, th { text-align:left; padding:6px 8px 6px 0; border-bottom:1px solid var(--line); }
th { color:var(--dim); font-weight:400; font-size:13px; }
.wrap { overflow-x:auto; }
@media (max-width:480px) { .classes { grid-template-columns:repeat(2, 1fr); } }
</style></head><body><main>
<h1>Serra mic bench</h1>
<div class="tabs"><button id="tab-record">Record</button><button id="tab-test">Test the classifier</button></div>
<div id="err"></div>
<div class="pane" id="pane-record">
<div class="classes" id="classes"></div>
<div class="row">
  <label>Note for the file name (who, distance)<input id="name" placeholder="sam-3m" autocomplete="off"></label>
  <label class="short">Stop after (s)<input id="limit" type="number" min="0" value="30"></label>
</div>
<button id="go">Start recording</button>
<div><div class="meter"><div id="bar"></div></div><div id="level">&nbsp;</div></div>
<div id="msg"></div>
<div><button id="discard" hidden>Delete the last take</button></div>
<div class="hint">Space starts and stops. Keys 1-5 pick the class. "Stop after" 0 means until you stop it.
Several short takes beat one long one; leave a second of quiet between sounds.</div>
</div>
<div class="pane" id="pane-test" hidden>
<div class="tabs"><button id="src-pico">Pico</button><button id="src-mac">This computer's mic</button></div>
<button id="listen" class="gobtn">Start listening</button>
<div id="banner">No alert yet</div>
<div id="scores"></div>
<div id="tlevel" class="hint">&nbsp;</div>
<div class="wrap"><table><thead><tr><th>Time</th><th>Alert</th><th>Confidence</th><th>Peak</th><th>Blasts</th></tr></thead>
<tbody id="log"></tbody></table></div>
<div class="hint" id="machint" hidden>Demo only: this runs the PC's copy of the model on a mic it was not trained on.
No blast counting. Allow microphone access when the browser asks.</div>
<div class="hint">The board scores the last second of sound every 240 ms and reports an alert about 1.5 s after
the sound ends. Bars show the latest scores; empty bars mean the room was quiet and the model did not run.
Space starts and stops.</div>
</div>
</main>
<script>
const CLASSES = __CLASSES__;
let label = localStorage.getItem("label") || CLASSES[0], recording = false, want = "record", listening = false, source = "pico", capture = null;
const $ = id => document.getElementById(id);
$("name").value = localStorage.getItem("name") || "";
$("limit").value = localStorage.getItem("limit") || "30";
CLASSES.forEach((c, i) => {
  const b = document.createElement("button");
  b.id = "c-" + c; b.innerHTML = (i + 1) + " " + c.replace("_", " ") + "<small></small>";
  b.onclick = () => { if (!recording) { label = c; localStorage.setItem("label", c); paint(); } };
  $("classes").append(b);
});
function paint() { CLASSES.forEach(c => $("c-" + c).classList.toggle("on", c === label)); }
async function post(path, body) { await fetch(path, {method: "POST", body: JSON.stringify(body || {})}); tick(); }
CLASSES.forEach(c => {
  const row = document.createElement("div"); row.className = "score";
  row.innerHTML = "<span>" + c.replace("_", " ") + "</span><div class='meter'><div id='s-" + c + "'></div></div><span id='v-" + c + "'></span>";
  $("scores").append(row);
});
$("tab-record").onclick = () => post("/mode", {mode: "record"});
$("tab-test").onclick = () => post("/mode", {mode: "test"});
$("listen").onclick = () => post("/listen", {on: !listening});
$("src-pico").onclick = () => post("/source", {source: "pico"});
$("src-mac").onclick = () => post("/source", {source: "mac"});
async function startCapture() {
  capture = {};  // set first so tick() does not start a second one while the prompt is up
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false}});
    const ctx = new AudioContext({sampleRate: 16000});
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = e => {
      const f = e.inputBuffer.getChannelData(0), pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32768)));
      fetch("/audio", {method: "POST", body: pcm.buffer});
    };
    ctx.createMediaStreamSource(stream).connect(node); node.connect(ctx.destination);
    capture = {stream, ctx};
  } catch (e) { capture = null; post("/listen", {on: false}); $("err").textContent = "No microphone access: " + e.message; }
}
function stopCapture() {
  if (capture && capture.ctx) { capture.stream.getTracks().forEach(t => t.stop()); capture.ctx.close(); }
  capture = null;
}
function toggle() {
  if (want === "test") return post("/listen", {on: !listening});
  if (recording) return post("/stop");
  localStorage.setItem("name", $("name").value); localStorage.setItem("limit", $("limit").value);
  post("/start", {label, name: $("name").value, limit: parseFloat($("limit").value) || 0});
}
$("go").onclick = toggle;
$("discard").onclick = () => post("/discard");
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); toggle(); }
  const n = parseInt(e.key); if (n >= 1 && n <= CLASSES.length) $("c-" + CLASSES[n - 1]).click();
});
async function tick() {
  let s;
  try { s = await (await fetch("/state")).json(); } catch { $("err").textContent = "record_ui.py is not running."; return; }
  recording = s.recording; want = s.want; listening = s.listening;
  $("err").textContent = s.source === "mac" && want === "test" ? "" : s.error;
  $("tab-record").classList.toggle("on", want === "record"); $("tab-test").classList.toggle("on", want === "test");
  $("pane-record").hidden = want !== "record"; $("pane-test").hidden = want !== "test";
  source = s.source;
  $("src-pico").classList.toggle("on", source === "pico"); $("src-mac").classList.toggle("on", source === "mac");
  $("machint").hidden = source !== "mac";
  if (source === "mac" && listening && !capture) startCapture();
  if (!(source === "mac" && listening) && capture && capture.ctx) stopCapture();
  const ready = s.mode === "test" || source === "mac";
  $("listen").disabled = !ready; $("listen").classList.toggle("rec", listening);
  $("listen").textContent = listening ? "Stop listening" : "Start listening";
  CLASSES.forEach((c, i) => {
    const v = ready && s.ran ? s.scores[i] / 256 : 0;
    $("s-" + c).style.width = (v * 100) + "%"; $("s-" + c).classList.toggle("hot", i < 3 && v >= 0.5);
    $("v-" + c).textContent = ready && s.ran ? v.toFixed(2) : "";
  });
  $("tlevel").textContent = ready ? "level " + s.level.toFixed(1) + " dBFS" + (s.ran ? "" : " (quiet: model not run)")
    + (s.steps ? ", model ran on " + Math.round(100 * s.inferences / s.steps) + "% of steps" : "") : "\u00a0";
  const a = s.alerts[0], fresh = a && s.now - a.at < 4;
  $("banner").classList.toggle("hit", !!fresh);
  $("banner").innerHTML = a ? a.label.toUpperCase().replace("_", " ") + "<small>" + a.time + ", confidence " + a.confidence.toFixed(2)
    + (a.label === "whistle" && a.blasts !== null ? ", " + a.blasts + (a.blasts === 1 ? " blast" : " blasts") : "") + "</small>"
    : (listening ? "Listening..." : "No alert yet");
  $("log").innerHTML = s.alerts.map(a => "<tr><td>" + a.time + "</td><td>" + a.label + "</td><td>" + a.confidence.toFixed(2)
    + "</td><td>" + a.peak.toFixed(1) + " dB</td><td>" + (a.label === "whistle" && a.blasts !== null ? a.blasts : "") + "</td></tr>").join("");
  $("go").disabled = s.mode !== "record" && !recording;
  $("go").classList.toggle("rec", recording);
  $("go").textContent = recording ? "Stop  " + s.seconds.toFixed(1) + " s  (" + s.label.replace("_", " ") + ")" : "Start recording";
  const hot = s.peak > -0.5;
  $("bar").style.width = Math.max(0, Math.min(100, (s.peak + 90) / 90 * 100)) + "%";
  $("bar").classList.toggle("hot", hot);
  $("level").textContent = s.error ? "\\u00a0" : "peak " + s.peak.toFixed(1) + " dBFS, rms " + s.rms.toFixed(1) + (hot ? "  CLIPPING: move back" : "");
  $("msg").textContent = s.message;
  $("discard").hidden = !s.last || recording;
  CLASSES.forEach(c => $("c-" + c).querySelector("small").textContent = s.takes[c].files + " takes, " + s.takes[c].seconds + " s");
  paint();
}
paint(); tick(); setInterval(tick, 150);
</script></body></html>
"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", help="serial port (default: the one Pico that is plugged in)")
    ap.add_argument("--http", type=int, default=8765, help="port for the web page")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    recorder = Recorder(args.port)
    mac = MacMic(recorder)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, body: bytes, kind: str) -> None:
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/state":
                self._send(json.dumps(recorder.state()).encode(), "application/json")
            else:
                page = PAGE.replace("__CLASSES__", json.dumps(CLASSES))
                self._send(page.encode(), "text/html; charset=utf-8")

        def do_POST(self) -> None:
            if self.path == "/audio":
                raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                mac.feed(np.frombuffer(raw[: len(raw) // 2 * 2], dtype="<i2"))
                return self._send(b"{}", "application/json")
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}")
            if self.path == "/start":
                recorder.start(
                    body.get("label", ""), body.get("name", ""), float(body.get("limit", 0))
                )
            elif self.path == "/stop":
                recorder.stop()
            elif self.path == "/discard":
                recorder.discard_last()
            elif self.path == "/mode":
                recorder.set_mode(body.get("mode", ""))
            elif self.path == "/source":
                recorder.set_source(body.get("source", ""))
            elif self.path == "/listen":
                if recorder.listen(bool(body.get("on"))):
                    mac.reset()
            self._send(b"{}", "application/json")

        def log_message(self, *_) -> None:
            pass

    # Local only: this page can start recordings, delete the last take and reflash the Pico.
    server = ThreadingHTTPServer(("127.0.0.1", args.http), Handler)
    url = f"http://localhost:{args.http}"
    print(f"Serra dev page at {url}  (Ctrl-C to quit)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
