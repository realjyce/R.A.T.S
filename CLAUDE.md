# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

R.A.T.S (Real-time Auto Tracking Shelf) — a 4-layer edge AI shelf-stock tracker. See `WORKFLOW.md` for the full system diagram; it is the authoritative architecture doc and worth re-reading when touching any layer.

## Commands

```bash
python server.py     # Flask detection backend on :5000 (loads model/best.pt)
npm run dev          # Vite dev server on :5173 (proxies /detect, /health, /metrics → :5000)
npm run build        # production bundle
```

No test suite exists (`npm test` is a stub). No linter is configured.

A single Python venv install covers the backend: `pip install -r requirements.txt`. The heavy deps are `ultralytics`, `torch`, `torchvision`, and `opencv-python`.

## Architecture

Four layers, loosely coupled by HTTP:

1. **Edge hardware** — XIAO ESP32-S3 + PIR AM312. Runs FOMO MobileNetV2 on-device, broadcasts a Wi-Fi AP at `192.168.4.1` exposing `/stream` (MJPEG) and `/status` (JSON `{counts, latency}`). Firmware is **not** in this repo.
2. **Model training** — artifacts only, in `baseline/` (YOLOv8 training curves, confusion matrix, `args.yaml`). Checkpoints `best.pt`/`last.pt` live in `model/` and are loaded by the backend.
3. **Backend** (`server.py`) — Flask + Ultralytics YOLO. Serves **two independent shelves** via a shared `Shelf` class (state + alert engine + SSE pub/sub), instantiated as `shelf1` (XIAO/FOMO) and `shelf2` (phone/YOLO):
   - `POST /edge/ingest` — Shelf 1. The XIAO runs FOMO on-device and POSTs `{counts, latency, device_id}`.
   - `POST /shelf2/ingest` — Shelf 2. Generic count push (e.g. a phone running YOLO locally).
   - `POST /detect` — accepts `{image: "data:..."}`, runs YOLO server-side, feeds Shelf 2.
   - `POST /phone_start|/phone_stop`, `GET /phone_stream` (MJPEG re-emit), `GET /phone_counts` (YOLO on latest frame → Shelf 2). The backend is the single consumer of the phone's MJPEG (IP Webcam `/video`, DroidCam `/mjpegfeed`) via the `MjpegProxy` class. The `xiao*` routes are the same pattern for Shelf 1's camera.
   - `GET /edge/stream`, `GET /shelf2/stream` — per-shelf SSE (`state` + `alert` events). `GET /edge/state`, `GET /shelf2/state` are REST fallbacks.
   - `GET /xiao/power`, `POST /xiao/push` — Shelf 1 deep-sleep power model.
   - `GET /health` — model class list. `GET /metrics` — training curves from the `.pt` checkpoint.
4. **Frontend** (`src/SmartShelfDashboard.jsx`) — single-file React app. Dashboard, workflow page, history page, charts, theme all live here. `src/main.jsx` is the mount point.

### Two-shelf dashboard

The dashboard renders both shelves side by side, each fed by its own SSE source via `useShelfStream(url, onAlert)`:

- **Shelf 1** (`/edge/stream`): `EdgeNodePanel` — the XIAO infers on-device and pushes counts; no live video, just telemetry. Drives the History log directly from SSE readings.
- **Shelf 2** (`/shelf2/stream`): `PhoneShelfPanel` — user pastes a phone stream URL → `/phone_start` → `<img src="/phone_stream">` shows the MJPEG, and a 1.5s poll of `/phone_counts` runs YOLO server-side, draws center-point dots on an overlay canvas, and logs to History via `onInference`.

`AggregatePanel` sums counts across both shelves; `LiveAlertsFeed` merges both alert streams (alert IDs are per-shelf, so merged entries get a `uid` like `s1-3`).

### Class coupling

The three product classes (`bottle`, `snack`, `cup`) are duplicated in three places and must stay in sync:
- model weights (`model/best.pt`)
- frontend `PRODUCTS` array and the `COLORS` map inside `drawBoxes`
- the stock-status thresholds (`empty` at 0, `low` at ≤3) are hardcoded in the product grid

Adding/renaming a class means retraining + updating both frontend arrays.

### Dev proxy

`vite.config.js` proxies `/detect`, `/health`, `/metrics` to `http://localhost:5000`. The frontend uses relative paths, so the backend must be running for detection/metrics to work in dev.
