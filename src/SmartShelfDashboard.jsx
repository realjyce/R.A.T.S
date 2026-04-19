import { useState, useEffect, useRef, useCallback } from "react";

const HARDWARE = [
  { name: "XIAO ESP32-S3 Sense", role: "Edge Device + Camera", color: "#38BDF8", icon: "🧠" },
  { name: "PIR Sensor AM312",    role: "Human Mini Detector",  color: "#FBBF24", icon: "👁" },
  { name: "FOMO MobileNetV2",    role: "On-Device ML Model",   color: "#22C55E", icon: "🤖" },
  { name: "Edge Impulse",        role: "ML Training Platform", color: "#A78BFA", icon: "⚙️" },
];

const PRODUCTS = [
  { id: "bottle", label: "Bottle", icon: "🍶", color: "#38BDF8" },
  { id: "snack",  label: "Snack",  icon: "🍿", color: "#F97316" },
  { id: "cup",    label: "Cup",    icon: "🍜", color: "#22C55E" },
];

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
//  AI EVALUATION PAGE
// ─────────────────────────────────────────────
function AiEvaluationPage({ t, inferLog, totalRuns, avgLatency }) {
  const { bg, surfaceAlt, border, textSecondary, accent, green } = t;

  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    fetch("/metrics")
      .then((r) => r.json())
      .then((d) => setMetrics(d))
      .catch(() => {});
  }, []);

  // Live per-class confidence from webcam inference log
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
            <SectionLabel color={textSecondary}>Loss Curves</SectionLabel>
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
            <SectionLabel color={textSecondary}>Performance Curves</SectionLabel>
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
          <SectionLabel color={textSecondary}>Live Session</SectionLabel>
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
          {totalRuns === 0 && <div style={{ fontSize: 11, color: textSecondary }}>Start the webcam on the Dashboard to populate live data.</div>}
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
        {/* Header row */}
        <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: textSecondary, textTransform: "uppercase", letterSpacing: "0.08em" }}>Inference Log</div>
          {inferLog.length > 0 && (
            <span style={{ fontSize: 10, color: textSecondary }}>{inferLog.length} entr{inferLog.length === 1 ? "y" : "ies"}</span>
          )}
        </div>

        {inferLog.length === 0 ? (
          <div style={{ padding: "14px 20px", fontSize: 11, color: textSecondary }}>
            No inferences yet — start the webcam on the Dashboard page.
          </div>
        ) : (
          /* Scrollable table — sticky thead stays, tbody scrolls */
          <div style={{ height: 280, overflowY: "auto", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed", minWidth: 480 }}>
              <colgroup>
                <col style={{ width: 42 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 80 }} />
                {PRODUCTS.map((p) => <col key={p.id} />)}
              </colgroup>
              <thead>
                <tr style={{ color: textSecondary, textAlign: "left", background: surfaceAlt, position: "sticky", top: 0, zIndex: 2 }}>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>#</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>Time</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>Latency</th>
                  {PRODUCTS.map((p) => (
                    <th key={p.id} style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}>{p.icon} {p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inferLog.map((entry, i) => (
                  <tr key={entry.id} style={{ borderBottom: `1px solid ${border}30`, transition: "background 0.15s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = border + "30"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "6px 10px", color: textSecondary }}>{inferLog.length - i}</td>
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

  const [camSource, setCamSource] = useState("xiao"); // "xiao" | "webcam"
  const [xiaoUrl,   setXiaoUrl]  = useState("http://192.168.4.1/stream");
  const [camState,  setCamState] = useState("idle"); // idle | requesting | active | error
  const [camError,  setCamError] = useState("");
  const [inferLog, setInferLog] = useState([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [avgLatency, setAvgLatency] = useState(null);
  const [stocks,    setStocks]   = useState(null);

  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);   // detection overlay (webcam mode)
  const captureRef  = useRef(null);   // hidden canvas for frame capture
  const inferRef    = useRef(null);
  const latencies   = useRef([]);

  const streamRef = useRef(null);

  // ── Draw YOLO boxes on overlay canvas ─────────────────────────
  const drawBoxes = useCallback((detections, vw, vh) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, vw, vh);
    const COLORS = { bottle: "#38BDF8", snack: "#F97316", cup: "#22C55E" };
    detections.forEach(({ x1, y1, x2, y2, label, conf }) => {
      const color = COLORS[label] ?? "#FFFFFF";
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc((x1+x2)/2, (y1+y2)/2, 4, 0, Math.PI*2); ctx.fill();
      const txt = `${label} ${(conf*100).toFixed(0)}%`;
      ctx.font = "bold 11px monospace";
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = color + "CC"; ctx.fillRect(x1, y1 - 18, tw + 10, 18);
      ctx.fillStyle = "#000"; ctx.fillText(txt, x1 + 5, y1 - 4);
    });
  }, []);

  // ── Webcam: capture frame → /detect → draw boxes ──────────────
  const runDetection = useCallback(async () => {
    const video   = videoRef.current;
    const capture = captureRef.current;
    if (!video || !capture || video.readyState < 2) return;
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    capture.width = vw; capture.height = vh;
    capture.getContext("2d").drawImage(video, 0, 0, vw, vh);
    const dataUrl = capture.toDataURL("image/jpeg", 0.8);
    try {
      const res  = await fetch("/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
      const data = await res.json();
      if (!data.detections) return;
      drawBoxes(data.detections, vw, vh);
      const latency = data.latency ?? 0;
      latencies.current = [...latencies.current.slice(-29), latency];
      const avg = Math.round(latencies.current.reduce((a, b) => a + b, 0) / latencies.current.length);
      setStocks(data.counts);
      setTotalRuns((n) => n + 1);
      setAvgLatency(avg);
      setInferLog((prev) => [{ time: formatTime(new Date()), latency, counts: data.counts, detections: data.detections, id: Date.now() }, ...prev.slice(0, 49)]);
    } catch { /* backend not reachable */ }
  }, [drawBoxes]);

  // ── XIAO: poll /status for stock counts ───────────────────────
  const pollStocks = useCallback(async () => {
    try {
      const base = xiaoUrl.replace("/stream", "");
      const res  = await fetch(`${base}/status`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      if (data.counts) {
        setStocks(data.counts);
        const latency = data.latency ?? 0;
        latencies.current = [...latencies.current.slice(-29), latency];
        const avg = Math.round(latencies.current.reduce((a, b) => a + b, 0) / latencies.current.length);
        setTotalRuns((n) => n + 1);
        setAvgLatency(avg);
        setInferLog((prev) => [{ time: formatTime(new Date()), latency, counts: data.counts, id: Date.now() }, ...prev.slice(0, 49)]);
      }
    } catch { /* silently skip */ }
  }, [xiaoUrl]);

  const startCamera = useCallback(async () => {
    setCamState("requesting"); setCamError("");
    try {
      if (camSource === "webcam") {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.src = ""; await videoRef.current.play(); }
        inferRef.current = setInterval(runDetection, 2000);
      } else {
        if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current.src = xiaoUrl; await videoRef.current.play(); }
        inferRef.current = setInterval(pollStocks, 2000);
      }
      setCamState("active");
    } catch (err) { setCamState("error"); setCamError(err.message || "Could not connect"); }
  }, [camSource, xiaoUrl, runDetection, pollStocks]);

  const stopCamera = useCallback(() => {
    clearInterval(inferRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current.src = ""; }
    if (canvasRef.current) { const ctx = canvasRef.current.getContext("2d"); ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); }
    setCamState("idle"); setStocks(null);
  }, []);

  useEffect(() => { stopCamera(); }, [camSource]); // eslint-disable-line
  useEffect(() => () => clearInterval(inferRef.current), []);

  const NAV = [
    { id: "dashboard",  label: "📊 Dashboard" },
    { id: "workflow",   label: "🔄 Workflow" },
    { id: "evaluation", label: "📋 History" },
  ];

  return (
    <div style={{ fontFamily: font, background: bg, color: textPrimary, minHeight: "100vh", margin: 0, padding: 0, fontSize: "13px", lineHeight: 1.5 }}>

      {/* HEADER */}
      <div style={{ background: `linear-gradient(90deg, ${surface} 0%, ${dark ? "#0F1923" : "#E2EBF3"} 100%)`, borderBottom: `1px solid ${border}` }}>
        <div style={{ padding: "14px 28px", borderBottom: `1px solid ${border}`, textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em", color: textPrimary }}>
            R.A.T.S &mdash; Real-Time Auto Tracking Shelf
          </div>
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

              {/* Top bar: source toggle + URL + status */}
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 12 }}>

                {/* Source toggle */}
                <div style={{ display: "flex", background: bg, border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                  {[
                    { id: "xiao",   label: "🔌 XIAO ESP32-S3" },
                    { id: "webcam", label: "📷 Webcam" },
                  ].map((src, i) => {
                    const active = camSource === src.id;
                    return (
                      <button key={src.id} onClick={() => setCamSource(src.id)} style={{ padding: "5px 14px", border: "none", borderRight: i === 0 ? `1px solid ${border}` : "none", background: active ? accent + "22" : "transparent", color: active ? accent : textSecondary, fontFamily: font, fontSize: 11, fontWeight: active ? 700 : 400, cursor: "pointer", transition: "all 0.15s" }}>
                        {src.label}
                      </button>
                    );
                  })}
                </div>

                {/* URL input — XIAO only */}
                {camSource === "xiao" && (
                  <input
                    value={xiaoUrl}
                    onChange={(e) => setXiaoUrl(e.target.value)}
                    placeholder="http://192.168.4.1/stream"
                    style={{ background: bg, border: `1px solid ${border}`, borderRadius: 6, color: textPrimary, fontFamily: font, fontSize: 11, padding: "4px 10px", flex: 1, outline: "none" }}
                  />
                )}

                {/* Live status */}
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: camState === "active" ? alertRed : textSecondary, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>
                  {camState === "active" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: alertRed, display: "inline-block", animation: "blink 1.2s infinite" }} />}
                  {camState === "active" ? "LIVE" : camState === "requesting" ? "CONNECTING…" : "OFFLINE"}
                </span>
              </div>

              {/* Hidden capture canvas (off-screen) */}
              <canvas ref={captureRef} style={{ display: "none" }} />

              {/* Viewport */}
              <div style={{ position: "relative", width: "100%", aspectRatio: "16/7", background: t.camBg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: camState === "active" ? "block" : "none" }} />
                {/* Detection overlay — webcam mode only */}
                <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", display: camSource === "webcam" && camState === "active" ? "block" : "none" }} />
                <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.015) 3px, rgba(255,255,255,0.015) 4px)", pointerEvents: "none" }} />
                {[
                  { top: 12, left: 12,     borderTop:    `2px solid ${t.bracketColor}`, borderLeft:   `2px solid ${t.bracketColor}` },
                  { top: 12, right: 12,    borderTop:    `2px solid ${t.bracketColor}`, borderRight:  `2px solid ${t.bracketColor}` },
                  { bottom: 12, left: 12,  borderBottom: `2px solid ${t.bracketColor}`, borderLeft:   `2px solid ${t.bracketColor}` },
                  { bottom: 12, right: 12, borderBottom: `2px solid ${t.bracketColor}`, borderRight:  `2px solid ${t.bracketColor}` },
                ].map((s, i) => <div key={i} style={{ position: "absolute", width: 18, height: 18, ...s }} />)}
                {camState !== "active" && (
                  <div style={{ textAlign: "center", color: textSecondary, fontSize: 12, zIndex: 1 }}>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>{camSource === "xiao" ? "🔌" : "📷"}</div>
                    {camState === "error"
                      ? <div style={{ color: alertRed }}>{camError}</div>
                      : camSource === "xiao"
                        ? <div>Enter the XIAO stream URL above and press <strong style={{ color: accent }}>Connect</strong></div>
                        : <div>Press <strong style={{ color: accent }}>Connect</strong> to open your webcam</div>
                    }
                  </div>
                )}
              </div>

              {/* Connect / Stop button */}
              <div style={{ padding: "10px 14px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "center" }}>
                {camState !== "active"
                  ? <button onClick={startCamera} style={btnStyle(accent, font)}>🔌 Connect</button>
                  : <button onClick={stopCamera}  style={btnStyle(alertRed, font)}>■ Stop</button>
                }
              </div>
            </div>

            {/* PRODUCT STOCK GRID */}
            <div>
              <SectionLabel color={textSecondary}>Product Stock</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {PRODUCTS.map((p) => {
                  const count  = stocks ? stocks[p.id] : null;
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
                      <div style={{ marginBottom: isAlert ? 12 : 0 }}>
                        <span style={{ fontSize: 48, fontWeight: 800, color: count == null ? textSecondary : statusColor, lineHeight: 1 }}>{count ?? "—"}</span>
                        {count != null && <span style={{ fontSize: 12, color: textSecondary, marginLeft: 8 }}>detected</span>}
                      </div>
                      {isAlert && (
                        <div style={{ padding: "8px 12px", borderRadius: 6, background: alertColor + "18", border: `1px solid ${alertColor}40`, fontSize: 11, color: alertColor, fontWeight: 600 }}>
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
    {
      step: "01",
      icon: "👤",
      title: "Human Detected",
      desc: "PIR Sensor AM312 detects motion near the shelf and triggers the system to wake up.",
      color: "#FBBF24",
      tag: "Hardware Trigger",
    },
    {
      step: "02",
      icon: "📷",
      title: "Frame Captured",
      desc: "XIAO ESP32-S3 Sense camera captures a frame of the shelf at up to 30 fps.",
      color: "#38BDF8",
      tag: "Edge Device",
    },
    {
      step: "03",
      icon: "🤖",
      title: "ML Inference",
      desc: "FOMO MobileNetV2 (on-device) or YOLO11n via Flask backend analyses the frame and detects product classes.",
      color: "#22C55E",
      tag: "AI Model",
    },
    {
      step: "04",
      icon: "📡",
      title: "Data Transmitted",
      desc: "Detection results (counts, bounding boxes, confidence) are sent over HTTP/JSON to the dashboard.",
      color: "#A78BFA",
      tag: "Network",
    },
    {
      step: "05",
      icon: "📊",
      title: "Dashboard Updated",
      desc: "React dashboard receives the data and updates product stock counts, alerts, and the inference log in real time.",
      color: accent,
      tag: "Dashboard",
    },
  ];

  const MODES = [
    {
      icon: "🔌",
      title: "XIAO ESP32-S3 Mode",
      color: "#38BDF8",
      rows: [
        { label: "Camera",    value: "OV2640 on XIAO ESP32-S3" },
        { label: "Model",     value: "FOMO MobileNetV2 (Edge Impulse)" },
        { label: "Inference", value: "On-device (MCU)" },
        { label: "Output",    value: "MJPEG stream + /status JSON" },
        { label: "Latency",   value: "~50–150 ms" },
      ],
    },
    {
      icon: "📷",
      title: "Webcam Mode",
      color: "#22C55E",
      rows: [
        { label: "Camera",    value: "Browser getUserMedia API" },
        { label: "Model",     value: "YOLO11n (best.pt)" },
        { label: "Inference", value: "Flask backend (CPU/GPU)" },
        { label: "Output",    value: "POST /detect → JSON detections" },
        { label: "Latency",   value: "~30–120 ms" },
      ],
    },
  ];

  const STACK = [
    { layer: "Hardware",  items: ["XIAO ESP32-S3 Sense", "PIR Sensor AM312"],                          color: "#FBBF24" },
    { layer: "ML",        items: ["Edge Impulse", "FOMO MobileNetV2", "YOLO11n (best.pt)"],            color: "#22C55E" },
    { layer: "Backend",   items: ["Python Flask", "Ultralytics", "OpenCV", "PyTorch"],                 color: "#A78BFA" },
    { layer: "Frontend",  items: ["React + Vite", "WebRTC getUserMedia", "Canvas API", "Fetch API"],   color: "#38BDF8" },
  ];

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 32 }}>

      {/* MAIN FLOW */}
      <div>
        <SectionLabel color={textSecondary}>System Flow</SectionLabel>
        <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          {FLOW.map((s, i) => (
            <div key={s.step} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              {/* Card */}
              <div style={{ flex: 1, background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: "18px 16px", position: "relative" }}>
                {/* Step badge */}
                <div style={{ position: "absolute", top: 12, right: 12, fontSize: 9, fontWeight: 700, color: s.color, background: s.color + "18", border: `1px solid ${s.color}40`, borderRadius: 20, padding: "2px 7px", letterSpacing: "0.05em" }}>
                  {s.tag}
                </div>
                <div style={{ fontSize: 28, marginBottom: 10 }}>{s.icon}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: s.color, letterSpacing: "0.08em", marginBottom: 4 }}>STEP {s.step}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 11, color: textSecondary, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
              {/* Arrow */}
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
        <SectionLabel color={textSecondary}>Operating Modes</SectionLabel>
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
    fontWeight: 600, fontFamily: font, letterSpacing: "0.02em",
  };
}
