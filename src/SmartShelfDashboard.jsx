import { useState, useEffect, useRef, useCallback } from "react";

const FONT_SANS = `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const FONT_MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, 'Consolas', monospace`;

const HARDWARE = [
  { name: "XIAO ESP32-S3 Sense", role: "Edge compute + camera",  color: "#38BDF8", icon: "cpu" },
  { name: "PIR AM312",           role: "Motion wake trigger",    color: "#F4B740", icon: "motion" },
  { name: "FOMO MobileNetV2",    role: "On-device inference",    color: "#34D399", icon: "model" },
  { name: "Edge Impulse",        role: "Training pipeline",      color: "#A78BFA", icon: "training" },
];

const PRODUCTS = [
  { id: "bottle", label: "Bottle", icon: "bottle", color: "#38BDF8" },
  { id: "snack",  label: "Snack",  icon: "box",    color: "#F4B740" },
  { id: "cup",    label: "Cup",    icon: "cup",    color: "#34D399" },
];

function formatTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Slate + Indigo — accent kept clear of the red/amber/green status colours.
const THEMES = {
  dark: {
    bg: "#0A0C12", surface: "#13161F", surfaceAlt: "#1A1E2A",
    border: "#242936", textPrimary: "#E7E9F0", textSecondary: "#8A93A6",
    accent: "#6366F1", accentSoft: "#A5B4FC", accent2: "#D97757", accent2Soft: "#E8A87C",
    alertRed: "#F25555", green: "#34D399",
    camBg: "#070910", bracketColor: "#6366F1", chip: "#0E1119",
    headerBg: "rgba(16,19,28,0.72)",
  },
  light: {
    bg: "#F6F7FB", surface: "#FFFFFF", surfaceAlt: "#EEF0F6",
    border: "#DDE1EA", textPrimary: "#171A22", textSecondary: "#5A6273",
    accent: "#5457E6", accentSoft: "#6366F1", accent2: "#C2673F", accent2Soft: "#D97757",
    alertRed: "#DC2626", green: "#0E9F6E",
    camBg: "#DADEE8", bracketColor: "#5457E6", chip: "#0E1119",
    headerBg: "rgba(255,255,255,0.72)",
  },
};

// ── Icon set: stroke-based SVGs (one consistent weight) instead of emoji. ─────
const ICONS = {
  dashboard:  <><rect x="3" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4"/></>,
  workflow:   <><line x1="6" y1="4" x2="6" y2="14"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M18 8.4a8 8 0 0 1-8 8"/></>,
  history:    <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
  cpu:        <><rect x="6.5" y="6.5" width="11" height="11" rx="1.6"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.8"/><path d="M9.5 3.5v2M14.5 3.5v2M9.5 18.5v2M14.5 18.5v2M3.5 9.5h2M3.5 14.5h2M18.5 9.5h2M18.5 14.5h2"/></>,
  motion:     <><circle cx="12" cy="12" r="1.6"/><path d="M15.5 8.5a5 5 0 0 1 0 7M8.5 15.5a5 5 0 0 1 0-7"/><path d="M18.5 5.5a9 9 0 0 1 0 13M5.5 18.5a9 9 0 0 1 0-13"/></>,
  model:      <><path d="M3 12h3.5l2.5 6.5 4-13 2.5 6.5H21"/></>,
  training:   <><line x1="5" y1="21" x2="5" y2="14"/><line x1="5" y1="10" x2="5" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="19" y1="21" x2="19" y2="15"/><line x1="19" y1="11" x2="19" y2="3"/><line x1="2.5" y1="14" x2="7.5" y2="14"/><line x1="9.5" y1="8" x2="14.5" y2="8"/><line x1="16.5" y1="11" x2="21.5" y2="11"/></>,
  bottle:     <><path d="M10 3h4"/><path d="M10.5 3v3.2a3 3 0 0 1-.6 1.8l-.8 1A3 3 0 0 0 8.5 12v7a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-7a3 3 0 0 0-.6-1.9l-.8-1a3 3 0 0 1-.6-1.8V3"/><path d="M8.5 13h7"/></>,
  cup:        <><path d="M6 7.5h12l-1 12.5a2 2 0 0 1-2 1.9H9a2 2 0 0 1-2-1.9L6 7.5z"/><path d="M5 7.5h14"/><path d="M9 4.5h6l.4 3"/></>,
  box:        <><path d="M21 8.2 12 3.3 3 8.2l9 4.9 9-4.9z"/><path d="M3 8.2v7.6l9 4.9 9-4.9V8.2"/><path d="M12 13.1V21"/></>,
  camera:     <><path d="M3 8.5A2 2 0 0 1 5 6.5h1.6l1.3-2h8.2l1.3 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9z"/><circle cx="12" cy="13" r="3.4"/></>,
  wifi:       <><path d="M4.5 11a11 11 0 0 1 15 0"/><path d="M8 14.5a6 6 0 0 1 8 0"/><circle cx="12" cy="18.5" r="1.1"/></>,
  zap:        <><path d="M13 2.5 5 13h6l-1 8.5L18 11h-6l1-8.5z"/></>,
  moon:       <><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3.2 6.6 6.6 0 0 0 21 12.8z"/></>,
  sun:        <><circle cx="12" cy="12" r="4"/><path d="M12 2v2.2M12 19.8V22M4 12H1.8M22.2 12H20M5.2 5.2l1.5 1.5M17.3 17.3l1.5 1.5M18.8 5.2l-1.5 1.5M6.7 17.3l-1.5 1.5"/></>,
  alert:      <><path d="M10.3 3.9 2 18.2A2 2 0 0 0 3.7 21h16.6a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9.5" x2="12" y2="13.5"/><line x1="12" y1="17" x2="12" y2="17.01"/></>,
  check:      <><path d="M20 6.5 9.5 17 4 11.5"/></>,
  user:       <><circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></>,
  layout:     <><rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M9 20.5V9.5"/></>,
  signal:     <><circle cx="12" cy="12" r="1.8"/><path d="M16 8a5.6 5.6 0 0 1 0 8M8 16a5.6 5.6 0 0 1 0-8"/></>,
};

function Icon({ name, size = 18, color = "currentColor", strokeWidth = 1.7, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block", ...style }} aria-hidden="true">
      {ICONS[name] || null}
    </svg>
  );
}

// ── R.A.T.S brand mark (from dashboard/src/rats_logo.svg) ─────────────────────
// Two-tone: a gradient silhouette (head + ears) with the facial features punched
// out in the surface colour, so the mark reads as crisp negative space on any bg.
function RatsLogo({ size = 30, gradFrom = "#7DD3FC", gradTo = "#38BDF8", cut = "#0B0E14", id = "ratsGrad" }) {
  return (
    <svg width={size} height={size * (58.632813 / 59)} viewBox="239.453 229.359 59 58.633" fill="none"
      role="img" aria-label="R.A.T.S logo" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={gradFrom} />
          <stop offset="1" stopColor={gradTo} />
        </linearGradient>
      </defs>
      <g fillRule="evenodd">
        {/* silhouette: head + two ears */}
        <path fill={`url(#${id})`} d="M 263.433594 247.082031 L 274.476562 247.082031 L 287.355469 256.652344 L 286.621094 268.429688 L 278.15625 278.734375 L 268.953125 284.992188 L 259.753906 278.734375 L 251.289062 268.429688 L 250.550781 256.652344 Z"/>
        <path fill={`url(#${id})`} d="M 250.550781 256.652344 L 243.191406 244.507812 C 242.453125 236.039062 248.710938 232.359375 254.96875 234.570312 L 263.433594 247.082031 Z"/>
        <path fill={`url(#${id})`} d="M 287.355469 256.652344 L 294.71875 244.507812 C 295.453125 236.039062 289.199219 232.359375 282.941406 234.570312 L 274.476562 247.082031 Z"/>
        {/* features punched out in the surface colour */}
        <path fill={cut} d="M 252.023438 253.707031 L 246.871094 244.507812 C 246.871094 238.984375 250.550781 236.777344 254.96875 238.984375 L 260.855469 247.082031 Z"/>
        <path fill={cut} d="M 285.886719 253.707031 L 291.039062 244.507812 C 291.039062 238.984375 287.355469 236.777344 282.941406 238.984375 L 277.050781 247.082031 Z"/>
        <path fill={cut} d="M 256.074219 259.597656 L 260.855469 255.914062 L 265.640625 259.597656 L 260.855469 262.171875 Z"/>
        <path fill={cut} d="M 272.265625 259.597656 L 277.050781 255.914062 L 281.835938 259.597656 L 277.050781 262.171875 Z"/>
        <path fill={cut} d="M 266.011719 269.164062 L 271.898438 269.164062 L 268.953125 273.949219 Z"/>
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────
//  Global motion + interaction styles (Emil Kowalski design principles)
//  Custom easing, sub-300ms UI motion, press feedback, stagger, and
//  Sonner-style alert toasts — with reduced-motion respected.
// ─────────────────────────────────────────────
const GLOBAL_CSS = `
:root{
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes ratsBlink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes ratsNum{from{opacity:0;filter:blur(3px);transform:translateY(4px)}to{opacity:1;filter:blur(0);transform:translateY(0)}}
@keyframes ratsFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes ratsRipple{0%{transform:scale(.9);opacity:.55}100%{transform:scale(2.3);opacity:0}}
@keyframes ratsRibbon{from{background-position:0 0}to{background-position:200% 0}}
.rats-num{display:inline-block;animation:ratsNum .28s var(--ease-out)}
.rats-btn{transition:transform .14s var(--ease-out),background .14s var(--ease-out),border-color .14s var(--ease-out),color .14s var(--ease-out)}
.rats-btn:active{transform:scale(.97)}
.rats-tab{transition:color .15s var(--ease-out),border-color .2s var(--ease-out)}
.rats-card{border-radius:12px;box-shadow:0 1px 1px rgba(0,0,0,.22),0 10px 28px -16px rgba(0,0,0,.55);transition:transform .22s var(--ease-out),box-shadow .25s var(--ease-out),border-color .25s var(--ease-out),background .25s var(--ease-out)}
@media (hover:hover) and (pointer:fine){.rats-card-hover{cursor:default}.rats-card-hover:hover{transform:translateY(-3px);box-shadow:0 2px 6px rgba(0,0,0,.28),0 22px 46px -22px rgba(0,0,0,.7),0 0 0 1px #6366F129}}
.rats-stagger>*{opacity:0;animation:ratsFadeUp .34s var(--ease-out) forwards}
.rats-stagger>*:nth-child(1){animation-delay:0ms}
.rats-stagger>*:nth-child(2){animation-delay:55ms}
.rats-stagger>*:nth-child(3){animation-delay:110ms}
.rats-stagger>*:nth-child(4){animation-delay:165ms}
.rats-stagger>*:nth-child(5){animation-delay:220ms}
.rats-blink{animation:blink 1.2s infinite}
.rats-toast{transition:transform .32s var(--ease-out),opacity .32s var(--ease-out)}
.rats-toast[data-state="enter"]{opacity:0;transform:translateY(-14px) scale(.96)}
.rats-toast[data-state="show"]{opacity:1;transform:translateY(0) scale(1)}
.rats-toast[data-state="leave"]{opacity:0;transform:translateY(-8px) scale(.98);transition-duration:.2s}
@keyframes ratsToastBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.rats-toast-bar{position:absolute;left:0;bottom:0;height:2px;width:100%;transform-origin:left;border-radius:0 0 0 10px}
.rats-page{animation:ratsFadeUp .28s var(--ease-out)}
button:focus-visible,input:focus-visible{outline:2px solid #6366F1;outline-offset:2px;border-radius:8px}
::selection{background:#6366F140}
/* top-lit rim: a faint highlight along each card's upper edge (light from above) */
.rats-card{position:relative;isolation:isolate}
.rats-card::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.05),transparent 40%);box-shadow:inset 0 1px 0 rgba(255,255,255,.07);mix-blend-mode:soft-light}
/* film grain — subtle tactile texture so surfaces don't read as flat/synthetic */
.rats-grain{position:fixed;inset:0;z-index:1;pointer-events:none;opacity:.04;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
/* refined scrollbars */
*::-webkit-scrollbar{width:11px;height:11px}
*::-webkit-scrollbar-thumb{background:#3a4254;border-radius:8px;border:3px solid transparent;background-clip:content-box}
*::-webkit-scrollbar-thumb:hover{background:#4a5468;background-clip:content-box}
*::-webkit-scrollbar-track{background:transparent}
@media (prefers-reduced-motion: reduce){
  *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
  .rats-card-hover:hover{transform:none}
}
`;

const SEV = {
  critical: { color: "#F25555", icon: "alert" },
  warning:  { color: "#F4B740", icon: "alert" },
  info:     { color: "#34D399", icon: "check" },
};

function statusOf(count) {
  return count == null ? "idle" : count <= 0 ? "empty" : count <= 3 ? "low" : "ok";
}

// ── Realtime edge feed: Server-Sent Events from the backend hub ───────────────
// The device infers on-device and pushes counts; the server raises alerts on
// status transitions and streams everything here. Survives device sleep because
// the server retains the last state.
function useEdgeStream(onAlert) {
  const [state, setState] = useState({
    counts: {}, statuses: {}, latency: 0, objects: 0, source: null, ts: 0, connected: false,
  });
  const [alerts, setAlerts] = useState([]);
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  useEffect(() => {
    const es = new EventSource("/edge/stream");
    es.addEventListener("state", (e) => {
      const d = JSON.parse(e.data);
      setState((s) => ({
        ...s, connected: true,
        counts: d.counts || {}, statuses: d.statuses || {},
        latency: d.latency || 0, objects: d.objects || 0, source: d.source, ts: d.ts || 0,
      }));
      if (Array.isArray(d.alerts) && d.alerts.length) setAlerts((prev) => (prev.length ? prev : d.alerts));
    });
    es.addEventListener("alert", (e) => {
      const a = JSON.parse(e.data);
      setAlerts((prev) => [a, ...prev].slice(0, 50));
      onAlertRef.current?.(a);
    });
    es.onopen  = () => setState((s) => ({ ...s, connected: true }));
    es.onerror = () => setState((s) => ({ ...s, connected: false }));
    return () => es.close();
  }, []);

  return { ...state, alerts };
}

function AnimatedNumber({ value, style }) {
  if (value == null) return <span style={{ fontFamily: FONT_MONO, ...style }}>—</span>;
  // keyed remount → a quick blur/fade per change (masks the swap, per Emil)
  return <span key={value} className="rats-num" style={{ fontFamily: FONT_MONO, ...style }}>{value}</span>;
}

// ── Sonner-style alert toast: enters from top-right, ease-out, auto-dismiss.
//    Hover pauses the timer + countdown bar; the tab going hidden pauses it too
//    (so a toast can't silently expire while you're looking away). ─────────────
const TOAST_LIFE = 4800;
function AlertToast({ toast, onDismiss }) {
  const [phase, setPhase] = useState("enter");
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_LIFE);
  const startedAt = useRef(0);
  const timer = useRef(null);

  const leave = useCallback(() => {
    setPhase("leave");
    setTimeout(() => onDismiss(toast.id), 200);   // let the exit play, then unmount
  }, [toast.id, onDismiss]);

  const resume = useCallback(() => {
    startedAt.current = Date.now();
    clearTimeout(timer.current);
    timer.current = setTimeout(leave, remaining.current);
  }, [leave]);

  const hold = useCallback(() => {
    clearTimeout(timer.current);
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase("show"));
    resume();
    const onVis = () => (document.hidden ? hold() : resume());
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVis); };
  }, [resume, hold]);

  const sev = SEV[toast.severity] || SEV.info;
  return (
    <div className="rats-toast" data-state={phase}
      onMouseEnter={() => { setPaused(true); hold(); }}
      onMouseLeave={() => { setPaused(false); resume(); }}
      onClick={leave}
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 11, cursor: "pointer",
        overflow: "hidden", background: "#10151E", border: `1px solid ${sev.color}40`, borderLeft: `2.5px solid ${sev.color}`,
        borderRadius: 12, padding: "12px 15px", boxShadow: `0 10px 34px rgba(0,0,0,.5)`, fontFamily: "inherit" }}>
      <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, background: `${sev.color}1A`, flexShrink: 0 }}>
        <Icon name={sev.icon} size={16} color={sev.color} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#E2E8F0" }}>{toast.message}</div>
        <div style={{ fontSize: 10, color: sev.color, fontWeight: 600, marginTop: 1, textTransform: "uppercase", letterSpacing: ".05em" }}>
          {toast.severity} · edge alert
        </div>
      </div>
      <span className="rats-toast-bar" style={{ background: sev.color,
        animation: `ratsToastBar ${TOAST_LIFE}ms linear forwards`,
        animationPlayState: paused ? "paused" : "running" }} />
    </div>
  );
}

function Toaster({ toasts, onDismiss }) {
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex",
      flexDirection: "column", gap: 10, width: 340, maxWidth: "90vw", pointerEvents: "none" }}>
      {toasts.map((a) => (
        <div key={a.id} style={{ pointerEvents: "auto" }}>
          <AlertToast toast={a} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

// ── Edge telemetry card: the device infers locally and pushes counts/alerts to
//    the server. No video stream — that's the whole point of edge efficiency. ──
function EdgeNodePanel({ t, edge }) {
  const { bg, textPrimary, textSecondary, accent, green, alertRed } = t;
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  const ago = edge.ts ? Math.max(0, Math.round(Date.now() / 1000 - edge.ts)) : null;
  const active = edge.connected && ago != null && ago < 15;   // fresh telemetry → awake & counting
  const stateLabel = !edge.connected ? "OFFLINE" : active ? "ACTIVE · COUNTING" : "IDLE / ASLEEP";
  const stateIcon  = !edge.connected ? "signal" : active ? "zap" : "moon";
  const stateColor = !edge.connected ? alertRed : active ? green : textSecondary;
  const rows = [
    { k: "Connection",        v: edge.connected ? "Subscribed (SSE)" : "Disconnected", c: edge.connected ? green : alertRed },
    { k: "Edge source",       v: edge.source || "—",                                   c: textPrimary },
    { k: "On-device latency", v: edge.latency ? `${edge.latency} ms` : "—",            c: accent },
    { k: "Objects seen",      v: edge.ts ? edge.objects : "—",                         c: textPrimary },
    { k: "Last telemetry",    v: ago == null ? "—" : ago < 2 ? "just now" : `${ago}s ago`, c: textSecondary },
  ];
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16/7", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 20 }}>
      {/* state pill — drives the two-part demo (active vs asleep) */}
      <div style={{ position: "absolute", top: 12, left: 14, display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: stateColor, letterSpacing: ".06em", fontFamily: FONT_MONO }}>
        <Icon name={stateIcon} size={13} color={stateColor} style={active ? undefined : { opacity: 0.8 }} />
        {stateLabel}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
        <div style={{ position: "relative", width: 92, height: 92, flexShrink: 0,
          opacity: active ? 1 : 0.5, filter: active ? "none" : "grayscale(0.6)",
          transition: "opacity .35s var(--ease-out), filter .35s var(--ease-out)" }}>
          {active && [0, 1].map((i) => (
            <span key={i} style={{ position: "absolute", inset: 0, borderRadius: "50%",
              border: `2px solid ${accent}`, animation: `ratsRipple 2.4s var(--ease-out) ${i * 1.2}s infinite` }} />
          ))}
          <div style={{ position: "absolute", inset: 14, borderRadius: "50%", background: `${accent}1A`,
            border: `1.5px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="cpu" size={32} color={accent} strokeWidth={1.5} />
          </div>
        </div>
        <div style={{ minWidth: 230 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 2 }}>XIAO ESP32-S3 · on-device FOMO</div>
          <div style={{ fontSize: 11, color: textSecondary, marginBottom: 12 }}>Inference runs on the edge — the server relays counts &amp; alerts only.</div>
          <div style={{ display: "grid", gap: 5 }}>
            {rows.map((r) => (
              <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 11 }}>
                <span style={{ color: textSecondary }}>{r.k}</span>
                <span style={{ color: r.c, fontWeight: 600 }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Live alerts feed — the server only emits these on a status change ────────
function LiveAlertsFeed({ t, alerts }) {
  const { surfaceAlt, border, textPrimary, textSecondary } = t;
  const shown = (alerts || []).slice(0, 8);
  return (
    <div>
      <SectionLabel color={textSecondary}>Live Alerts · sent only when stock status changes</SectionLabel>
      <div className="rats-card" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
        {shown.length === 0 ? (
          <div style={{ padding: "16px 20px", fontSize: 12, color: textSecondary }}>
            No alerts yet — the system stays silent until stock crosses a threshold. That silence is the edge efficiency.
          </div>
        ) : (
          <div className="rats-stagger" style={{ display: "flex", flexDirection: "column" }}>
            {shown.map((a, i) => {
              const sev = SEV[a.severity] || SEV.info;
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 18px",
                  borderBottom: i < shown.length - 1 ? `1px solid ${border}55` : "none" }}>
                  <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 7, background: `${sev.color}1A`, flexShrink: 0 }}>
                    <Icon name={sev.icon} size={14} color={sev.color} />
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5, color: textPrimary, fontWeight: 600 }}>{a.message}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: sev.color, textTransform: "uppercase", letterSpacing: ".06em" }}>{a.severity}</span>
                  <span style={{ fontSize: 10.5, color: textSecondary, minWidth: 64, textAlign: "right", fontFamily: FONT_MONO }}>{formatTime(new Date((a.ts || 0) * 1000))}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

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
//  POWER & SAVINGS PANEL  (deep-sleep demo)
//  Polls the backend /xiao/power, which projects battery life + cost from the
//  device's REAL measured duty cycle. Stays live even while the device sleeps,
//  because the backend retains the last telemetry the device pushed.
// ─────────────────────────────────────────────
function PowerSavingsPanel({ t }) {
  const { bg, surfaceAlt, border, textPrimary, textSecondary, accent, green, alertRed } = t;
  const [p, setP] = useState(null);
  const [battery, setBattery] = useState(1000); // mAh — live demo tweak

  useEffect(() => {
    let alive = true;
    const tick = () => {
      fetch(`/xiao/power?battery=${battery}`)
        .then((r) => r.json())
        .then((d) => { if (alive) setP(d); })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [battery]);

  const asleep = p?.state === "asleep";
  const fmtDays = (d) => d == null ? "—" : d >= 1 ? `${d.toFixed(1)} d` : `${(d * 24).toFixed(1)} h`;

  const stats = [
    { label: "Duty cycle",        value: p ? `${p.duty_pct}%` : "—",            color: accent },
    { label: "Avg current",       value: p ? `${p.avg_mA} mA` : "—",            color: accent },
    { label: `Battery (${battery}mAh)`, value: p ? fmtDays(p.life_days_deepsleep) : "—", color: green, big: true },
    { label: "vs always-on",      value: p ? fmtDays(p.life_days_alwayson) : "—", color: textSecondary },
    { label: "Energy saved",      value: p ? `${p.energy_saved_pct}%` : "—",    color: green, big: true },
    { label: "Wake events",       value: p ? p.wake_count : "—",                color: textPrimary },
  ];

  return (
    <div>
      <SectionLabel color={textSecondary}>Power & Cost Savings — Deep-Sleep vs Always-On</SectionLabel>
      <div className="rats-card" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${green}`, borderRadius: 12, padding: "16px 20px" }}>

        {/* State + battery selector */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: asleep ? textSecondary : alertRed }}>
            <span className={asleep ? "" : "rats-blink"} style={{ display: "inline-flex" }}>
              <Icon name={asleep ? "moon" : "zap"} size={15} color={asleep ? textSecondary : alertRed} />
            </span>
            {p ? (asleep ? "DEEP SLEEP" : "AWAKE · COUNTING") : "Waiting for device…"}
            {p?.wake_count > 0 && <span style={{ color: textSecondary, fontWeight: 400, fontSize: 11 }}>wake #{p.wake_count}</span>}
          </span>
          <div style={{ display: "flex", background: bg, border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
            {[500, 1000, 2000].map((mAh, i) => (
              <button key={mAh} onClick={() => setBattery(mAh)} style={{ padding: "4px 12px", border: "none", borderRight: i < 2 ? `1px solid ${border}` : "none", background: battery === mAh ? accent + "22" : "transparent", color: battery === mAh ? accent : textSecondary, fontFamily: "inherit", fontSize: 11, fontWeight: battery === mAh ? 700 : 400, cursor: "pointer" }}>
                {mAh}mAh
              </button>
            ))}
          </div>
        </div>

        {/* Stat grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
              <div style={{ fontSize: s.big ? 24 : 18, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Cost line */}
        {p && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 8, background: green + "12", border: `1px solid ${green}40`, fontSize: 12 }}>
            <span style={{ color: textSecondary }}>Annual service cost / shelf:</span>
            <span style={{ color: alertRed, fontWeight: 700, textDecoration: "line-through" }}>${p.cost_per_year_alwayson}</span>
            <span style={{ color: textSecondary }}>→</span>
            <span style={{ color: green, fontWeight: 800, fontSize: 15 }}>${p.cost_per_year_deepsleep}</span>
            <span style={{ color: textSecondary, fontSize: 10, marginLeft: "auto" }}>
              assumes {p.i_active_mA}mA active · {(p.i_sleep_mA * 1000).toFixed(0)}µA sleep · ${p.cost_per_service}/visit · nominal figures
            </span>
          </div>
        )}
        {p && p.last_seen_s != null && (
          <div style={{ fontSize: 10, color: textSecondary, marginTop: 8 }}>
            Last telemetry {p.last_seen_s}s ago · duty cycle measured on-device across {p.wake_count} wake cycle{p.wake_count === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
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
          <div className="rats-card" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 12, padding: "16px 20px" }}>
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
          <div className="rats-card" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 12, padding: "16px 20px" }}>
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
        <div className="rats-card" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 12, padding: "16px 20px" }}>
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

        <div className="rats-card" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 12, padding: "16px 20px" }}>
          <SectionLabel color={textSecondary}>Live Detection Confidence</SectionLabel>
          {liveConf.map((p) => (
            <div key={p.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                <span style={{ color: textSecondary, display: "inline-flex", alignItems: "center", gap: 7 }}><Icon name={p.icon} size={15} color={p.color} /> {p.label}</span>
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
      <div className="rats-card" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
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
                    <th key={p.id} style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, fontWeight: 600 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={p.icon} size={13} color={p.color} /> {p.label}</span></th>
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
  const font = FONT_SANS;

  const [dark, setDark] = useState(true);
  const [page, setPage] = useState("dashboard");
  const t = dark ? THEMES.dark : THEMES.light;
  const { bg, surface, surfaceAlt, border, textPrimary, textSecondary, accent, alertRed, green } = t;

  const [camSource, setCamSource] = useState("edge"); // "edge" | "webcam"
  const [camState,  setCamState] = useState("idle"); // webcam only: idle | requesting | active | error
  const [camError,  setCamError] = useState("");
  const [inferLog, setInferLog] = useState([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [avgLatency, setAvgLatency] = useState(null);
  const [toasts,    setToasts]   = useState([]);

  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);   // detection overlay (webcam mode)
  const captureRef  = useRef(null);   // hidden canvas for frame capture
  const inferRef    = useRef(null);
  const latencies   = useRef([]);
  const streamRef   = useRef(null);
  const lastLoggedTs = useRef(0);     // de-dupe edge readings into the History log

  // ── Realtime alerts: push a toast whenever the server raises one ──────────
  const pushToast    = useCallback((a) => setToasts((prev) => [...prev, a]), []);
  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((x) => x.id !== id)), []);
  const edge = useEdgeStream(pushToast);

  // The server is the single source of truth for stock + statuses.
  const hasData = edge.ts > 0;
  const stocks  = hasData ? edge.counts : null;

  // Device-pushed readings (edge mode) drive the History log; webcam logs itself.
  useEffect(() => {
    if (!edge.ts || edge.ts === lastLoggedTs.current) return;
    lastLoggedTs.current = edge.ts;
    if (edge.source === "webcam") return;
    const latency = edge.latency || 0;
    latencies.current = [...latencies.current.slice(-29), latency];
    const avg = Math.round(latencies.current.reduce((a, b) => a + b, 0) / latencies.current.length);
    setTotalRuns((n) => n + 1);
    setAvgLatency(avg);
    setInferLog((prev) => [{ time: formatTime(new Date()), latency, counts: edge.counts, detections: [], id: Date.now() }, ...prev.slice(0, 49)]);
  }, [edge.ts, edge.source, edge.latency, edge.counts]);

  // ── Draw YOLO boxes on overlay canvas ─────────────────────────
  const drawBoxes = useCallback((detections, vw, vh) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, vw, vh);
    const COLORS = { bottle: "#38BDF8", snack: "#F97316", cup: "#22C55E" };
    detections.forEach(({ x1, y1, x2, y2, label }) => {
      const color = COLORS[label] ?? "#FFFFFF";
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      // single colored dot per detection (no box, no confidence label)
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; // thin outline so it reads on any bg
      ctx.stroke();
    });
  }, []);

  // ── Webcam: capture frame → /detect → draw boxes. The backend ingests the
  //    counts into the same alert engine, so stock + alerts flow back via SSE. ─
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
      setTotalRuns((n) => n + 1);
      setAvgLatency(avg);
      setInferLog((prev) => [{ time: formatTime(new Date()), latency, counts: data.counts, detections: data.detections, id: Date.now() }, ...prev.slice(0, 49)]);
    } catch { /* backend not reachable */ }
  }, [drawBoxes]);

  const startCamera = useCallback(async () => {
    setCamState("requesting"); setCamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      inferRef.current = setInterval(runDetection, 2000);
      setCamState("active");
    } catch (err) { setCamState("error"); setCamError(err.message || "Could not open webcam"); }
  }, [runDetection]);

  const stopCamera = useCallback(() => {
    clearInterval(inferRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.srcObject = null; }
    if (canvasRef.current) { const ctx = canvasRef.current.getContext("2d"); ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); }
    setCamState("idle");
  }, []);

  // Switching to (or staying on) edge mode tears down any webcam stream.
  useEffect(() => { if (camSource !== "webcam") stopCamera(); }, [camSource]); // eslint-disable-line
  useEffect(() => () => { clearInterval(inferRef.current); streamRef.current?.getTracks().forEach((tr) => tr.stop()); }, []);

  const webcamLive = camSource === "webcam" && camState === "active";
  const liveOn    = camSource === "edge" ? (edge.connected && hasData) : camState === "active";
  const liveLabel = camSource === "edge"
    ? (edge.connected ? (hasData ? "LIVE" : "LISTENING") : "OFFLINE")
    : (camState === "active" ? "LIVE" : camState === "requesting" ? "CONNECTING…" : "OFFLINE");

  const NAV = [
    { id: "dashboard",  label: "Dashboard", icon: "dashboard" },
    { id: "workflow",   label: "Pipeline",  icon: "workflow" },
    { id: "evaluation", label: "History",   icon: "history" },
  ];

  return (
    <div style={{ fontFamily: font, background: bg, backgroundImage: `radial-gradient(900px 440px at 15% -150px, ${accent}${dark ? "20" : "14"}, transparent 64%), radial-gradient(820px 400px at 92% -130px, ${t.accent2}${dark ? "14" : "0E"}, transparent 60%)`, backgroundRepeat: "no-repeat", color: textPrimary, minHeight: "100vh", margin: 0, padding: 0, fontSize: "13px", lineHeight: 1.5, transition: "background-color .25s ease, color .25s ease" }}>
      <style>{GLOBAL_CSS}</style>
      <div className="rats-grain" />
      <Toaster toasts={toasts} onDismiss={dismissToast} />

      {/* HEADER — sticky, frosted, with the R.A.T.S trademark lockup */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: t.headerBg, backdropFilter: "blur(14px) saturate(140%)", WebkitBackdropFilter: "blur(14px) saturate(140%)", borderBottom: `1px solid ${border}` }}>
        {/* brand ribbon — indigo → Claude clay, slow shimmer */}
        <div style={{ height: 2, backgroundImage: `linear-gradient(90deg, ${accent}, ${t.accent2}, ${accent})`, backgroundSize: "200% 100%", animation: "ratsRibbon 7s linear infinite" }} />
        <div style={{ padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>

          {/* Brand lockup */}
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <span style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 12, background: t.chip, boxShadow: `0 0 0 1px ${border}, 0 8px 22px -8px ${accent}80`, position: "relative", overflow: "hidden" }}>
              <span style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 120% at 30% 0%, ${accent}33, transparent 60%)` }} />
              <RatsLogo size={26} gradFrom={t.accentSoft} gradTo={accent} cut={t.chip} />
            </span>
            <div style={{ lineHeight: 1.1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, fontFamily: FONT_MONO, fontWeight: 700, fontSize: 17, letterSpacing: "0.06em", color: textPrimary }}>
                R.A.T.S<span style={{ fontFamily: FONT_SANS, fontSize: 9, fontWeight: 600, color: textSecondary, transform: "translateY(-6px)" }}>™</span>
              </div>
              <div style={{ fontSize: 10.5, color: textSecondary, letterSpacing: "0.02em" }}>Real-time Auto-Tracking Shelf</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10.5, color: textSecondary, whiteSpace: "nowrap", fontFamily: FONT_MONO, padding: "5px 10px", borderRadius: 999, border: `1px solid ${border}`, background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
              <span className={edge.connected ? "rats-blink" : ""} style={{ width: 7, height: 7, borderRadius: "50%", background: edge.connected ? green : alertRed, display: "inline-block", boxShadow: edge.connected ? `0 0 8px ${green}` : "none" }} />
              {edge.connected ? "server linked" : "server offline"}
            </span>
            <button className="rats-btn" onClick={() => setDark((d) => !d)} title="Toggle theme" aria-label="Toggle theme" style={{ display: "grid", placeItems: "center", width: 34, height: 34, border: `1px solid ${border}`, background: surfaceAlt, color: textSecondary, borderRadius: 10, cursor: "pointer" }}>
              <Icon name={dark ? "sun" : "moon"} size={16} />
            </button>
          </div>
        </div>

        <nav style={{ display: "flex", gap: 2, padding: "0 20px", borderTop: `1px solid ${border}` }}>
          {NAV.map((n) => {
            const active = page === n.id;
            return (
              <button key={n.id} className="rats-tab" onClick={() => setPage(n.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px", height: 44, border: "none", borderBottom: active ? `2px solid ${accent}` : "2px solid transparent", background: "transparent", color: active ? textPrimary : textSecondary, fontFamily: font, fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: "pointer" }}>
                <Icon name={n.icon} size={16} color={active ? accent : textSecondary} />
                {n.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* PAGE: DASHBOARD */}
      {page === "dashboard" && (
        <div className="rats-page" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 28 }}>

          {/* HARDWARE GRID */}
          <div>
            <SectionLabel color={textSecondary}>System Components</SectionLabel>
            <div className="rats-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {HARDWARE.map((hw) => (
                <div key={hw.name} className="rats-card rats-card-hover" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 12, padding: "15px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 10, background: `${hw.color}14`, border: `1px solid ${hw.color}33`, flexShrink: 0 }}>
                      <Icon name={hw.icon} size={19} color={hw.color} strokeWidth={1.6} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hw.name}</div>
                      <div style={{ fontSize: 11, color: textSecondary, marginTop: 2 }}>{hw.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CAMERA PANEL + STOCK (side by side) */}
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
            <div className="rats-card" style={{ flex: "2 1 480px", minWidth: 0, background: surfaceAlt, border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>

              {/* Top bar: source toggle + status */}
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", background: bg, border: `1px solid ${border}`, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
                  {[
                    { id: "edge",   label: "Edge (XIAO)", icon: "cpu" },
                    { id: "webcam", label: "Webcam",      icon: "camera" },
                  ].map((src, i) => {
                    const active = camSource === src.id;
                    return (
                      <button key={src.id} className="rats-btn" onClick={() => setCamSource(src.id)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 13px", border: "none", borderRight: i === 0 ? `1px solid ${border}` : "none", background: active ? accent + "1F" : "transparent", color: active ? textPrimary : textSecondary, fontFamily: font, fontSize: 11.5, fontWeight: active ? 600 : 500, cursor: "pointer" }}>
                        <Icon name={src.icon} size={14} color={active ? accent : textSecondary} /> {src.label}
                      </button>
                    );
                  })}
                </div>

                <span style={{ flex: 1, fontSize: 11, color: textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {camSource === "edge" ? "Edge device → server · counts & alerts only" : "Local webcam → YOLO backend"}
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: 6, color: liveOn ? alertRed : textSecondary, fontWeight: 700, fontSize: 10.5, whiteSpace: "nowrap", letterSpacing: ".06em", fontFamily: FONT_MONO }}>
                  {liveOn && <span className="rats-blink" style={{ width: 7, height: 7, borderRadius: "50%", background: alertRed, display: "inline-block" }} />}
                  {liveLabel}
                </span>
              </div>

              {/* Hidden capture canvas (off-screen) */}
              <canvas ref={captureRef} style={{ display: "none" }} />

              {camSource === "edge" ? (
                <EdgeNodePanel t={t} edge={edge} />
              ) : (
                <>
                  {/* Webcam viewport */}
                  <div style={{ position: "relative", width: "100%", aspectRatio: "16/7", background: t.camBg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: webcamLive ? "block" : "none" }} />
                    <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: webcamLive ? "block" : "none" }} />
                    <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)", pointerEvents: "none" }} />
                    {!webcamLive && (
                      <div style={{ zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: textSecondary, fontSize: 12.5 }}>
                        <Icon name="camera" size={30} color={textSecondary} strokeWidth={1.5} />
                        {camState === "error"
                          ? <div style={{ color: alertRed }}>{camError}</div>
                          : <div>Press <strong style={{ color: accent }}>Connect</strong> to open your webcam</div>}
                      </div>
                    )}
                  </div>

                  {/* Connect / Stop button */}
                  <div style={{ padding: "10px 14px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "center" }}>
                    {camState !== "active"
                      ? <button className="rats-btn" onClick={startCamera} style={{ ...btnStyle(accent, font), display: "inline-flex", alignItems: "center", gap: 8 }}><Icon name="camera" size={15} color={accent} /> Connect</button>
                      : <button className="rats-btn" onClick={stopCamera}  style={{ ...btnStyle(alertRed, font), display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ width: 9, height: 9, background: alertRed, borderRadius: 2 }} /> Stop</button>}
                  </div>
                </>
              )}
            </div>

            {/* PRODUCT STOCK GRID — sidebar beside the preview */}
            <div style={{ flex: "1 1 280px", minWidth: 0 }}>
              <SectionLabel color={textSecondary}>Product Stock</SectionLabel>
              <div className="rats-stagger" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                {PRODUCTS.map((p) => {
                  const count  = stocks ? (stocks[p.id] ?? 0) : null;
                  const status = edge.statuses?.[p.id] || statusOf(count);
                  const alertYellow = "#F4B740";
                  const isAlert     = status === "empty" || status === "low";
                  const alertColor  = status === "empty" ? alertRed : alertYellow;
                  const statusColor = { idle: textSecondary, empty: alertRed, low: alertYellow, ok: green }[status] || textSecondary;
                  const dotColor    = isAlert ? alertColor : p.color;
                  return (
                    <div key={p.id} className="rats-card" style={{ background: isAlert ? (status === "empty" ? alertRed + "0C" : alertYellow + "0A") : surfaceAlt, border: `1px solid ${isAlert ? alertColor + "55" : border}`, borderRadius: 12, padding: "16px 18px", ...(isAlert ? { boxShadow: `0 0 0 1px ${alertColor}2E, 0 12px 30px -16px ${alertColor}66` } : {}) }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
                        <span style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 10, background: `${dotColor}14`, border: `1px solid ${dotColor}30`, flexShrink: 0 }}>
                          <Icon name={p.icon} size={19} color={dotColor} strokeWidth={1.6} />
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: textPrimary }}>{p.label}</div>
                          <div style={{ fontSize: 10, color: statusColor, fontWeight: 700, marginTop: 2, letterSpacing: ".05em", textTransform: "uppercase" }}>{{ idle: "No data", empty: "Out of stock", low: "Low stock", ok: "In stock" }[status]}</div>
                        </div>
                        {isAlert && <span className="rats-blink" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: alertColor + "1F", color: alertColor, border: `1px solid ${alertColor}40`, letterSpacing: ".04em" }}><Icon name="alert" size={11} color={alertColor} /> {status === "empty" ? "CRITICAL" : "WARNING"}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: isAlert ? 12 : 0 }}>
                        <AnimatedNumber value={count} style={{ fontSize: 44, fontWeight: 700, color: count == null ? textSecondary : statusColor, lineHeight: 1 }} />
                        {count != null && <span style={{ fontSize: 11.5, color: textSecondary }}>{count === 1 ? "unit" : "units"} detected</span>}
                      </div>
                      {isAlert && (
                        <div style={{ padding: "8px 12px", borderRadius: 8, background: alertColor + "14", border: `1px solid ${alertColor}33`, fontSize: 11, color: alertColor, fontWeight: 600 }}>
                          {status === "empty" ? "No items detected — immediate restock required" : `Only ${count} item${count === 1 ? "" : "s"} left — restock soon`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* LIVE ALERTS FEED */}
          <LiveAlertsFeed t={t} alerts={edge.alerts} />

          {/* POWER & SAVINGS (deep-sleep demo) */}
          <PowerSavingsPanel t={t} />
        </div>
      )}

      {/* PAGE: WORKFLOW */}
      {page === "workflow" && <div className="rats-page"><WorkflowPage t={t} /></div>}

      {/* PAGE: HISTORY */}
      {page === "evaluation" && (
        <div className="rats-page">
          <AiEvaluationPage t={t} font={font} inferLog={inferLog} totalRuns={totalRuns} avgLatency={avgLatency} />
        </div>
      )}

      {/* FOOTER */}
      <footer style={{ borderTop: `1px solid ${border}`, marginTop: 16, padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <RatsLogo size={17} gradFrom={t.accentSoft} gradTo={accent} cut={bg} id="ratsGradFoot" />
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: textPrimary, fontWeight: 700, letterSpacing: ".06em" }}>R.A.T.S™</span>
          <span style={{ width: 4, height: 4, background: t.accent2, transform: "rotate(45deg)", margin: "0 2px" }} />
          <span style={{ fontSize: 11, color: textSecondary }}>Edge-AI shelf intelligence</span>
        </div>
        <div style={{ fontSize: 10.5, color: textSecondary, fontFamily: FONT_MONO, letterSpacing: ".03em" }}>
          FOMO on-device · ~150&nbsp;ms · realtime SSE
        </div>
      </footer>
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
      icon: "motion",
      title: "Motion wakes device",
      desc: "PIR AM312 detects a person at the shelf and wakes the XIAO from deep sleep — no compute happens until someone is there.",
      color: "#F4B740",
      tag: "Edge · PIR",
    },
    {
      step: "02",
      icon: "camera",
      title: "On-device capture",
      desc: "The OV2640 grabs a frame straight into PSRAM. The image never leaves the device — there is no video stream over the network.",
      color: "#38BDF8",
      tag: "Edge · Camera",
    },
    {
      step: "03",
      icon: "model",
      title: "FOMO inference (on-device)",
      desc: "MobileNetV2 FOMO runs on the ESP32-S3 itself in ~150 ms and counts each product class. This is the realtime core — no server, no round-trip.",
      color: "#34D399",
      tag: "Edge · MCU",
    },
    {
      step: "04",
      icon: "wifi",
      title: "Push only on change",
      desc: "When a count changes, the device POSTs a tiny JSON payload over WiFi to the relay. Stable shelf → silent network (edge efficiency).",
      color: "#A78BFA",
      tag: "WiFi · JSON",
    },
    {
      step: "05",
      icon: "layout",
      title: "Realtime dashboard",
      desc: "The relay raises an alert on any stock-status change and streams state + alerts to the dashboard over SSE — live counts and toasts.",
      color: accent,
      tag: "Dashboard · SSE",
    },
  ];

  const MODES = [
    {
      icon: "cpu",
      title: "Edge — XIAO ESP32-S3",
      color: "#38BDF8",
      rows: [
        { label: "Camera",    value: "OV2640 (DVP)" },
        { label: "Model",     value: "FOMO MobileNetV2 (Edge Impulse)" },
        { label: "Inference", value: "On-device (ESP32-S3)" },
        { label: "Network",   value: "Counts & alerts only — no video" },
        { label: "Latency",   value: "~150 ms on-device" },
      ],
    },
    {
      icon: "camera",
      title: "Webcam — demo fallback",
      color: "#34D399",
      rows: [
        { label: "Camera",    value: "Browser getUserMedia" },
        { label: "Model",     value: "YOLO11n (best.pt)" },
        { label: "Inference", value: "Flask backend (CPU/GPU)" },
        { label: "Purpose",   value: "Present without the hardware" },
        { label: "Latency",   value: "~30–120 ms" },
      ],
    },
  ];

  const STACK = [
    { layer: "Hardware",  items: ["XIAO ESP32-S3 Sense", "PIR AM312", "OV2640 camera"],                color: "#F4B740" },
    { layer: "Edge ML",   items: ["Edge Impulse", "FOMO MobileNetV2", "TFLite Micro"],                 color: "#34D399" },
    { layer: "Relay",     items: ["Python Flask", "SSE alert hub", "Ultralytics (webcam)"],            color: "#A78BFA" },
    { layer: "Frontend",  items: ["React + Vite", "EventSource (SSE)", "Canvas overlay"],              color: "#38BDF8" },
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
              <div className="rats-card" style={{ flex: 1, background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${s.color}`, borderRadius: 12, padding: "18px 16px", position: "relative" }}>
                {/* Step badge */}
                <div style={{ position: "absolute", top: 12, right: 12, fontSize: 9, fontWeight: 700, color: s.color, background: s.color + "18", border: `1px solid ${s.color}40`, borderRadius: 6, padding: "2px 7px", letterSpacing: "0.05em" }}>
                  {s.tag}
                </div>
                <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 11, background: `${s.color}14`, border: `1px solid ${s.color}30`, marginBottom: 12 }}>
                  <Icon name={s.icon} size={20} color={s.color} strokeWidth={1.6} />
                </span>
                <div style={{ fontSize: 9, fontWeight: 700, color: s.color, letterSpacing: "0.08em", marginBottom: 4, fontFamily: FONT_MONO }}>STEP {s.step}</div>
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
            <div key={m.title} className="rats-card" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${m.color}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", gap: 11, borderBottom: `1px solid ${border}` }}>
                <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: `${m.color}14`, border: `1px solid ${m.color}30` }}>
                  <Icon name={m.icon} size={17} color={m.color} strokeWidth={1.6} />
                </span>
                <span style={{ fontWeight: 600, fontSize: 14, color: textPrimary }}>{m.title}</span>
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
            <div key={s.layer} className="rats-card rats-card-hover" style={{ background: surfaceAlt, border: `1px solid ${border}`, borderTop: `3px solid ${s.color}`, borderRadius: 12, padding: "14px 16px" }}>
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

function SectionLabel({ children, color = "#8A93A6" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
      <span style={{ width: 3, height: 13, borderRadius: 2, background: "linear-gradient(180deg, #6366F1, #D97757)", flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.09em" }}>{children}</span>
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
