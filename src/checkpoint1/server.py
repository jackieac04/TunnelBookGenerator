from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from PIL import Image
import io
import uuid
import numpy as np
import tempfile
import os
import zipfile
import re

from points import TunnelBookGenerator

app = FastAPI()

MODEL_TYPE = "vit_h"
CHECKPOINT_PATH = os.environ.get("SAM_CHECKPOINT", "sam_vit_h_4b8939.pth")


class SegmentRequest(BaseModel):
    # [[x,y], [x,y], ...] in ORIGINAL image pixel coords
    points: list[list[int]]
    # 1 = foreground, 0 = background; must match points length if provided
    labels: list[int] | None = None


class ExportAiRequest(BaseModel):
    masks_b64: list[str]          # base64-encoded PNG mask per layer, in order
    dpi: int = 72                 # source image DPI for px→pt conversion
    mode: str = "outline"         # "outline" = red only, "engraving" = red + blue


#  session_id -> {"gen": TunnelBookGenerator, "width": int, "height": int, ...}
_sessions: dict[str, dict] = {}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/sessions")
async def create_session(image: UploadFile = File(...)):
    img_bytes = await image.read()

    # validate image and get dimensions
    try:
        pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image")

    # generator
    try:
        gen = TunnelBookGenerator(MODEL_TYPE, CHECKPOINT_PATH)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to initialize SAM: {e}")

    # so write a temp file and call load_image(path)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(img_bytes)
        tmp_path = f.name

    try:
        # calls predictor.set_image(...) inside points.py
        gen.load_image(tmp_path)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load image in points.py: {e}")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "gen": gen,
        "width": pil.width,
        "height": pil.height,
        "filename": image.filename or "image",
    }

    return {"sessionId": session_id, "width": pil.width, "height": pil.height}


@app.post("/api/sessions/{session_id}/segment")
async def segment(session_id: str, req: SegmentRequest):
    sess = _sessions.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Unknown session")

    points = req.points or []
    if len(points) == 0:
        raise HTTPException(status_code=400, detail="No points provided")

    # points to image bounds
    w, h = sess["width"], sess["height"]
    clamped = [
        [max(0, min(w - 1, int(x))), max(0, min(h - 1, int(y)))]
        for x, y in points
    ]

    gen: TunnelBookGenerator = sess["gen"]

    point_coords = np.array(clamped, dtype=np.float32)

    if req.labels is None:
        point_labels = np.ones(len(clamped), dtype=np.int32)
    else:
        if len(req.labels) != len(clamped):
            raise HTTPException(
                status_code=400, detail="labels must match points length")
        point_labels = np.array(req.labels, dtype=np.int32)

    try:
        masks, _, _ = gen.predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=False,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SAM predict failed: {e}")

    mask = masks[0]

    # return transparent mask PNG
    alpha = (mask.astype(np.uint8) * 255)
    rgba = np.zeros((alpha.shape[0], alpha.shape[1], 4), dtype=np.uint8)
    rgba[..., 3] = alpha

    out = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    _sessions.pop(session_id, None)
    return {"ok": True}


@app.post("/api/sessions/{session_id}/export-ai")
async def export_ai(session_id: str, req: ExportAiRequest):
    """
    Accepts one base64-encoded mask PNG per layer, runs edge detection +
    vectorisation on each, and returns a .zip containing:
      - one .ai file per layer  (layer_1.ai, layer_2.ai, …)
      - one combined layout .ai (all_layers_layout.ai)
    """
    import base64

    sess = _sessions.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Unknown session")

    if not req.masks_b64:
        raise HTTPException(status_code=400, detail="No masks provided")

    gen: TunnelBookGenerator = sess["gen"]

    # Decode each mask PNG → boolean numpy array and store on the generator
    gen.layer_masks = []
    for i, b64 in enumerate(req.masks_b64):
        try:
            png_bytes = base64.b64decode(b64)
            pil_mask = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
            alpha_arr = np.array(pil_mask)[:, :, 3]   # alpha channel
            bool_mask = alpha_arr > 127                 # threshold → boolean
            gen.layer_masks.append(bool_mask)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to decode mask for layer {i + 1}: {e}"
            )

    # Edge detection
    try:
        edge_data = gen.detect_edges()
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Edge detection failed: {e}")

    # Vectorise → collect .ai file contents in memory (don't write to disk)
    try:
        ai_files = _vectorise_to_memory(gen, edge_data, dpi=req.dpi, mode=req.mode)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Vectorisation failed: {e}")

    # Pack everything into a zip and return it
    zip_buf = io.BytesIO()
    base = re.sub(r'[^\x00-\x7F]+', '_', sess["filename"].rsplit(".", 1)[0])

    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in ai_files.items():
            zf.writestr(f"{base}_{name}", content)

    zip_buf.seek(0)
    return Response(
        content=zip_buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{base}_layers.ai.zip"'},
    )


def _vectorise_to_memory(gen: TunnelBookGenerator, edge_data, dpi: int, mode: str = "outline") -> dict[str, str]:
    """
    Returns a dict of  filename -> .ai file content (string),
    e.g. {"layer_1.ai": "...", "layer_2.ai": "...", "all_layers_layout.ai": "..."}
    """
    from points import (
        _contours_to_ps_paths, _mask_to_closed_ps_paths, _build_ai_document,
        _build_ai_header, _build_ai_footer, _build_layer_block,
    )

    ARTBOARD_W_PT = 32 * 72
    ARTBOARD_H_PT = 18 * 72
    STROKE_WIDTH = 0.072
    MAX_CONTENT_PT = 12 * 72  # 864 pt — max 12" on either axis

    img_h_px, img_w_px = gen.image_rgb.shape[:2]
    px_to_pt = 72.0 / dpi
    img_w_pt = img_w_px * px_to_pt
    img_h_pt = img_h_px * px_to_pt

    # Per-layer: scale to 12"×12" max, centered on artboard
    content_scale = min(MAX_CONTENT_PT / img_w_pt,
                        MAX_CONTENT_PT / img_h_pt, 1.0)
    content_w_pt = img_w_pt * content_scale
    content_h_pt = img_h_pt * content_scale
    content_offset_x = (ARTBOARD_W_PT - content_w_pt) / 2.0
    content_offset_y = (ARTBOARD_H_PT - content_h_pt) / 2.0

    valid_layers = [(i, e) for i, e in enumerate(edge_data) if e is not None]

    if not valid_layers:
        return {}

    n = len(valid_layers)
    layout_cols = max(
        1, int(np.ceil(np.sqrt(n * ARTBOARD_W_PT / ARTBOARD_H_PT))))
    layout_rows = int(np.ceil(n / layout_cols))
    padding_pt = 10.0
    cell_w = (ARTBOARD_W_PT - padding_pt * (layout_cols + 1)) / layout_cols
    cell_h = (ARTBOARD_H_PT - padding_pt * (layout_rows + 1)) / layout_rows
    scale_to_cell = min(cell_w / img_w_pt, cell_h / img_h_pt,
                        MAX_CONTENT_PT / img_w_pt, MAX_CONTENT_PT / img_h_pt)

    results: dict[str, str] = {}
    per_layer_outer = []
    per_layer_inner = []

    for layer_idx, (orig_i, edata) in enumerate(valid_layers):
        outer_ps = _mask_to_closed_ps_paths(
            gen.layer_masks[orig_i].astype(np.uint8) * 255, px_to_pt, img_h_pt)
        inner_ps = _contours_to_ps_paths(edata["inner"], px_to_pt, img_h_pt)

        per_layer_outer.append(outer_ps)
        per_layer_inner.append(inner_ps)

        if not outer_ps and not inner_ps:
            continue

        ai_content = _build_ai_document(
            artboard_w=ARTBOARD_W_PT,
            artboard_h=ARTBOARD_H_PT,
            outer_paths=outer_ps,
            inner_paths=inner_ps,
            offset_x=content_offset_x,
            offset_y=content_offset_y,
            content_scale=content_scale,
            stroke_width=STROKE_WIDTH / content_scale,
            layer_name=f"Layer {orig_i + 1}",
            mode=mode,
        )
        results[f"layer_{orig_i + 1}.ai"] = ai_content

    # combined layout
    combined_blocks = []
    for layer_idx, (orig_i, _) in enumerate(valid_layers):
        outer_ps = per_layer_outer[layer_idx]
        inner_ps = per_layer_inner[layer_idx]
        if not outer_ps and not inner_ps:
            continue
        col = layer_idx % layout_cols
        row = layer_idx // layout_cols
        cell_x0 = padding_pt + col * (cell_w + padding_pt)
        cell_y0 = ARTBOARD_H_PT - padding_pt - \
            (row + 1) * (cell_h + padding_pt) + padding_pt
        scaled_w = img_w_pt * scale_to_cell
        scaled_h = img_h_pt * scale_to_cell
        offset_x = cell_x0 + (cell_w - scaled_w) / 2.0
        offset_y = cell_y0 + (cell_h - scaled_h) / 2.0
        combined_blocks.append(
            _build_layer_block(
                outer_paths=outer_ps,
                inner_paths=inner_ps,
                offset_x=offset_x,
                offset_y=offset_y,
                content_scale=scale_to_cell,
                stroke_width=STROKE_WIDTH / scale_to_cell,
                layer_name=f"Layer {orig_i + 1}",
                mode=mode,
            )
        )

    if combined_blocks:
        combined = _build_ai_header(ARTBOARD_W_PT, ARTBOARD_H_PT)
        combined += "\n".join(combined_blocks)
        combined += _build_ai_footer()
        results["all_layers_layout.ai"] = combined

    return results
