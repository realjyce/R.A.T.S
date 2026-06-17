# R.A.T.S

**Real-time Auto-Tracking Shelf** — an edge-AI system that watches a shelf, counts what's on it, and raises an alert the moment stock runs low.

A PIR sensor wakes a XIAO ESP32-S3 from deep sleep when someone approaches. **FOMO MobileNetV2 runs entirely on the device** (~150 ms) and counts each product — no image ever leaves the board. When a count changes, the device pushes a small JSON payload over WiFi to a lightweight relay, which raises alerts on stock-status changes and streams them to the dashboard in realtime over Server-Sent Events.

Three product classes are tracked out of the box: **bottle**, **snack**, **cup**.

---

## Pipeline

```
PIR AM312 ─wake─► XIAO ESP32-S3 ─► on-device FOMO ─► push on change ─► Flask relay ─SSE─► dashboard
 (motion)         (OV2640 frame)    (~150 ms, local)   (WiFi, JSON)     (alert hub)        (live UI)
```

The edge device does **all** the inference. The relay does **zero** inference — it only caches the last state, raises alerts on `ok → low → empty` / restock transitions, and pushes them to the browser. This is what keeps the dashboard alive (showing last-known stock) even while the device is asleep.

> **Why a relay if inference is on-device?** It isn't required for inference — it's a passive gateway. It (a) keeps the dashboard populated during PIR deep sleep, (b) lets the alert UI be demoed via the webcam without hardware, and (c) enables hosting the dashboard off the local network. See `PIR-Mode.md` for the realtime-vs-deep-sleep trade-off.

---

## Quick start

You need Python 3 and Node.js.

```bash
# 1. Python virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1      # Windows PowerShell
# source .venv/bin/activate     # macOS / Linux

# 2. Backend deps (inside the venv)
pip install -r requirements.txt

# 3. Frontend deps
npm install

# 4. Start the relay/backend (Flask on :5000)
python server.py

# 5. In another terminal, start the dashboard (Vite on :5173)
npm run dev
```

Open <http://localhost:5173>. With no hardware connected, the dashboard sits in **Edge** mode listening for the device; switch to **Webcam** to drive the whole pipeline locally, or simulate the device:

```bash
# baseline, then drop two products below threshold → two alert toasts
curl -s -X POST http://localhost:5000/edge/ingest -H "Content-Type: application/json" \
  -d '{"device_id":"xiao","counts":{"bottle":5,"cup":5,"snack":5}}'
curl -s -X POST http://localhost:5000/edge/ingest -H "Content-Type: application/json" \
  -d '{"device_id":"xiao","counts":{"bottle":0,"cup":5,"snack":2}}'
```

---

## Modes

| Mode | Camera | Inference | Path |
|---|---|---|---|
| **Edge (XIAO)** — primary | OV2640 on the MCU | On-device FOMO MobileNetV2 | device → `POST /edge/ingest` → SSE |
| **Webcam** — demo fallback | Browser `getUserMedia` | Server-side YOLO (`model/best.pt`) | browser → `POST /detect` → SSE |

Both feed the same alert engine, so stock counts and alerts always arrive at the dashboard the same way: over the `/edge/stream` SSE feed.

---

## Backend API (`server.py`, port 5000)

Realtime / edge:
- `POST /edge/ingest` — device telemetry `{ device_id, counts, latency? }`. Raises alerts on status transitions.
- `GET /edge/state` — current world state + recent alerts (REST snapshot).
- `GET /edge/stream` — **Server-Sent Events**: `state` and `alert` events pushed to the dashboard.

Webcam inference:
- `POST /detect` — `{ image: "data:image/jpeg;base64,..." }` → `{ detections, counts, latency }` (also feeds the alert engine).

Deep-sleep power demo:
- `POST /xiao/push` — wake/sleep telemetry from the deep-sleep firmware.
- `GET /xiao/power` — projects battery life + cost from the device-measured duty cycle. Query: `?battery=<mAh>&active=<mA>`.

Model info:
- `GET /health` — model status + class list.
- `GET /metrics` — training curves / mAP read from the `.pt` checkpoint.

The Vite dev server proxies `/edge`, `/xiao`, `/detect`, `/health`, `/metrics` to Flask automatically.

---

## Firmware (`xiao/`)

| Sketch | Purpose |
|---|---|
| `xiao/detector/detector.ino` | On-device FOMO + realtime push. POSTs counts to `/edge/ingest` **only when they change**. |
| `xiao/detector_deepsleep/detector_deepsleep.ino` | PIR-triggered deep sleep (wake on GPIO2 `ext0`); pushes power telemetry for the savings demo. |

Before flashing, set your WiFi credentials and `SERVER_INGEST` (the PC's LAN IP, e.g. `http://192.168.0.100:5000/edge/ingest`). Board: `XIAO_ESP32S3`, PSRAM: `OPI PSRAM`, Partition: `Huge APP`. The FOMO model export lives in `FOMO/` (Edge Impulse Arduino library).

---

## Power / efficiency demo

The dashboard's **Power & Savings** panel projects battery life and cost (deep-sleep vs always-on) from the device's *measured* duty cycle. For a slide-ready version:

```bash
python power_model.py               # table + power_compare.png
python power_model.py --from-backend # use the live measured duty cycle
```

---

## Stock thresholds

- `> 3` → **in stock**
- `1–3` → **low stock** (warning)
- `0` → **out of stock** (critical)

Alerts fire only on a *transition* between these states — a stable shelf produces a silent network and a quiet dashboard.

---

## Repository layout

```
server.py                       Flask relay: edge ingest, SSE alert hub, webcam YOLO, power model
power_model.py                  Standalone battery-life / cost calculator + chart
model/                          YOLO checkpoints (best.pt, last.pt) — webcam mode
baseline/                       Training artifacts (curves, confusion matrix, args.yaml)
FOMO/                           Edge Impulse FOMO Arduino library exports
xiao/                           ESP32-S3 firmware (realtime + deep-sleep sketches)
src/SmartShelfDashboard.jsx     Single-file React dashboard
vite.config.js                  Dev server + proxy config
WORKFLOW.md                     Full system architecture
PIR-Mode.md                     PIR integration + realtime-vs-deep-sleep notes
```

---

## License

See [LICENSE](./LICENSE).
