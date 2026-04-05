import { useState, useEffect, useCallback, useRef } from "react";

const PRODUCTS = [
  { id: "coke", label: "Coke Can", color: "#E53935", icon: "🥤", maxStock: 6, weight: "355g" },
  { id: "ramen", label: "Ramen Cup", color: "#FF9800", icon: "🍜", maxStock: 5, weight: "64g" },
  { id: "chips", label: "Chip Bag", color: "#43A047", icon: "🥨", maxStock: 4, weight: "150g" },
];

const THRESHOLD = 2;

function generateShelfGrid(products) {
  const grid = [];
  products.forEach((p) => {
    for (let i = 0; i < p.maxStock; i++) {
      grid.push({ productId: p.id, slot: i, occupied: i < p.stock });
    }
  });
  return grid;
}

function formatTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function randomBetween(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

// --- Sparkline mini chart ---
function Sparkline({ data, color, width = 120, height = 32 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// --- Main Dashboard ---
export default function SmartShelfDashboard() {
  const [stocks, setStocks] = useState(
    PRODUCTS.reduce((acc, p) => ({ ...acc, [p.id]: p.maxStock }), {})
  );
  const [alerts, setAlerts] = useState([]);
  const [inferenceLog, setInferenceLog] = useState([]);
  const [latencyHistory, setLatencyHistory] = useState([]);
  const [powerHistory, setPowerHistory] = useState([]);
  const [deviceStatus, setDeviceStatus] = useState("sleep");
  const [simRunning, setSimRunning] = useState(false);
  const [totalInferences, setTotalInferences] = useState(0);
  const [pirTriggers, setPirTriggers] = useState(0);
  const [lastInference, setLastInference] = useState(null);
  const simRef = useRef(null);

  const runInference = useCallback(
    (updatedStocks) => {
      const latency = randomBetween(120, 210);
      const now = new Date();
      setDeviceStatus("inferring");
      setTotalInferences((n) => n + 1);
      setLastInference(now);
      setLatencyHistory((h) => [...h.slice(-29), latency]);
      setPowerHistory((h) => [...h.slice(-29), randomBetween(85, 160)]);

      const detections = PRODUCTS.map((p) => ({
        label: p.label,
        count: updatedStocks[p.id],
        confidence: (0.82 + Math.random() * 0.16).toFixed(2),
      }));

      setInferenceLog((log) => [
        {
          time: formatTime(now),
          latency,
          detections,
          id: Date.now(),
        },
        ...log.slice(0, 19),
      ]);

      // Check thresholds
      PRODUCTS.forEach((p) => {
        if (updatedStocks[p.id] <= THRESHOLD && updatedStocks[p.id] >= 0) {
          setAlerts((a) => [
            {
              time: formatTime(now),
              product: p.label,
              icon: p.icon,
              count: updatedStocks[p.id],
              severity: updatedStocks[p.id] === 0 ? "critical" : "warning",
              id: Date.now() + p.id,
            },
            ...a.slice(0, 14),
          ]);
        }
      });

      setTimeout(() => setDeviceStatus("sleep"), 1800);
    },
    []
  );

  // PIR trigger simulation
  const triggerPIR = useCallback(() => {
    setPirTriggers((n) => n + 1);
    setDeviceStatus("waking");
    setTimeout(() => {
      // Randomly remove an item
      setStocks((prev) => {
        const available = PRODUCTS.filter((p) => prev[p.id] > 0);
        if (available.length === 0) return prev;
        const pick = available[Math.floor(Math.random() * available.length)];
        const updated = { ...prev, [pick.id]: Math.max(0, prev[pick.id] - 1) };
        runInference(updated);
        return updated;
      });
    }, 600);
  }, [runInference]);

  // Restock
  const restockAll = useCallback(() => {
    const full = PRODUCTS.reduce((acc, p) => ({ ...acc, [p.id]: p.maxStock }), {});
    setStocks(full);
    setDeviceStatus("waking");
    setTimeout(() => runInference(full), 400);
  }, [runInference]);

  // Manual adjust
  const adjustStock = useCallback(
    (id, delta) => {
      setStocks((prev) => {
        const p = PRODUCTS.find((x) => x.id === id);
        const next = Math.max(0, Math.min(p.maxStock, prev[id] + delta));
        const updated = { ...prev, [id]: next };
        setDeviceStatus("waking");
        setTimeout(() => runInference(updated), 300);
        return updated;
      });
    },
    [runInference]
  );

  // Auto-sim
  useEffect(() => {
    if (simRunning) {
      simRef.current = setInterval(() => triggerPIR(), randomBetween(2500, 5000));
    } else {
      clearInterval(simRef.current);
    }
    return () => clearInterval(simRef.current);
  }, [simRunning, triggerPIR]);

  // Computed
  const avgLatency =
    latencyHistory.length > 0
      ? (latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length).toFixed(0)
      : "—";
  const fps = latencyHistory.length > 0 ? (1000 / latencyHistory[latencyHistory.length - 1]).toFixed(1) : "—";

  // --- STYLES ---
  const font = `'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace`;
  const bg = "#0B0E14";
  const surface = "#141922";
  const surfaceAlt = "#1A2030";
  const border = "#232D3F";
  const textPrimary = "#E2E8F0";
  const textSecondary = "#7B8BA5";
  const accent = "#38BDF8";
  const alertYellow = "#FBBF24";
  const alertRed = "#EF4444";
  const green = "#22C55E";

  return (
    <div
      style={{
        fontFamily: font,
        background: bg,
        color: textPrimary,
        minHeight: "100vh",
        padding: "0",
        margin: "0",
        fontSize: "13px",
        lineHeight: 1.5,
      }}
    >
      {/* HEADER */}
      <div
        style={{
          background: `linear-gradient(90deg, ${surface} 0%, #0F1923 100%)`,
          borderBottom: `1px solid ${border}`,
          padding: "16px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${accent}, #6366F1)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 800,
              color: "#fff",
              letterSpacing: -1,
            }}
          >
            ES
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "0.02em" }}>
              Smart Shelf — Edge Dashboard
            </div>
            <div style={{ color: textSecondary, fontSize: 11, marginTop: 1 }}>
              XIAO ESP32-S3 Sense &middot; FOMO MobileNetV2 &middot; Intelligent Edge System
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StatusPill
            label={deviceStatus === "sleep" ? "Deep Sleep" : deviceStatus === "waking" ? "PIR Triggered" : "Inferring"}
            color={deviceStatus === "sleep" ? textSecondary : deviceStatus === "waking" ? alertYellow : accent}
            pulse={deviceStatus !== "sleep"}
          />
          <button onClick={triggerPIR} style={btnStyle(accent)}>
            ⚡ Trigger PIR
          </button>
          <button onClick={() => setSimRunning((s) => !s)} style={btnStyle(simRunning ? alertRed : green)}>
            {simRunning ? "■ Stop Sim" : "▶ Auto Sim"}
          </button>
          <button onClick={restockAll} style={btnStyle("#8B5CF6")}>
            ↻ Restock All
          </button>
        </div>
      </div>

      {/* BODY */}
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* TOP ROW: Metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12 }}>
          <MetricCard label="Device Status" value={deviceStatus.toUpperCase()} sub="XIAO ESP32-S3" color={accent} />
          <MetricCard label="Total Inferences" value={totalInferences} sub="FOMO runs" color={accent} />
          <MetricCard label="PIR Triggers" value={pirTriggers} sub="AM312 events" color={alertYellow} />
          <MetricCard label="Avg Latency" value={`${avgLatency}ms`} sub="inference time" color={green} />
          <MetricCard label="Est. FPS" value={fps} sub="frames/sec" color="#a78bfa" />
          <MetricCard
            label="Last Inference"
            value={lastInference ? formatTime(lastInference) : "—"}
            sub="timestamp"
            color={textSecondary}
          />
        </div>

        {/* MID ROW: Shelf + Product Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* SHELF GRID */}
          <Card title="📷 Shelf Camera View (FOMO Grid)" style={{ minHeight: 220 }}>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8 }}>
              {PRODUCTS.map((p) => (
                <div key={p.id}>
                  <div
                    style={{
                      fontSize: 11,
                      color: textSecondary,
                      marginBottom: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: p.color,
                        display: "inline-block",
                      }}
                    />
                    {p.label}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${Math.min(p.maxStock, 3)}, 42px)`,
                      gap: 5,
                    }}
                  >
                    {Array.from({ length: p.maxStock }).map((_, i) => {
                      const occupied = i < stocks[p.id];
                      return (
                        <div
                          key={i}
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 6,
                            background: occupied ? p.color + "22" : surfaceAlt,
                            border: occupied ? `2px solid ${p.color}` : `1px dashed ${border}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: occupied ? 20 : 12,
                            color: occupied ? p.color : border,
                            transition: "all 0.3s",
                            position: "relative",
                          }}
                        >
                          {occupied ? p.icon : "✕"}
                          {occupied && (
                            <div
                              style={{
                                position: "absolute",
                                bottom: -2,
                                right: -2,
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: green,
                                border: `2px solid ${surface}`,
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 10, color: textSecondary }}>
              Grid shows FOMO centroid detections · 96×96 grayscale input · Bounding boxes → centroids
            </div>
          </Card>

          {/* PRODUCT CARDS */}
          <Card title="📦 Inventory Status">
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
              {PRODUCTS.map((p) => {
                const pct = (stocks[p.id] / p.maxStock) * 100;
                const low = stocks[p.id] <= THRESHOLD;
                const empty = stocks[p.id] === 0;
                return (
                  <div
                    key={p.id}
                    style={{
                      background: surfaceAlt,
                      borderRadius: 8,
                      padding: "10px 14px",
                      border: `1px solid ${empty ? alertRed + "60" : low ? alertYellow + "40" : border}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 22 }}>{p.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</span>
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 20,
                            background: empty
                              ? alertRed + "22"
                              : low
                              ? alertYellow + "22"
                              : green + "18",
                            color: empty ? alertRed : low ? alertYellow : green,
                            fontWeight: 600,
                          }}
                        >
                          {stocks[p.id]} / {p.maxStock}
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          height: 6,
                          borderRadius: 3,
                          background: border,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            borderRadius: 3,
                            background: empty ? alertRed : low ? alertYellow : green,
                            transition: "width 0.5s ease",
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <MiniBtn onClick={() => adjustStock(p.id, -1)}>−</MiniBtn>
                      <MiniBtn onClick={() => adjustStock(p.id, 1)}>+</MiniBtn>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: textSecondary }}>
              Restock threshold: ≤ {THRESHOLD} units → alert triggered
            </div>
          </Card>
        </div>

        {/* BOTTOM ROW: Charts + Alerts + Logs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          {/* Latency Chart */}
          <Card title="⏱ Inference Latency">
            <Sparkline data={latencyHistory} color={accent} width={260} height={60} />
            <div style={{ marginTop: 6, fontSize: 10, color: textSecondary }}>
              Last 30 inferences · Target: &lt;200ms on ESP32-S3
            </div>
          </Card>

          {/* Power Chart */}
          <Card title="🔋 Power Draw (mA)">
            <Sparkline data={powerHistory} color={alertYellow} width={260} height={60} />
            <div style={{ marginTop: 6, fontSize: 10, color: textSecondary }}>
              Deep sleep: ~15µA · Active inference: 85–160mA
            </div>
          </Card>

          {/* Alerts */}
          <Card title="🚨 Restock Alerts" style={{ maxHeight: 180, overflow: "auto" }}>
            {alerts.length === 0 ? (
              <div style={{ color: textSecondary, fontSize: 11, padding: "10px 0" }}>
                No alerts yet — trigger PIR or run simulation
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      fontSize: 11,
                      padding: "4px 8px",
                      borderRadius: 4,
                      background: a.severity === "critical" ? alertRed + "15" : alertYellow + "12",
                      borderLeft: `3px solid ${a.severity === "critical" ? alertRed : alertYellow}`,
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <span>{a.icon}</span>
                    <span style={{ color: textSecondary, minWidth: 65 }}>{a.time}</span>
                    <span style={{ fontWeight: 600 }}>{a.product}</span>
                    <span style={{ color: a.severity === "critical" ? alertRed : alertYellow }}>
                      {a.count === 0 ? "OUT OF STOCK" : `LOW: ${a.count} left`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* INFERENCE LOG */}
        <Card title="📊 Inference Log (FOMO Detections)">
          <div style={{ maxHeight: 160, overflow: "auto" }}>
            {inferenceLog.length === 0 ? (
              <div style={{ color: textSecondary, fontSize: 11, padding: "6px 0" }}>
                Waiting for first inference…
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ color: textSecondary, textAlign: "left" }}>
                    <th style={{ padding: "4px 8px", borderBottom: `1px solid ${border}` }}>Time</th>
                    <th style={{ padding: "4px 8px", borderBottom: `1px solid ${border}` }}>Latency</th>
                    {PRODUCTS.map((p) => (
                      <th key={p.id} style={{ padding: "4px 8px", borderBottom: `1px solid ${border}` }}>
                        {p.icon} {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inferenceLog.map((log) => (
                    <tr key={log.id} style={{ borderBottom: `1px solid ${border}15` }}>
                      <td style={{ padding: "4px 8px", color: textSecondary }}>{log.time}</td>
                      <td style={{ padding: "4px 8px", color: accent }}>{log.latency}ms</td>
                      {log.detections.map((d, i) => (
                        <td key={i} style={{ padding: "4px 8px" }}>
                          <span style={{ fontWeight: 600 }}>{d.count}</span>
                          <span style={{ color: textSecondary, marginLeft: 4, fontSize: 10 }}>
                            ({d.confidence})
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* ARCHITECTURE FOOTER */}
        <div
          style={{
            background: surfaceAlt,
            borderRadius: 10,
            padding: "14px 20px",
            border: `1px solid ${border}`,
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 16,
            fontSize: 11,
            color: textSecondary,
          }}
        >
          <div>
            <span style={{ color: accent, fontWeight: 700 }}>EDGE</span> XIAO ESP32-S3 Sense · 8MB PSRAM · 240MHz
          </div>
          <div>
            <span style={{ color: alertYellow, fontWeight: 700 }}>MODEL</span> FOMO · MobileNetV2 α=0.35 · 96×96 grayscale
          </div>
          <div>
            <span style={{ color: green, fontWeight: 700 }}>SENSOR</span> AM312 PIR · 3.3V · 15µA standby
          </div>
          <div>
            <span style={{ color: "#a78bfa", fontWeight: 700 }}>COMM</span> MQTT over WiFi · Event-driven
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Subcomponents ---

function Card({ title, children, style = {} }) {
  return (
    <div
      style={{
        background: "#141922",
        borderRadius: 10,
        border: "1px solid #232D3F",
        padding: "14px 18px",
        ...style,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#7B8BA5",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div
      style={{
        background: "#141922",
        borderRadius: 10,
        border: "1px solid #232D3F",
        padding: "12px 16px",
      }}
    >
      <div style={{ fontSize: 10, color: "#7B8BA5", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#7B8BA5", marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function StatusPill({ label, color, pulse }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 20,
        background: color + "18",
        border: `1px solid ${color}40`,
        fontSize: 11,
        fontWeight: 600,
        color,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          animation: pulse ? "pulse 1.2s infinite" : "none",
        }}
      />
      {label}
      <style>{`@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }`}</style>
    </div>
  );
}

function MiniBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        border: "1px solid #232D3F",
        background: "#1A2030",
        color: "#E2E8F0",
        cursor: "pointer",
        fontSize: 15,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function btnStyle(color) {
  return {
    padding: "6px 14px",
    borderRadius: 6,
    border: `1px solid ${color}60`,
    background: color + "18",
    color,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "inherit",
    letterSpacing: "0.02em",
  };
}
