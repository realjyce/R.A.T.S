"""
R.A.T.S  –  Detection backend (two-shelf aggregator)
Loads model/best.pt and serves two independent shelves:
  • Shelf 1 — XIAO ESP32-S3 + PIR + FOMO (on-device inference, pushes counts)
  • Shelf 2 — Phone camera (IP Webcam / DroidCam) + YOLO (server-side inference)
Run:  python server.py
"""

import base64, time, threading, json, queue, itertools
from urllib.parse import urlparse
import requests
import numpy as np
import cv2
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from ultralytics import YOLO

MODEL_PATH = "model/best.pt"
PORT       = 5000

# ── Power / cost model assumptions (XIAO ESP32-S3 Sense, datasheet/typical) ──
# These are NOMINAL figures used to project battery life from a REAL, device-
# measured duty cycle. Swap in bench-measured values for a bulletproof demo.
I_ACTIVE_MA       = 150.0    # camera + WiFi + FOMO inference, typical avg draw
I_SLEEP_MA        = 0.014    # ~14 µA deep sleep (Seeed XIAO ESP32-S3 spec)
DEFAULT_BATTERY   = 1000.0   # mAh — a small 1S LiPo; override via ?battery=
COST_PER_SERVICE  = 5.0      # $ per recharge/replacement visit (labor+battery)

app   = Flask(__name__)
CORS(app)
model = YOLO(MODEL_PATH)

# Latest telemetry pushed by the deep-sleep device (held in RAM so the dashboard
# power panel stays live even while the device itself is asleep & unreachable).
_power = {"event": None, "boot_count": 0, "awake_us": 0, "total_us": 0,
          "counts": {}, "ts": 0.0}

# ── Edge alert engine ────────────────────────────────────────────────────────
# Each shelf is the single source of truth for its own stock. An ALERT is raised
# only on a status TRANSITION (ok→low→empty, or a restock back to ok) — i.e.
# "only sent when necessary", not every frame.
LOW_THRESHOLD = 3            # ≤ this (and > 0) is "low"; 0 is "empty"

def status_of(count):
    return "empty" if count <= 0 else "low" if count <= LOW_THRESHOLD else "ok"

SEVERITY = {"empty": "critical", "low": "warning", "ok": "info"}

def alert_message(product, st, count):
    label = product.capitalize()
    if st == "empty": return f"{label} is OUT OF STOCK"
    if st == "low":   return f"{label} running low — {count} left"
    return f"{label} restocked — {count} in stock"


class Shelf:
    """One shelf's world state + alert engine + SSE pub/sub.

    Both pipelines normalize into the same shape: a per-product count map plus
    derived statuses. Alerts fire only on status transitions, and every SSE
    subscriber gets the current snapshot immediately on connect — so the
    dashboard stays live even while a deep-sleep device is offline.
    """
    def __init__(self, shelf_id):
        self.shelf_id    = shelf_id
        self._state      = {"counts": {}, "statuses": {}, "latency": 0,
                            "objects": 0, "source": None, "device_id": None, "ts": 0.0}
        self._alerts     = []                 # most-recent-first, capped
        self._prev       = {}                 # per-product last status, for transitions
        self._seq        = itertools.count(1)
        self._lock       = threading.Lock()
        self._subs       = []                 # one bounded queue per browser
        self._sub_lock   = threading.Lock()

    # ── SSE pub/sub ──────────────────────────────────────────────────────────
    def subscribe(self):
        q = queue.Queue(maxsize=128)
        with self._sub_lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q):
        with self._sub_lock:
            if q in self._subs:
                self._subs.remove(q)

    def _publish(self, event, data):
        dead = []
        with self._sub_lock:
            for q in self._subs:
                try:
                    q.put_nowait((event, data))
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self._subs.remove(q)

    def snapshot(self):
        with self._lock:
            return {**self._state, "shelf_id": self.shelf_id, "alerts": self._alerts[:20]}

    # ── Ingestion ────────────────────────────────────────────────────────────
    def ingest(self, counts, source, latency=0, device_id=None):
        """Update world state from a reading and raise alerts on status changes."""
        counts = {k: int(v) for k, v in counts.items()}
        statuses, fresh = {}, []
        with self._lock:
            for prod, cnt in counts.items():
                st = status_of(cnt)
                statuses[prod] = st
                prev = self._prev.get(prod)
                # Skip the first reading (baseline) so startup doesn't alert-storm.
                if prev is not None and st != prev and (
                    st in ("low", "empty") or (st == "ok" and prev in ("low", "empty"))
                ):
                    fresh.append({
                        "id": next(self._seq), "ts": time.time(), "product": prod,
                        "status": st, "count": cnt, "severity": SEVERITY[st],
                        "message": alert_message(prod, st, cnt),
                    })
                self._prev[prod] = st
            self._state.update({"counts": counts, "statuses": statuses,
                                "latency": int(latency), "objects": sum(counts.values()),
                                "source": source, "device_id": device_id, "ts": time.time()})
            for a in fresh:
                self._alerts.insert(0, a)
            del self._alerts[50:]
            snap = {**self._state, "shelf_id": self.shelf_id, "alerts": self._alerts[:20]}
        self._publish("state", snap)
        for a in fresh:
            self._publish("alert", a)
        return statuses


# The two shelves of the unified dashboard.
shelf1 = Shelf("shelf_1")   # XIAO ESP32 + FOMO   (counts pushed by the device)
shelf2 = Shelf("shelf_2")   # Phone camera + YOLO (inference here on the server)
SHELVES = {"shelf_1": shelf1, "shelf_2": shelf2}


def run_inference(img):
    """Run YOLO on a decoded BGR frame → {detections, counts, latency}."""
    t0      = time.perf_counter()
    results = model(img, verbose=False)[0]
    latency = int((time.perf_counter() - t0) * 1000)

    detections = []
    counts     = {name: 0 for name in model.names.values()}

    for box in results.boxes:
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
        conf  = float(box.conf[0])
        cls   = int(box.cls[0])
        label = model.names[cls]
        counts[label] += 1
        detections.append({
            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "cx": (x1 + x2) / 2,    # FOMO emits center points; we hand YOLO's
            "cy": (y1 + y2) / 2,    # box centers too, so both render identically
            "conf":  round(conf, 3),
            "label": label,
        })

    return {"detections": detections, "counts": counts, "latency": latency}


@app.route("/detect", methods=["POST"])
def detect():
    """Webcam/phone snapshot → YOLO → shelf 2. Body: {image: "data:image/jpeg;base64,..."}."""
    data = request.get_json(force=True)
    if not data or "image" not in data:
        return jsonify({"error": "No image provided"}), 400

    # Decode base64 frame
    header, encoded = data["image"].split(",", 1)
    img_bytes = base64.b64decode(encoded)
    nparr     = np.frombuffer(img_bytes, np.uint8)
    img       = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return jsonify({"error": "Invalid image"}), 400

    result = run_inference(img)
    # Feed shelf 2's alert engine so the realtime dashboard + alerts work here too.
    shelf2.ingest(result["counts"], data.get("source", "phone_yolo"), result["latency"])
    return jsonify(result)


class MjpegProxy:
    """Single backend consumer of a device's MJPEG /stream.

    Many device web servers are single-threaded — if the browser opens the
    stream it blocks inference, and vice-versa. So the backend becomes the ONE
    consumer: it holds the MJPEG connection, keeps the latest frame, and both
    re-streams it to the browser and runs YOLO on it. The device only ever sees
    one connection → no conflict. Used for both the XIAO and the phone camera.
    """
    def __init__(self):
        self.url      = None
        self.jpeg     = None     # latest raw JPEG bytes
        self.seq      = 0        # bumped on every new frame
        self.running  = False
        self.lock     = threading.Lock()
        self.thread   = None

    def start(self, stream_url):
        with self.lock:
            if self.running and self.url == stream_url:
                return
            self.running = False          # signal any old reader to exit
            self.url     = stream_url
            self.running = True
            self.jpeg    = None
            self.thread  = threading.Thread(target=self._reader, args=(stream_url,), daemon=True)
            self.thread.start()

    def stop(self):
        with self.lock:
            self.running = False
            self.url     = None
            self.jpeg    = None

    def snapshot(self):
        with self.lock:
            return self.jpeg, self.seq

    def _reader(self, url):
        """Read the MJPEG stream and split it into JPEG frames by SOI/EOI markers."""
        while True:
            with self.lock:
                if not self.running or self.url != url:
                    return
            try:
                with requests.get(url, stream=True, timeout=6) as r:
                    buf = b""
                    for chunk in r.iter_content(chunk_size=8192):
                        with self.lock:
                            if not self.running or self.url != url:
                                return
                        buf += chunk
                        while True:
                            start = buf.find(b"\xff\xd8")            # JPEG start
                            end   = buf.find(b"\xff\xd9", start + 2) # JPEG end
                            if start != -1 and end != -1:
                                frame = buf[start:end + 2]
                                buf   = buf[end + 2:]
                                with self.lock:
                                    self.jpeg = frame
                                    self.seq += 1
                            else:
                                break
            except requests.RequestException:
                time.sleep(0.5)  # device hiccup — retry the connection


def _mjpeg_response(proxy):
    """Re-emit a proxy's device frames to the browser as a smooth MJPEG stream."""
    def gen():
        last = -1
        while True:
            if not proxy.running:
                break
            frame, seq = proxy.snapshot()
            if frame is not None and seq != last:
                last = seq
                yield (b"--frame\r\nContent-Type: image/jpeg\r\n"
                       b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                       + frame + b"\r\n")
            else:
                time.sleep(0.02)
    return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")


def _proxy_counts(proxy, shelf, source):
    """Run YOLO on a proxy's latest frame → {detections, counts, latency, w, h}."""
    frame, _ = proxy.snapshot()
    if frame is None:
        return jsonify({"error": "No frame yet — is the stream started?"}), 503
    nparr = np.frombuffer(frame, np.uint8)
    img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"error": "Invalid frame from device"}), 502
    result = run_inference(img)
    h, w   = img.shape[:2]
    result["w"], result["h"] = w, h
    shelf.ingest(result["counts"], source, result["latency"])
    return jsonify(result)


xiao  = MjpegProxy()   # Shelf 1 camera (XIAO MJPEG, when streaming frames)
phone = MjpegProxy()   # Shelf 2 camera (IP Webcam / DroidCam)


def _stream_url(raw, default_path="/stream"):
    """Normalize a device URL. If the user already gave a path, keep it
    (IP Webcam uses /video, DroidCam /mjpegfeed); otherwise append a default."""
    p = urlparse((raw or "").strip())
    if not p.scheme or not p.netloc:
        return None
    path = p.path if p.path and p.path != "/" else default_path
    return f"{p.scheme}://{p.netloc}{path}"


# ── Shelf 1: XIAO camera MJPEG proxy (optional video demo) ───────────────────
@app.route("/xiao_start", methods=["POST"])
def xiao_start():
    url = _stream_url((request.get_json(force=True) or {}).get("url"), "/stream")
    if not url:
        return jsonify({"error": "Invalid url"}), 400
    xiao.start(url)
    return jsonify({"status": "started", "url": url})

@app.route("/xiao_stop", methods=["POST"])
def xiao_stop():
    xiao.stop()
    return jsonify({"status": "stopped"})

@app.route("/xiao_stream")
def xiao_stream():
    return _mjpeg_response(xiao)

@app.route("/xiao_counts")
def xiao_counts():
    return _proxy_counts(xiao, shelf1, "xiao-proxy")


# ── Shelf 2: phone camera MJPEG proxy (IP Webcam / DroidCam) ─────────────────
@app.route("/phone_start", methods=["POST"])
def phone_start():
    """Begin proxying a phone's MJPEG stream. Body: {"url": "http://<ip>:8080/video"}.
    IP Webcam → /video, DroidCam → /mjpegfeed. A bare host defaults to /video."""
    url = _stream_url((request.get_json(force=True) or {}).get("url"), "/video")
    if not url:
        return jsonify({"error": "Invalid url"}), 400
    phone.start(url)
    return jsonify({"status": "started", "url": url})

@app.route("/phone_stop", methods=["POST"])
def phone_stop():
    phone.stop()
    return jsonify({"status": "stopped"})

@app.route("/phone_stream")
def phone_stream():
    return _mjpeg_response(phone)

@app.route("/phone_counts")
def phone_counts():
    return _proxy_counts(phone, shelf2, "phone_yolo")


# ── Power telemetry (Shelf 1 / XIAO deep-sleep demo) ─────────────────────────
@app.route("/xiao/push", methods=["POST"])
def xiao_push():
    """Deep-sleep device telemetry. The device POSTs this on each wake ('wake')
    and just before sleeping ('sleep'), so the backend always holds the latest
    accumulated awake/total time even while the device is offline asleep.
    Body: {event, boot_count, awake_us, total_us, counts?}."""
    d = request.get_json(force=True) or {}
    _power.update({
        "event":      d.get("event", "wake"),
        "boot_count": int(d.get("boot_count", _power["boot_count"])),
        "awake_us":   int(d.get("awake_us",   _power["awake_us"])),
        "total_us":   int(d.get("total_us",   _power["total_us"])),
        "counts":     d.get("counts", _power["counts"]),
        "ts":         time.time(),
    })
    return jsonify({"ok": True})

@app.route("/xiao/power")
def xiao_power():
    """Project battery life + cost from the device's REAL measured duty cycle.
    Query overrides for live demo tweaks: ?battery=<mAh>&active=<mA>."""
    battery  = float(request.args.get("battery", DEFAULT_BATTERY))
    i_active = float(request.args.get("active",  I_ACTIVE_MA))

    awake_us, total_us = _power["awake_us"], _power["total_us"]
    duty   = (awake_us / total_us) if total_us > 0 else 0.0
    duty   = min(max(duty, 0.0), 1.0)
    avg_mA = i_active * duty + I_SLEEP_MA * (1.0 - duty)

    life_deep  = (battery / avg_mA)   / 24.0 if avg_mA   > 0 else 0.0  # days
    life_always = (battery / i_active) / 24.0 if i_active > 0 else 0.0  # days

    def per_year(life_days):
        return (365.0 / life_days) if life_days > 0 else 0.0
    cost_deep   = per_year(life_deep)  * COST_PER_SERVICE
    cost_always = per_year(life_always) * COST_PER_SERVICE

    # 'asleep' if the most recent push said so (or none seen yet)
    state = "asleep" if _power["event"] in (None, "sleep") else "awake"

    return jsonify({
        "state":        state,
        "wake_count":   _power["boot_count"],
        "last_seen_s":  round(time.time() - _power["ts"], 1) if _power["ts"] else None,
        "duty_pct":     round(duty * 100, 2),
        "avg_mA":       round(avg_mA, 3),
        "counts":       _power["counts"],
        "battery_mAh":  battery,
        "i_active_mA":  i_active,
        "i_sleep_mA":   I_SLEEP_MA,
        "life_days_deepsleep": round(life_deep, 2),
        "life_days_alwayson":  round(life_always, 3),
        "energy_saved_pct":    round((1 - avg_mA / i_active) * 100, 1) if i_active else 0,
        "cost_per_year_deepsleep": round(cost_deep, 2),
        "cost_per_year_alwayson":  round(cost_always, 2),
        "cost_per_service":        COST_PER_SERVICE,
    })


# ── Per-shelf ingest + SSE streams ───────────────────────────────────────────
@app.route("/edge/ingest", methods=["POST"])
def edge_ingest():
    """Realtime push from the XIAO edge device (Shelf 1). It runs FOMO locally
    and POSTs its counts here (ideally only when they change). Body:
    {device_id?, counts:{bottle:N,...}, latency?, objects?}."""
    d = request.get_json(force=True) or {}
    counts = d.get("counts") or {}
    if not isinstance(counts, dict):
        return jsonify({"error": "counts must be an object"}), 400
    statuses = shelf1.ingest(counts, d.get("device_id", "xiao"),
                             d.get("latency", 0), d.get("device_id"))
    return jsonify({"ok": True, "statuses": statuses})

@app.route("/shelf2/ingest", methods=["POST"])
def shelf2_ingest():
    """Generic ingest for Shelf 2 — e.g. a phone running YOLO locally and
    POSTing counts directly. Same schema as /edge/ingest."""
    d = request.get_json(force=True) or {}
    counts = d.get("counts") or {}
    if not isinstance(counts, dict):
        return jsonify({"error": "counts must be an object"}), 400
    statuses = shelf2.ingest(counts, d.get("device_id", "phone_yolo"),
                             d.get("latency", 0), d.get("device_id"))
    return jsonify({"ok": True, "statuses": statuses})

@app.route("/edge/state")
def edge_state():
    """REST snapshot of Shelf 1's world state + recent alerts (SSE fallback)."""
    return jsonify(shelf1.snapshot())

@app.route("/shelf2/state")
def shelf2_state():
    return jsonify(shelf2.snapshot())

def _sse(shelf):
    """Server-Sent Events for one shelf: pushes 'state' and 'alert' events to the
    dashboard in realtime. Every subscriber gets the current snapshot on connect."""
    def gen():
        q = shelf.subscribe()
        try:
            yield f"event: state\ndata: {json.dumps(shelf.snapshot())}\n\n"
            while True:
                try:
                    event, data = q.get(timeout=15)
                    yield f"event: {event}\ndata: {json.dumps(data)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"      # comment frame keeps connection open
        finally:
            shelf.unsubscribe(q)
    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no", "Connection": "keep-alive"})

@app.route("/edge/stream")
def edge_stream_sse():
    return _sse(shelf1)

@app.route("/shelf2/stream")
def shelf2_stream_sse():
    return _sse(shelf2)


@app.route("/health")
def health():
    return jsonify({"status": "ok", "classes": model.names})

@app.route("/metrics")
def metrics():
    import torch
    ckpt = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
    tr   = ckpt.get("train_results", {})
    args = ckpt.get("train_args", {})

    def last(key): return tr[key][-1] if key in tr and tr[key] else None
    def series(key): return [round(v, 5) for v in tr.get(key, [])]

    return jsonify({
        "train_args": {k: args[k] for k in ("epochs", "imgsz", "batch", "model") if k in args},
        "epoch_trained":  ckpt.get("epoch", 0) + 1,
        "best_fitness":   round(ckpt.get("best_fitness", 0), 4),
        "classes":        model.names,
        "final": {
            "precision": last("metrics/precision(B)"),
            "recall":    last("metrics/recall(B)"),
            "mAP50":     last("metrics/mAP50(B)"),
            "mAP50_95":  last("metrics/mAP50-95(B)"),
        },
        "curves": {
            "epochs":         tr.get("epoch", []),
            "train_box_loss": series("train/box_loss"),
            "train_cls_loss": series("train/cls_loss"),
            "val_box_loss":   series("val/box_loss"),
            "val_cls_loss":   series("val/cls_loss"),
            "precision":      series("metrics/precision(B)"),
            "recall":         series("metrics/recall(B)"),
            "mAP50":          series("metrics/mAP50(B)"),
            "mAP50_95":       series("metrics/mAP50-95(B)"),
        },
    })

if __name__ == "__main__":
    print(f"R.A.T.S backend running on http://localhost:{PORT}")
    print(f"Model classes: {model.names}")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
