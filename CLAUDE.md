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
3. **Backend** (`server.py`) — Flask + Ultralytics YOLO. Three endpoints:
   - `POST /detect` — accepts `{image: "data:image/jpeg;base64,..."}`, returns `{detections, counts, latency}`. Frame is decoded via base64 → OpenCV.
   - `GET /health` — model class list.
   - `GET /metrics` — reads `train_results`/`train_args` directly from the `.pt` checkpoint (uses `torch.load(..., weights_only=False)`). Powers the History page charts.
4. **Frontend** (`src/SmartShelfDashboard.jsx`) — single-file React app. Everything (dashboard, workflow page, history page, charts, theme) lives in this one ~700-line file. `src/main.jsx` is just the mount point.

### Frontend mode switching

The dashboard has two camera sources that drive different code paths — keep them straight when editing:

- **`xiao` mode**: `<video>.src = xiaoUrl` (MJPEG), polls `${base}/status` every 2s via `pollStocks`. No bounding-box overlay (the device returns pre-counted results, not boxes).
- **`webcam` mode**: `getUserMedia` → hidden `captureRef` canvas snapshots a frame every 2s → POSTs base64 JPEG to `/detect` → `drawBoxes` paints YOLO results onto `canvasRef` overlay.

Switching `camSource` triggers `stopCamera` via effect — both intervals and media streams must be torn down to avoid leaks.

### Class coupling

The three product classes (`bottle`, `snack`, `cup`) are duplicated in three places and must stay in sync:
- model weights (`model/best.pt`)
- frontend `PRODUCTS` array and the `COLORS` map inside `drawBoxes`
- the stock-status thresholds (`empty` at 0, `low` at ≤3) are hardcoded in the product grid

Adding/renaming a class means retraining + updating both frontend arrays.

### Dev proxy

`vite.config.js` proxies `/detect`, `/health`, `/metrics` to `http://localhost:5000`. The frontend uses relative paths, so the backend must be running for detection/metrics to work in dev.
