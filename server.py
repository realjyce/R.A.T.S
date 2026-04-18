"""
R.A.T.S  –  Detection backend
Loads model/best.pt and exposes POST /detect
Run:  python server.py
"""

import base64, time
import numpy as np
import cv2
from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO

MODEL_PATH = "model/best.pt"
PORT       = 5000

app   = Flask(__name__)
CORS(app)
model = YOLO(MODEL_PATH)

# Map model class names → dashboard product IDs
CLASS_MAP = {name: name for name in model.names.values()}

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

    return jsonify({
        "detections": detections,
        "counts":     counts,
        "latency":    latency,
    })

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
    app.run(host="0.0.0.0", port=PORT, debug=False)
