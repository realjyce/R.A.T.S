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

export default function SmartShelfDashboard() {
  const font        = `'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace`;
  const bg          = "#0B0E14";
  const surface     = "#141922";
  const surfaceAlt  = "#1A2030";
  const border      = "#232D3F";
  const textPrimary = "#E2E8F0";
  const textSecondary = "#7B8BA5";
  const accent      = "#38BDF8";
  const alertRed    = "#EF4444";
  const green       = "#22C55E";

  // ── source toggle ──────────────────────────────────────────────
  const [camSource, setCamSource] = useState("mockup"); // "xiao" | "mockup"
  const [xiaoUrl,   setXiaoUrl]   = useState("http://192.168.4.1/stream");

  // ── camera / inference state ───────────────────────────────────
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const inferRef  = useRef(null);

  const [camState,       setCamState]       = useState("idle"); // idle | requesting | active | error
  const [camError,       setCamError]       = useState("");
  const [inferLog,       setInferLog]       = useState([]);
  const [lastDetections, setLastDetections] = useState([]);
  const [totalRuns,      setTotalRuns]      = useState(0);
  const [avgLatency,     setAvgLatency]     = useState(null);
  const [stocks,         setStocks]         = useState(null); // null = no data yet
  const latencies = useRef([]);

  // ── draw mock FOMO detections ──────────────────────────────────
  const drawDetections = useCallback((detections, w, h) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width  = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    detections.forEach(({ x, y, label, color, conf }) => {
      const bx = x - 18, by = y - 18, bw = 36, bh = 36;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = "bold 10px monospace";
      ctx.fillText(`${label} ${conf}`, bx, by - 4);
    });
  }, []);

  // ── run one mock inference cycle ───────────────────────────────
  const runInference = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const t0 = performance.now();
    const w  = video.videoWidth  || 320;
    const h  = video.videoHeight || 240;

    const count = randomBetween(1, 5);
    const detections = Array.from({ length: count }, () => {
      const p = PRODUCTS[randomBetween(0, PRODUCTS.length - 1)];
      return {
        x: randomBetween(30, w - 30),
        y: randomBetween(30, h - 30),
        label: p.label,
        color: p.color,
        conf:  (0.80 + Math.random() * 0.18).toFixed(2),
        id:    p.id,
      };
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
    setInferLog((prev) => [{ time: formatTime(now), latency, counts, id: Date.now() }, ...prev.slice(0, 9)]);
    setTotalRuns((n) => n + 1);
    setAvgLatency(avg);
    setStocks(counts);

  }, [drawDetections]);

  // ── start ──────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCamState("requesting");
    setCamError("");
    try {
      if (camSource === "mockup") {
        // Browser webcam / phone camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.src = "";
          await videoRef.current.play();
        }
      } else {
        // XIAO MJPEG stream
        if (videoRef.current) {
          videoRef.current.srcObject = null;
          videoRef.current.src = xiaoUrl;
          await videoRef.current.play();
        }
      }
      setCamState("active");
      inferRef.current = setInterval(runInference, 2000);
    } catch (err) {
      setCamState("error");
      setCamError(err.message || "Could not connect");
    }
  }, [camSource, xiaoUrl, runInference]);

  // ── stop ───────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    clearInterval(inferRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current.src = ""; }
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setCamState("idle");
    setLastDetections([]);
    setStocks(null);
  }, []);

  // stop when switching source
  useEffect(() => { stopCamera(); }, [camSource]); // eslint-disable-line

  useEffect(() => () => {
    clearInterval(inferRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // ── labels ─────────────────────────────────────────────────────
  const sourceLabel = camSource === "xiao" ? "XIAO ESP32-S3 (MJPEG)" : "Mockup Cam — Phone / Webcam";
  const idleHint    = camSource === "xiao"
    ? <>Enter the device IP above then press <strong style={{ color: accent }}>Connect</strong></>
    : <>Press <strong style={{ color: accent }}>Start Camera</strong> to begin mock feed</>;

  return (
    <div style={{ fontFamily: font, background: bg, color: textPrimary, minHeight: "100vh", margin: 0, padding: 0, fontSize: "13px", lineHeight: 1.5 }}>

      {/* HEADER */}
      <div style={{ background: `linear-gradient(90deg, ${surface} 0%, #0F1923 100%)`, borderBottom: `1px solid ${border}`, padding: "16px 28px", display: "flex", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em" }}>
          R.A.T.S &mdash; Real-Time Auto Tracking Shelf
        </div>
      </div>

      {/* BODY */}
      <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 28 }}>

        {/* HARDWARE GRID */}
        <div>
          <SectionLabel>System Components</SectionLabel>
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

        {/* CAMERA PANEL + INFERENCE */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Camera panel */}
          <div style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              {/* Source toggle */}
              <div style={{ display: "flex", gap: 0, background: bg, border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
                {["xiao", "mockup"].map((src) => {
                  const active = camSource === src;
                  const label  = src === "xiao" ? "🔌 XIAO ESP32-S3" : "💻 Mockup Cam";
                  return (
                    <button
                      key={src}
                      onClick={() => setCamSource(src)}
                      style={{
                        padding: "5px 16px",
                        border: "none",
                        borderRight: src === "xiao" ? `1px solid ${border}` : "none",
                        background: active ? accent + "22" : "transparent",
                        color:      active ? accent : textSecondary,
                        fontFamily: font, fontSize: 11,
                        fontWeight: active ? 700 : 400,
                        cursor: "pointer", letterSpacing: "0.03em", transition: "all 0.15s",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* XIAO URL input */}
              {camSource === "xiao" && (
                <input
                  value={xiaoUrl}
                  onChange={(e) => setXiaoUrl(e.target.value)}
                  placeholder="http://192.168.4.1/stream"
                  style={{
                    background: bg, border: `1px solid ${border}`, borderRadius: 6,
                    color: textPrimary, fontFamily: font, fontSize: 11,
                    padding: "4px 10px", width: 240, outline: "none", flex: 1,
                  }}
                />
              )}

              {/* Live status */}
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: camState === "active" ? alertRed : textSecondary, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>
                {camState === "active" && (
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: alertRed, display: "inline-block", animation: "blink 1.2s infinite" }} />
                )}
                {camState === "active" ? "LIVE" : camState === "requesting" ? "CONNECTING…" : "OFFLINE"}
              </span>
            </div>

            {/* Viewport */}
            <div style={{ position: "relative", width: "100%", aspectRatio: "16/7", background: "#060A0F", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: camState === "active" ? "block" : "none" }} />
              <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", display: camState === "active" ? "block" : "none" }} />
              <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.015) 3px, rgba(255,255,255,0.015) 4px)", pointerEvents: "none" }} />
              {[
                { top: 12, left: 12,  borderTop: `2px solid ${accent}`, borderLeft:  `2px solid ${accent}` },
                { top: 12, right: 12, borderTop: `2px solid ${accent}`, borderRight: `2px solid ${accent}` },
                { bottom: 12, left: 12,  borderBottom: `2px solid ${accent}`, borderLeft:  `2px solid ${accent}` },
                { bottom: 12, right: 12, borderBottom: `2px solid ${accent}`, borderRight: `2px solid ${accent}` },
              ].map((s, i) => (
                <div key={i} style={{ position: "absolute", width: 18, height: 18, ...s }} />
              ))}
              {camState !== "active" && (
                <div style={{ textAlign: "center", color: "#2A3A50", fontSize: 12, zIndex: 1 }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>{camSource === "xiao" ? "🔌" : "📷"}</div>
                  {camState === "error"
                    ? <div style={{ color: alertRed }}>{camError}</div>
                    : <div>{idleHint}</div>
                  }
                </div>
              )}
            </div>

            {/* Controls */}
            <div style={{ padding: "10px 14px", borderTop: `1px solid ${border}`, display: "flex", gap: 8 }}>
              {camState !== "active"
                ? <button onClick={startCamera} style={btnStyle(accent)}>{camSource === "xiao" ? "🔌 Connect" : "▶ Start Camera"}</button>
                : <button onClick={stopCamera}  style={btnStyle(alertRed)}>■ Stop</button>
              }
              <span style={{ fontSize: 11, color: textSecondary, alignSelf: "center" }}>
                {camState === "active" ? `Inference every 2 s · ${totalRuns} run${totalRuns !== 1 ? "s" : ""}` : camSource === "xiao" ? "Requires XIAO on the same network" : "Open in phone browser for rear camera"}
              </span>
            </div>
          </div>

        {/* PRODUCT STOCK GRID */}
        <div>
          <SectionLabel>Product Stock</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {PRODUCTS.map((p) => {
              const count  = stocks ? stocks[p.id] : null;
              const pct    = count != null ? Math.round((count / p.max) * 100) : null;
              const status = count == null ? "idle"
                : count === 0  ? "empty"
                : count <= 3   ? "low"
                :                "ok";

              const alertYellow  = "#FBBF24";
              const isAlert      = status === "empty" || status === "low";
              const alertColor   = status === "empty" ? alertRed : alertYellow;
              const statusColor  = { idle: textSecondary, empty: alertRed, low: alertYellow, ok: green }[status];

              return (
                <div
                  key={p.id}
                  style={{
                    background: isAlert
                      ? (status === "empty" ? alertRed + "0D" : alertYellow + "0A")
                      : surfaceAlt,
                    border: `1px solid ${isAlert ? alertColor + "70" : border}`,
                    borderTop: `3px solid ${isAlert ? alertColor : p.color}`,
                    borderRadius: 10,
                    padding: "18px 20px",
                    boxShadow: isAlert ? `0 0 18px ${alertColor}22` : "none",
                    transition: "all 0.4s ease",
                  }}
                >
                  {/* Icon + name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 28 }}>{p.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: textPrimary }}>{p.label}</div>
                      <div style={{ fontSize: 10, color: statusColor, fontWeight: 600, marginTop: 2 }}>
                        {{ idle: "No data", empty: "OUT OF STOCK", low: "LOW STOCK", ok: "In Stock" }[status]}
                      </div>
                    </div>
                    {/* Alert badge */}
                    {isAlert && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                        background: alertColor + "22", color: alertColor,
                        border: `1px solid ${alertColor}50`,
                        animation: "blink 1.4s infinite",
                      }}>
                        {status === "empty" ? "⛔ CRITICAL" : "⚠ WARNING"}
                      </span>
                    )}
                  </div>

                  {/* Count */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 }}>
                    <span style={{ fontSize: 40, fontWeight: 800, color: count == null ? textSecondary : statusColor, lineHeight: 1 }}>
                      {count ?? "—"}
                    </span>
                    {count != null && (
                      <span style={{ fontSize: 13, color: textSecondary }}>/ {p.max}</span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 3, background: border, overflow: "hidden", marginBottom: isAlert ? 12 : 0 }}>
                    <div style={{
                      height: "100%",
                      width: pct != null ? `${pct}%` : "0%",
                      borderRadius: 3,
                      background: statusColor,
                      transition: "width 0.5s ease",
                    }} />
                  </div>

                  {/* Inline alert message */}
                  {isAlert && (
                    <div style={{
                      marginTop: 4,
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: alertColor + "18",
                      border: `1px solid ${alertColor}40`,
                      fontSize: 11,
                      color: alertColor,
                      fontWeight: 600,
                    }}>
                      {status === "empty"
                        ? "⛔ No items detected — immediate restock required"
                        : `⚠ Only ${count} item${count === 1 ? "" : "s"} left — restock soon`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        </div>

      </div>

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }`}</style>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#7B8BA5", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
      {children}
    </div>
  );
}

function btnStyle(color) {
  return {
    padding: "6px 14px", borderRadius: 6, border: `1px solid ${color}60`,
    background: color + "18", color, cursor: "pointer", fontSize: 12,
    fontWeight: 600, fontFamily: "inherit", letterSpacing: "0.02em",
  };
}
