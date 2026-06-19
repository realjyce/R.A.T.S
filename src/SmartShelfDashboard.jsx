import { useState, useEffect, useRef, useCallback } from "react";

// Two detection pipelines, one dashboard:
//   Shelf 1 — XIAO ESP32-S3 + FOMO MobileNetV2, inference ON-DEVICE (no sensor).
//             Browser polls the device's /status directly for counts.
//   Shelf 2 — Phone camera (DroidCam / IP Webcam) → backend proxies the MJPEG
//             stream and runs YOLOv8 on it. Browser polls /phone_counts.
const HARDWARE = [
  { name: "XIAO ESP32-S3 Sense", role: "Shelf 1 · Edge Camera", color: "#38BDF8", icon: "🧠" },
  { name: "FOMO MobileNetV2",    role: "Shelf 1 · On-Device ML", color: "#22C55E", icon: "🤖" },
  { name: "Phone Camera",        role: "Shelf 2 · IP / DroidCam", color: "#F97316", icon: "📱" },
  { name: "YOLOv8 (best.pt)",    role: "Shelf 2 · Backend ML",   color: "#A78BFA", icon: "🎯" },
];

const PRODUCTS = [
  { id: "bottle", label: "Bottle", icon: "🍶", color: "#38BDF8" },
  { id: "snack",  label: "Snack",  icon: "🍿", color: "#F97316" },
  { id: "cup",    label: "Cup",    icon: "🍜", color: "#22C55E" },
];

const COLORS = { bottle: "#38BDF8", snack: "#F97316", cup: "#22C55E" };

function formatTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Normalize the XIAO device URL to its base (drop trailing slash + any path),
// so "http://192.168.45.86", ".../", or ".../stream" all resolve to the host.
function deviceBase(url) {
  return (url || "").trim().replace(/\/+$/, "").replace(/\/(stream|status|capture)$/i, "");
}

const THEMES = {
  dark: {
    bg: "#0B0E14", surface: "#141922", surfaceAlt: "#1A2030",
    border: "#232D3F", textPrimary: "#E2E8F0", textSecondary: "#7B8BA5",
    accent: "#38BDF8", alertRed: "#EF4444", green: "#22C55E",
    camBg: "#060A0F", bracketColor: "#38BDF8",
  },
  light: {
    bg: "#F0F4F8", surface: "#FFFFFF", surfaceAlt: "#E8EEF4",
    border: "#CBD5E1", textPrimary: "#0F172A", textSecondary: "#64748B",
    accent: "#0284C7", alertRed: "#DC2626", green: "#16A34A",
    camBg: "#D1D9E0", bracketColor: "#0284C7",
  },
};

// ─────────────────────────────────────────────
//  Mini SVG line chart
// ─────────────────────────────────────────────
function LineChart({ series, width = 400, height = 90, colors }) {
  if (!series.length || !series[0].data.length) return null;
  const n    = series[0].data.length;
  const allV = series.flatMap((s) => s.data);
  const minV = Math.min(...allV), maxV = Math.max(...allV);
  const range = maxV - minV || 1;
  const pts = (data) =>
    data.map((v, i) => {
      const x = (i / (n - 1)) * width;
      const y = height - ((v - minV) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {series.map((s, i) => (
        <polyline key={i} points={pts(s.data)} fill="none" stroke={colors[i]} strokeWidth="1.8"
          strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────
//  SHELF PANEL — one detection pipeline, self-contained.
//  mode "fomo": polls the XIAO device /status directly (counts come pre-computed
//               on-device; preview is refreshing /capture snapshots).
//  mode "yolo": phone IP camera proxied by the backend (/phone_*) OR the local
//               webcam (getUserMedia → /detect). Backend runs YOLO either way.
// ─────────────────────────────────────────────
function ShelfPanel({ t, font, shelfId, title, mode, accentColor, onLog, onStocks }) {
  const { bg, surface, surfaceAlt, border, textPrimary, textSecondary, accent, alertRed, green } = t;

  const [yoloSrc, setYoloSrc] = useState("phone");   // yolo only: "phone" | "webcam"
  const [url, setUrl]         = useState("");
  const [camState, setCamState] = useState("idle");  // idle | requesting | active | error
  const [camError, setCamError] = useState("");
  const [stocks, setStocks]   = useState(null);
  const [latency, setLatency] = useState(null);
  const [lastUpdate, setLast] = useState(null);

  const imgRef     = useRef(null);  // preview <img> (fomo /capture, or proxied /phone_stream)
  const videoRef   = useRef(null);  // webcam <video>
  const canvasRef  = useRef(null);  // detection overlay
  const captureRef = useRef(null);  // hidden capture canvas (webcam)
  const pollRef    = useRef(null);
  const streamRef  = useRef(null);
  const busy       = useRef(false); // one request in flight at a time
  const hist       = useRef([]);    // recent count readings for temporal smoothing

  // Single colored dot per detection (FOMO center points / YOLO box centers).
  const drawMarkers = useCallback((dets, w, h) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    (dets || []).forEach(({ x1, y1, x2, y2, label }) => {
      const color = COLORS[label] ?? "#FFFFFF";
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
    });
  }, []);

  // Smooth counts (median of last 5 readings) and publish to dashboard + log.
  const record = useCallback((counts, lat, dets) => {
    const h5 = [...hist.current, counts].slice(-5);
    hist.current = h5;
    const smoothed = {};
    PRODUCTS.forEach((p) => {
      const vals = h5.map((c) => c?.[p.id] ?? 0).sort((a, b) => a - b);
      smoothed[p.id] = vals[Math.floor(vals.length / 2)];
    });
    setStocks(smoothed);
    setLatency(lat ?? 0);
    setLast(new Date());
    onStocks?.(shelfId, smoothed);
    onLog?.({ shelf: shelfId, time: formatTime(new Date()), latency: lat ?? 0, counts, detections: dets, id: Date.now() });
  }, [onStocks, onLog, shelfId]);

  // FOMO — talk to the device directly: /status for counts, /capture for preview.
  const pollFomo = useCallback(async () => {
    const base = deviceBase(url);
    if (!base || busy.current) return;
    busy.current = true;
    try {
      const res = await fetch(`${base}/status`);
      if (res.ok) {
        const d = await res.json();
        if (d.counts) {
          record(d.counts, d.latency, d.detections);
          if (d.w && d.h) drawMarkers(d.detections || [], d.w, d.h);
          const img = imgRef.current;
          if (img && (img.complete || !img.getAttribute("src"))) img.src = `${base}/capture?t=${Date.now()}`;
        }
      }
    } catch { /* device not reachable */ }
    finally { busy.current = false; }
  }, [url, record, drawMarkers]);

  // Phone — backend already holds the MJPEG; just ask it for YOLO counts.
  const pollPhone = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch("/phone_counts");
      if (res.ok) {
        const d = await res.json();
        if (d.counts) {
          record(d.counts, d.latency, d.detections);
          if (d.w && d.h) drawMarkers(d.detections || [], d.w, d.h);
        }
      }
    } catch { /* backend not reachable */ }
    finally { busy.current = false; }
  }, [record, drawMarkers]);

  // Webcam — snapshot a frame and POST it to /detect (backend YOLO).
  const runWebcam = useCallback(async () => {
    const video = videoRef.current, cap = captureRef.current;
    if (!video || !cap || video.readyState < 2) return;
    const w = video.videoWidth || 640, h = video.videoHeight || 480;
    cap.width = w; cap.height = h;
    cap.getContext("2d").drawImage(video, 0, 0, w, h);
    const dataUrl = cap.toDataURL("image/jpeg", 0.8);
    try {
      const res = await fetch("/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
      const d = await res.json();
      if (d.detections) { drawMarkers(d.detections, w, h); record(d.counts, d.latency, d.detections); }
    } catch { /* backend not reachable */ }
  }, [record, drawMarkers]);

  const start = useCallback(async () => {
    setCamState("requesting"); setCamError("");
    try {
      if (mode === "fomo") {
        const base = deviceBase(url);
        if (!base) throw new Error("Enter the XIAO IP, e.g. http://192.168.1.50");
        const r = await fetch(`${base}/status`);          // confirm reachable (may take ~1s while it infers)
        if (!r.ok) throw new Error("Device not reachable at " + base);
        if (imgRef.current) imgRef.current.src = `${base}/capture?t=${Date.now()}`;
        pollRef.current = setInterval(pollFomo, 3000);
      } else if (yoloSrc === "phone") {
        if (!url.trim()) throw new Error("Enter the phone stream URL, e.g. http://192.168.1.42:4747/video");
        const r = await fetch("/phone_start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
        if (!r.ok) throw new Error("Backend couldn't open the phone stream — is server.py running?");
        if (imgRef.current) imgRef.current.src = `/phone_stream?t=${Date.now()}`;
        pollRef.current = setInterval(pollPhone, 2000);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        pollRef.current = setInterval(runWebcam, 2000);
      }
      setCamState("active");
    } catch (err) { setCamState("error"); setCamError(err.message || "Could not connect"); }
  }, [mode, yoloSrc, url, pollFomo, pollPhone, runWebcam]);

  const stop = useCallback(() => {
    clearInterval(pollRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (imgRef.current) imgRef.current.src = "";
    if (canvasRef.current) { const ctx = canvasRef.current.getContext("2d"); ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); }
    if (mode === "yolo" && yoloSrc === "phone") fetch("/phone_stop", { method: "POST" }).catch(() => {});
    hist.current = [];
    setCamState("idle"); setStocks(null); setLatency(null);
    onStocks?.(shelfId, null);
  }, [mode, yoloSrc, onStocks, shelfId]);

  useEffect(() => () => stop(), []);            // eslint-disable-line
  useEffect(() => { stop(); }, [yoloSrc]);      // eslint-disable-line  (switching source tears down)

  const showVideo = mode === "yolo" && yoloSrc === "webcam" && camState === "active";
  const showImg   = !showVideo && camState === "active";
  const placeholder = mode === "fomo"
    ? "http://192.168.1.50   (XIAO IP from Serial Monitor)"
    : "http://192.168.1.42:4747/video   (DroidCam stream URL)";
  const totalObjects = stocks ? Object.values(stocks).reduce((a, b) => a + b, 0) : null;

  return (
    <div style={{ flex: "1 1 460px", minWidth: 0, background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${accentColor}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>

      {/* Title bar */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 18 }}>{mode === "fomo" ? "🧠" : "📱"}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            <div style={{ fontSize: 10.5, color: accentColor, fontWeight: 600 }}>
              {mode === "fomo" ? "ESP32 · FOMO on-device" : `Phone · YOLOv8 (${yoloSrc})`}
            </div>
          </div>
        </div>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: camState === "active" ? alertRed : textSecondary, fontWeight: 700, fontSize: 10.5, whiteSpace: "nowrap" }}>
          {camState === "active" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: alertRed, display: "inline-block", animation: "blink 1.2s infinite" }} />}
          {camState === "active" ? "LIVE" : camState === "requesting" ? "CONNECTING…" : camState === "error" ? "ERROR" : "OFFLINE"}
        </span>
      </div>

      {/* Controls */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${border}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {mode === "yolo" && (
          <div style={{ display: "flex", background: bg, border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
            {[{ id: "phone", label: "📱 Phone" }, { id: "webcam", label: "💻 Webcam" }].map((s, i) => {
              const active = yoloSrc === s.id;
              return (
                <button key={s.id} onClick={() => setYoloSrc(s.id)} disabled={camState === "active"}
                  style={{ padding: "5px 12px", border: "none", borderRight: i === 0 ? `1px solid ${border}` : "none", background: active ? accentColor + "22" : "transparent", color: active ? accentColor : textSecondary, fontFamily: font, fontSize: 11, fontWeight: active ? 700 : 400, cursor: camState === "active" ? "not-allowed" : "pointer", opacity: camState === "active" ? 0.5 : 1 }}>
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
        {!(mode === "yolo" && yoloSrc === "webcam") && (
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder} disabled={camState === "active"}
            style={{ background: bg, border: `1px solid ${border}`, borderRadius: 6, color: textPrimary, fontFamily: font, fontSize: 11, padding: "5px 10px", flex: "1 1 180px", minWidth: 120, outline: "none", opacity: camState === "active" ? 0.6 : 1 }} />
        )}
        {camState !== "active"
          ? <button onClick={start} style={btnStyle(accentColor, font)}>🔌 Connect</button>
          : <button onClick={stop}  style={btnStyle(alertRed, font)}>■ Stop</button>}
      </div>

      {/* Hidden capture canvas (webcam) */}
      <canvas ref={captureRef} style={{ display: "none" }} />

      {/* Viewport */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: t.camBg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: showVideo ? "block" : "none" }} />
        <img ref={imgRef} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: showImg ? "block" : "none" }} />
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: camState === "active" ? "block" : "none" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.015) 3px, rgba(255,255,255,0.015) 4px)", pointerEvents: "none" }} />
        {[
          { top: 10, left: 10,     borderTop:    `2px solid ${t.bracketColor}`, borderLeft:   `2px solid ${t.bracketColor}` },
          { top: 10, right: 10,    borderTop:    `2px solid ${t.bracketColor}`, borderRight:  `2px solid ${t.bracketColor}` },
          { bottom: 10, left: 10,  borderBottom: `2px solid ${t.bracketColor}`, borderLeft:   `2px solid ${t.bracketColor}` },
          { bottom: 10, right: 10, borderBottom: `2px solid ${t.bracketColor}`, borderRight:  `2px solid ${t.bracketColor}` },
        ].map((s, i) => <div key={i} style={{ position: "absolute", width: 16, height: 16, ...s }} />)}
        {camState !== "active" && (
          <div style={{ textAlign: "center", color: textSecondary, fontSize: 11.5, zIndex: 1, padding: "0 24px" }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>{mode === "fomo" ? "🧠" : yoloSrc === "webcam" ? "💻" : "📱"}</div>
            {camState === "error"
              ? <div style={{ color: alertRed }}>{camError}</div>
              : mode === "fomo"
                ? <div>Enter the XIAO device IP and press <strong style={{ color: accentColor }}>Connect</strong></div>
                : yoloSrc === "webcam"
                  ? <div>Press <strong style={{ color: accentColor }}>Connect</strong> to use this computer's webcam</div>
                  : <div>Enter your phone's stream URL and press <strong style={{ color: accentColor }}>Connect</strong></div>}
          </div>
        )}
      </div>

      {/* Counts row */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${PRODUCTS.length}, 1fr)`, gap: 1, background: border }}>
        {PRODUCTS.map((p) => {
          const count  = stocks ? stocks[p.id] : null;
          const status = count == null ? "idle" : count === 0 ? "empty" : count <= 3 ? "low" : "ok";
          const statusColor = { idle: textSecondary, empty: alertRed, low: "#FBBF24", ok: green }[status];
          return (
            <div key={p.id} style={{ background: surfaceAlt, padding: "12px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 18, marginBottom: 2 }}>{p.icon}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: count == null ? textSecondary : statusColor, lineHeight: 1 }}>{count ?? "—"}</div>
              <div style={{ fontSize: 9.5, color: statusColor, fontWeight: 600, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {{ idle: "—", empty: "Out", low: "Low", ok: "OK" }[status]} · {p.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: source + latency + last update */}
      <div style={{ padding: "8px 16px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, color: textSecondary, marginTop: "auto" }}>
        <span>{totalObjects != null ? `${totalObjects} items` : "no data"}{latency != null && ` · ${latency}ms`}</span>
        <span>{lastUpdate ? `updated ${formatTime(lastUpdate)}` : "—"}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  AI EVALUATION / HISTORY PAGE
// ─────────────────────────────────────────────
function AiEvaluationPage({ t, inferLog, totalRuns, avgLatency }) {
  const { bg, surfaceAlt, border, textSecondary, accent, green } = t;

  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    fetch("/metrics").then((r) => r.json()).then((d) => setMetrics(d)).catch(() => {});
  }, []);

  // Live per-class confidence from the inference log (both shelves).
  const liveConf = PRODUCTS.map((p) => {
    const vals = inferLog.flatMap((e) =>
      (e.detections || []).filter((d) => d.label === p.id).map((d) => d.conf)
    );
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { ...p, avgConf: avg, count: vals.length };
  });

  const c = metrics?.curves ?? {};

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 28 }}>

      {/* TRAINING CURVES */}
      {c.epochs?.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, padding: "16px 20px" }}>
            <SectionLabel color={textSecondary}>YOLOv8 Loss Curves</SectionLabel>
            <div style={{ display: "flex", gap: 16, fontSize: 10, color: textSecondary, marginBottom: 10 }}>
              <span style={{ color: accent }}>— Train box</span>
              <span style={{ color: "#A78BFA" }}>— Val box</span>
              <span style={{ color: "#F97316" }}>— Train cls</span>
              <span style={{ color: green }}>— Val cls</span>
            </div>
            <LineChart series={[{ data: c.train_box_loss }, { data: c.val_box_loss }, { data: c.train_cls_loss }, { data: c.val_cls_loss }]} colors={[accent, "#A78BFA", "#F97316", green]} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: textSecondary, marginTop: 6 }}>
              <span>Epoch 1</span><span>Epoch {metrics?.epoch_trained}</span>
            </div>
          </div>
          <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, padding: "16px 20px" }}>
            <SectionLabel color={textSecondary}>YOLOv8 Performance Curves</SectionLabel>
            <div style={{ display: "flex", gap: 16, fontSize: 10, color: textSecondary, marginBottom: 10 }}>
              <span style={{ color: accent }}>— Precision</span>
              <span style={{ color: green }}>— Recall</span>
              <span style={{ color: "#F97316" }}>— mAP@50</span>
              <span style={{ color: "#A78BFA" }}>— mAP@50-95</span>
            </div>
            <LineChart series={[{ data: c.precision }, { data: c.recall }, { data: c.mAP50 }, { data: c.mAP50_95 }]} colors={[accent, green, "#F97316", "#A78BFA"]} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: textSecondary, marginTop: 6 }}>
              <span>Epoch 1</span><span>Epoch {metrics?.epoch_trained}</span>
            </div>
          </div>
        </div>
      )}

      {/* LIVE SESSION + CONFIDENCE */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
        <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, padding: "16px 20px" }}>
          <SectionLabel color={textSecondary}>Live Session (both shelves)</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            {[
              { label: "Total Runs",  value: totalRuns,                            color: accent },
              { label: "Avg Latency", value: avgLatency ? `${avgLatency}ms` : "—", color: green },
            ].map((m) => (
              <div key={m.label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: m.color, marginTop: 2 }}>{m.value}</div>
              </div>
            ))}
          </div>
          {totalRuns === 0 && <div style={{ fontSize: 11, color: textSecondary }}>Connect a shelf on the Dashboard to populate live data.</div>}
        </div>

        <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, padding: "16px 20px" }}>
          <SectionLabel color={textSecondary}>Live Detection Confidence</SectionLabel>
          {liveConf.map((p) => (
            <div key={p.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                <span style={{ color: textSecondary }}>{p.icon} {p.label}</span>
                <span style={{ fontWeight: 700, color: p.avgConf != null ? p.color : textSecondary }}>
                  {p.avgConf != null ? `${(p.avgConf * 100).toFixed(1)}%` : "—"}
                  {p.count > 0 && <span style={{ color: textSecondary, fontWeight: 400, marginLeft: 6 }}>({p.count} detections)</span>}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: border, overflow: "hidden" }}>
                <div style={{ height: "100%", width: p.avgConf != null ? `${(p.avgConf * 100).toFixed(1)}%` : "0%", borderRadius: 3, background: p.color, transition: "width 0.5s ease" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* INFERENCE LOG */}
      <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: textSecondary, textTransform: "uppercase", letterSpacing: "0.08em" }}>Inference Log</div>
          {inferLog.length > 0 && <span style={{ fontSize: 10, color: textSecondary }}>{inferLog.length} entr{inferLog.length === 1 ? "y" : "ies"}</span>}
        </div>

        {inferLog.length === 0 ? (
          <div style={{ padding: "14px 20px", fontSize: 11, color: textSecondary }}>No inferences yet — connect a shelf on the Dashboard page.</div>
        ) : (
          <div style={{ height: 280, overflowY: "auto", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed", minWidth: 560 }}>
              <colgroup>
                <col style={{ width: 42 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 80 }} />
                {PRODUCTS.map((p) => <col key={p.id} />)}
              </colgroup>
              <thead>
                <tr style={{ color: textSecondary, textAlign: "left", background: surfaceAlt, position: "sticky", top: 0, zIndex: 2 }}>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>#</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>Shelf</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>Time</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>Latency</th>
                  {PRODUCTS.map((p) => (
                    <th key={p.id} style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>{p.icon} {p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inferLog.map((entry, i) => (
                  <tr key={entry.id} style={{ borderBottom: `1px solid ${border}30` }}
                    onMouseEnter={(e) => e.currentTarget.style.background = border + "30"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "6px 10px", color: textSecondary }}>{inferLog.length - i}</td>
                    <td style={{ padding: "6px 10px", color: entry.shelf === "shelf_1" ? accent : "#F97316", fontWeight: 700 }}>{entry.shelf === "shelf_1" ? "1 · FOMO" : "2 · YOLO"}</td>
                    <td style={{ padding: "6px 10px", color: textSecondary }}>{entry.time}</td>
                    <td style={{ padding: "6px 10px", color: accent, fontWeight: 700 }}>{entry.latency}ms</td>
                    {PRODUCTS.map((p) => (
                      <td key={p.id} style={{ padding: "6px 10px", fontWeight: 600, color: p.color }}>{entry.counts?.[p.id] ?? 0}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  MAIN DASHBOARD
// ─────────────────────────────────────────────
export default function SmartShelfDashboard() {
  const font = `'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace`;

  const [dark, setDark] = useState(true);
  const [page, setPage] = useState("dashboard");
  const t = dark ? THEMES.dark : THEMES.light;
  const { bg, surface, surfaceAlt, border, textPrimary, textSecondary, accent, alertRed, green } = t;

  const [inferLog, setInferLog]     = useState([]);
  const [totalRuns, setTotalRuns]   = useState(0);
  const [avgLatency, setAvgLatency] = useState(null);
  const [shelfStocks, setShelfStocks] = useState({ shelf_1: null, shelf_2: null });
  const latRef = useRef([]);

  const pushLog = useCallback((e) => {
    setInferLog((prev) => [e, ...prev.slice(0, 49)]);
    setTotalRuns((n) => n + 1);
    latRef.current = [...latRef.current.slice(-29), e.latency || 0];
    setAvgLatency(Math.round(latRef.current.reduce((a, b) => a + b, 0) / latRef.current.length));
  }, []);

  const updateStocks = useCallback((shelf, s) => {
    setShelfStocks((prev) => ({ ...prev, [shelf]: s }));
  }, []);

  // Aggregate counts across both shelves.
  const combined = PRODUCTS.map((p) => {
    const a = shelfStocks.shelf_1?.[p.id] ?? 0;
    const b = shelfStocks.shelf_2?.[p.id] ?? 0;
    return { ...p, total: a + b, a, b, hasData: shelfStocks.shelf_1 != null || shelfStocks.shelf_2 != null };
  });

  const NAV = [
    { id: "dashboard",  label: "📊 Dashboard" },
    { id: "workflow",   label: "🔄 Workflow" },
    { id: "evaluation", label: "📋 History" },
  ];

  return (
    <div style={{ fontFamily: font, background: bg, color: textPrimary, minHeight: "100vh", margin: 0, padding: 0, fontSize: "13px", lineHeight: 1.5 }}>

      {/* HEADER */}
      <div style={{ background: `linear-gradient(90deg, ${surface} 0%, ${dark ? "#0F1923" : "#E2EBF3"} 100%)`, borderBottom: `1px solid ${border}` }}>
        <div style={{ padding: "14px 28px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em", color: textPrimary, textAlign: "center" }}>
            R.A.T.S &mdash; Real-Time Auto Tracking Shelf
          </div>
          <button onClick={() => setDark((d) => !d)} title="Toggle theme"
            style={{ position: "absolute", right: 28, top: "50%", transform: "translateY(-50%)", background: "transparent", border: `1px solid ${border}`, borderRadius: 6, color: textSecondary, fontFamily: font, fontSize: 12, padding: "4px 10px", cursor: "pointer" }}>
            {dark ? "☀ Light" : "🌙 Dark"}
          </button>
        </div>
        <nav style={{ display: "flex", justifyContent: "center" }}>
          {NAV.map((n) => {
            const active = page === n.id;
            return (
              <button key={n.id} onClick={() => setPage(n.id)} style={{ padding: "0 18px", height: 42, border: "none", borderBottom: active ? `2px solid ${accent}` : "2px solid transparent", background: "transparent", color: active ? accent : textSecondary, fontFamily: font, fontSize: 12, fontWeight: active ? 700 : 400, cursor: "pointer", letterSpacing: "0.03em", transition: "all 0.15s" }}>
                {n.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* PAGE: DASHBOARD */}
      {page === "dashboard" && (
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 28 }}>

          {/* HARDWARE GRID */}
          <div>
            <SectionLabel color={textSecondary}>System Components — Two Pipelines</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {HARDWARE.map((hw) => (
                <div key={hw.name} style={{ background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${hw.color}`, borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{hw.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: textPrimary }}>{hw.name}</div>
                      <div style={{ fontSize: 11, color: hw.color, marginTop: 1 }}>{hw.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* COMBINED TOTALS */}
          <div>
            <SectionLabel color={textSecondary}>Combined Stock — Both Shelves Aggregated</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${PRODUCTS.length}, 1fr)`, gap: 16 }}>
              {combined.map((p) => {
                const status = !p.hasData ? "idle" : p.total === 0 ? "empty" : p.total <= 3 ? "low" : "ok";
                const alertYellow = "#FBBF24";
                const isAlert     = status === "empty" || status === "low";
                const alertColor  = status === "empty" ? alertRed : alertYellow;
                const statusColor = { idle: textSecondary, empty: alertRed, low: alertYellow, ok: green }[status];
                return (
                  <div key={p.id} style={{ background: isAlert ? (status === "empty" ? alertRed + "0D" : alertYellow + "0A") : surfaceAlt, border: `1px solid ${isAlert ? alertColor + "70" : border}`, borderTop: `3px solid ${isAlert ? alertColor : p.color}`, borderRadius: 10, padding: "16px 20px", boxShadow: isAlert ? `0 0 18px ${alertColor}22` : "none", transition: "all 0.4s ease" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 26 }}>{p.icon}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: textPrimary }}>{p.label}</div>
                          <div style={{ fontSize: 10, color: statusColor, fontWeight: 600 }}>{{ idle: "No data", empty: "OUT OF STOCK", low: "LOW STOCK", ok: "In Stock" }[status]}</div>
                        </div>
                      </div>
                      {isAlert && <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: alertColor + "22", color: alertColor, border: `1px solid ${alertColor}50`, animation: "blink 1.4s infinite" }}>{status === "empty" ? "⛔" : "⚠"}</span>}
                    </div>
                    <div>
                      <span style={{ fontSize: 44, fontWeight: 800, color: !p.hasData ? textSecondary : statusColor, lineHeight: 1 }}>{p.hasData ? p.total : "—"}</span>
                      {p.hasData && <span style={{ fontSize: 11, color: textSecondary, marginLeft: 10 }}>S1 {p.a} + S2 {p.b}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TWO SHELF PANELS */}
          <div>
            <SectionLabel color={textSecondary}>Live Shelves</SectionLabel>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "stretch" }}>
              <ShelfPanel t={t} font={font} shelfId="shelf_1" title="Shelf 1 — XIAO ESP32" mode="fomo" accentColor="#38BDF8" onLog={pushLog} onStocks={updateStocks} />
              <ShelfPanel t={t} font={font} shelfId="shelf_2" title="Shelf 2 — Phone Camera" mode="yolo" accentColor="#F97316" onLog={pushLog} onStocks={updateStocks} />
            </div>
          </div>
        </div>
      )}

      {/* PAGE: WORKFLOW */}
      {page === "workflow" && <WorkflowPage t={t} />}

      {/* PAGE: HISTORY */}
      {page === "evaluation" && (
        <AiEvaluationPage t={t} font={font} inferLog={inferLog} totalRuns={totalRuns} avgLatency={avgLatency} />
      )}

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
//  WORKFLOW PAGE
// ─────────────────────────────────────────────
function WorkflowPage({ t }) {
  const { bg, surface, surfaceAlt, border, textPrimary, textSecondary, accent, green } = t;

  const FLOW = [
    { step: "01", icon: "📷", title: "Frame Captured", desc: "Each shelf captures a frame — XIAO ESP32-S3 camera on Shelf 1, a phone camera on Shelf 2.", color: "#38BDF8", tag: "Capture" },
    { step: "02", icon: "🤖", title: "ML Inference", desc: "Shelf 1 runs FOMO MobileNetV2 on-device (MCU); Shelf 2 streams to the backend where YOLOv8 runs the inference.", color: "#22C55E", tag: "AI Model" },
    { step: "03", icon: "📡", title: "Data Transmitted", desc: "Both pipelines emit counts + detections over HTTP/JSON — Shelf 1 via the device /status, Shelf 2 via /phone_counts.", color: "#A78BFA", tag: "Network" },
    { step: "04", icon: "🧮", title: "Aggregated", desc: "The dashboard merges both shelves into a single combined stock view per product class.", color: "#F97316", tag: "Aggregate" },
    { step: "05", icon: "📊", title: "Dashboard Updated", desc: "React dashboard updates per-shelf counts, combined totals, alerts, and the inference log in real time.", color: accent, tag: "Dashboard" },
  ];

  const MODES = [
    {
      icon: "🧠", title: "Shelf 1 — XIAO ESP32-S3 (FOMO)", color: "#38BDF8",
      rows: [
        { label: "Camera",    value: "OV3660 on XIAO ESP32-S3" },
        { label: "Model",     value: "FOMO MobileNetV2 (Edge Impulse)" },
        { label: "Inference", value: "On-device (MCU) — no cloud" },
        { label: "Output",    value: "/status JSON (counts + points)" },
        { label: "Latency",   value: "~50–150 ms" },
      ],
    },
    {
      icon: "📱", title: "Shelf 2 — Phone Camera (YOLOv8)", color: "#F97316",
      rows: [
        { label: "Camera",    value: "Phone via DroidCam / IP Webcam" },
        { label: "Model",     value: "YOLOv8 (best.pt)" },
        { label: "Inference", value: "Flask backend (CPU/GPU)" },
        { label: "Output",    value: "/phone_counts JSON detections" },
        { label: "Latency",   value: "~30–120 ms" },
      ],
    },
  ];

  const STACK = [
    { layer: "Hardware",  items: ["XIAO ESP32-S3 Sense", "Phone (DroidCam / IP Webcam)"],          color: "#FBBF24" },
    { layer: "ML",        items: ["Edge Impulse", "FOMO MobileNetV2", "YOLOv8 (best.pt)"],          color: "#22C55E" },
    { layer: "Backend",   items: ["Python Flask", "Ultralytics", "OpenCV", "PyTorch"],              color: "#A78BFA" },
    { layer: "Frontend",  items: ["React + Vite", "WebRTC getUserMedia", "Canvas API", "Fetch API"], color: "#38BDF8" },
  ];

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 32 }}>

      {/* MAIN FLOW */}
      <div>
        <SectionLabel color={textSecondary}>System Flow</SectionLabel>
        <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          {FLOW.map((s, i) => (
            <div key={s.step} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ flex: 1, background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: "18px 16px", position: "relative" }}>
                <div style={{ position: "absolute", top: 12, right: 12, fontSize: 9, fontWeight: 700, color: s.color, background: s.color + "18", border: `1px solid ${s.color}40`, borderRadius: 20, padding: "2px 7px", letterSpacing: "0.05em" }}>{s.tag}</div>
                <div style={{ fontSize: 28, marginBottom: 10 }}>{s.icon}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: s.color, letterSpacing: "0.08em", marginBottom: 4 }}>STEP {s.step}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 11, color: textSecondary, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
              {i < FLOW.length - 1 && (
                <div style={{ flexShrink: 0, width: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{ width: "100%", height: 2, background: `linear-gradient(90deg, ${FLOW[i].color}, ${FLOW[i+1].color})`, borderRadius: 1 }} />
                  <div style={{ width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: `7px solid ${FLOW[i+1].color}`, marginTop: -7, alignSelf: "flex-end", marginRight: -1 }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* OPERATING MODES */}
      <div>
        <SectionLabel color={textSecondary}>The Two Pipelines</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {MODES.map((m) => (
            <div key={m.title} style={{ background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${m.color}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${border}` }}>
                <span style={{ fontSize: 20 }}>{m.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: textPrimary }}>{m.title}</span>
              </div>
              <div style={{ padding: "10px 0" }}>
                {m.rows.map((r) => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 18px", gap: 12 }}>
                    <span style={{ fontSize: 11, color: textSecondary, flexShrink: 0 }}>{r.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: textPrimary, textAlign: "right" }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TECH STACK */}
      <div>
        <SectionLabel color={textSecondary}>Tech Stack</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {STACK.map((s) => (
            <div key={s.layer} style={{ background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>{s.layer}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {s.items.map((item) => (
                  <div key={item} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: textPrimary }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

function SectionLabel({ children, color = "#7B8BA5" }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
      {children}
    </div>
  );
}

function btnStyle(color, font) {
  return {
    padding: "6px 14px", borderRadius: 6, border: `1px solid ${color}60`,
    background: color + "18", color, cursor: "pointer", fontSize: 12,
    fontWeight: 600, fontFamily: font, letterSpacing: "0.02em", whiteSpace: "nowrap",
  };
}
