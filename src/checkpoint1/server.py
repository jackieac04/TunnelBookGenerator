from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from PIL import Image
import io
import uuid
import numpy as np
import tempfile
import os

from points import TunnelBookGenerator

app = FastAPI()

MODEL_TYPE = "vit_h"
CHECKPOINT_PATH = os.environ.get("SAM_CHECKPOINT", "sam_vit_h_4b8939.pth")


class SegmentRequest(BaseModel):
    # [[x,y], [x,y], ...] in ORIGINAL image pixel coords 
    points: list[list[int]]
    # 1 = foreground, 0 = background; must match points length if provided
    labels: list[int] | None = None


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
        raise HTTPException(status_code=500, detail=f"Failed to initialize SAM: {e}")

    # so write a temp file and call load_image(path)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(img_bytes)
        tmp_path = f.name

    try:
        gen.load_image(tmp_path)  # calls predictor.set_image(...) inside points.py
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load image in points.py: {e}")
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
            raise HTTPException(status_code=400, detail="labels must match points length")
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