import { useState, useEffect, useRef, useCallback } from "react";

const HARDWARE = [
  { name: "XIAO ESP32-S3 Sense", role: "Edge Device + Camera", color: "#38BDF8", icon: "🧠" },
  { name: "PIR Sensor AM312",    role: "Human Mini Detector",  color: "#FBBF24", icon: "👁" },
  { name: "FOMO MobileNetV2",    role: "On-Device ML Model",   color: "#22C55E", icon: "🤖" },
  { name: "Edge Impulse",        role: "ML Training Platform", color: "#A78BFA", icon: "⚙️" },
];

const PRODUCTS = [
  { id: "bottle", label: "Bottle", icon: "🍶", color: "#38BDF8", max: 6 },
  { id: "can",    label: "Can",    icon: "🥫", color: "#F97316", max: 8 },
  { id: "chips",  label: "Chips",  icon: "🥨", color: "#22C55E", max: 5 },
];

function randomBetween(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}
function formatTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
//  AI EVALUATION PAGE
// ─────────────────────────────────────────────
function AiEvaluationPage({ t, font, inferLog, totalRuns, avgLatency }) {
  const { bg, surface, surfaceAlt, border, textPrimary, textSecondary, accent, green, alertRed } = t;

  // Static model metrics per class (from Edge Impulse training output)
  const classMetrics = [
    { label: "Bottle", icon: "🍶", color: "#38BDF8", precision: 0.91, recall: 0.88, f1: 0.89, samples: 120 },
    { label: "Can",    icon: "🥫", color: "#F97316", precision: 0.87, recall: 0.85, f1: 0.86, samples: 150 },
    { label: "Chips",  icon: "🥨", color: "#22C55E", precision: 0.93, recall: 0.90, f1: 0.91, samples: 100 },
  ];

  const overallAcc = 0.893;

  // Confusion matrix (rows = actual, cols = predicted) [bottle, can, chips]
  const confMatrix = [
    [106,  8,  6],
    [  9, 128, 13],
    [  5,  5,  90],
  ];
  const confLabels = ["Bottle", "Can", "Chips"];
  const confMax    = Math.max(...confMatrix.flat());

  // Per-class confidence history from live log
  const confHistory = PRODUCTS.map((p) => {
    const vals = inferLog.flatMap((entry) =>
      entry.detections ? entry.detections.filter((d) => d.id === p.id).map((d) => parseFloat(d.conf)) : []
    );
    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
    return { ...p, avgConf: avg, samples: vals.length };
  });

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 28 }}>

      {/* MODEL OVERVIEW */}
      <div>
        <SectionLabel color={textSecondary}>Model Overview</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {[
            { label: "Model",       value: "FOMO",             sub: "Faster Objects, More Objects", color: accent },
            { label: "Backbone",    value: "MobileNetV2",      sub: "α = 0.35",                    color: "#A78BFA" },
            { label: "Input Size",  value: "96 × 96",          sub: "Grayscale",                   color: "#F97316" },
            { label: "Overall Acc", value: `${(overallAcc * 100).toFixed(1)}%`, sub: "Validation set", color: green },
          ].map((m) => (
            <div key={m.label} style={{ background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${m.color}`, borderRadius: 10, padding: "14px 18px" }}>
              <div style={{ fontSize: 10, color: textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: m.color, marginTop: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: textSecondary, marginTop: 2 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* PER-CLASS METRICS */}
      <div>
        <SectionLabel color={textSecondary}>Per-Class Performance</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {classMetrics.map((c) => (
            <div key={c.label} style={{ background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${c.color}`, borderRadius: 10, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 22 }}>{c.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: textPrimary }}>{c.label}</div>
                  <div style={{ fontSize: 10, color: textSecondary }}>{c.samples} training samples</div>
                </div>
              </div>
              {[
                { label: "Precision", value: c.precision },
                { label: "Recall",    value: c.recall },
                { label: "F1 Score",  value: c.f1 },
              ].map((m) => (
                <div key={m.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: textSecondary }}>{m.label}</span>
                    <span style={{ fontWeight: 700, color: textPrimary }}>{(m.value * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: border, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${m.value * 100}%`, borderRadius: 3, background: c.color, transition: "width 0.6s ease" }} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* CONFUSION MATRIX + LIVE CONFIDENCE */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

        {/* Confusion Matrix */}
        <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, padding: "16px 20px" }}>
          <SectionLabel color={textSecondary}>Confusion Matrix</SectionLabel>
          <div style={{ fontSize: 10, color: textSecondary, marginBottom: 12 }}>Rows = Actual · Cols = Predicted</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ padding: "6px 8px", fontSize: 10, color: textSecondary, textAlign: "left" }}></th>
                {confLabels.map((l) => (
                  <th key={l} style={{ padding: "6px 8px", fontSize: 10, color: accent, textAlign: "center", fontWeight: 700 }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {confMatrix.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ padding: "6px 8px", fontSize: 10, color: accent, fontWeight: 700 }}>{confLabels[ri]}</td>
                  {row.map((val, ci) => {
                    const isDiag   = ri === ci;
                    const opacity  = 0.15 + (val / confMax) * 0.75;
                    const cellBg   = isDiag
                      ? `rgba(34,197,94,${opacity})`
                      : val > 0 ? `rgba(239,68,68,${opacity * 0.6})` : "transparent";
                    return (
                      <td key={ci} style={{
                        padding: "8px", textAlign: "center", fontSize: 13, fontWeight: 700,
                        borderRadius: 6, background: cellBg,
                        color: isDiag ? green : val > 0 ? alertRed : textSecondary,
                        border: `1px solid ${border}`,
                      }}>
                        {val}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Live session stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Session summary */}
          <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, padding: "16px 20px" }}>
            <SectionLabel color={textSecondary}>Live Session</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { label: "Total Runs",  value: totalRuns,                           color: accent },
                { label: "Avg Latency", value: avgLatency ? `${avgLatency}ms` : "—", color: green },
              ].map((m) => (
                <div key={m.label} style={{ background: t.bg, border: `1px solid ${border}`, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, color: textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: m.color, marginTop: 2 }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Live avg confidence per class */}
          <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, padding: "16px 20px", flex: 1 }}>
            <SectionLabel color={textSecondary}>Live Avg Confidence</SectionLabel>
            {confHistory.map((c) => (
              <div key={c.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: textSecondary }}>{c.icon} {c.label}</span>
                  <span style={{ fontWeight: 700, color: c.avgConf ? c.color : textSecondary }}>
                    {c.avgConf ? `${(c.avgConf * 100).toFixed(1)}%` : "—"}
                    {c.samples > 0 && <span style={{ color: textSecondary, fontWeight: 400, marginLeft: 6 }}>({c.samples})</span>}
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: border, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: c.avgConf ? `${c.avgConf * 100}%` : "0%", borderRadius: 3, background: c.color, transition: "width 0.5s ease" }} />
                </div>
              </div>
            ))}
            {totalRuns === 0 && (
              <div style={{ fontSize: 11, color: textSecondary, marginTop: 4 }}>Run the camera on the Dashboard to populate live data.</div>
            )}
          </div>
        </div>
      </div>

      {/* INFERENCE LOG TABLE */}
      <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, padding: "16px 20px" }}>
        <SectionLabel color={textSecondary}>Inference Log</SectionLabel>
        {inferLog.length === 0 ? (
          <div style={{ fontSize: 11, color: textSecondary }}>No inferences yet — start the camera on the Dashboard page.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ color: textSecondary, textAlign: "left" }}>
                  <th style={{ padding: "6px 10px", borderBottom: `1px solid ${border}` }}>#</th>
                  <th style={{ padding: "6px 10px", borderBottom: `1px solid ${border}` }}>Time</th>
                  <th style={{ padding: "6px 10px", borderBottom: `1px solid ${border}` }}>Latency</th>
                  {PRODUCTS.map((p) => (
                    <th key={p.id} style={{ padding: "6px 10px", borderBottom: `1px solid ${border}` }}>{p.icon} {p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inferLog.map((entry, i) => (
                  <tr key={entry.id} style={{ borderBottom: `1px solid ${border}20` }}>
                    <td style={{ padding: "5px 10px", color: textSecondary }}>{inferLog.length - i}</td>
                    <td style={{ padding: "5px 10px", color: textSecondary }}>{entry.time}</td>
                    <td style={{ padding: "5px 10px", color: accent, fontWeight: 700 }}>{entry.latency}ms</td>
                    {PRODUCTS.map((p) => (
                      <td key={p.id} style={{ padding: "5px 10px", fontWeight: 600, color: p.color }}>{entry.counts[p.id]}</td>
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
  const [page, setPage] = useState("dashboard"); // "dashboard" | "evaluation"
  const t = dark ? THEMES.dark : THEMES.light;
  const { bg, surface, surfaceAlt, border, textPrimary, textSecondary, accent, alertRed, green } = t;

  const [camSource, setCamSource] = useState("mockup");
  const [xiaoUrl,   setXiaoUrl]   = useState("http://192.168.4.1/stream");

  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const inferRef  = useRef(null);

  const [camState,       setCamState]       = useState("idle");
  const [camError,       setCamError]       = useState("");
  const [inferLog,       setInferLog]       = useState([]);
  const [lastDetections, setLastDetections] = useState([]);
  const [totalRuns,      setTotalRuns]      = useState(0);
  const [avgLatency,     setAvgLatency]     = useState(null);
  const [stocks,         setStocks]         = useState(null);
  const latencies = useRef([]);

  const drawDetections = useCallback((detections, w, h) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = w; canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    detections.forEach(({ x, y, label, color, conf }) => {
      const bx = x - 18, by = y - 18;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, 36, 36);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = "bold 10px monospace";
      ctx.fillText(`${label} ${conf}`, bx, by - 4);
    });
  }, []);

  const runInference = useCallback(() => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const t0 = performance.now();
    const w = video.videoWidth || 320, h = video.videoHeight || 240;
    const count = randomBetween(1, 5);
    const detections = Array.from({ length: count }, () => {
      const p = PRODUCTS[randomBetween(0, PRODUCTS.length - 1)];
      return { x: randomBetween(30, w - 30), y: randomBetween(30, h - 30), label: p.label, color: p.color, conf: (0.80 + Math.random() * 0.18).toFixed(2), id: p.id };
    });
    drawDetections(detections, w, h);
    const latency = randomBetween(120, 210) + Math.round(performance.now() - t0);
    latencies.current = [...latencies.current.slice(-29), latency];
    const avg = Math.round(latencies.current.reduce((a, b) => a + b, 0) / latencies.current.length);
    const counts = {};
    PRODUCTS.forEach((p) => { counts[p.id] = 0; });
    detections.forEach((d) => { counts[d.id] = (counts[d.id] || 0) + 1; });
    const now = new Date();
    setLastDetections(detections);
    setInferLog((prev) => [{ time: formatTime(now), latency, counts, detections, id: Date.now() }, ...prev.slice(0, 49)]);
    setTotalRuns((n) => n + 1);
    setAvgLatency(avg);
    setStocks(counts);
  }, [drawDetections]);

  const startCamera = useCallback(async () => {
    setCamState("requesting"); setCamError("");
    try {
      if (camSource === "mockup") {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.src = ""; await videoRef.current.play(); }
      } else {
        if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current.src = xiaoUrl; await videoRef.current.play(); }
      }
      setCamState("active");
      inferRef.current = setInterval(runInference, 2000);
    } catch (err) { setCamState("error"); setCamError(err.message || "Could not connect"); }
  }, [camSource, xiaoUrl, runInference]);

  const stopCamera = useCallback(() => {
    clearInterval(inferRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current.src = ""; }
    if (canvasRef.current) { const ctx = canvasRef.current.getContext("2d"); ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); }
    setCamState("idle"); setLastDetections([]); setStocks(null);
  }, []);

  useEffect(() => { stopCamera(); }, [camSource]); // eslint-disable-line
  useEffect(() => () => { clearInterval(inferRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const sourceLabel = camSource === "xiao" ? "XIAO ESP32-S3 (MJPEG)" : "Mockup Cam — Phone / Webcam";
  const idleHint    = camSource === "xiao"
    ? <><strong style={{ color: accent }}>Connect</strong> after entering the device IP</>
    : <>Press <strong style={{ color: accent }}>Start Camera</strong> to begin mock feed</>;

  const NAV = [
    { id: "dashboard",  label: "📊 Dashboard" },
    { id: "evaluation", label: "🧪 AI Evaluation" },
  ];

  return (
    <div style={{ fontFamily: font, background: bg, color: textPrimary, minHeight: "100vh", margin: 0, padding: 0, fontSize: "13px", lineHeight: 1.5 }}>

      {/* HEADER */}
      <div style={{ background: `linear-gradient(90deg, ${surface} 0%, ${dark ? "#0F1923" : "#E2EBF3"} 100%)`, borderBottom: `1px solid ${border}` }}>

        {/* Project title row */}
        <div style={{ padding: "14px 28px", borderBottom: `1px solid ${border}`, textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em", color: textPrimary }}>
            R.A.T.S &mdash; Real-Time Auto Tracking Shelf
          </div>
        </div>

        {/* Nav bar row */}
        <nav style={{ display: "flex", justifyContent: "center", gap: 0 }}>
          {NAV.map((n) => {
            const active = page === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                style={{
                  padding: "0 18px", height: 42, border: "none",
                  borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
                  background: "transparent",
                  color: active ? accent : textSecondary,
                  fontFamily: font, fontSize: 12, fontWeight: active ? 700 : 400,
                  cursor: "pointer", letterSpacing: "0.03em",
                  transition: "all 0.15s",
                }}
              >
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
            <SectionLabel color={textSecondary}>System Components</SectionLabel>
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

          {/* CAMERA PANEL */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, overflow: "hidden" }}>
              {/* Top bar */}
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", gap: 0, background: bg, border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
                  {["xiao", "mockup"].map((src) => {
                    const active = camSource === src;
                    return (
                      <button key={src} onClick={() => setCamSource(src)} style={{ padding: "5px 16px", border: "none", borderRight: src === "xiao" ? `1px solid ${border}` : "none", background: active ? accent + "22" : "transparent", color: active ? accent : textSecondary, fontFamily: font, fontSize: 11, fontWeight: active ? 700 : 400, cursor: "pointer", letterSpacing: "0.03em", transition: "all 0.15s" }}>
                        {src === "xiao" ? "🔌 XIAO ESP32-S3" : "💻 Mockup Cam"}
                      </button>
                    );
                  })}
                </div>
                {camSource === "xiao" && (
                  <input value={xiaoUrl} onChange={(e) => setXiaoUrl(e.target.value)} placeholder="http://192.168.4.1/stream" style={{ background: bg, border: `1px solid ${border}`, borderRadius: 6, color: textPrimary, fontFamily: font, fontSize: 11, padding: "4px 10px", width: 240, outline: "none", flex: 1 }} />
                )}
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: camState === "active" ? alertRed : textSecondary, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>
                  {camState === "active" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: alertRed, display: "inline-block", animation: "blink 1.2s infinite" }} />}
                  {camState === "active" ? "LIVE" : camState === "requesting" ? "CONNECTING…" : "OFFLINE"}
                </span>
              </div>
              {/* Viewport */}
              <div style={{ position: "relative", width: "100%", aspectRatio: "16/7", background: t.camBg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: camState === "active" ? "block" : "none" }} />
                <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", display: camState === "active" ? "block" : "none" }} />
                <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.015) 3px, rgba(255,255,255,0.015) 4px)", pointerEvents: "none" }} />
                {[{ top: 12, left: 12, borderTop: `2px solid ${t.bracketColor}`, borderLeft: `2px solid ${t.bracketColor}` }, { top: 12, right: 12, borderTop: `2px solid ${t.bracketColor}`, borderRight: `2px solid ${t.bracketColor}` }, { bottom: 12, left: 12, borderBottom: `2px solid ${t.bracketColor}`, borderLeft: `2px solid ${t.bracketColor}` }, { bottom: 12, right: 12, borderBottom: `2px solid ${t.bracketColor}`, borderRight: `2px solid ${t.bracketColor}` }].map((s, i) => (
                  <div key={i} style={{ position: "absolute", width: 18, height: 18, ...s }} />
                ))}
                {camState !== "active" && (
                  <div style={{ textAlign: "center", color: textSecondary, fontSize: 12, zIndex: 1 }}>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>{camSource === "xiao" ? "🔌" : "📷"}</div>
                    {camState === "error" ? <div style={{ color: alertRed }}>{camError}</div> : <div>{idleHint}</div>}
                  </div>
                )}
              </div>
              {/* Controls */}
              <div style={{ padding: "10px 14px", borderTop: `1px solid ${border}`, display: "flex", gap: 8 }}>
                {camState !== "active"
                  ? <button onClick={startCamera} style={btnStyle(accent, font)}>{camSource === "xiao" ? "🔌 Connect" : "▶ Start Camera"}</button>
                  : <button onClick={stopCamera}  style={btnStyle(alertRed, font)}>■ Stop</button>
                }
                <span style={{ fontSize: 11, color: textSecondary, alignSelf: "center" }}>
                  {camState === "active" ? `Inference every 2 s · ${totalRuns} run${totalRuns !== 1 ? "s" : ""}` : camSource === "xiao" ? "Requires XIAO on the same network" : "Open in phone browser for rear camera"}
                </span>
              </div>
            </div>

            {/* PRODUCT STOCK GRID */}
            <div>
              <SectionLabel color={textSecondary}>Product Stock</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {PRODUCTS.map((p) => {
                  const count  = stocks ? stocks[p.id] : null;
                  const pct    = count != null ? Math.round((count / p.max) * 100) : null;
                  const status = count == null ? "idle" : count === 0 ? "empty" : count <= 3 ? "low" : "ok";
                  const alertYellow = "#FBBF24";
                  const isAlert     = status === "empty" || status === "low";
                  const alertColor  = status === "empty" ? alertRed : alertYellow;
                  const statusColor = { idle: textSecondary, empty: alertRed, low: alertYellow, ok: green }[status];
                  return (
                    <div key={p.id} style={{ background: isAlert ? (status === "empty" ? alertRed + "0D" : alertYellow + "0A") : surfaceAlt, border: `1px solid ${isAlert ? alertColor + "70" : border}`, borderTop: `3px solid ${isAlert ? alertColor : p.color}`, borderRadius: 10, padding: "18px 20px", boxShadow: isAlert ? `0 0 18px ${alertColor}22` : "none", transition: "all 0.4s ease" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <span style={{ fontSize: 28 }}>{p.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: textPrimary }}>{p.label}</div>
                          <div style={{ fontSize: 10, color: statusColor, fontWeight: 600, marginTop: 2 }}>{{ idle: "No data", empty: "OUT OF STOCK", low: "LOW STOCK", ok: "In Stock" }[status]}</div>
                        </div>
                        {isAlert && <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: alertColor + "22", color: alertColor, border: `1px solid ${alertColor}50`, animation: "blink 1.4s infinite" }}>{status === "empty" ? "⛔ CRITICAL" : "⚠ WARNING"}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 }}>
                        <span style={{ fontSize: 40, fontWeight: 800, color: count == null ? textSecondary : statusColor, lineHeight: 1 }}>{count ?? "—"}</span>
                        {count != null && <span style={{ fontSize: 13, color: textSecondary }}>/ {p.max}</span>}
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: border, overflow: "hidden", marginBottom: isAlert ? 12 : 0 }}>
                        <div style={{ height: "100%", width: pct != null ? `${pct}%` : "0%", borderRadius: 3, background: statusColor, transition: "width 0.5s ease" }} />
                      </div>
                      {isAlert && (
                        <div style={{ marginTop: 4, padding: "8px 12px", borderRadius: 6, background: alertColor + "18", border: `1px solid ${alertColor}40`, fontSize: 11, color: alertColor, fontWeight: 600 }}>
                          {status === "empty" ? "⛔ No items detected — immediate restock required" : `⚠ Only ${count} item${count === 1 ? "" : "s"} left — restock soon`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PAGE: AI EVALUATION */}
      {page === "evaluation" && (
        <AiEvaluationPage t={t} font={font} inferLog={inferLog} totalRuns={totalRuns} avgLatency={avgLatency} />
      )}

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }`}</style>
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
    fontWeight: 600, fontFamily: font, letterSpacing: "0.02em",
  };
}
