from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from PIL import Image
import io
import uuid
import numpy as np
import zipfile
import re
import cv2
from skimage.segmentation import felzenszwalb, slic

app = FastAPI()

_sessions: dict[str, dict] = {}


def _chaikin(pts: list[list[int]], iters: int = 3) -> list[list[float]]:
    """Chaikin corner-cutting: smooth an open polyline by cutting corners."""
    p = [[float(x), float(y)] for x, y in pts]
    for _ in range(iters):
        if len(p) < 2:
            break
        out = [p[0]]
        for i in range(len(p) - 1):
            p0, p1 = p[i], p[i + 1]
            out.append([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]])
            out.append([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]])
        out.append(p[-1])
        p = out
    return p


class EdgeSelectionRequest(BaseModel):
    selected_indices: list[int]


class StandRequest(BaseModel):
    n_layers: int
    spoke_h_in: float = 1.4
    base_h_in: float = 0.65


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/sessions")
async def create_session(image: UploadFile = File(...)):
    img_bytes = await image.read()
    try:
        pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image")

    img_rgb = np.array(pil)
    img_h, img_w = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # ── Dense edges (hyper-sensitive, backend only) ───────────────────────────
    # Low thresholds + tight blur → captures every candidate boundary.
    # Used downstream for connector routing and topology solving.
    blurred_dense = cv2.GaussianBlur(gray, (3, 3), 0.5)
    edges_dense_map = cv2.Canny(blurred_dense, 10, 30)

    contours_dense, _ = cv2.findContours(
        edges_dense_map, cv2.RETR_LIST, cv2.CHAIN_APPROX_TC89_KCOS)
    edge_contours_dense: list[np.ndarray] = [
        c for c in contours_dense
        if len(c) >= 2 and cv2.arcLength(c, False) >= 8
    ]

    # ── Display edges (moderate sensitivity, shown to user) ───────────────────
    # Wider blur + higher thresholds → only meaningful object boundaries survive.
    # Minimum arc-length filter removes noise fragments before simplification.
    blurred_display = cv2.GaussianBlur(gray, (5, 5), 1.0)
    edges_display_map = cv2.Canny(blurred_display, 50, 150)

    contours_display, _ = cv2.findContours(
        edges_display_map, cv2.RETR_LIST, cv2.CHAIN_APPROX_TC89_KCOS)

    edge_polylines: list[list[list[int]]] = []
    for c in contours_display:
        peri = cv2.arcLength(c, False)
        if peri < 25:           # aggressive length filter for display
            continue
        eps = max(1.0, 0.01 * peri)
        approx = cv2.approxPolyDP(c, eps, False)
        pts = approx.squeeze()
        if pts.ndim == 1:
            pts = pts[np.newaxis, :]
        if len(pts) < 2:
            continue
        edge_polylines.append(_chaikin(pts.tolist()))

    # ── Joint segmentation: edge-aware superpixels ────────────────────────────
    # Felzenszwalb graph-based segmentation produces regions whose boundaries
    # naturally align with detected object edges — better than spatial SLIC for
    # downstream depth binning and connector routing.
    try:
        superpixels = felzenszwalb(img_rgb, scale=150, sigma=0.8, min_size=100)
    except Exception as e:
        print(f"[create_session] felzenszwalb failed ({e}), falling back to SLIC")
        n_segs = max(200, min(2000, (img_h * img_w) // 1500))
        superpixels = slic(img_rgb, n_segments=n_segs, compactness=10, sigma=1, start_label=0)

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "image_rgb": img_rgb,
        "width": img_w,
        "height": img_h,
        "filename": image.filename or "image",
        # Two edge resolutions stored separately
        "edges_dense_map": edges_dense_map,          # uint8 binary — connector routing
        "edge_contours_dense": edge_contours_dense,  # list[np.ndarray] — export / topology
        # Edge-aware superpixels for joint segmentation (Step 2)
        "superpixels": superpixels,                  # int32 label map
        # User's selection (display-edge indices)
        "selected_edges": [],
    }

    n_sp = int(superpixels.max()) + 1
    print(
        f"[create_session] {img_w}x{img_h} | "
        f"display={len(edge_polylines)} edges | "
        f"dense={len(edge_contours_dense)} edges | "
        f"superpixels={n_sp}"
    )
    return {
        "sessionId": session_id,
        "width": img_w,
        "height": img_h,
        "edges": edge_polylines,
    }


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    _sessions.pop(session_id, None)
    return {"ok": True}


@app.post("/api/sessions/{session_id}/edge-selection")
async def save_edge_selection(session_id: str, req: EdgeSelectionRequest):
    sess = _sessions.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Unknown session")
    sess["selected_edges"] = req.selected_indices
    print(f"[edge-selection] {len(req.selected_indices)} edges marked as cuts")
    return {"ok": True, "selected": len(req.selected_indices)}


@app.post("/api/sessions/{session_id}/export-stand")
async def export_stand(session_id: str, req: StandRequest):
    sess = _sessions.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Unknown session")
    if req.n_layers < 1:
        raise HTTPException(status_code=400, detail="n_layers must be at least 1")

    from points import build_stand_ai
    try:
        ai_content = build_stand_ai(
            n_layers=req.n_layers,
            spoke_h_in=req.spoke_h_in,
            base_h_in=req.base_h_in,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stand generation failed: {e}")

    base = re.sub(r'[^\x00-\x7F]+', '_', sess["filename"].rsplit(".", 1)[0])
    return Response(
        content=ai_content.encode("latin-1"),
        media_type="application/postscript",
        headers={"Content-Disposition": f'attachment; filename="{base}_stand.ai"'},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
