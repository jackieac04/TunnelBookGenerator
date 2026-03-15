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
import torch
from torchvision import transforms
import traceback
import cv2

from points import TunnelBookGenerator

app = FastAPI()

MODEL_TYPE = "vit_h"
CHECKPOINT_PATH = "src/checkpoint1/sam_vit_h_4b8939.pth"


class SegmentRequest(BaseModel):
    # [[x,y], [x,y], ...] in ORIGINAL image pixel coords
    points: list[list[int]]
    # 1 = foreground, 0 = background; must match points length if provided
    labels: list[int] | None = None


class ExportAiRequest(BaseModel):
    masks_b64: list[str]          # base64-encoded PNG mask per layer, in order
    dpi: int = 72                 # source image DPI for px→pt conversion
    mode: str = "outline"         # "outline" = red only, "engraving" = red + blue


class AutomaticRequest(BaseModel):
    num_layers: int               # number of layers to split the depth map into
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
        "image_rgb": gen.image_rgb,
        "width": pil.width,
        "height": pil.height,
        "filename": image.filename or "image",
    }

    return {"sessionId": session_id, "width": pil.width, "height": pil.height}


@app.post("/api/automatic-sessions")
async def create_automatic_session(image: UploadFile = File(...)):
    img_bytes = await image.read()

    # validate image and get dimensions
    try:
        pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image")

    # Load image directly as numpy array
    img_rgb = np.array(pil)

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "image_rgb": img_rgb,
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


@app.get("/api/sessions/{session_id}/automatic-ai")
async def get_automatic_ai(session_id: str):
    sess = _sessions.get(session_id)
    if not sess or "ai_files" not in sess:
        raise HTTPException(status_code=404, detail="AI files not available")

    ai_files = sess["ai_files"]
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
            "Content-Disposition": f'attachment; filename="{base}_automatic_ai.zip"'},
    )


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
        ai_files = _vectorise_to_memory(
            gen.layer_masks, gen.image_rgb, edge_data, dpi=req.dpi, mode=req.mode)
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


@app.post("/api/sessions/{session_id}/automatic")
async def automatic(session_id: str, req: AutomaticRequest):
    """
    Automatically generates depth-based layers from the image, runs edge detection +
    vectorisation on each, and returns a .zip containing:
      - one .ai file per layer  (layer_1.ai, layer_2.ai, …)
      - one combined layout .ai (all_layers_layout.ai)
    and another zip containing:
      - one .png mask per layer (layer_1.png, layer_2.png, …)
    """
    sess = _sessions.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Unknown session")

    if req.num_layers < 1:
        raise HTTPException(
            status_code=400, detail="num_layers must be at least 1")

    print(
        f"Automatic request: num_layers={req.num_layers}, dpi={req.dpi}, mode={req.mode}")

    # Use the image_rgb from session
    img_rgb = sess["image_rgb"]

    # Load MiDaS model for depth estimation
    try:
        print("Loading MiDaS model for depth estimation...")
        # Bypass SSL verification for torch.hub.load
        import ssl
        ssl._create_default_https_context = ssl._create_unverified_context
        midas = torch.hub.load("intel-isl/MiDaS", "MiDaS_small")
        print("MiDaS model loaded successfully.")
        midas.to("cpu")
        midas.eval()
        print("MiDaS model moved to CPU and set to eval mode.")
    except Exception as e:
        # print error with full details for debugging
        print("An error occurred:")
        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Failed to load MiDaS model: {e}")

    # Define transforms
    print("Setting up image transforms...")
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])

    # Preprocess image
    try:
        # Resize to 384x384 for MiDaS
        resize_transform = transforms.Resize((384, 384))
        pil_img = Image.fromarray(img_rgb)
        resized_pil = resize_transform(pil_img)
        input_tensor = transform(resized_pil).unsqueeze(0).to("cpu")
        print("Image preprocessing completed successfully.")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to preprocess image: {e}")

    # Predict depth
    try:
        with torch.no_grad():
            print("Running depth prediction with MiDaS...")
            prediction = midas(input_tensor)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=(384, 384),
                mode="bicubic",
                align_corners=False
            ).squeeze()
        depth_map_384 = prediction.cpu().numpy()
        # Resize back to original size
        depth_map = cv2.resize(
            depth_map_384, (img_rgb.shape[1], img_rgb.shape[0]), interpolation=cv2.INTER_CUBIC)
        print("Depth prediction completed successfully.")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to predict depth: {e}")

    # Split depth map into layers
    depth_min = depth_map.min()
    depth_max = depth_map.max()
    print(f"Depth map stats: min={depth_min}, max={depth_max}")
    if depth_min == depth_max:
        # Flat depth, create single layer
        mask = np.ones_like(depth_map, dtype=bool)
        layer_masks = [mask] * req.num_layers
    else:
        thresholds = np.linspace(depth_min, depth_max, req.num_layers + 1)
        layer_masks = []
        for i in range(req.num_layers):
            if i == 0:
                mask = depth_map < thresholds[1]
            elif i == req.num_layers - 1:
                mask = depth_map >= thresholds[i]
            else:
                mask = (depth_map >= thresholds[i]) & (
                    depth_map < thresholds[i + 1])
            layer_masks.append(mask.astype(bool))
    print(f"Depth map split into {req.num_layers} layers successfully.")
    # Edge detection
    try:
        edge_data = detect_edges(layer_masks, img_rgb)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Edge detection failed: {e}")

    # Vectorise → collect .ai file contents in memory (don't write to disk)
    print("Starting vectorisation of layers...")
    try:
        ai_files = _vectorise_to_memory(
            layer_masks, img_rgb, edge_data, dpi=req.dpi, mode=req.mode)
    except Exception as e:
        print("An error occurred:")
        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Vectorisation failed: {e}")

    # Create PNG files for each layer mask
    png_files = {}
    for i, mask in enumerate(layer_masks):
        alpha = (mask.astype(np.uint8) * 255)
        rgba = np.zeros((alpha.shape[0], alpha.shape[1], 4), dtype=np.uint8)
        rgba[..., 3] = alpha
        out = Image.fromarray(rgba, mode="RGBA")
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        png_files[f"layer_{i+1}.png"] = buf.getvalue()

    # Store ai_files in session for later retrieval
    sess["ai_files"] = ai_files

    # Pack pngs into zip
    zip_buf = io.BytesIO()
    base = re.sub(r'[^\x00-\x7F]+', '_', sess["filename"].rsplit(".", 1)[0])

    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in png_files.items():
            zf.writestr(name, content)

    zip_buf.seek(0)
    print(
        f"Generated PNG zip file of size {zip_buf.getbuffer().nbytes} bytes successfully.")
    return Response(
        content=zip_buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{base}_automatic_masks.zip"'},
    )


def detect_edges(layer_masks, img_rgb, canny_low=30, canny_high=100):
    """Detect edges for each layer mask.

    Returns a list of dicts with:
      - "outer": edge map (uint8 image) for the mask silhouette
      - "inner": edge map (uint8 image) for internal details

    This matches the format used by TunnelBookGenerator.detect_edges() so
    automatic and manual modes can share the same vectorisation pipeline.
    """
    edge_data = []
    for mask in layer_masks:
        if mask is None:
            edge_data.append(None)
            continue

        # Convert boolean mask to uint8
        mask_uint8 = mask.astype(np.uint8) * 255

        # --- outer edge: silhouette of the mask ---
        # Close small holes to create a clean contour before Canny.
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask_closed = cv2.morphologyEx(mask_uint8, cv2.MORPH_CLOSE, kernel)
        outer_edges = cv2.Canny(mask_closed, 100, 200)

        # --- inner edges: Canny on the masked image content ---
        masked_rgb = cv2.bitwise_and(img_rgb, img_rgb, mask=mask_uint8)
        gray = cv2.cvtColor(masked_rgb, cv2.COLOR_RGB2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        inner_edges = cv2.Canny(blurred, canny_low, canny_high)

        # Remove overlap with outer silhouette
        inner_edges = cv2.bitwise_and(
            inner_edges, cv2.bitwise_not(outer_edges))

        edge_data.append({"outer": outer_edges, "inner": inner_edges})

    return edge_data


def _vectorise_to_memory(layer_masks, image_rgb, edge_data, dpi: int, mode: str = "outline") -> dict[str, str]:
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

    img_h_px, img_w_px = image_rgb.shape[:2]
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
    cell_content_w_pt = img_w_pt * scale_to_cell
    cell_content_h_pt = img_h_pt * scale_to_cell

    results: dict[str, str] = {}
    per_layer_outer = []
    per_layer_inner = []

    for layer_idx, (orig_i, edata) in enumerate(valid_layers):
        outer_ps = _mask_to_closed_ps_paths(
            layer_masks[orig_i].astype(np.uint8) * 255, px_to_pt, img_h_pt)

        # edata["inner"] may already be a list of contours (old behavior),
        # or an edge image (current behavior).
        inner_input = edata.get("inner")
        if isinstance(inner_input, (list, tuple)):
            contours_inner = inner_input
        else:
            contours_inner, _ = cv2.findContours(
                inner_input, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        inner_ps = _contours_to_ps_paths(contours_inner, px_to_pt, img_h_pt)

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
            content_w_pt=content_w_pt,
            content_h_pt=content_h_pt,
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
                content_w_pt=cell_content_w_pt,
                content_h_pt=cell_content_h_pt,
            )
        )

    if combined_blocks:
        combined = _build_ai_header(ARTBOARD_W_PT, ARTBOARD_H_PT)
        combined += "\n".join(combined_blocks)
        combined += _build_ai_footer()
        results["all_layers_layout.ai"] = combined

    return results


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
