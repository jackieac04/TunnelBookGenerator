import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react'
import JSZip from 'jszip'
import './App.css'

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ''
const apiUrl = (path: string) => `${API_BASE}${path}`

type SegmentPoint = { x: number; y: number; xPct: number; yPct: number }
type ExportMode = 'outline' | 'engraving'

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
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  ImagePlus: ({ size = 38 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
      <line x1="16" y1="5" x2="22" y2="5" />
      <line x1="19" y1="2" x2="19" y2="8" />
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
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  DownloadCloud: ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
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
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  ArrowRight: ({ size = 15 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  RotateCcw: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-4.15" />
    </svg>
  ),
  RotateCw: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-.49-4.15" />
    </svg>
  ),
  Expand: ({ size = 11 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  ),
  Collapse: ({ size = 11 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="10" y1="14" x2="3" y2="21" />
      <line x1="21" y1="3" x2="14" y2="10" />
    </svg>
  ),
  Scissors: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  Eye: ({ size = 13 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  EyeOff: ({ size = 13 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
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
  Wand: ({ size = 13 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4V2" /><path d="M15 16v-2" />
      <path d="M8 9h2" /><path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" /><path d="M15 9h.01" />
      <path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" />
      <path d="M12.2 6.2 11 5" />
    </svg>
  ),
  DragHandle: ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
}

async function createSession(imageFile: File) {
  const fd = new FormData()
  fd.append('image', imageFile)
  const res = await fetch(apiUrl('/api/sessions'), { method: 'POST', body: fd })
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Failed to start session (${res.status})`)
  return res.json() as Promise<{ sessionId: string; width: number; height: number }>
}

async function segmentMask(sessionId: string, points: SegmentPoint[], signal?: AbortSignal) {
  const res = await fetch(apiUrl(`/api/sessions/${sessionId}/segment`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points: points.map(p => [p.x, p.y]) }),
    signal,
  })
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Segmentation failed (${res.status})`)
  return res.blob()
}

async function deleteSession(sessionId: string) {
  await fetch(apiUrl(`/api/sessions/${sessionId}`), { method: 'DELETE' }).catch(() => { })
}

async function exportAiLayers(sessionId: string, maskBlobs: Blob[], dpi = 72, mode: ExportMode = 'outline') {
  const toBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  const masks_b64 = await Promise.all(maskBlobs.map(toBase64))
  const res = await fetch(apiUrl(`/api/sessions/${sessionId}/export-ai`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ masks_b64, dpi, mode }),
  })
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `AI export failed (${res.status})`)
  return res.blob()
}

async function exportAiLayersPerMode(
  sessionId: string,
  layers: Array<{ maskBlob: Blob; mode: ExportMode; index: number }>,
  dpi = 72
): Promise<Blob> {
  const toBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })

  const zip = new JSZip()

  for (const layer of layers) {
    const b64 = await toBase64(layer.maskBlob)
    const res = await fetch(apiUrl(`/api/sessions/${sessionId}/export-ai`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masks_b64: [b64], dpi, mode: layer.mode }),
    })
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `AI export failed for layer ${layer.index + 1}`)
    const zipBlob = await res.blob()
    const innerZip = await JSZip.loadAsync(zipBlob)
    for (const [filename, file] of Object.entries(innerZip.files)) {
      if (!file.dir) {
        const content = await file.async('blob')
        const newName = filename.replace(/layer_1\.ai/, `layer_${String(layer.index + 1).padStart(2, '0')}_${layer.mode}.ai`)
          .replace(/all_layers_layout\.ai/, `layer_${String(layer.index + 1).padStart(2, '0')}_${layer.mode}_layout.ai`)
        zip.file(newName, content)
      }
    }
  }

  return zip.generateAsync({ type: 'blob' })
}

interface LayerColor { fill: string; stroke: string; solid: string }
interface CompletedLayer { maskUrl: string; maskBlob: Blob; points: SegmentPoint[]; color: LayerColor; mode: ExportMode }

const LAYER_COLORS: LayerColor[] = [
  { fill: 'rgba(239,68,68,0.55)', stroke: '#ef4444', solid: '#ef4444' },
  { fill: 'rgba(59,130,246,0.55)', stroke: '#3b82f6', solid: '#3b82f6' },
  { fill: 'rgba(34,197,94,0.55)', stroke: '#22c55e', solid: '#22c55e' },
  { fill: 'rgba(251,146,60,0.55)', stroke: '#f97316', solid: '#f97316' },
  { fill: 'rgba(168,85,247,0.55)', stroke: '#a855f7', solid: '#a855f7' },
  { fill: 'rgba(236,72,153,0.55)', stroke: '#ec4899', solid: '#ec4899' },
  { fill: 'rgba(20,184,166,0.55)', stroke: '#14b8a6', solid: '#14b8a6' },
  { fill: 'rgba(234,179,8,0.55)', stroke: '#eab308', solid: '#eab308' },
  { fill: 'rgba(99,102,241,0.55)', stroke: '#6366f1', solid: '#6366f1' },
  { fill: 'rgba(14,165,233,0.55)', stroke: '#0ea5e9', solid: '#0ea5e9' },
]

function Stars() {
  return (
    <div className="stars" aria-hidden="true">
      {[...Array(20)].map((_, i) => <div key={i} className={`star star-${i + 1}`} />)}
    </div>
  )
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          x
        </button>
        <div className="modal-title"><I.Sparkles /> How It Works</div>
        <div className="modal-step">
          <div className="modal-step-label"><I.Upload /> step 1 — Upload</div>
          <p>Drop or click to upload a photo. Enter how many layers (1–10) and press <strong>run()</strong>.</p>
        </div>
        <hr className="modal-divider" />
        <div className="modal-step">
          <div className="modal-step-label"><I.Brush /> step 2 — Select Layers</div>
          <p>Click points on the image to guide each layer. Each click refines the AI mask. On the <strong>last layer</strong>, use <strong>Select Remaining</strong> to auto-fill everything not yet selected.</p>
        </div>
        <hr className="modal-divider" />
        <div className="modal-step">
          <div className="modal-step-label"><I.BookOpen /> step 3 — Visualize</div>
          <p>The book preview shows layers as solid colours. Toggle visibility with the eye icon, click any layer row to expand its settings (outline vs engrave).</p>
        </div>
        <hr className="modal-divider" />
        <div className="modal-step">
          <div className="modal-step-label"><I.Download /> step 4 — Export</div>
          <p><strong>Download All</strong> exports a <code>.zip</code>. <strong>Export .ai</strong> gives Adobe Illustrator files per layer.</p>
        </div>
      </div>
    </div>
  )
}


type Screen = 'home' | 'layers' | 'output'

function Sidebar({ screen, totalLayers, currentLayer, completedCount, onGoHome }: {
  screen: Screen; totalLayers: number; currentLayer: number; completedCount: number; onGoHome: () => void
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <I.SquareStack />
        <span>tunnel<span className="sidebar-logo-accent">book</span></span>
      </div>
      <nav className="sidebar-nav">
        <div
          className={`sidebar-tab ${screen === 'home' ? 'sidebar-tab--active' : 'sidebar-tab--idle'}`}
          onClick={onGoHome} role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onGoHome()}
        >
          <I.Home />
          <span className="sidebar-tab-label">upload</span>
          {screen !== 'home' && <div className="sidebar-tab-dot" style={{ background: '#6366f1' }} />}
        </div>

        {totalLayers > 0 && Array.from({ length: totalLayers }, (_, i) => {
          const n = i + 1, isDone = i < completedCount
          const isActive = screen === 'layers' && currentLayer === n
          const c = LAYER_COLORS[i % LAYER_COLORS.length]
          return (
            <div key={i}
              className={`sidebar-tab ${isActive ? 'sidebar-tab--active' : ''} ${isDone ? 'sidebar-tab--done' : ''} ${!isDone && !isActive ? 'sidebar-tab--pending' : ''}`}
              style={isActive ? { borderLeftColor: c.stroke } : {}}
            >
              <div className="sidebar-tab-dot" style={{ background: (isDone || isActive) ? c.solid : 'rgba(200,170,255,0.18)' }} />
              <span className="sidebar-tab-label">layer_{n.toString().padStart(2, '0')}</span>
              {isDone && <span className="sidebar-tab-check"><I.Check /></span>}
              {isActive && <div className="sidebar-tab-pulse" />}
            </div>
          )
        })}

        {screen === 'output' && (
          <div className="sidebar-tab sidebar-tab--active sidebar-tab--output">
            <I.CheckCircle size={13} />
            <span className="sidebar-tab-label">output</span>
          </div>
        )}
      </nav>
      <div className="sidebar-footer">
        <span className="sidebar-status">
          {totalLayers > 0 ? <>{completedCount}<span className="sidebar-status-sep">/</span>{totalLayers} done</> : 'ready'}
        </span>
      </div>
    </aside>
  )
}


function BookVisualizer({ completedLayers, totalLayers, layerModes, onLayerModeChange, inProgressMask, onDockedChange, onDragStart, locked }: {
  completedLayers: CompletedLayer[]; totalLayers: number
  layerModes: ExportMode[]; onLayerModeChange: (i: number, m: ExportMode) => void
  inProgressMask: { maskUrl: string; color: LayerColor } | null
  onDockedChange: (docked: boolean) => void
  onDragStart: (startX: number, startY: number, panelX: number, panelY: number) => void
  locked?: boolean
}) {
  const [rotY, setRotY] = useState(30)
  const [rotX, setRotX] = useState(14)
  const [scale, setScale] = useState(1)
  const [minimized, setMinimized] = useState(false)
  const [docked, setDocked] = useState(true)
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null)
  const [visibleLayers, setVisibleLayers] = useState<Set<number>>(new Set())
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number; ry: number; rx: number } | null>(null)

  useEffect(() => {
    setVisibleLayers(prev => {
      const s = new Set(prev)
      completedLayers.forEach((_, i) => s.add(i))
      return s
    })
  }, [completedLayers.length])

  const toggleVis = (idx: number) =>
    setVisibleLayers(prev => { const s = new Set(prev); s.has(idx) ? s.delete(idx) : s.add(idx); return s })

  const handleMouseDown = (e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY, ry: rotY, rx: rotX }
    setIsDragging(true); e.preventDefault()
  }

  useEffect(() => {
    if (!isDragging) return
    const move = (e: MouseEvent) => {
      if (!dragStart.current) return
      setRotY(dragStart.current.ry + (e.clientX - dragStart.current.x) * 0.55)
      setRotX(dragStart.current.rx - (e.clientY - dragStart.current.y) * 0.32)
    }
    const up = () => setIsDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [isDragging])

  // Callback ref: attaches wheel listener the instant the scene div is in the DOM
  const sceneRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setScale(s => Math.min(3, Math.max(0.3, s - e.deltaY * 0.001)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
      // store cleanup on the element itself so we can remove it if needed
      ; (el as any)._wheelCleanup = () => el.removeEventListener('wheel', onWheel)
  }, [])

  const hasContent = completedLayers.length > 0 || !!inProgressMask

  const panelRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={panelRef} className={`viz-panel ${docked ? 'viz-panel--docked' : ''} ${minimized ? 'viz-panel--minimized' : ''}`}>
      <div className="viz-header">
        {/* Drag handle — only active when floating */}
        {!docked && (
          <div
            className="viz-drag-handle"
            title="Drag to move"
            onMouseDown={e => {
              e.preventDefault()
              const panel = panelRef.current?.closest('.viz-float') as HTMLElement | null
              if (!panel) return
              const rect = panel.getBoundingClientRect()
              onDragStart(e.clientX, e.clientY, rect.left, rect.top)
            }}
          >
            <I.DragHandle />
          </div>
        )}
        <I.BookOpen />
        <span>book_preview</span>
        {locked && <span className="viz-locked-badge">locked</span>}
        <div className="viz-header-actions">
          <button className="viz-icon-btn" onClick={() => { setRotY(30); setRotX(14); setScale(1) }} title="Reset view"><I.RotateCcw /></button>
          <button className="viz-icon-btn" onClick={() => { const next = !docked; setDocked(next); onDockedChange(next); setMinimized(false) }} title={docked ? 'Float' : 'Expand to panel'}>
            {docked ? <I.Collapse /> : <I.Expand />}
          </button>
          {!docked && (
            <button className="viz-icon-btn" onClick={() => setMinimized(m => !m)} title={minimized ? 'Show' : 'Minimize'}>
              {minimized ? <I.ChevronUp /> : <I.ChevronDown />}
            </button>
          )}
        </div>
      </div>

      {!minimized && (
        <>
          {!hasContent ? (
            <div className="viz-empty">
              <I.Layers size={26} />
              <span>click points on<br />the image to preview</span>
            </div>
          ) : (
            <>
              <div ref={sceneRef} className="viz-scene" onMouseDown={handleMouseDown} style={{ cursor: isDragging ? 'grabbing' : 'grab' }}>
                <div className="viz-book" style={{ transform: `scale(${scale}) rotateX(${rotX}deg) rotateY(${rotY}deg)` }}>
                  {completedLayers.map((layer, i) => {
                    if (!visibleLayers.has(i)) return null
                    return (
                      <div key={i} className="viz-layer"
                        style={{
                          background: layer.color.solid,
                          WebkitMaskImage: `url(${layer.maskUrl})`,
                          maskImage: `url(${layer.maskUrl})`,
                          transform: `translateZ(${(completedLayers.length - i) * 20}px)`,
                          zIndex: completedLayers.length - i,
                        }}
                      />
                    )
                  })}
                  {inProgressMask && (
                    <div className="viz-layer viz-layer--inprogress"
                      style={{
                        background: inProgressMask.color.solid,
                        WebkitMaskImage: `url(${inProgressMask.maskUrl})`,
                        maskImage: `url(${inProgressMask.maskUrl})`,
                        transform: `translateZ(${(completedLayers.length + 1) * 20}px)`,
                        zIndex: completedLayers.length + 1,
                      }}
                    />
                  )}
                </div>
                <div className="viz-scene-hint">scroll to zoom · drag to rotate</div>
              </div>
              <div className="viz-rotate-row">
                <button className="viz-ctrl-btn" onClick={() => setRotY(r => r - 30)} title="Rotate left"><I.RotateCcw /></button>
                <div className="viz-zoom-controls">
                  <button className="viz-ctrl-btn" onClick={() => setScale(s => Math.max(0.3, s - 0.15))} title="Zoom out">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                  <span className="viz-ctrl-label">{Math.round(scale * 100)}%</span>
                  <button className="viz-ctrl-btn" onClick={() => setScale(s => Math.min(3, s + 0.15))} title="Zoom in">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                </div>
                <span className="viz-ctrl-label-layers">
                  {completedLayers.length}/{totalLayers}
                  {inProgressMask && <span className="viz-live-badge"> ● live</span>}
                </span>
                <button className="viz-ctrl-btn" onClick={() => setRotY(r => r + 30)} title="Rotate right"><I.RotateCw /></button>
              </div>
              <div className="viz-layer-list">
                {completedLayers.map((layer, i) => {
                  const isExpanded = expandedLayer === i
                  const isVisible = visibleLayers.has(i)
                  const mode = layerModes[i] ?? 'outline'
                  return (
                    <div key={i} className={`viz-layer-row ${isExpanded ? 'viz-layer-row--expanded' : ''}`}>
                      <div
                        className={`viz-layer-row-header ${locked ? 'viz-layer-row-header--locked' : ''}`}
                        onClick={() => !locked && setExpandedLayer(isExpanded ? null : i)}
                        role={locked ? undefined : 'button'}
                        title={locked ? 'Locked after export' : 'Click to configure export settings'}
                      >
                        <div className="viz-layer-swatch" style={{ background: layer.color.solid }} />
                        <span className="viz-layer-name">layer_{(i + 1).toString().padStart(2, '0')}</span>
                        <span className="viz-layer-mode-badge">{mode}</span>
                        <button className={`viz-eye-btn ${!isVisible ? 'viz-eye-btn--off' : ''}`}
                          onClick={e => { e.stopPropagation(); toggleVis(i) }}
                          title={isVisible ? 'Hide' : 'Show'}>
                          {isVisible ? <I.Eye /> : <I.EyeOff />}
                        </button>
                        {locked
                          ? <span className="viz-locked-icon" title="Settings locked after export">🔒</span>
                          : <span className="viz-expand-arrow">{isExpanded ? <I.ChevronUp /> : <I.ChevronDown />}</span>
                        }
                      </div>
                      {!locked && isExpanded && (
                        <div className="viz-layer-options">
                          <div className="viz-options-label">// export_mode</div>
                          <div className="viz-modes">
                            <button className={`viz-mode-btn ${mode === 'outline' ? 'viz-mode-btn--active' : ''}`}
                              onClick={() => onLayerModeChange(i, 'outline')}>
                              <I.Scissors /> outline
                            </button>
                            <button className={`viz-mode-btn ${mode === 'engraving' ? 'viz-mode-btn--active' : ''}`}
                              onClick={() => onLayerModeChange(i, 'engraving')}>
                              <I.Eye /> engrave
                            </button>
                          </div>
                          <div className="viz-mode-hint">
                            {mode === 'outline' ? '// red cut lines only' : '// red cuts + blue engraving'}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                {inProgressMask && (
                  <div className="viz-layer-row viz-layer-row--inprogress">
                    <div className="viz-layer-row-header" style={{ cursor: 'default' }}>
                      <div className="viz-layer-swatch viz-layer-swatch--pulse" style={{ background: inProgressMask.color.solid }} />
                      <span className="viz-layer-name">layer_{(completedLayers.length + 1).toString().padStart(2, '0')}</span>
                      <span className="viz-live-badge">● selecting…</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}


function HomeScreen({ onGo, isStarting, error, exportMode, onExportModeChange }: {
  onGo: (f: File, url: string, n: number) => void
  isStarting: boolean; error: string | null
  exportMode: ExportMode; onExportModeChange: (m: ExportMode) => void
}) {
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [layerCount, setLayerCount] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const parsed = parseInt(layerCount, 10)
  const canGo = !!imageUrl && parsed >= 1 && parsed <= 10 && !isStarting

  const applyFile = (f: File) => { setImageFile(f); setImageUrl(URL.createObjectURL(f)) }
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) applyFile(f) }
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false) }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && f.type.startsWith('image/')) applyFile(f)
  }

  return (
    <div className="home-screen">
      <div className="home-hero">
        <div className="home-tag">// AI-powered layer segmentation</div>
        <h1 className="home-title">
          Tunnel<span className="home-title-accent">Book</span>
          <span className="home-title-small"> Generator</span>
          <span className="home-title-cursor">_</span>
        </h1>
        <div className="home-steps">
          <span className="home-step"><I.Upload size={11} /> upload image</span>
          <span className="home-step-arrow">→</span>
          <span className="home-step"><I.Brush size={11} /> select layers</span>
          <span className="home-step-arrow">→</span>
          <span className="home-step"><I.BookOpen size={11} /> preview in 3d</span>
          <span className="home-step-arrow">→</span>
          <span className="home-step"><I.Download size={11} /> export cut files</span>
        </div>
      </div>

      <div
        className={`drop-zone ${isDragging ? 'drop-zone--dragging' : ''} ${imageUrl ? 'drop-zone--filled' : ''}`}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        onClick={() => !imageUrl && fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        {imageUrl ? (
          <div className="drop-zone-preview">
            <img src={imageUrl} alt="Uploaded" />
            <div className="drop-zone-overlay">
              <button className="drop-zone-change" onClick={e => { e.stopPropagation(); fileRef.current?.click() }}>
                <I.Upload /> change image
              </button>
            </div>
            <div className="drop-zone-filename">{imageFile?.name}</div>
          </div>
        ) : (
          <div className="drop-zone-empty">
            <div className="drop-zone-icon"><I.ImagePlus /></div>
            <div className="drop-zone-text">{isDragging ? 'drop it here!' : 'drag & drop or click to upload'}</div>
            <div className="drop-zone-sub">PNG · JPG · WEBP</div>
          </div>
        )}
      </div>

      <div className="config-row">
        <div className="config-group">
          <label className="config-label"><I.Layers /> layers</label>
          <div className="config-input-wrap">
            <input className="config-input" type="text" inputMode="numeric"
              placeholder="?" value={layerCount}
              onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ''); setLayerCount(!v || parseInt(v) <= 10 ? v : '10') }}
              maxLength={2} />
            <span className="config-max">/ 10</span>
          </div>
        </div>

        <div className="config-group">
          <label className="config-label"><I.Settings /> default mode</label>
          <div className="mode-toggle">
            <button className={`mode-toggle-btn ${exportMode === 'outline' ? 'mode-toggle-btn--active' : ''}`}
              onClick={() => onExportModeChange('outline')}>
              <I.Scissors /> outline
            </button>
            <button className={`mode-toggle-btn ${exportMode === 'engraving' ? 'mode-toggle-btn--active' : ''}`}
              onClick={() => onExportModeChange('engraving')}>
              <I.Eye /> engrave
            </button>
          </div>
        </div>

        <button className={`go-btn ${canGo ? 'go-btn--active' : 'go-btn--disabled'}`}
          onClick={() => { if (canGo && imageFile && imageUrl) onGo(imageFile, imageUrl, parsed) }}
          disabled={!canGo}>
          {isStarting ? <><span className="go-btn-spinner" /> loading…</> : <>run() <I.ArrowRight /></>}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-banner-tag">// error</span> {error}
          <div className="error-banner-sub">Ensure the Python server is running and Vite proxies <code>/api</code>.</div>
        </div>
      )}
    </div>
  )
}

// ─── Layer Selection Screen ───────────────────────────────────────────────────

function LayerSelectionScreen({
  imageFile, imageUrl, sessionId, sessionWidth, sessionHeight,
  totalLayers, currentLayer, completedLayers, exportMode, onNext, onBack, onMaskChange,
}: {
  imageFile: File | null; imageUrl: string; sessionId: string
  sessionWidth: number; sessionHeight: number; totalLayers: number
  currentLayer: number; completedLayers: CompletedLayer[]
  exportMode: ExportMode; onNext: (l: CompletedLayer) => void; onBack: () => void
  onMaskChange: (m: { maskUrl: string; color: LayerColor } | null) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const currentMaskUrlRef = useRef<string | null>(null)
  const segCtrl = useRef<AbortController | null>(null)
  const segSeq = useRef(0)

  const [points, setPoints] = useState<SegmentPoint[]>([])
  const [maskUrl, setMaskUrl] = useState<string | null>(null)
  const [maskBlob, setMaskBlob] = useState<Blob | null>(null)
  const [isSegmenting, setIsSegmenting] = useState(false)
  const [segError, setSegError] = useState<string | null>(null)
  const [isSelectingRemaining, setIsSelectingRemaining] = useState(false)
  const [imgExpanded, setImgExpanded] = useState(false)
  // Per-layer mode — defaults to the global default, can be overridden per layer
  const [layerMode, setLayerMode] = useState<ExportMode>(exportMode)

  const color = LAYER_COLORS[(currentLayer - 1) % LAYER_COLORS.length]
  const isLast = currentLayer === totalLayers

  // Notify parent so the book visualizer can preview this layer live
  useEffect(() => {
    onMaskChange(maskUrl ? { maskUrl, color } : null)
  }, [maskUrl, color.solid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shared: run segmentation for a given point list
  const runSegment = async (nextPts: SegmentPoint[]) => {
    segCtrl.current?.abort()
    if (nextPts.length === 0) {
      // Nothing to segment — clear mask
      if (maskUrl) { try { URL.revokeObjectURL(maskUrl) } catch (_) { } }
      setMaskUrl(null); setMaskBlob(null); currentMaskUrlRef.current = null
      setIsSegmenting(false); return
    }
    const ctrl = new AbortController(); segCtrl.current = ctrl
    const seq = ++segSeq.current
    setIsSegmenting(true); setSegError(null)
    try {
      const blob = await segmentMask(sessionId, nextPts, ctrl.signal)
      if (seq !== segSeq.current) return
      const url = URL.createObjectURL(blob)
      if (maskUrl) { URL.revokeObjectURL(maskUrl); if (currentMaskUrlRef.current === maskUrl) currentMaskUrlRef.current = null }
      setMaskUrl(url); setMaskBlob(blob); currentMaskUrlRef.current = url
    } catch (err: any) {
      if (err?.name !== 'AbortError') setSegError(err?.message ?? 'Segmentation failed')
    } finally {
      if (seq === segSeq.current) setIsSegmenting(false)
    }
  }

  useEffect(() => {
    segCtrl.current?.abort(); segCtrl.current = null; segSeq.current = 0
    setPoints([]); setMaskUrl(null); setMaskBlob(null)
    currentMaskUrlRef.current = null; setIsSegmenting(false); setSegError(null)
    setLayerMode(exportMode)
    onMaskChange(null)
  }, [currentLayer]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    segCtrl.current?.abort()
    const u = currentMaskUrlRef.current; if (u) try { URL.revokeObjectURL(u) } catch (_) { }
  }, [])

  const handleImageClick = async (e: React.MouseEvent) => {
    const img = imgRef.current; if (!img) return
    const rect = img.getBoundingClientRect()
    const xRel = (e.clientX - rect.left) / rect.width
    const yRel = (e.clientY - rect.top) / rect.height
    if (xRel < 0 || xRel > 1 || yRel < 0 || yRel > 1) return
    const w = sessionWidth || img.naturalWidth, h = sessionHeight || img.naturalHeight
    const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    const x = cl(Math.round(xRel * (w - 1)), 0, w - 1)
    const y = cl(Math.round(yRel * (h - 1)), 0, h - 1)
    const nextPts = [...points, { x, y, xPct: xRel, yPct: yRel }]
    setPoints(nextPts)
    await runSegment(nextPts)
  }

  const handleRemovePoint = async (e: React.MouseEvent, idx: number) => {
    e.stopPropagation() // don't add a new point at the same spot
    const nextPts = points.filter((_, i) => i !== idx)
    setPoints(nextPts)
    await runSegment(nextPts)
  }

  const handleClear = () => {
    segCtrl.current?.abort(); segSeq.current++
    setIsSegmenting(false); setSegError(null); setPoints([])
    if (maskUrl) try { URL.revokeObjectURL(maskUrl) } catch (_) { }
    setMaskUrl(null); setMaskBlob(null); currentMaskUrlRef.current = null
  }

  const handleSelectRemaining = useCallback(async () => {
    const w = sessionWidth, h = sessionHeight; if (!w || !h) return
    setIsSelectingRemaining(true); setSegError(null)
    try {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = 'rgba(255,255,255,1)'; ctx.fillRect(0, 0, w, h)
      if (completedLayers.length > 0) {
        ctx.globalCompositeOperation = 'destination-out'
        for (const layer of completedLayers) {
          await new Promise<void>(res => { const img = new Image(); img.onload = () => { ctx.drawImage(img, 0, 0, w, h); res() }; img.onerror = () => res(); img.src = layer.maskUrl })
        }
      }
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('fail')), 'image/png'))
      const url = URL.createObjectURL(blob)
      if (maskUrl) try { URL.revokeObjectURL(maskUrl) } catch (_) { }
      setMaskUrl(url); setMaskBlob(blob); currentMaskUrlRef.current = url; setPoints([])
    } catch (err: any) { setSegError(err?.message ?? 'Failed to select remaining') }
    finally { setIsSelectingRemaining(false) }
  }, [completedLayers, sessionWidth, sessionHeight, maskUrl])

  const canAdvance = !!maskUrl && !!maskBlob && !isSegmenting && !isSelectingRemaining

  return (
    <div className="layer-screen">
      <div className="layer-topbar">
        <button className="back-btn" onClick={onBack}><I.ChevronLeft /> back</button>
        <div className="layer-topbar-center">
          <span className="layer-filename">{imageFile?.name}</span>
          <div className="layer-badge" style={{ background: color.solid }}>layer_{currentLayer.toString().padStart(2, '0')}</div>
          <span className="layer-of">of {totalLayers}</span>
        </div>
        <div className="layer-progress-wrap">
          {Array.from({ length: totalLayers }, (_, i) => (
            <div key={i}
              className={`progress-pip ${i < currentLayer - 1 ? 'progress-pip--done' : i === currentLayer - 1 ? 'progress-pip--active' : 'progress-pip--pending'}`}
              style={i === currentLayer - 1 ? { background: color.solid } : {}} />
          ))}
        </div>
      </div>

      <div className={`canvas-card ${imgExpanded ? 'canvas-card--expanded' : ''}`}>
        <div className="canvas-tools">
          <span className="canvas-tools-hint"><I.Brush /> click anywhere on the image to place selection points</span>
          <button className="canvas-expand-btn" onClick={() => setImgExpanded(e => !e)}>
            {imgExpanded ? <><I.Collapse /> shrink</> : <><I.Expand /> expand</>}
          </button>
        </div>
        <div className="canvas-wrap" onClick={handleImageClick}>
          <img ref={imgRef} src={imageUrl} alt="Source" draggable={false} />
          <div className="overlay-stack" aria-hidden>
            {completedLayers.map((l, i) => (
              <div key={i} className="mask-overlay" style={{ background: l.color.fill, WebkitMaskImage: `url(${l.maskUrl})`, maskImage: `url(${l.maskUrl})` }} />
            ))}
            {maskUrl && <div className="mask-overlay" style={{ background: color.fill, WebkitMaskImage: `url(${maskUrl})`, maskImage: `url(${maskUrl})` }} />}
          </div>
          <div className="points-stack" aria-hidden="false">
            {points.map((p, idx) => (
              <div
                key={idx}
                className="point-marker"
                style={{ left: `${p.xPct * 100}%`, top: `${p.yPct * 100}%` }}
                onClick={e => handleRemovePoint(e, idx)}
                title="Click to remove this point"
              />
            ))}
          </div>
          {(isSegmenting || isSelectingRemaining) && (
            <div className="segmenting-pill">
              <span className="segmenting-dot" />
              {isSelectingRemaining ? 'computing remaining…' : 'segmenting…'}
            </div>
          )}
        </div>
      </div>

      <div className="layer-controls">
        <div className="layer-controls-left">
          <div className="points-pill">{points.length} pt{points.length === 1 ? '' : 's'}</div>
          <button className="ctrl-btn ctrl-btn--ghost" onClick={handleClear}
            disabled={points.length === 0 && !maskUrl && !isSegmenting}>clear</button>
          {isLast && (
            <button className="ctrl-btn ctrl-btn--wand" onClick={handleSelectRemaining}
              disabled={isSelectingRemaining || isSegmenting}
              title="Fill everything not yet selected">
              <I.Wand /> {completedLayers.length > 0 ? 'select remaining' : 'select all'}
            </button>
          )}
        </div>
        <div className="layer-controls-right">
          {segError && <span className="seg-error-inline">// {segError}</span>}

          {/* Per-layer mode picker */}
          <div className="layer-mode-picker">
            <span className="layer-mode-label">mode:</span>
            <button
              className={`layer-mode-btn ${layerMode === 'outline' ? 'layer-mode-btn--active' : ''}`}
              onClick={() => setLayerMode('outline')}
              title="Cut outline only (red)"
            ><I.Scissors size={11} /> outline</button>
            <button
              className={`layer-mode-btn ${layerMode === 'engraving' ? 'layer-mode-btn--active' : ''}`}
              onClick={() => setLayerMode('engraving')}
              title="Cut + engrave (red + blue)"
            ><I.Eye size={11} /> engrave</button>
          </div>

          {completedLayers.length > 0 && (
            <div className="completed-legend">
              {completedLayers.map((l, i) => (
                <div key={i} className="legend-chip" style={{ background: l.color.solid + '22', border: `1px solid ${l.color.solid}66` }}>
                  <div className="legend-chip-dot" style={{ background: l.color.solid }} />
                  <span>{i + 1}</span>
                  <I.Check />
                </div>
              ))}
              <div className="legend-chip legend-chip--active" style={{ border: `1.5px solid ${color.solid}` }}>
                <div className="legend-chip-dot" style={{ background: color.solid }} />
                <span>{currentLayer}</span>
                <I.Brush />
              </div>
            </div>
          )}
          <button className="next-btn"
            onClick={() => {
              if (maskUrl && maskBlob) {
                onNext({ maskUrl, maskBlob, points, color, mode: layerMode })
                currentMaskUrlRef.current = null
              }
            }}
            disabled={!canAdvance}>
            {isLast ? <><I.CheckCircle size={14} /> submit</> : <>next <I.ChevronRight /></>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Output Screen ────────────────────────────────────────────────────────────

function OutputScreen({ imageFile, imageUrl, sessionId, sessionWidth, sessionHeight, totalLayers, completedLayers, layerModes, onBack, exportMode }: {
  imageFile: File | null; imageUrl: string | null; sessionId: string | null
  sessionWidth: number; sessionHeight: number; totalLayers: number
  completedLayers: CompletedLayer[]; layerModes: ExportMode[]
  onBack: () => void; exportMode: ExportMode
}) {
  const baseName = imageFile ? imageFile.name.replace(/\.[^/.]+$/, '') : 'output'
  const safeBase = baseName.replace(/\s+/g, '_')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  const filenames = Array.from({ length: totalLayers }, (_, i) => `${baseName}_Layer${i + 1}.png`)
  const [isZipping, setIsZipping] = useState(false)
  const [zipError, setZipError] = useState<string | null>(null)
  const [isExportingAi, setIsExportingAi] = useState(false)
  const [aiExportError, setAiExportError] = useState<string | null>(null)

  const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src })
  const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('fail')), 'image/png'))

  const compose = async (maskBlob: Blob) => {
    if (!imageUrl) throw new Error('Missing image URL')
    const w = sessionWidth, h = sessionHeight; if (!w || !h) throw new Error('Missing dimensions')
    const base = await loadImg(imageUrl)
    const mu = URL.createObjectURL(maskBlob); const maskImg = await loadImg(mu).finally(() => URL.revokeObjectURL(mu))
    const cut = document.createElement('canvas'); cut.width = w; cut.height = h
    const cc = cut.getContext('2d')!; cc.drawImage(base, 0, 0, w, h)
    cc.globalCompositeOperation = 'destination-in'; cc.drawImage(maskImg, 0, 0, w, h)
    const out = document.createElement('canvas'); out.width = w; out.height = h
    const oc = out.getContext('2d')!; oc.fillStyle = '#fff'; oc.fillRect(0, 0, w, h); oc.drawImage(cut, 0, 0)
    return toBlob(out)
  }

  const dlBlob = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
  }

  const handleDownloadAll = async () => {
    setZipError(null); setIsZipping(true)
    try {
      const zip = new JSZip(), missing: number[] = []
      for (let i = 0; i < filenames.length; i++) {
        const mb = completedLayers[i]?.maskBlob; if (!mb) { missing.push(i + 1); continue }
        zip.file(filenames[i], await compose(mb))
      }
      if (missing.length) zip.file('README_missing.txt', `Missing layers: ${missing.join(', ')}\n`)
      dlBlob(`TunnelBook_${safeBase}_${totalLayers}layers_${stamp}.zip`, await zip.generateAsync({ type: 'blob' }))
    } catch (err: any) { setZipError(err?.message ?? 'Failed') }
    finally { setIsZipping(false) }
  }

  const handleDownloadAi = async () => {
    if (!sessionId) return; setAiExportError(null); setIsExportingAi(true)
    try {
      const layerData = completedLayers.map((l, i) => ({
        maskBlob: l.maskBlob,
        mode: layerModes[i] ?? l.mode ?? 'outline' as ExportMode,
        index: i,
      }))
      dlBlob(`TunnelBook_${safeBase}_ai_${stamp}.zip`,
        await exportAiLayersPerMode(sessionId, layerData, 72))
    } catch (err: any) { setAiExportError(err?.message ?? 'AI export failed') }
    finally { setIsExportingAi(false) }
  }

  return (
    <div className="output-screen">
      <div className="output-topbar">
        <button className="back-btn" onClick={onBack}><I.ChevronLeft /> back</button>
        <div className="output-title"><I.CheckCircle /> <span>all_layers_complete</span></div>
        <div className="output-badge">{totalLayers} layers</div>
      </div>
      <div className="output-card">
        <div className="output-card-header">// {imageFile?.name}</div>
        {filenames.map((name, i) => (
          <div key={i} className="output-row">
            <div className="output-row-left">
              <div className="output-dot" style={{ background: completedLayers[i]?.color.stroke ?? '#aaa' }} />
              <div className="output-info">
                <span className="output-filename">{name}</span>
                <div className="output-meta">
                  <span className="output-layer-tag">layer_{(i + 1).toString().padStart(2, '0')}</span>
                  <span className="output-mode-tag">{(layerModes[i] ?? 'outline') === 'outline' ? <><I.Scissors /> outline</> : <><I.Eye /> engrave</>}</span>
                </div>
              </div>
            </div>
            <button className="download-btn" onClick={async () => { const mb = completedLayers[i]?.maskBlob; if (mb) dlBlob(name, await compose(mb)) }}>
              <I.Download /> .png
            </button>
          </div>
        ))}
      </div>
      <div className="output-actions">
        <button className="action-btn action-btn--zip" onClick={handleDownloadAll} disabled={isZipping}>
          <I.DownloadCloud /> {isZipping ? 'zipping…' : 'download_all.zip'}
        </button>
        <button className="action-btn action-btn--ai" onClick={handleDownloadAi} disabled={isExportingAi || !sessionId}>
          <I.DownloadCloud /> {isExportingAi ? 'vectorising…' : 'export_as.ai'}
        </button>
      </div>
      {(zipError || aiExportError) && (
        <div className="error-banner"><span className="error-banner-tag">// error</span> {zipError || aiExportError}</div>
      )}
    </div>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [totalLayers, setTotalLayers] = useState(0)
  const [currentLayer, setCurrentLayer] = useState(1)
  const [completedLayers, setCompletedLayers] = useState<CompletedLayer[]>([])
  const [layerModes, setLayerModes] = useState<ExportMode[]>([])
  const [showHelp, setShowHelp] = useState(false)
  const [exportMode, setExportMode] = useState<ExportMode>('outline')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionWidth, setSessionWidth] = useState(0)
  const [sessionHeight, setSessionHeight] = useState(0)
  const [isStarting, setIsStarting] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)
  // live in-progress mask from LayerSelectionScreen — shown in visualizer as a preview layer
  const [inProgressMask, setInProgressMask] = useState<{ maskUrl: string; color: LayerColor } | null>(null)

  // Track docked state at App level so we can style the float wrapper
  const [vizDocked, setVizDocked] = useState(true)
  // Draggable position for the floating panel (null = default bottom-right anchor)
  const [vizPos, setVizPos] = useState<{ x: number; y: number } | null>(null)

  const reset = async () => {
    completedLayers.forEach(l => { try { URL.revokeObjectURL(l.maskUrl) } catch (_) { } })
    if (sessionId) await deleteSession(sessionId)
    setSessionId(null); setSessionWidth(0); setSessionHeight(0)
    setCompletedLayers([]); setLayerModes([]); setCurrentLayer(1); setTotalLayers(0); setBackendError(null)
    setInProgressMask(null)
  }

  const handleGo = async (file: File, url: string, count: number) => {
    setBackendError(null); setIsStarting(true)
    try {
      const { sessionId: sid, width, height } = await createSession(file)
      setImageFile(file); setImageUrl(url); setTotalLayers(count)
      setCurrentLayer(1); setCompletedLayers([]); setLayerModes([])
      setSessionId(sid); setSessionWidth(width); setSessionHeight(height); setScreen('layers')
    } catch (err: any) { setBackendError(err?.message ?? 'Failed to start backend') }
    finally { setIsStarting(false) }
  }

  const handleNext = (layer: CompletedLayer) => {
    const newCompleted = [...completedLayers, layer]
    setCompletedLayers(newCompleted); setLayerModes(prev => [...prev, layer.mode])
    setInProgressMask(null)
    if (currentLayer >= totalLayers) setScreen('output')
    else setCurrentLayer(p => p + 1)
  }

  const handleBack = () => { setScreen('home'); reset() }

  const showViz = screen === 'layers' || completedLayers.length > 0

  return (
    <div className="app-root">
      <Stars />
      <Sidebar screen={screen} totalLayers={totalLayers} currentLayer={currentLayer} completedCount={completedLayers.length} onGoHome={handleBack} />
      <main className={`app-main ${vizDocked && showViz ? 'app-main--docked' : ''}`}>
        <div className="main-inner">
          {screen === 'home' && <HomeScreen onGo={handleGo} isStarting={isStarting} error={backendError} exportMode={exportMode} onExportModeChange={setExportMode} />}
          {screen === 'layers' && imageUrl && sessionId && (
            <LayerSelectionScreen imageFile={imageFile} imageUrl={imageUrl} sessionId={sessionId}
              sessionWidth={sessionWidth} sessionHeight={sessionHeight} totalLayers={totalLayers}
              currentLayer={currentLayer} completedLayers={completedLayers} exportMode={exportMode}
              onNext={handleNext} onBack={handleBack}
              onMaskChange={setInProgressMask} />
          )}
          {screen === 'output' && (
            <OutputScreen imageFile={imageFile} imageUrl={imageUrl} sessionId={sessionId}
              sessionWidth={sessionWidth} sessionHeight={sessionHeight} totalLayers={totalLayers}
              completedLayers={completedLayers} layerModes={layerModes} onBack={handleBack} exportMode={exportMode} />
          )}
        </div>

        {showViz && (
          <div
            className={`viz-float ${vizDocked ? 'viz-float--docked' : ''}`}
            style={!vizDocked && vizPos ? { bottom: 'auto', right: 'auto', top: vizPos.y, left: vizPos.x } : undefined}
          >
            <BookVisualizer completedLayers={completedLayers} totalLayers={totalLayers}
              layerModes={layerModes}
              inProgressMask={inProgressMask}
              locked={screen === 'output'}
              onLayerModeChange={(i, m) => setLayerModes(prev => prev.map((x, j) => j === i ? m : x))}
              onDockedChange={(d) => { setVizDocked(d); if (d) setVizPos(null) }}
              onDragStart={(startX, startY, panelX, panelY) => {
                const onMove = (e: MouseEvent) => {
                  setVizPos({ x: panelX + (e.clientX - startX), y: panelY + (e.clientY - startY) })
                }
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
          </div>
        )}

        <button className="help-btn" onClick={() => setShowHelp(true)} title="How it works">?</button>
      </main>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

export default App