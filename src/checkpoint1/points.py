import cv2
import numpy as np


# Stroke colors
_CUT_RGB = (1.0, 0.0, 0.0)   # red   – outer cut
_ENGRAVE_RGB = (0.0, 0.0, 1.0)   # blue  – inner engrave


def _smooth_contour(pts: np.ndarray, epsilon: float = 1.0, chaikin_iters: int = 4) -> np.ndarray:
    """
    Smooth a contour:
    1. approxPolyDP removes sub-pixel jitter (epsilon=1.0 px — very conservative).
    2. Chaikin subdivision (4 passes) rounds sharp corners into gentle curves
       by cutting each corner at the 1/4 and 3/4 points of every edge.
    The 4 iterations provide smoother, less jagged results.
    """
    # Step 1 — remove micro-jitter
    approx = cv2.approxPolyDP(pts.reshape(-1, 1, 2).astype(np.float32),
                              epsilon=epsilon, closed=True)
    pts = approx.squeeze().astype(np.float64)
    if pts.ndim == 1:
        pts = pts[np.newaxis, :]

    # Step 2 — Chaikin corner-cutting (closed curve)
    for _ in range(chaikin_iters):
        n = len(pts)
        if n < 3:
            break
        new_pts = []
        for i in range(n):
            p0 = pts[i]
            p1 = pts[(i + 1) % n]
            new_pts.append(0.75 * p0 + 0.25 * p1)
            new_pts.append(0.25 * p0 + 0.75 * p1)
        pts = np.array(new_pts)

    return pts


def _contours_to_ps_paths(contours: list[np.ndarray], px_to_pt: float, img_h_pt: float,
                          close: bool = True, min_area_px: float = None) -> list[str]:
    """Trace contours from a list of contours and return a list of
    PostScript path command strings (one string per contour).

    Y is flipped to convert from image-space (y=0 top) to PS-space (y=0 bottom).

    This function is intentionally lenient by default so that small-but-visible
    edges are not discarded before export. When needed, callers can pass a
    larger `min_area_px` to filter fine noise.
    """
    ps_paths = []
    for contour in contours:
        if len(contour) < 2:
            continue
        if min_area_px is not None and cv2.contourArea(contour) < min_area_px:
            continue

        # Simplify contour geometry to reduce path complexity and file size.
        # Keep enough detail so shapes still look like the source image.
        peri = cv2.arcLength(contour, True)
        eps = max(0.5, 0.005 * peri)
        approx = cv2.approxPolyDP(contour, eps, True)

        # If the approximation still has too many points, downsample.
        # We only downsample very large contours to avoid making the file huge.
        pts_raw = (approx.squeeze() if approx.squeeze().ndim > 1
                   else approx.squeeze()[np.newaxis, :])
        if len(pts_raw) > 5000:
            # keep only every Nth point to cap complexity
            step = int(np.ceil(len(pts_raw) / 5000))
            pts_raw = pts_raw[::step]

        # Smooth slightly (optional) to avoid jagged edges
        pts = _smooth_contour(pts_raw)

        cmds = []
        for j, (px, py) in enumerate(pts):
            ps_x = px * px_to_pt
            ps_y = img_h_pt - py * px_to_pt
            # Reduce precision to keep file sizes down
            cmds.append(
                f"{ps_x:.2f} {ps_y:.2f} {'moveto' if j == 0 else 'lineto'}")
        if close:
            cmds.append("closepath")
        ps_paths.append("\n".join(cmds))
    return ps_paths


def _mask_to_closed_ps_paths(mask_uint8: np.ndarray, px_to_pt: float,
                             img_h_pt: float, min_area_px: float = None) -> list[str]:
    """Derive closed outer-silhouette paths directly from a binary mask using
    cv2.findContours (RETR_EXTERNAL) rather than Canny edge detection.

    This guarantees every returned path is a fully-closed loop — no gaps.
    Contours smaller than min_area_px (default 20 px²) are discarded.
    A small smoothing pass is applied before conversion.
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask_clean = cv2.morphologyEx(mask_uint8, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(
        mask_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_KCOS)

    ps_paths = []
    for contour in contours:
        if len(contour) < 3:
            continue
        if min_area_px is not None and cv2.contourArea(contour) < min_area_px:
            continue
        pts = _smooth_contour(contour.squeeze() if contour.squeeze().ndim > 1
                              else contour.squeeze()[np.newaxis, :])
        cmds = []
        for j, (px, py) in enumerate(pts):
            ps_x = px * px_to_pt
            ps_y = img_h_pt - py * px_to_pt
            cmds.append(
                f"{ps_x:.4f} {ps_y:.4f} {'moveto' if j == 0 else 'lineto'}")
        cmds.append("closepath")
        ps_paths.append("\n".join(cmds))
    return ps_paths


def _build_ai_header(artboard_w: float, artboard_h: float) -> str:
    """Minimal Adobe Illustrator 8 compatible PostScript header."""
    return f"""%!PS-Adobe-3.0
%%Creator: TunnelBookGenerator
%%BoundingBox: 0 0 {artboard_w:.4f} {artboard_h:.4f}
%%HiResBoundingBox: 0.0000 0.0000 {artboard_w:.4f} {artboard_h:.4f}
%%DocumentProcessColors: Red Blue
%%EndComments
%%BeginProlog
%%EndProlog
%%BeginSetup
%%EndSetup
"""


def _build_ai_footer() -> str:
    return "\n%%Trailer\n%%EOF\n"


def _stroke_paths_block(paths: list[str], r: float, g: float, b: float,
                        stroke_width: float) -> list[str]:
    """Return PS lines that set color and stroke each path. No gsave/grestore."""
    if not paths:
        return []
    lines = [
        f"{r:.4f} {g:.4f} {b:.4f} setrgbcolor",
        f"{stroke_width:.4f} setlinewidth",
        "1 setlinecap",
        "1 setlinejoin",
        "[] 0 setdash",
    ]
    for path_cmds in paths:
        lines += ["newpath", path_cmds, "stroke"]
    return lines


def _border_rect_ps(content_w_pt: float, content_h_pt: float,
                    border_pt: float, stroke_width: float) -> str:
    """
    Draw two concentric red rectangles forming a 0.5" wide border band:
      - inner rect: flush with the content area (0, 0) → (content_w, content_h)
      - outer rect: border_pt (0.5") outside the content on all four sides
    Both stroked red at stroke_width (0.072 pt).
    Called before content scale is applied so dimensions stay in true artboard points.
    """
    r, g, b = _CUT_RGB
    STROKE_WIDTH = 0.072  # always fixed, ignore passed stroke_width for border

    def rect_cmds(x0, y0, w, h):
        return [
            "newpath",
            f"{x0:.4f} {y0:.4f} moveto",
            f"{x0 + w:.4f} {y0:.4f} lineto",
            f"{x0 + w:.4f} {y0 + h:.4f} lineto",
            f"{x0:.4f} {y0 + h:.4f} lineto",
            "closepath",
            "stroke",
        ]

    lines = [
        "% --- border rects ---",
        f"{r:.4f} {g:.4f} {b:.4f} setrgbcolor",
        f"{STROKE_WIDTH:.4f} setlinewidth",
        "1 setlinecap",
        "1 setlinejoin",
        "[] 0 setdash",
    ]
    # inner edge — flush with content
    lines += rect_cmds(0, 0, content_w_pt, content_h_pt)
    # outer edge — 0.5" beyond content
    lines += rect_cmds(-border_pt, -border_pt,
                       content_w_pt + 2 * border_pt,
                       content_h_pt + 2 * border_pt)
    return "\n".join(lines) + "\n"


def _build_layer_block(outer_paths: list[str], inner_paths: list[str],
                       offset_x: float, offset_y: float, content_scale: float,
                       stroke_width: float, layer_name: str = "Layer",
                       mode: str = "outline",
                       content_w_pt: float = 0.0,
                       content_h_pt: float = 0.0,
                       border_pt: float = 0.5 * 72) -> str:
    """
    PostScript block for one layer.
    Outer paths → red (cut).
    Inner paths → blue (engrave) — only when mode == 'engraving'.
    A border rectangle is always drawn around the content area.
    content_w_pt / content_h_pt are the unscaled artboard dimensions of the
    content so the border rect can be placed correctly.
    border_pt is the gap (in points) between the inner and outer frame rectangles.
    """
    BORDER_PT = border_pt

    lines = [
        f"% --- {layer_name} ---",
        "gsave",
        f"{offset_x:.4f} {offset_y:.4f} translate",
    ]

    # Border rect is drawn in artboard-point space (before content scale)
    # so it is always a true ½" regardless of image scale.
    if content_w_pt > 0 and content_h_pt > 0:
        lines.append(_border_rect_ps(
            content_w_pt, content_h_pt, BORDER_PT, stroke_width))

    lines.append(f"{content_scale:.6f} {content_scale:.6f} scale")
    lines += _stroke_paths_block(outer_paths, *_CUT_RGB, stroke_width)
    if mode == "engraving":
        lines += _stroke_paths_block(inner_paths, *_ENGRAVE_RGB, stroke_width)
    lines.append("grestore")
    return "\n".join(lines) + "\n"


def _build_ai_document(artboard_w: float, artboard_h: float,
                       outer_paths: list[str], inner_paths: list[str],
                       offset_x: float, offset_y: float, content_scale: float,
                       stroke_width: float, layer_name: str = "Layer",
                       mode: str = "outline",
                       content_w_pt: float = 0.0,
                       content_h_pt: float = 0.0,
                       border_pt: float = 0.5 * 72) -> str:
    """Full single-layer .ai document."""
    doc = _build_ai_header(artboard_w, artboard_h)
    doc += _build_layer_block(
        outer_paths=outer_paths,
        inner_paths=inner_paths,
        offset_x=offset_x,
        offset_y=offset_y,
        content_scale=content_scale,
        stroke_width=stroke_width,
        layer_name=layer_name,
        mode=mode,
        content_w_pt=content_w_pt,
        content_h_pt=content_h_pt,
        border_pt=border_pt,
    )
    doc += _build_ai_footer()
    return doc


def build_stand_ai(
    n_layers: int,
    spoke_h_in: float = 1.4,
    base_h_in: float = 0.65,
    spoke_w_in: float = 0.2,
    gap_in: float = 0.16,
    tri_w_in: float = 0.5,
) -> str:
    r"""
    Generate a laser-cutter-ready .ai file for the tunnel book stand.

    ONE single closed shape: a comb whose outer left and right edges are the
    hypotenuses of right-angle triangles, giving the piece its lean.

    Dimensions:
      spoke_w_in = 0.20"  wall width of each spoke
      gap_in     = 0.16"  slot width (one slot per layer)
      spoke_h_in = 1.40"  height of spokes above the base
      base_h_in  = 0.65"  height of the solid base bar
      tri_w_in   = 0.50"  how far the triangle foot extends beyond
                           the outermost spoke at the bottom

    Total width at bottom = tri_w_in + teeth_w + tri_w_in
    Total width at top    = teeth_w  (= (n_layers+1)*spoke_w + n_layers*gap)
    Total height          = base_h_in + spoke_h_in
    """
    PT = 72.0
    SW = spoke_w_in * PT
    GW = gap_in     * PT
    SH = spoke_h_in * PT
    BH = base_h_in  * PT
    TW = tri_w_in   * PT

    n_spokes = n_layers + 1
    n_gaps   = n_layers
    teeth_w  = n_spokes * SW + n_gaps * GW
    total_h  = BH + SH
    base_w   = 2 * TW + teeth_w

    margin = 0.25 * PT
    art_w  = base_w  + 2 * margin
    art_h  = total_h + 2 * margin

    ox = margin
    oy = margin

    def ps_path(pts: list) -> str:
        cmds = []
        for j, (px, py) in enumerate(pts):
            cmds.append(f"{px:.4f} {py:.4f} {'moveto' if j == 0 else 'lineto'}")
        cmds.append("closepath")
        return "\n".join(cmds)

    def stroke_block(path_ps: str, label: str) -> str:
        r, g, b = _CUT_RGB
        return (
            f"% --- {label} ---\n"
            f"gsave\n"
            f"{r:.4f} {g:.4f} {b:.4f} setrgbcolor\n"
            f"0.0720 setlinewidth\n"
            f"1 setlinecap\n1 setlinejoin\n[] 0 setdash\n"
            f"newpath\n{path_ps}\nstroke\ngrestore\n"
        )

    # Single closed path traced clockwise:
    # bottom-left tip -> bottom-right tip -> top-right spoke ->
    # (comb teeth right-to-left with slot notches) -> top-left spoke ->
    # back to bottom-left tip via closepath (left hypotenuse)
    pts = []
    pts.append((ox, oy))                          # bottom-left tip
    pts.append((ox + base_w, oy))                 # bottom-right tip
    pts.append((ox + TW + teeth_w, oy + total_h)) # top of rightmost spoke

    for i in range(n_gaps - 1, -1, -1):
        g_right = ox + TW + (i + 1) * (SW + GW)
        g_left  = ox + TW + (i + 1) *  SW + i * GW
        pts.append((g_right, oy + total_h))   # arrive at right edge of slot
        pts.append((g_right, oy + BH))        # drop to slot floor
        pts.append((g_left,  oy + BH))        # cross slot floor
        pts.append((g_left,  oy + total_h))   # rise from slot

    pts.append((ox + TW, oy + total_h))           # top of leftmost spoke

    doc  = _build_ai_header(art_w, art_h)
    doc += stroke_block(
        ps_path(pts),
        f"Stand - {n_layers} layer{'s' if n_layers != 1 else ''} "
        f"({n_spokes} spokes, {n_gaps} slots)"
    )
    doc += _build_ai_footer()
    return doc


    