import { useState, useRef, useEffect, type ChangeEvent } from "react";
import {
  Upload,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ImagePlus,
  Paintbrush2,
  Download,
  DownloadCloud,
  Sparkles,
  Layers,
  ArrowRight,
  Check,
} from "lucide-react"; // npm install lucide-react
import JSZip from "jszip"; // npm install jszip
import "./App.css";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ""; // e.g. "http://localhost:8000" (optional)
const apiUrl = (path: string) => `${API_BASE}${path}`;

type SegmentPoint = { x: number; y: number; xPct: number; yPct: number };
type ExportMode = "outline" | "engraving";
type Mode = "manual" | "automatic";

async function createSession(imageFile: File) {
  const fd = new FormData();
  fd.append("image", imageFile);

  const res = await fetch(apiUrl("/api/sessions"), {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Failed to start automatic session (${res.status})`);
  }
  return res.json() as Promise<{
    sessionId: string;
    width: number;
    height: number;
  }>;
}
async function createAutomaticSession(imageFile: File) {
  const fd = new FormData();
  fd.append("image", imageFile);

  const res = await fetch(apiUrl("/api/automatic-sessions"), {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Failed to start automatic session (${res.status})`);
  }
  return res.json() as Promise<{
    sessionId: string;
    width: number;
    height: number;
  }>;
}

async function segmentMask(
  sessionId: string,
  points: SegmentPoint[],
  signal?: AbortSignal,
) {
  const res = await fetch(apiUrl(`/api/sessions/${sessionId}/segment`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points: points.map((p) => [p.x, p.y]) }),
    signal,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Segmentation failed (${res.status})`);
  }

  return res.blob();
}

async function deleteSession(sessionId: string) {
  await fetch(apiUrl(`/api/sessions/${sessionId}`), { method: "DELETE" }).catch(
    () => {},
  );
}

async function exportAiLayers(
  sessionId: string,
  maskBlobs: Blob[],
  dpi = 72,
  mode: ExportMode = "outline",
) {
  const toBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]); // strip "data:...;base64,"
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const masks_b64 = await Promise.all(maskBlobs.map(toBase64));

  const res = await fetch(apiUrl(`/api/sessions/${sessionId}/export-ai`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masks_b64, dpi, mode }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `AI export failed (${res.status})`);
  }

  return res.blob(); // zip blob
}

async function automaticLayers(
  sessionId: string,
  numLayers: number,
  dpi = 72,
  mode: ExportMode = "outline",
) {
  // print the parameters being sent to the backend for debugging
  console.log({ num_layers: numLayers, dpi, mode });
  const res = await fetch(apiUrl(`/api/sessions/${sessionId}/automatic`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ num_layers: numLayers, dpi, mode }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Automatic generation failed (${res.status})`);
  }

  return res.blob(); // png zip blob
}

async function automaticAiLayers(sessionId: string) {
  const res = await fetch(apiUrl(`/api/sessions/${sessionId}/automatic-ai`));
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Automatic AI failed (${res.status})`);
  }
  return res.blob(); // ai zip blob
}

interface LayerColor {
  fill: string;
  stroke: string;
}

interface CompletedLayer {
  maskUrl: string;
  maskBlob: Blob;
  points: SegmentPoint[];
  color: LayerColor;
}

// each layer gets the next colour — used to tint the mask overlay
const LAYER_COLORS: LayerColor[] = [
  { fill: "rgba(239, 68, 68, 0.55)", stroke: "#ef4444" },
  { fill: "rgba(59, 130, 246, 0.55)", stroke: "#3b82f6" },
  { fill: "rgba(34, 197, 94, 0.55)", stroke: "#22c55e" },
  { fill: "rgba(251, 146, 60, 0.55)", stroke: "#f97316" },
  { fill: "rgba(168, 85, 247, 0.55)", stroke: "#a855f7" },
  { fill: "rgba(236, 72, 153, 0.55)", stroke: "#ec4899" },
  { fill: "rgba(20, 184, 166, 0.55)", stroke: "#14b8a6" },
  { fill: "rgba(234, 179, 8, 0.55)", stroke: "#eab308" },
  { fill: "rgba(99, 102, 241, 0.55)", stroke: "#6366f1" },
  { fill: "rgba(14, 165, 233, 0.55)", stroke: "#0ea5e9" },
];

// decorative bubbles floating in the background
function Bubbles() {
  return (
    <div className="bubbles" aria-hidden="true">
      {[...Array(8)].map((_, i) => (
        <div key={i} className={`bubble bubble-${i + 1}`} />
      ))}
    </div>
  );
}

// progress dots shown on the layer selection screen
function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="progress-dots">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`progress-dot ${
            i + 1 < current
              ? "dot-done"
              : i + 1 === current
                ? "dot-active"
                : "dot-pending"
          }`}
          style={
            i + 1 === current
              ? { background: LAYER_COLORS[i % LAYER_COLORS.length].stroke }
              : {}
          }
        />
      ))}
    </div>
  );
}

// help modal — triggered by the ? button in the corner
interface HelpModalProps {
  onClose: () => void;
}

function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          x
        </button>
        <div className="modal-title">
          <Sparkles size={18} className="modal-title-icon" />
          How It Works
        </div>

        <div className="modal-step">
          <div className="modal-step-label">
            <Upload size={13} /> Step 1 — Upload Photo
          </div>
          <p>
            Upload a photo and enter the number of layers (1–10). Click{" "}
            <strong>Go!</strong> to begin.
          </p>
        </div>
        <hr className="modal-divider" />
        <div className="modal-step">
          <div className="modal-step-label">
            <Paintbrush2 size={13} /> Step 2 — Select Your Layers
          </div>
          <p>
            Click <strong>multiple points</strong> on the image to guide the
            selection for each layer. Each click adds a selection on the layer
            (more points usually means a cleaner mask). When it looks right,
            click <strong>Next Layer</strong> to lock it in! Completed layers
            cannot be revised. The last layer shows{" "}
            <strong>Submit Layers</strong>.
          </p>
        </div>
        <hr className="modal-divider" />
        <div className="modal-step">
          <div className="modal-step-label">
            <Download size={13} /> Step 3 — Download &amp; Cut
          </div>
          <p>
            <strong>Download All</strong> exports in a single <code>.zip</code>{" "}
            containing every layer image or individually.
          </p>
        </div>
      </div>
    </div>
  );
}

// home screen — image upload + layer count input
interface HomeScreenProps {
  onGo: (file: File, url: string, count: number, mode: Mode) => void;
  isStarting: boolean;
  error: string | null;
  exportMode: ExportMode;
  onExportModeChange: (mode: ExportMode) => void;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

function HomeScreen({
  onGo,
  isStarting,
  error,
  exportMode,
  onExportModeChange,
  mode,
  onModeChange,
}: HomeScreenProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [layerCount, setLayerCount] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const parsedLayers = parseInt(layerCount, 10);
  const canGo =
    imageUrl !== null && parsedLayers >= 1 && parsedLayers <= 10 && !isStarting;

  // image upload — stores as local object URL for preview
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    setImageUrl(URL.createObjectURL(f));
  };

  const handleLayerInput = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^0-9]/g, "");
    if (v === "" || parseInt(v) <= 10) setLayerCount(v);
    else setLayerCount("10");
  };

  const handleGo = () => {
    if (canGo && imageFile && imageUrl)
      onGo(imageFile, imageUrl, parsedLayers, mode);
  };

  return (
    <>
      <h1 className="page-title">Tunnel Book Design Tool</h1>
      <div className="controls-row">
        <button className="upload-btn" onClick={() => fileRef.current?.click()}>
          <Upload size={16} strokeWidth={2.5} />
          Upload Image
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFile}
        />

        <div className="layers-group">
          <Layers size={15} className="layers-icon" />
          <span className="layers-label">Book Layers:</span>
          <input
            className="layers-input"
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={layerCount}
            onChange={handleLayerInput}
            maxLength={2}
          />
          <span className="layers-hint">max 10</span>
        </div>
      </div>

      <div className="controls-row">
        <div className="mode-pill">
          <button
            className={`mode-pill-btn ${mode === "manual" ? "mode-pill-btn-active" : ""}`}
            onClick={() => onModeChange("manual")}
          >
            Manual
          </button>
          <div className="mode-option">
            <button
              className={`mode-pill-btn ${mode === "automatic" ? "mode-pill-btn-active" : ""}`}
              onClick={() => onModeChange("automatic")}
            >
              Automatic
            </button>
          </div>
        </div>
        <div className="mode-pill">
          <button
            className={`mode-pill-btn ${exportMode === "outline" ? "mode-pill-btn-active" : ""}`}
            onClick={() => onExportModeChange("outline")}
            title="Outline — red border cuts only"
          >
            Outline
          </button>
          <button
            className={`mode-pill-btn ${exportMode === "engraving" ? "mode-pill-btn-active" : ""}`}
            onClick={() => onExportModeChange("engraving")}
            title="Engraving — red cuts + blue engraving"
          >
            Engrave
          </button>
        </div>

        <button
          className={`go-btn ${canGo ? "go-btn-active" : "go-btn-disabled"}`}
          onClick={handleGo}
          disabled={!canGo}
        >
          {isStarting ? "Starting…" : "Go!"}
          {canGo && !isStarting && <ArrowRight size={16} strokeWidth={2.5} />}
        </button>
      </div>

      {error && (
        <div className="backend-error">
          <strong>Backend error:</strong> {error}
          <div className="backend-error-sub">
            Make sure the Python server is running and Vite is proxying{" "}
            <code>/api</code>.
          </div>
        </div>
      )}

      {imageUrl ? (
        <>
          <div className="filename-pill">
            <CheckCircle2
              size={16}
              className="filename-icon"
              strokeWidth={2.5}
            />
            <span className="filename-text">{imageFile?.name}</span>
          </div>
          <div className="preview-card preview-card-uploaded">
            <img src={imageUrl} alt="Uploaded" />
          </div>
        </>
      ) : (
        <div
          className="preview-card drop-zone"
          onClick={() => fileRef.current?.click()}
        >
          <div className="no-file-inner">
            <div className="no-file-icon">
              <ImagePlus size={40} strokeWidth={1.5} />
            </div>
            <span className="no-file-text">Click to upload an image</span>
            <span className="no-file-sub">PNG · JPG · WEBP</span>
          </div>
        </div>
      )}
    </>
  );
}

// layer selection screen — user clicks points, SAM segments the region, result stored per layer
interface LayerSelectionProps {
  imageFile: File | null;
  imageUrl: string;
  sessionId: string;
  sessionWidth: number;
  sessionHeight: number;
  totalLayers: number;
  currentLayer: number;
  completedLayers: CompletedLayer[];
  onNext: (layer: CompletedLayer) => void;
  onBack: () => void;
}

function LayerSelectionScreen({
  imageFile,
  imageUrl,
  sessionId,
  sessionWidth,
  sessionHeight,
  totalLayers,
  currentLayer,
  completedLayers,
  onNext,
  onBack,
}: LayerSelectionProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const currentMaskUrlRef = useRef<string | null>(null);

  const [points, setPoints] = useState<SegmentPoint[]>([]);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [maskBlob, setMaskBlob] = useState<Blob | null>(null);
  const [isSegmenting, setIsSegmenting] = useState<boolean>(false);
  const [segError, setSegError] = useState<string | null>(null);

  const segmentController = useRef<AbortController | null>(null);
  const segmentSeq = useRef<number>(0);

  const color = LAYER_COLORS[(currentLayer - 1) % LAYER_COLORS.length];
  const isLast = currentLayer === totalLayers;

  // reset local selection when you move to a new layer
  useEffect(() => {
    segmentController.current?.abort();
    segmentController.current = null;
    segmentSeq.current = 0;

    setPoints([]);
    setMaskUrl(null);
    setMaskBlob(null);
    currentMaskUrlRef.current = null;

    setIsSegmenting(false);
    setSegError(null);
  }, [currentLayer]);

  // cleanup any in-progress request if user leaves the page
  useEffect(() => {
    return () => {
      segmentController.current?.abort();
      const url = currentMaskUrlRef.current;
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImageClick = async (e: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const xRel = (e.clientX - rect.left) / rect.width;
    const yRel = (e.clientY - rect.top) / rect.height;

    // clicked outside
    if (xRel < 0 || xRel > 1 || yRel < 0 || yRel > 1) return;

    // IMPORTANT: backend expects pixel coords in the ORIGINAL image space.
    // Use the session dimensions returned by /api/sessions.
    const clamp = (v: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v));
    const w = sessionWidth > 0 ? sessionWidth : img.naturalWidth;
    const h = sessionHeight > 0 ? sessionHeight : img.naturalHeight;
    const x = clamp(Math.round(xRel * (w - 1)), 0, w - 1);
    const y = clamp(Math.round(yRel * (h - 1)), 0, h - 1);

    const nextPoints = [...points, { x, y, xPct: xRel, yPct: yRel }];
    setPoints(nextPoints);

    // cancel any previous request (click spam)
    segmentController.current?.abort();
    const controller = new AbortController();
    segmentController.current = controller;
    const seq = ++segmentSeq.current;

    setIsSegmenting(true);
    setSegError(null);

    try {
      const blob = await segmentMask(sessionId, nextPoints, controller.signal);
      if (seq !== segmentSeq.current) return; // stale response

      const url = URL.createObjectURL(blob);

      // revoke only the previous in-progress mask url for this same layer
      if (maskUrl) {
        URL.revokeObjectURL(maskUrl);
        if (currentMaskUrlRef.current === maskUrl)
          currentMaskUrlRef.current = null;
      }

      setMaskUrl(url);
      setMaskBlob(blob);
      currentMaskUrlRef.current = url;
    } catch (err: any) {
      // ignore abort errors
      if (err?.name === "AbortError") return;
      setSegError(err?.message ?? "Segmentation failed");
    } finally {
      if (seq === segmentSeq.current) setIsSegmenting(false);
    }
  };

  const handleClear = () => {
    // clears the current layer
    segmentController.current?.abort();
    segmentSeq.current++;

    setIsSegmenting(false);
    setSegError(null);
    setPoints([]);

    if (maskUrl) {
      try {
        URL.revokeObjectURL(maskUrl);
      } catch (_) {}
    }
    setMaskUrl(null);
    setMaskBlob(null);
    currentMaskUrlRef.current = null;
  };

  const handleNext = () => {
    if (!maskUrl || !maskBlob) return;
    onNext({ maskUrl, maskBlob, points, color });
    currentMaskUrlRef.current = null;
  };

  const canAdvance = !!maskUrl && !!maskBlob && !isSegmenting;

  return (
    <>
      <h1 className="page-subtitle">
        <Paintbrush2 size={26} className="subtitle-icon" strokeWidth={2} />
        Layer Selection
      </h1>

      <div className="nav-row">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={16} strokeWidth={2.5} /> Back
        </button>
        <span className="nav-filename" title={imageFile?.name}>
          {imageFile?.name}
        </span>
        <div style={{ width: 88 }} />
      </div>

      <ProgressDots total={totalLayers} current={currentLayer} />

      <div className="layer-card">
        <div className="layer-card-title">
          Selecting{" "}
          <span className="layer-badge" style={{ background: color.stroke }}>
            Layer {currentLayer}
          </span>{" "}
          of {totalLayers}
        </div>

        <div className="canvas-wrap" onClick={handleImageClick}>
          <img ref={imgRef} src={imageUrl} alt="Source" draggable={false} />

          <div className="overlay-stack" aria-hidden="true">
            {completedLayers.map((l, i) => (
              <div
                key={i}
                className="mask-overlay"
                style={{
                  background: l.color.fill,
                  WebkitMaskImage: `url(${l.maskUrl})`,
                  maskImage: `url(${l.maskUrl})`,
                }}
              />
            ))}
            {maskUrl && (
              <div
                className="mask-overlay"
                style={{
                  background: color.fill,
                  WebkitMaskImage: `url(${maskUrl})`,
                  maskImage: `url(${maskUrl})`,
                }}
              />
            )}
          </div>

          <div className="points-stack" aria-hidden="true">
            {points.map((p, idx) => (
              <div
                key={idx}
                className="point-marker"
                style={{ left: `${p.xPct * 100}%`, top: `${p.yPct * 100}%` }}
              />
            ))}
          </div>

          {isSegmenting && (
            <div className="segmenting-pill" aria-live="polite">
              Segmenting…
            </div>
          )}
        </div>

        <div className="points-meta">
          <p className="draw-hint">
            <Paintbrush2 size={13} className="hint-icon" />
            Click <strong>multiple points</strong> to guide this layer (each
            click is a selection and updates the mask)
          </p>
          <div className="points-right">
            <div className="points-count" aria-live="polite">
              {points.length} point{points.length === 1 ? "" : "s"}
            </div>
            <button
              className="clear-points-btn"
              onClick={handleClear}
              disabled={points.length === 0 && !maskUrl && !isSegmenting}
              title="Clear points for this layer"
            >
              Clear
            </button>
          </div>
        </div>

        {segError && <div className="seg-error">{segError}</div>}

        {completedLayers.length > 0 && (
          <div className="legend">
            {completedLayers.map((l, i) => (
              <div key={i} className="legend-item">
                <div
                  className="legend-dot"
                  style={{ background: l.color.stroke }}
                />
                Layer {i + 1}
                <Check size={11} strokeWidth={3} className="legend-check" />
              </div>
            ))}
            <div
              className="legend-item legend-item-active"
              style={{ borderColor: color.stroke }}
            >
              <div
                className="legend-dot"
                style={{ background: color.stroke }}
              />
              Layer {currentLayer}
              <Paintbrush2 size={11} strokeWidth={2.5} />
            </div>
          </div>
        )}
      </div>

      <div className="next-row">
        <button
          className="next-btn"
          onClick={handleNext}
          disabled={!canAdvance}
        >
          {isLast ? (
            <>
              <CheckCircle2 size={16} strokeWidth={2.5} /> Submit Layers
            </>
          ) : (
            <>
              Next Layer <ChevronRight size={16} strokeWidth={2.5} />
            </>
          )}
        </button>
      </div>
    </>
  );
}

// output screen — lists generated layer masks for download
interface OutputScreenProps {
  imageFile: File | null;
  sessionId: string | null;
  totalLayers: number;
  completedLayers: CompletedLayer[];
  onBack: () => void;
  exportMode: ExportMode;
  mode: Mode;
  aiZip: Blob | null;
}

function OutputScreen({
  imageFile,
  sessionId,
  totalLayers,
  completedLayers,
  onBack,
  exportMode,
  mode,
  aiZip,
}: OutputScreenProps) {
  // strip extension so files are named e.g. "my-photo_Layer1.png"
  const baseName = imageFile
    ? imageFile.name.replace(/\.[^/.]+$/, "")
    : "output";

  const safeBase = baseName.replace(/\s+/g, "_");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const zipName = `TunnelBook_${safeBase}_${totalLayers}layers_${stamp}.zip`;
  const aiZipName = `TunnelBook_${safeBase}_${totalLayers}layers_${stamp}_ai.zip`;

  const filenames = Array.from(
    { length: totalLayers },
    (_, i) => `${baseName}_Layer${i + 1}.png`,
  );

  const [isZipping, setIsZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  const [isExportingAi, setIsExportingAi] = useState(false);
  const [aiExportError, setAiExportError] = useState<string | null>(null);

  const handleDownloadAi = async () => {
    if (!sessionId) return;
    setAiExportError(null);
    setIsExportingAi(true);

    try {
      const maskBlobs = completedLayers.map((l) => l.maskBlob);
      const zipBlob = await exportAiLayers(
        sessionId,
        maskBlobs,
        72,
        exportMode,
      );
      downloadBlob(aiZipName, zipBlob);
    } catch (err: any) {
      setAiExportError(err?.message ?? "AI export failed");
    } finally {
      setIsExportingAi(false);
    }
  };

  const downloadBlob = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    setZipError(null);
    setIsZipping(true);

    try {
      const zip = new JSZip();
      const missing: number[] = [];

      for (let i = 0; i < filenames.length; i++) {
        const name = filenames[i];
        const maskBlob = completedLayers[i]?.maskBlob;
        if (!maskBlob) {
          missing.push(i + 1);
          continue;
        }
        zip.file(name, maskBlob);
      }

      if (missing.length > 0) {
        zip.file(
          "README_missing_layers.txt",
          `Missing layer masks: ${missing.join(", ")}
`,
        );
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipName, zipBlob);
    } catch (err: any) {
      setZipError(err?.message ?? "Failed to create zip");
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <>
      <h1 className="page-subtitle">
        <CheckCircle2 size={26} className="subtitle-icon" strokeWidth={2} />
        Your Layers Are Ready!
      </h1>

      <div className="nav-row">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={16} strokeWidth={2.5} /> Back
        </button>
        <div className="nav-center">
          <div className="nav-filename-full">{imageFile?.name}</div>
          <div className="complete-badge">
            <CheckCircle2 size={12} strokeWidth={2.5} />
            All {totalLayers} layers complete
          </div>
        </div>
        <div style={{ width: 88 }} />
      </div>

      <div className="output-card">
        {filenames.map((name, i) => (
          <div key={i} className="output-row">
            <div className="output-row-left">
              <div
                className="output-dot"
                style={{
                  background: completedLayers[i]?.color.stroke ?? "#999",
                }}
              />
              <div className="output-names">
                <span className="output-filename">{name}</span>
                <span className="output-layer-tag">Layer {i + 1}</span>
              </div>
            </div>
            <button
              className="download-btn"
              onClick={async () => {
                const maskBlob = completedLayers[i]?.maskBlob;
                if (!maskBlob) return;
                downloadBlob(name, maskBlob);
              }}
              title={`Download ${name}`}
            >
              <Download size={18} strokeWidth={2} />
              Download
            </button>
          </div>
        ))}
      </div>

      <button
        className="download-all-btn"
        onClick={handleDownloadAll}
        disabled={isZipping}
      >
        <DownloadCloud size={18} strokeWidth={2.5} />
        {isZipping ? "Preparing Zip…" : "Download All Layers (.zip)"}
      </button>

      {mode === "automatic" && aiZip ? (
        <button
          className="download-all-btn"
          onClick={() => downloadBlob(aiZipName, aiZip)}
          style={{
            marginTop: 10,
            background: "linear-gradient(135deg, #dc2626, #991b1b)",
          }}
        >
          <DownloadCloud size={18} strokeWidth={2.5} />
          Download as .ai (Adobe Illustrator)
        </button>
      ) : null}

      {mode === "manual" && sessionId ? (
        <button
          className="download-all-btn"
          onClick={handleDownloadAi}
          disabled={isExportingAi || !sessionId}
          style={{
            marginTop: 10,
            background: "linear-gradient(135deg, #dc2626, #991b1b)",
          }}
        >
          <DownloadCloud size={18} strokeWidth={2.5} />
          {isExportingAi
            ? "Vectorising…"
            : "Download as .ai (Adobe Illustrator)"}
        </button>
      ) : null}

      {aiExportError && (
        <div className="seg-error" style={{ marginTop: 10 }}>
          {aiExportError}
        </div>
      )}

      {zipError && (
        <div className="seg-error" style={{ marginTop: 10 }}>
          {zipError}
        </div>
      )}
    </>
  );
}

// root app — screen routing and shared state

type Screen = "home" | "layers" | "output";

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [totalLayers, setTotalLayers] = useState<number>(0);
  const [currentLayer, setCurrentLayer] = useState<number>(1);
  const [completedLayers, setCompletedLayers] = useState<CompletedLayer[]>([]);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [exportMode, setExportMode] = useState<ExportMode>("outline");
  const [mode, setMode] = useState<Mode>("manual");

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionWidth, setSessionWidth] = useState<number>(0);
  const [sessionHeight, setSessionHeight] = useState<number>(0);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [aiZip, setAiZip] = useState<Blob | null>(null);

  const resetAndCleanup = async () => {
    completedLayers.forEach((l) => {
      try {
        URL.revokeObjectURL(l.maskUrl);
      } catch (_) {}
    });

    if (sessionId) await deleteSession(sessionId);

    setSessionId(null);
    setSessionWidth(0);
    setSessionHeight(0);
    setCompletedLayers([]);
    setCurrentLayer(1);
    setTotalLayers(0);
    setBackendError(null);
  };

  const handleGo = async (
    file: File,
    url: string,
    count: number,
    selectedMode: Mode,
  ) => {
    setMode(selectedMode);
    setBackendError(null);
    setIsStarting(true);

    try {
      if (selectedMode === "automatic") {
        const { sessionId, width, height } = await createAutomaticSession(file);
        setSessionId(sessionId);
        setSessionWidth(width);
        setSessionHeight(height);
        setImageFile(file);
        setImageUrl(url);
        setTotalLayers(count);
        const pngZip = await automaticLayers(sessionId, count, 72, exportMode);
        const aiZipBlob = await automaticAiLayers(sessionId);
        setAiZip(aiZipBlob);
        // Load PNGs from zip
        const zip = await JSZip.loadAsync(pngZip);
        const layers: CompletedLayer[] = [];
        for (let i = 0; i < count; i++) {
          const fileName = `layer_${i + 1}.png`;
          const zipFile = zip.file(fileName);
          if (zipFile) {
            const blob = await zipFile.async("blob");
            layers.push({
              maskUrl: URL.createObjectURL(blob),
              maskBlob: blob,
              points: [],
              color: LAYER_COLORS[i % LAYER_COLORS.length],
            });
          }
        }
        setCompletedLayers(layers);
        console.log(count);
        console.log(layers);
        setScreen("output");
      } else {
        const { sessionId, width, height } = await createSession(file);
        setImageFile(file);
        setImageUrl(url);
        setTotalLayers(count);
        setCurrentLayer(1);
        setCompletedLayers([]);
        setSessionId(sessionId);
        setSessionWidth(width);
        setSessionHeight(height);
        setScreen("layers");
      }
    } catch (err: any) {
      setBackendError(err?.message ?? "Failed to start session");
    } finally {
      setIsStarting(false);
    }
  };

  // layer progression: stores each completed layer and advances to the next, or to output.
  const handleNext = (layer: CompletedLayer) => {
    const newCompleted = [...completedLayers, layer];
    setCompletedLayers(newCompleted);
    if (currentLayer >= totalLayers) setScreen("output");
    else setCurrentLayer((prev) => prev + 1);
  };

  const handleBackToHome = () => {
    setScreen("home");
    resetAndCleanup();
  };

  return (
    <div className="app-wrap">
      <Bubbles />

      <button
        className="help-btn"
        onClick={() => setShowHelp(true)}
        title="How it works"
      >
        ?
      </button>

      {screen === "home" && (
        <HomeScreen
          onGo={handleGo}
          isStarting={isStarting}
          error={backendError}
          exportMode={exportMode}
          onExportModeChange={setExportMode}
          mode={mode}
          onModeChange={setMode}
        />
      )}

      {screen === "layers" && imageUrl && sessionId && (
        <LayerSelectionScreen
          imageFile={imageFile}
          imageUrl={imageUrl}
          sessionId={sessionId}
          sessionWidth={sessionWidth}
          sessionHeight={sessionHeight}
          totalLayers={totalLayers}
          currentLayer={currentLayer}
          completedLayers={completedLayers}
          onNext={handleNext}
          onBack={handleBackToHome}
        />
      )}

      {screen === "output" && (
        <OutputScreen
          imageFile={imageFile}
          sessionId={sessionId}
          totalLayers={totalLayers}
          completedLayers={completedLayers}
          onBack={handleBackToHome}
          exportMode={exportMode}
          mode={mode}
          aiZip={aiZip}
        />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default App;
