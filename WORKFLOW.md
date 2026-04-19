# R.A.T.S — System Workflow
**Real-time Auto Tracking Shelf**  
Edge AI product tracking using XIAO ESP32S3 + YOLOv8

---

## Overview

R.A.T.S is a 4-layer edge AI system: physical hardware on the shelf, an on-device or server-side ML model, a Flask detection backend, and a React dashboard for real-time monitoring and alerting.

---

## Layer 1 — Hardware (Edge Device)

```
[ Shelf ] ──► [ PIR Sensor AM312 ] ──► triggers camera wake
                                            │
                                            ▼
                               [ XIAO ESP32S3 Sense ]
                               - Built-in OV2640 camera
                               - Runs FOMO MobileNetV2 (on-device)
                               - Broadcasts Wi-Fi AP: 192.168.4.1
                                            │
                               ┌────────────┴────────────┐
                               ▼                         ▼
                        /stream (MJPEG)           /status (JSON)
                        Video feed for          Counts + latency
                        browser preview         from on-device ML
```

**Key behavior:**
- PIR sensor detects human presence → activates the camera to save power.
- XIAO ESP32S3 acts as a Wi-Fi Access Point; no router required.
- On-device FOMO MobileNetV2 performs lightweight inference directly on the MCU.
- The `/status` endpoint returns `{ counts, latency }` — pre-computed on the device.

---

## Layer 2 — ML Model Pipeline (Training & Export)

```
[ Raw Product Images ]
        │
        ▼
[ Labeling / Annotation ]   ◄──── Classes: bottle | snack | cup
        │
        ▼
[ Edge Impulse Training ]   OR   [ YOLOv8 Custom Training ]
        │                                  │
        ▼                                  ▼
[ FOMO MobileNetV2 ]            [ YOLOv8n → best.pt ]
  (on-device MCU)               (server-side inference)
        │                                  │
        ▼                                  ▼
 Flash to ESP32S3               model/best.pt loaded
                                 by server.py (Flask)
```

**Training artifacts stored in `/baseline/`:**
- `results.csv` — epoch-by-epoch metrics
- `confusion_matrix.png` — class-level accuracy breakdown
- `BoxF1_curve.png`, `BoxPR_curve.png` — precision/recall diagnostics
- `best.pt` / `last.pt` — final model checkpoints
- `args.yaml` — training hyperparameters

---

## Layer 3 — Detection Backend (`server.py`)

```
POST /detect
────────────
Browser → base64 JPEG frame
        │
        ▼
   Decode → OpenCV ndarray
        │
        ▼
   YOLO model inference (best.pt)
        │
        ▼
   Parse boxes: x1,y1,x2,y2 | label | confidence
        │
        ▼
   Return JSON:
   {
     detections: [ { x1,y1,x2,y2,cx,cy,conf,label } ],
     counts:     { bottle:N, snack:N, cup:N },
     latency:    ms
   }

GET /health   → model class list + status check
GET /metrics  → training curves + best_fitness + final mAP scores
```

**Stack:** Flask + Flask-CORS + Ultralytics YOLOv8 + OpenCV + NumPy  
**Port:** 5000  
**Inference speed:** tracked per-request in milliseconds

---

## Layer 4 — Dashboard Frontend (`src/SmartShelfDashboard.jsx`)

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (Vite/React)                  │
│                                                          │
│  ┌──────────────┐   Camera Source Toggle                 │
│  │  XIAO Mode   │ → poll  GET /status every 2s           │
│  │  Webcam Mode │ → capture frame → POST /detect every 2s│
│  └──────────────┘                                        │
│         │                                                │
│         ▼                                                │
│  [ Video Viewport ]  +  [ YOLO Box Overlay Canvas ]      │
│         │                                                │
│         ▼                                                │
│  [ Product Stock Grid ]                                  │
│  - bottle / snack / cup counts                           │
│  - Status:  OK → LOW (≤3) → EMPTY (0)                   │
│  - Alerts: ⚠ WARNING / ⛔ CRITICAL with blink animation  │
│         │                                                │
│         ▼                                                │
│  [ History Page ]                                        │
│  - Training curves: loss, precision, recall, mAP         │
│  - Live session: total runs, avg latency                 │
│  - Per-class confidence bars                             │
│  - Scrollable inference log (last 50 entries)            │
└─────────────────────────────────────────────────────────┘
```

---

## End-to-End Workflow (Operational Mode)

```
1. Power on XIAO ESP32S3 on shelf
        │
2. PIR sensor detects motion → camera activates
        │
3. Choose source in Dashboard:
   ├── [XIAO Mode]  Connect to 192.168.4.1/stream
   │      └── Poll /status every 2s → receive counts from on-device ML
   │
   └── [Webcam Mode]  Open browser webcam
          └── Capture JPEG frame every 2s → POST to Flask /detect
                 └── YOLOv8 runs inference → returns detections + counts
        │
4. Dashboard updates product stock display in real-time
        │
5. Alert logic evaluates counts:
   count > 3   →  ✅ In Stock (green)
   count 1-3   →  ⚠ LOW STOCK (yellow warning)
   count = 0   →  ⛔ OUT OF STOCK (red critical, blink)
        │
6. History page logs each inference run:
   - timestamp, latency, per-class counts
   - running average latency (last 30 runs)
   - per-class average confidence scores
```

---

## Running the System

```bash
# 1. Start the detection backend
python server.py
# → Flask running at http://localhost:5000

# 2. Start the frontend dashboard
npm run dev
# → Vite serving at http://localhost:5173

# 3. Hardware (XIAO ESP32S3)
# Flash firmware via Arduino IDE / PlatformIO
# Device broadcasts Wi-Fi AP at 192.168.4.1
# Connect laptop to XIAO's Wi-Fi, then open dashboard
```

---

## System Architecture Summary

| Layer | Component | Technology |
|---|---|---|
| Edge Device | XIAO ESP32S3 Sense | Arduino / ESP-IDF |
| Motion Trigger | PIR AM312 | Hardware GPIO |
| On-Device ML | FOMO MobileNetV2 | Edge Impulse |
| Server ML | YOLOv8n | Ultralytics / PyTorch |
| Backend API | Flask server | Python 3 |
| Frontend | Smart Shelf Dashboard | React + Vite |
| Model Training | Custom dataset | YOLOv8 training loop |
| Products Tracked | Bottle, Snack, Cup | 3-class detection |

---

*R.A.T.S — edge system for smart shelf product tracking*
