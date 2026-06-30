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


def _chaikin(pts: list[list[float]], iters: int = 1) -> list[list[float]]:
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


def _split_polyline(pts: list[list[float]],
                    angle_thresh_deg: float = 40.0,
                    max_arc_px: float = 120.0) -> list[list[list[float]]]:
    """Split a polyline at sharp corners and at max arc length.

    Returns a list of sub-polylines, each with ≥ 2 points.
    """
    if len(pts) < 2:
        return []

    segments: list[list[list[float]]] = []
    current: list[list[float]] = [pts[0]]
    arc_len: float = 0.0

    for i in range(1, len(pts)):
        p_prev = np.array(current[-1])
        p_cur  = np.array(pts[i])
        step   = float(np.linalg.norm(p_cur - p_prev))

        # Split on corner angle
        split_corner = False
        if len(current) >= 2 and i < len(pts) - 1:
            v1 = p_cur - p_prev
            v2 = np.array(pts[i + 1]) - p_cur
            n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
            if n1 > 0 and n2 > 0:
                cos_a = float(np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0))
                if np.degrees(np.arccos(cos_a)) > angle_thresh_deg:
                    split_corner = True

        # Split on max arc length
        split_len = (arc_len + step) > max_arc_px

        if (split_corner or split_len) and len(current) >= 2:
            current.append(pts[i])   # include the split point in both segments
            segments.append(current)
            current = [pts[i]]
            arc_len = 0.0
        else:
            current.append(pts[i])
            arc_len += step

    if len(current) >= 2:
        segments.append(current)

    return segments


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

    # ── Joint segmentation: edge-aware superpixels ────────────────────────────
    try:
        superpixels = felzenszwalb(img_rgb, scale=150, sigma=0.8, min_size=100)
    except Exception as e:
        print(f"[create_session] felzenszwalb failed ({e}), falling back to SLIC")
        n_segs = max(200, min(2000, (img_h * img_w) // 1500))
        superpixels = slic(img_rgb, n_segments=n_segs, compactness=10, sigma=1, start_label=0)

    # ── Display edges: Canny edges snapped to superpixel boundaries ───────────
    # Use Canny for accurate edge localization, then snap each contour point to
    # the nearest superpixel boundary pixel so selected edges map cleanly to
    # superpixel regions in downstream steps.
    blurred_display = cv2.GaussianBlur(gray, (5, 5), 1.0)
    canny_display = cv2.Canny(blurred_display, 50, 150)

    # Build superpixel boundary map for snapping
    sp = superpixels
    boundary_map = np.zeros((img_h, img_w), dtype=np.uint8)
    boundary_map[:-1, :] |= ((sp[:-1, :] != sp[1:, :]) * 255).astype(np.uint8)
    boundary_map[:, :-1] |= ((sp[:, :-1] != sp[:, 1:]) * 255).astype(np.uint8)

    # Distance transform: for each pixel, distance to nearest boundary pixel
    dist_to_boundary, nearest_boundary = cv2.distanceTransformWithLabels(
        cv2.bitwise_not(boundary_map), cv2.DIST_L2, cv2.DIST_MASK_PRECISE,
        labelType=cv2.DIST_LABEL_PIXEL)

    # Map from distanceTransform label → (row, col) of the boundary pixel
    label_coords = np.column_stack(np.where(boundary_map > 0))  # shape (N, 2): [row, col]

    def _snap_to_boundary(pts_rc: np.ndarray) -> np.ndarray:
        """Snap each point (row, col) to the nearest superpixel boundary pixel."""
        rows = np.clip(pts_rc[:, 0], 0, img_h - 1)
        cols = np.clip(pts_rc[:, 1], 0, img_w - 1)
        labels = nearest_boundary[rows, cols] - 1   # 1-indexed → 0-indexed
        labels = np.clip(labels, 0, len(label_coords) - 1)
        return label_coords[labels]                  # returns (row, col) pairs

    contours_display, _ = cv2.findContours(
        canny_display, cv2.RETR_LIST, cv2.CHAIN_APPROX_TC89_KCOS)

    edge_polylines: list[list[list[float]]] = []
    for c in contours_display:
        peri = cv2.arcLength(c, False)
        if peri < 25:
            continue
        eps = max(1.0, 0.01 * peri)
        approx = cv2.approxPolyDP(c, eps, False)
        pts = approx.squeeze()
        if pts.ndim == 1:
            pts = pts[np.newaxis, :]
        if len(pts) < 2:
            continue
        # pts is (N, 2) in (x, y) order; snap needs (row, col) = (y, x)
        pts_rc = pts[:, ::-1]
        snapped_rc = _snap_to_boundary(pts_rc)
        # convert back to (x, y)
        snapped_xy = snapped_rc[:, ::-1].tolist()
        smoothed = _chaikin(snapped_xy, iters=1)
        edge_polylines.extend(_split_polyline(smoothed))

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
