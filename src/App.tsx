import {
  useState,
  useRef,
  type ChangeEvent,
} from "react";
import "./App.css";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
const apiUrl = (path: string) => `${API_BASE}${path}`;

type ExportMode = "outline" | "engraving";
type EdgePolyline = number[][];   // [[x, y], ...]
type Screen = "home" | "edges" | "output";

// ─── Icons ────────────────────────────────────────────────────────────────────

const I = {
  Upload: ({ size = 15 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  ),
  ChevronLeft: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  ChevronRight: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  ChevronDown: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  ChevronUp: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ),
  Check: ({ size = 11 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  CheckCircle: ({ size = 17 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  ImagePlus: ({ size = 38 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
      <line x1="16" y1="5" x2="22" y2="5" /><line x1="19" y1="2" x2="19" y2="8" />
    </svg>
  ),
  Brush: ({ size = 13 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
      <path d="M9 8c-2 3-4 3.5-7 4l8 8c1-.5 3.5-2 4-7" />
    </svg>
  ),
  Download: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  DownloadCloud: ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17" /><line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
    </svg>
  ),
  Sparkles: ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  ),
  Layers: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  ArrowRight: ({ size = 15 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  BookOpen: ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  Settings: ({ size = 13 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  X: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  RotateCcw: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.15" />
    </svg>
  ),
  Scissors: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  Eye: ({ size = 13 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  SquareStack: ({ size = 18 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2" />
      <path d="M10 16c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2" />
      <rect x="14" y="14" width="8" height="8" rx="2" />
    </svg>
  ),
  Home: ({ size = 13 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
};

// ─── API functions ─────────────────────────────────────────────────────────────

async function createSession(imageFile: File): Promise<{
  sessionId: string;
  width: number;
  height: number;
  edges: EdgePolyline[];
}> {
  const fd = new FormData();
  fd.append("image", imageFile);
  const res = await fetch(apiUrl("/api/sessions"), { method: "POST", body: fd });
  if (!res.ok)
    throw new Error(
      (await res.text().catch(() => "")) || `Failed to start session (${res.status})`,
    );
  return res.json();
}

async function saveEdgeSelection(sessionId: string, selectedIndices: number[]): Promise<void> {
  const res = await fetch(apiUrl(`/api/sessions/${sessionId}/edge-selection`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selected_indices: selectedIndices }),
  });
  if (!res.ok)
    throw new Error(
      (await res.text().catch(() => "")) || `Failed to save selection (${res.status})`,
    );
}

async function deleteSession(sessionId: string) {
  await fetch(apiUrl(`/api/sessions/${sessionId}`), { method: "DELETE" }).catch(() => {});
}

async function exportStand(
  sessionId: string,
  nLayers: number,
  spokeH = 1.4,
  baseH = 0.65,
) {
  const res = await fetch(apiUrl(`/api/sessions/${sessionId}/export-stand`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n_layers: nLayers, spoke_h_in: spokeH, base_h_in: baseH }),
  });
  if (!res.ok)
    throw new Error(
      (await res.text().catch(() => "")) || `Stand export failed (${res.status})`,
    );
  return res.blob();
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Stars() {
  return (
    <div className="stars" aria-hidden="true">
      {[...Array(20)].map((_, i) => (
        <div key={i} className={`star star-${i + 1}`} />
      ))}
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>x</button>
        <div className="modal-title"><I.Sparkles /> How It Works</div>
        <div className="modal-step">
          <div className="modal-step-label"><I.Upload /> step 1 — Upload</div>
          <p>Drop or click to upload a photo. Enter how many layers (1–10) and press <strong>run</strong>. Edge detection runs automatically.</p>
        </div>
        <hr className="modal-divider" />
        <div className="modal-step">
          <div className="modal-step-label"><I.Brush /> step 2 — Select Edges</div>
          <p>
            All detected boundaries are shown as white lines. Click any edge to mark it as a <strong>cut line</strong> (turns red). Click again to deselect.
            Use <strong>select all</strong> / <strong>clear all</strong> for bulk actions.
          </p>
        </div>
        <hr className="modal-divider" />
        <div className="modal-step">
          <div className="modal-step-label"><I.CheckCircle /> step 3 — Confirm</div>
          <p>Press <strong>confirm cuts</strong> to store your selection. The backend will use these edges together with depth estimation to assign pixels to layers.</p>
        </div>
        <hr className="modal-divider" />
        <div className="modal-step">
          <div className="modal-step-label"><I.Download /> step 4 — Export</div>
          <p><strong>Export Stand</strong> gives an Adobe Illustrator file for the laser-cut tunnel book stand.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  screen,
  onGoHome,
}: {
  screen: Screen;
  onGoHome: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <I.SquareStack />
        <span>tunnel<span className="sidebar-logo-accent">book</span></span>
      </div>
      <nav className="sidebar-nav">
        <div
          className={`sidebar-tab ${screen === "home" ? "sidebar-tab--active" : "sidebar-tab--idle"}`}
          onClick={onGoHome}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onGoHome()}
        >
          <I.Home />
          <span className="sidebar-tab-label">upload</span>
          {screen !== "home" && <div className="sidebar-tab-dot" style={{ background: "#6366f1" }} />}
        </div>

        {screen !== "home" && (
          <div
            className={`sidebar-tab ${screen === "edges" ? "sidebar-tab--active" : ""} ${screen === "output" ? "sidebar-tab--done" : ""}`}
          >
            <div
              className="sidebar-tab-dot"
              style={{ background: screen === "output" ? "#22c55e" : "#6366f1" }}
            />
            <span className="sidebar-tab-label">edges</span>
            {screen === "output" && (
              <span className="sidebar-tab-check"><I.Check /></span>
            )}
            {screen === "edges" && <div className="sidebar-tab-pulse" />}
          </div>
        )}

        {screen === "output" && (
          <div className="sidebar-tab sidebar-tab--active sidebar-tab--output">
            <I.CheckCircle size={13} />
            <span className="sidebar-tab-label">output</span>
          </div>
        )}
      </nav>
      <div className="sidebar-footer">
        <span className="sidebar-status">
          {screen === "home" ? "ready" : screen === "edges" ? "selecting" : "complete"}
        </span>
      </div>
    </aside>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

function HomeScreen({
  onGo,
  isStarting,
  error,
  exportMode,
  onExportModeChange,
}: {
  onGo: (f: File, url: string, n: number, frameWidthIn: number, frameHeightIn: number, frameBorderIn: number) => void;
  isStarting: boolean;
  error: string | null;
  exportMode: ExportMode;
  onExportModeChange: (m: ExportMode) => void;
}) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [layerCount, setLayerCount] = useState("");
  const [frameWidthIn, setFrameWidthIn] = useState("12");
  const [frameHeightIn, setFrameHeightIn] = useState("9");
  const [frameBorderIn, setFrameBorderIn] = useState("0.5");
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = parseInt(layerCount, 10);
  const parsedW = parseFloat(frameWidthIn);
  const parsedH = parseFloat(frameHeightIn);
  const parsedB = parseFloat(frameBorderIn);
  const frameValid =
    !isNaN(parsedW) && parsedW >= 1 && parsedW <= 30 &&
    !isNaN(parsedH) && parsedH >= 1 && parsedH <= 30 &&
    !isNaN(parsedB) && parsedB >= 0 && parsedB <= 4;
  const canGo = !!imageUrl && parsed >= 1 && parsed <= 10 && !isStarting && frameValid;

  const clampNum = (v: string, min: number, max: number) => {
    const n = parseFloat(v);
    if (isNaN(n)) return v;
    if (n > max) return String(max);
    return v;
  };

  const applyFile = (f: File) => {
    setImageFile(f);
    setImageUrl(URL.createObjectURL(f));
  };
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) applyFile(f);
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) applyFile(f);
  };

  const outerW = frameValid ? (parsedW + 2 * parsedB).toFixed(2) : "—";
  const outerH = frameValid ? (parsedH + 2 * parsedB).toFixed(2) : "—";

  return (
    <div className="home-screen">
      <div className="home-hero">
        <div className="home-tag">// AI-powered layer segmentation</div>
        <h1 className="home-title">
          Tunnel<span className="home-title-accent">Book</span>
          <span className="home-title-small"> Generator</span>
        </h1>
        <div className="home-steps">
          <span className="home-step"><I.Upload size={11} /> upload image</span>
          <span className="home-step-arrow">→</span>
          <span className="home-step"><I.Brush size={11} /> select edges</span>
          <span className="home-step-arrow">→</span>
          <span className="home-step"><I.BookOpen size={11} /> assign layers</span>
          <span className="home-step-arrow">→</span>
          <span className="home-step"><I.Download size={11} /> export cut files</span>
        </div>
      </div>

      <div
        className={`drop-zone ${isDragging ? "drop-zone--dragging" : ""} ${imageUrl ? "drop-zone--filled" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !imageUrl && fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
        {imageUrl ? (
          <div className="drop-zone-preview">
            <img src={imageUrl} alt="Uploaded" />
            <div className="drop-zone-overlay">
              <button
                className="drop-zone-change"
                onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
              >
                <I.Upload /> change image
              </button>
            </div>
            <div className="drop-zone-filename">{imageFile?.name}</div>
          </div>
        ) : (
          <div className="drop-zone-empty">
            <div className="drop-zone-icon"><I.ImagePlus /></div>
            <div className="drop-zone-text">
              {isDragging ? "drop it here!" : "drag & drop or click to upload"}
            </div>
            <div className="drop-zone-sub">PNG · JPG · WEBP</div>
          </div>
        )}
      </div>

      {/* ── Row 1: layers / default mode / run ── */}
      <div className="config-row">
        <div className="config-group">
          <label className="config-label"><I.Layers /> layers</label>
          <div className="config-input-wrap">
            <input
              className="config-input"
              type="text"
              inputMode="numeric"
              placeholder="?"
              value={layerCount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, "");
                setLayerCount(!v || parseInt(v) <= 10 ? v : "10");
              }}
              maxLength={2}
            />
            <span className="config-max">/ 10</span>
          </div>
        </div>

        <div className="config-group">
          <label className="config-label"><I.Settings /> default mode</label>
          <div className="mode-toggle">
            <button
              className={`mode-toggle-btn ${exportMode === "outline" ? "mode-toggle-btn--active" : ""}`}
              onClick={() => onExportModeChange("outline")}
            >
              <I.Scissors /> outline
            </button>
            <button
              className={`mode-toggle-btn ${exportMode === "engraving" ? "mode-toggle-btn--active" : ""}`}
              onClick={() => onExportModeChange("engraving")}
            >
              <I.Eye /> engrave
            </button>
          </div>
        </div>

        <button
          className={`go-btn ${canGo ? "go-btn--active" : "go-btn--disabled"}`}
          onClick={() => {
            if (canGo && imageFile && imageUrl)
              onGo(imageFile, imageUrl, parsed, parsedW, parsedH, parsedB);
          }}
          disabled={!canGo}
        >
          {isStarting ? (
            <><span className="go-btn-spinner" /> detecting edges…</>
          ) : (
            <>run <I.ArrowRight /></>
          )}
        </button>
      </div>

      {/* ── Row 2: frame dimensions ── */}
      <div className="config-row config-row--frame">
        <div className="frame-row-label"><I.Scissors size={11} /> frame dimensions</div>
        <div className="config-group">
          <label className="config-label">inner width</label>
          <div className="config-input-wrap config-input-wrap--sm">
            <input
              className="config-input config-input--sm"
              type="text"
              inputMode="decimal"
              placeholder="12"
              value={frameWidthIn}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setFrameWidthIn(clampNum(v, 1, 30));
              }}
            />
            <span className="config-max">/ 30 in</span>
          </div>
        </div>
        <div className="config-group">
          <label className="config-label">inner height</label>
          <div className="config-input-wrap config-input-wrap--sm">
            <input
              className="config-input config-input--sm"
              type="text"
              inputMode="decimal"
              placeholder="9"
              value={frameHeightIn}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setFrameHeightIn(clampNum(v, 1, 30));
              }}
            />
            <span className="config-max">/ 30 in</span>
          </div>
        </div>
        <div className="config-group">
          <label className="config-label">border gap</label>
          <div className="config-input-wrap config-input-wrap--sm">
            <input
              className="config-input config-input--sm"
              type="text"
              inputMode="decimal"
              placeholder="0.5"
              value={frameBorderIn}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setFrameBorderIn(clampNum(v, 0, 4));
              }}
            />
            <span className="config-max">/ 4 in</span>
          </div>
        </div>
        <div className={`frame-summary ${!frameValid ? "frame-summary--warn" : ""}`}>
          {frameValid ? (
            <>
              <span className="frame-summary-item">
                <span className="frame-summary-key">inner</span>{parsedW}" × {parsedH}"
              </span>
              <span className="frame-summary-sep">·</span>
              <span className="frame-summary-item">
                <span className="frame-summary-key">border</span>{parsedB}"
              </span>
              <span className="frame-summary-sep">·</span>
              <span className="frame-summary-item">
                <span className="frame-summary-key">outer</span>{outerW}" × {outerH}"
              </span>
              <span className="frame-summary-sep">·</span>
              <span className="frame-summary-note">identical across all layers</span>
            </>
          ) : (
            <span className="frame-summary-warn-text">⚠ enter valid dimensions to continue</span>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-banner-tag">// error</span> {error}
          <div className="error-banner-sub">
            Ensure the Python server is running and Vite proxies <code>/api</code>.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Edge Selection Screen ────────────────────────────────────────────────────

function EdgeSelectionScreen({
  imageUrl,
  sessionWidth,
  sessionHeight,
  numLayers,
  edges,
  onSubmit,
  onBack,
}: {
  imageUrl: string;
  sessionWidth: number;
  sessionHeight: number;
  numLayers: number;
  edges: EdgePolyline[];
  onSubmit: (selectedIndices: number[]) => Promise<void>;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit([...selected]);
    } catch (err: any) {
      setSubmitError(err?.message ?? "Failed to save");
      setIsSubmitting(false);
    }
  };

  const polyPts = (pl: EdgePolyline) => pl.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <div className="layer-screen">
      <div className="layer-topbar">
        <button className="back-btn" onClick={onBack}>
          <I.ChevronLeft /> back
        </button>
        <div className="layer-topbar-center">
          <div className="layer-badge" style={{ background: "#6366f1" }}>
            edge_selection
          </div>
          <span className="layer-of">for {numLayers} layer{numLayers !== 1 ? "s" : ""}</span>
        </div>
        <div className="layer-progress-wrap" style={{ alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {selected.size} / {edges.length} edges selected
          </span>
        </div>
      </div>

      <div className="canvas-card">
        <div className="canvas-tools">
          <span className="canvas-tools-hint">
            <I.Brush /> click edges to mark as cut lines (red) or leave unselected (grey)
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="ctrl-btn ctrl-btn--ghost"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
            >
              clear all
            </button>
            <button
              className="ctrl-btn ctrl-btn--ghost"
              onClick={() => setSelected(new Set(edges.map((_, i) => i)))}
              disabled={selected.size === edges.length}
            >
              select all
            </button>
          </div>
        </div>

        {/* canvas-wrap is sized exactly to the image; SVG overlays it 1:1 */}
        <div className="canvas-wrap" style={{ position: "relative" }}>
          <img
            src={imageUrl}
            alt="Source"
            draggable={false}
            style={{ display: "block", width: "100%", height: "auto", pointerEvents: "none" }}
          />
          <svg
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
            viewBox={`0 0 ${sessionWidth} ${sessionHeight}`}
            preserveAspectRatio="none"
          >
            {edges.map((pl, i) => {
              const isSel = selected.has(i);
              const isHov = hoveredIdx === i;
              const pts = polyPts(pl);
              return (
                <g
                  key={i}
                  onClick={() => toggle(i)}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Wide transparent stroke — hit target */}
                  <polyline
                    points={pts}
                    stroke="transparent"
                    strokeWidth={12}
                    fill="none"
                  />
                  {/* Visible stroke */}
                  <polyline
                    points={pts}
                    stroke={
                      isSel
                        ? isHov ? "#f87171" : "#ef4444"
                        : isHov ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.28)"
                    }
                    strokeWidth={isSel ? 2 : 1}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="layer-controls">
        <div className="layer-controls-left">
          <div className="points-pill" style={{ color: "#ef4444", borderColor: "#ef444444" }}>
            {selected.size} cut
          </div>
          <div className="points-pill">
            {edges.length - selected.size} ignored
          </div>
        </div>
        <div className="layer-controls-right">
          {submitError && <span className="seg-error-inline">// {submitError}</span>}
          <button
            className="next-btn"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <><span className="go-btn-spinner" /> saving…</>
            ) : (
              <><I.CheckCircle size={14} /> confirm cuts</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Output Screen ────────────────────────────────────────────────────────────

function OutputScreen({
  imageFile,
  sessionId,
  numLayers,
  selectedEdgeCount,
  onBack,
}: {
  imageFile: File | null;
  sessionId: string | null;
  numLayers: number;
  selectedEdgeCount: number;
  onBack: () => void;
}) {
  const [isExportingStand, setIsExportingStand] = useState(false);
  const [standError, setStandError] = useState<string | null>(null);

  const baseName = imageFile ? imageFile.name.replace(/\.[^/.]+$/, "") : "output";
  const safeBase = baseName.replace(/\s+/g, "_");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");

  const dlBlob = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadStand = async () => {
    if (!sessionId) return;
    setStandError(null);
    setIsExportingStand(true);
    try {
      dlBlob(
        `TunnelBook_${safeBase}_stand_${stamp}.ai`,
        await exportStand(sessionId, numLayers),
      );
    } catch (err: any) {
      setStandError(err?.message ?? "Stand export failed");
    } finally {
      setIsExportingStand(false);
    }
  };

  return (
    <div className="output-screen">
      <div className="output-topbar">
        <button className="back-btn" onClick={onBack}>
          <I.ChevronLeft /> back
        </button>
        <div className="output-title">
          <I.CheckCircle /> <span>edges_saved</span>
        </div>
        <div className="output-badge">{numLayers} layers</div>
      </div>

      <div className="output-card">
        <div className="output-card-header">// {imageFile?.name}</div>
        <div className="output-row">
          <div className="output-row-left">
            <div className="output-dot" style={{ background: "#ef4444" }} />
            <div className="output-info">
              <span className="output-filename">{selectedEdgeCount} cut edge{selectedEdgeCount !== 1 ? "s" : ""} selected</span>
              <div className="output-meta">
                <span className="output-layer-tag">step_1 complete</span>
                <span className="output-mode-tag"><I.Scissors /> outline</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: "10px 16px 14px", color: "var(--text-dim)", fontSize: 11, lineHeight: 1.6 }}>
          // edge selections stored · superpixels computed<br />
          // depth binning + layer assignment → step 2
        </div>
      </div>

      <div className="output-actions">
        <button
          className="action-btn action-btn--stand"
          onClick={handleDownloadStand}
          disabled={isExportingStand || !sessionId}
          title={`Generate a ${numLayers}-slot laser-cut stand`}
        >
          <I.DownloadCloud /> {isExportingStand ? "generating…" : "export_stand.ai"}
        </button>
      </div>

      {standError && (
        <div className="error-banner">
          <span className="error-banner-tag">// error</span> {standError}
        </div>
      )}
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [totalLayers, setTotalLayers] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("outline");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionWidth, setSessionWidth] = useState(0);
  const [sessionHeight, setSessionHeight] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [frameWidthIn, setFrameWidthIn] = useState(12);
  const [frameHeightIn, setFrameHeightIn] = useState(9);
  const [frameBorderIn, setFrameBorderIn] = useState(0.5);
  const [edges, setEdges] = useState<EdgePolyline[]>([]);
  const [selectedEdgeCount, setSelectedEdgeCount] = useState(0);

  const reset = async () => {
    if (sessionId) await deleteSession(sessionId);
    setSessionId(null);
    setSessionWidth(0);
    setSessionHeight(0);
    setTotalLayers(0);
    setEdges([]);
    setSelectedEdgeCount(0);
    setBackendError(null);
    setFrameWidthIn(12);
    setFrameHeightIn(9);
    setFrameBorderIn(0.5);
  };

  const handleGo = async (
    file: File,
    url: string,
    count: number,
    fwIn: number,
    fhIn: number,
    fbIn: number,
  ) => {
    setFrameWidthIn(fwIn);
    setFrameHeightIn(fhIn);
    setFrameBorderIn(fbIn);
    setBackendError(null);
    setIsStarting(true);
    try {
      const { sessionId: sid, width, height, edges: detectedEdges } = await createSession(file);
      setImageFile(file);
      setImageUrl(url);
      setTotalLayers(count);
      setSessionId(sid);
      setSessionWidth(width);
      setSessionHeight(height);
      setEdges(detectedEdges);
      setScreen("edges");
    } catch (err: any) {
      setBackendError(err?.message ?? "Failed to start backend");
    } finally {
      setIsStarting(false);
    }
  };

  const handleEdgeSubmit = async (selectedIndices: number[]) => {
    if (!sessionId) return;
    await saveEdgeSelection(sessionId, selectedIndices);
    setSelectedEdgeCount(selectedIndices.length);
    setScreen("output");
  };

  const handleBack = () => {
    setScreen("home");
    reset();
  };

  return (
    <div className="app-root">
      <Stars />
      <Sidebar screen={screen} onGoHome={handleBack} />
      <main className="app-main">
        <div className="main-inner">
          {screen === "home" && (
            <HomeScreen
              onGo={handleGo}
              isStarting={isStarting}
              error={backendError}
              exportMode={exportMode}
              onExportModeChange={setExportMode}
            />
          )}
          {screen === "edges" && imageUrl && sessionId && (
            <EdgeSelectionScreen
              imageUrl={imageUrl}
              sessionWidth={sessionWidth}
              sessionHeight={sessionHeight}
              numLayers={totalLayers}
              edges={edges}
              onSubmit={handleEdgeSubmit}
              onBack={handleBack}
            />
          )}
          {screen === "output" && (
            <OutputScreen
              imageFile={imageFile}
              sessionId={sessionId}
              numLayers={totalLayers}
              selectedEdgeCount={selectedEdgeCount}
              onBack={handleBack}
            />
          )}
        </div>
        <button className="help-btn" onClick={() => setShowHelp(true)} title="How it works">
          ?
        </button>
      </main>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default App;
