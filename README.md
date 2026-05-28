# R.A.T.S

**Real-time Auto Tracking Shelf** — an edge-AI system that watches a shelf, counts what's on it, and raises alerts when stock runs low.

A PIR sensor wakes a XIAO ESP32-S3 Sense camera when someone approaches; on-device ML (FOMO MobileNetV2) or a server-side YOLO model analyses the frame; a React dashboard shows live product counts, bounding boxes, and stock alerts.

Three product classes are tracked out of the box: **bottle**, **snack**, **cup**.

---

## Quick start

You need Python 3 and Node.js installed.

```bash
# 1. Install backend dependencies
pip install -r requirements.txt

# 2. Install frontend dependencies
npm install

# 3. Start the detection backend (Flask on :5000)
python server.py

# 4. In another terminal, start the dashboard (Vite on :5173)
npm run dev
```

Open <http://localhost:5173> and pick a camera source on the dashboard.

---

## Camera modes

The dashboard supports two sources, selectable from the top toolbar:

| Mode | Camera | Inference | Endpoint |
|---|---|---|---|
| 🔌 **XIAO ESP32-S3** | OV2640 on the MCU | On-device FOMO MobileNetV2 | `http://192.168.4.1/stream` + `/status` |
| 📷 **Webcam** | Browser `getUserMedia` | Server-side YOLO (`model/best.pt`) | `POST /detect` |

In XIAO mode the device returns pre-computed counts; in webcam mode the browser snapshots a frame every 2s, POSTs it to the Flask backend, and overlays YOLO bounding boxes on the video.

---

## System architecture

| Layer | Component | Technology |
|---|---|---|
| Edge device | XIAO ESP32-S3 Sense | Arduino / ESP-IDF |
| Motion trigger | PIR AM312 | Hardware GPIO |
| On-device ML | FOMO MobileNetV2 | Edge Impulse |
| Server ML | YOLOv8n | Ultralytics / PyTorch |
| Backend API | Flask | Python 3 |
| Frontend | Smart Shelf Dashboard | React + Vite |

See [`WORKFLOW.md`](./WORKFLOW.md) for the full end-to-end flow diagram.

---

## Backend API

`server.py` exposes three endpoints on port 5000:

- `POST /detect` — body `{ image: "data:image/jpeg;base64,..." }`, returns `{ detections, counts, latency }`.
- `GET /health` — model status + class list.
- `GET /metrics` — training curves, best fitness, final mAP scores (read from the `.pt` checkpoint).

The Vite dev server proxies all three to the Flask backend automatically.

---

## Repository layout

```
server.py                       Flask detection backend
model/                          YOLO checkpoints (best.pt, last.pt)
baseline/                       Training artifacts (curves, confusion matrix, args.yaml)
src/SmartShelfDashboard.jsx     Single-file React dashboard
src/main.jsx                    Mount point
vite.config.js                  Dev server + proxy config
WORKFLOW.md                     Full system architecture
```

The ESP32 firmware is **not** included in this repo — flash your own via Arduino IDE / PlatformIO.

---

## Stock alert thresholds

The dashboard classifies each product based on its detected count:

- `> 3` → ✅ In stock
- `1–3` → ⚠ Low stock (yellow)
- `0` → ⛔ Out of stock (red, blinking)

---

## License

See [LICENSE](./LICENSE).
