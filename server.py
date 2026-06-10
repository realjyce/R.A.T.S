"""
R.A.T.S  –  Detection backend
Loads model/best.pt and exposes POST /detect
Run:  python server.py
"""

import base64, time, threading
from urllib.parse import urlparse
import requests
import numpy as np
import cv2
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from ultralytics import YOLO

MODEL_PATH = "model/best.pt"
PORT       = 5000

app   = Flask(__name__)
CORS(app)
model = YOLO(MODEL_PATH)

# Map model class names → dashboard product IDs
CLASS_MAP = {name: name for name in model.names.values()}

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
            "cx": (x1 + x2) / 2,
            "cy": (y1 + y2) / 2,
            "conf":  round(conf, 3),
            "label": label,
        })

    return {"detections": detections, "counts": counts, "latency": latency}

@app.route("/detect", methods=["POST"])
def detect():
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

    return jsonify(run_inference(img))

class XiaoStream:
    """Single client of a XIAO device's /stream.

    The device's web server is single-threaded — if the browser opens /stream
    it blocks /capture (detection), and vice-versa. So the backend becomes the
    ONE consumer: it holds the MJPEG connection, keeps the latest frame, and
    both re-streams it to the browser (/xiao_stream) and runs YOLO on it
    (/xiao_counts). The device only ever sees one connection → no conflict.
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

xiao = XiaoStream()

def _stream_url(raw):
    """Normalize any device URL to its /stream endpoint."""
    p = urlparse((raw or "").strip())
    if not p.scheme or not p.netloc:
        return None
    return f"{p.scheme}://{p.netloc}/stream"

@app.route("/xiao_start", methods=["POST"])
def xiao_start():
    """Begin proxying a device's MJPEG stream. Body: {"url": "http://<ip>/stream"}."""
    url = _stream_url((request.get_json(force=True) or {}).get("url"))
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
    """Re-emit the device frames to the browser as a smooth MJPEG stream."""
    def gen():
        last = -1
        while True:
            if not xiao.running:
                break
            frame, seq = xiao.snapshot()
            if frame is not None and seq != last:
                last = seq
                yield (b"--frame\r\nContent-Type: image/jpeg\r\n"
                       b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                       + frame + b"\r\n")
            else:
                time.sleep(0.02)
    return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")

@app.route("/xiao_counts")
def xiao_counts():
    """Run YOLO on the latest streamed frame → {detections, counts, latency, w, h}."""
    frame, _ = xiao.snapshot()
    if frame is None:
        return jsonify({"error": "No frame yet — is the stream started?"}), 503
    nparr = np.frombuffer(frame, np.uint8)
    img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"error": "Invalid frame from device"}), 502
    result = run_inference(img)
    h, w   = img.shape[:2]
    result["w"], result["h"] = w, h
    return jsonify(result)

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
