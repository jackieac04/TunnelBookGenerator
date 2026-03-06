import cv2
import numpy as np
import torch
import matplotlib.pyplot as plt
from matplotlib.widgets import Button
from PIL import Image
from segment_anything import sam_model_registry, SamPredictor


class TunnelBookGenerator:
    def __init__(self, model_type, checkpoint_path):
        """Initialize the generator with the SAM model."""
        print("Loading SAM model... (This might take a moment)")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        sam = sam_model_registry[model_type](checkpoint=checkpoint_path)
        sam.to(device=self.device)
        self.predictor = SamPredictor(sam)

        self.image = None
        self.image_rgb = None

        self.num_layers = 0
        self.current_layer = 0
        self.layer_clicks = []  # List of lists containing [x, y] coordinates
        self.layer_masks = []   # List of boolean masks from SAM

    #  Load image for SAM
    def load_image(self, image_path):
        self.image = cv2.imread(image_path)
        if self.image is None:
            raise ValueError(f"Could not load image at {image_path}")

        self.image_rgb = cv2.cvtColor(self.image, cv2.COLOR_BGR2RGB)
        self.predictor.set_image(self.image_rgb)
        print(f"Image loaded")

    def onclick(self, event):
        #  clicks outside the image
        if event.inaxes != self.ax:
            return

        if event.xdata is not None and event.ydata is not None:
            x, y = int(event.xdata), int(event.ydata)
            self.layer_clicks[self.current_layer].append([x, y])

            self.generate_mask_for_current_layer()
            self.update_display()

    # next layer or close if finished
    def next_layer(self, event):
        if self.layer_masks[self.current_layer] is None:
            print(
                f"Warning: No mask generated for Layer {self.current_layer + 1}.")

        self.current_layer += 1

        if self.current_layer >= self.num_layers:
            print("All layers defined! Processing and closing window...")
            plt.close(self.fig)
        else:
            self.update_display()

    #  segmentation mask for cur layer using its points
    def generate_mask_for_current_layer(self):
        clicks = self.layer_clicks[self.current_layer]
        if len(clicks) == 0:
            return

        input_points = np.array(clicks)
        input_labels = np.ones(len(clicks))

        masks, _, _ = self.predictor.predict(
            point_coords=input_points,
            point_labels=input_labels,
            multimask_output=False
        )

        self.layer_masks[self.current_layer] = masks[0]

# update display to show current layer in green, previous layers in blue, and click points in red
    def update_display(self):
        self.ax.clear()

        # copy of the og image
        display_img = self.image_rgb.copy().astype(np.float32)
        # array of 10 RGB colors for up to 10 layers (all rainbow colors)
        colors = [
            [255, 0, 0],    # Red
            [255, 128, 0],  # Orange
            [255, 255, 0],  # Yellow
            [0, 255, 0],    # Green
            [0, 128, 255],  # Blue
            [128, 0, 255],  # Purple
            [255, 0, 128],  # Pink
            [128, 128, 0],  # Olive
            [128, 0, 128],  # Purple (alternative)
            [0, 128, 128]   # Teal
        ]

        # prev layers in different colors
        for i in range(self.current_layer):
            if self.layer_masks[i] is not None:
                mask = self.layer_masks[i]
                # Mix 70% original pixel color + 30% color from colors list
                display_img[mask] = (display_img[mask] * 0.7) + \
                    (np.array(colors[i]) * 0.3)
        # cur layer in corresponding color
        if self.layer_masks[self.current_layer] is not None:
            mask = self.layer_masks[self.current_layer]
            # Mix 50% original pixel color + 50% color from colors list
            display_img[mask] = (display_img[mask] * 0.5) + \
                (np.array(colors[self.current_layer]) * 0.5)

        display_img = display_img.astype(np.uint8)
        self.ax.imshow(display_img)

        #  click points for cur layer
        clicks = self.layer_clicks[self.current_layer]
        if len(clicks) > 0:
            clicks_array = np.array(clicks)
            self.ax.scatter(clicks_array[:, 0], clicks_array[:, 1],
                            c='red', s=100, marker='x', linewidths=3)

        title_text = f"Layer {self.current_layer + 1} of {self.num_layers}\n"
        title_text += "Click subjects for THIS layer, then click 'Next Layer'."
        self.ax.set_title(title_text)
        self.ax.axis('off')

        self.fig.canvas.draw()

#   matplotlib GUI and start the interaction loop
    def run_interactive(self, image_path, num_layers):
        self.load_image(image_path)
        self.num_layers = num_layers
        self.current_layer = 0

        self.layer_clicks = [[] for _ in range(num_layers)]
        self.layer_masks = [None for _ in range(num_layers)]

        self.fig, self.ax = plt.subplots(figsize=(12, 8))
        plt.subplots_adjust(bottom=0.2)

        axnext = plt.axes([0.81, 0.05, 0.1, 0.075])
        self.bnext = Button(axnext, 'Next Layer')
        self.bnext.on_clicked(self.next_layer)

        self.cid = self.fig.canvas.mpl_connect(
            'button_press_event', self.onclick)

        self.update_display()
        plt.show()

# export layers as separate transparent PNGs with original image colors and transparent background
# for debugging
    def save_layers(self, output_base_name):
        """Export each layer as a separate transparent PNG."""
        print("\nSaving layers...")
        for i, mask in enumerate(self.layer_masks):
            if mask is None:
                print(f"Skipping Layer {i + 1} (No mask generated)")
                continue

            # Create RGBA image with transparent background
            result = np.dstack(
                [self.image_rgb, np.zeros_like(mask, dtype=np.uint8)])
            result[:, :, 3] = mask.astype(np.uint8) * 255

            output_path = f"{output_base_name}_layer_{i + 1}.png"
            Image.fromarray(result, 'RGBA').save(output_path)
            print(f"-> Saved: {output_path}")

    def detect_edges(self, canny_low=50, canny_high=150):
        """Run edge detection on each masked layer, keeping outer (cut) and inner (engrave) edges in separate maps."""
        
        print("\nDetecting edges...")
        edge_data = []

        for i, mask in enumerate(self.layer_masks):
            if mask is None:
                print(f"  Layer {i + 1}: no mask, skipping")
                edge_data.append(None)
                continue

            # --- outer edge: silhouette of the SAM mask ---
            mask_uint8 = mask.astype(np.uint8) * 255
            outer_edges = cv2.Canny(mask_uint8, 100, 200)

            # --- inner edges: Canny on the masked image content ---
            masked_rgb = self.image_rgb.copy()
            masked_rgb[~mask] = 0
            gray = cv2.cvtColor(masked_rgb, cv2.COLOR_RGB2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            inner_edges = cv2.Canny(blurred, canny_low, canny_high)

            # Remove any inner edges that overlap the outer silhouette to keep
            # the two sets clean and non-redundant
            inner_edges = cv2.bitwise_and(inner_edges, cv2.bitwise_not(outer_edges))

            edge_data.append({"outer": outer_edges, "inner": inner_edges})
            print(f"  Layer {i + 1}: edges detected")

        return edge_data

    def export_ai_files(self, output_base_name, edge_data=None,
                        dpi=72, layout_cols=None):
        """Vectorise edge data and export one .ai file per layer, plus a combined layout file with all layers tiled on a 32"×18" artboard."""
        if edge_data is None:
            edge_data = self.detect_edges()

        # Artboard dimensions in points
        ARTBOARD_W_PT = 32 * 72   # 2304 pt
        ARTBOARD_H_PT = 18 * 72   # 1296 pt
        STROKE_WIDTH  = 0.072     # pt

        img_h_px, img_w_px = self.image_rgb.shape[:2]
        px_to_pt = 72.0 / dpi
        img_w_pt = img_w_px * px_to_pt
        img_h_pt = img_h_px * px_to_pt

        valid_layers = [(i, e) for i, e in enumerate(edge_data) if e is not None]

        if not valid_layers:
            print("No edge data to export.")
            return

        # --- auto layout grid for combined file ---
        n = len(valid_layers)
        if layout_cols is None:
            layout_cols = max(1, int(np.ceil(np.sqrt(n * ARTBOARD_W_PT / ARTBOARD_H_PT))))
        layout_rows = int(np.ceil(n / layout_cols))

        padding_pt = 10.0
        cell_w = (ARTBOARD_W_PT - padding_pt * (layout_cols + 1)) / layout_cols
        cell_h = (ARTBOARD_H_PT - padding_pt * (layout_rows + 1)) / layout_rows
        scale_to_cell = min(cell_w / img_w_pt, cell_h / img_h_pt)

        per_layer_outer = []  # ps_paths lists for combined layout
        per_layer_inner = []

        print("\nExporting .ai files...")

        for layer_idx, (orig_i, edata) in enumerate(valid_layers):
            outer_ps = _contours_to_ps_paths(edata["outer"], px_to_pt, img_h_pt)
            inner_ps = _contours_to_ps_paths(edata["inner"], px_to_pt, img_h_pt)

            per_layer_outer.append(outer_ps)
            per_layer_inner.append(inner_ps)

            if not outer_ps and not inner_ps:
                print(f"  Layer {orig_i + 1}: no contours found, skipping")
                continue

            ai_content = _build_ai_document(
                artboard_w=ARTBOARD_W_PT,
                artboard_h=ARTBOARD_H_PT,
                outer_paths=outer_ps,
                inner_paths=inner_ps,
                offset_x=0.0,
                offset_y=0.0,
                content_scale=1.0,
                stroke_width=STROKE_WIDTH,
                layer_name=f"Layer {orig_i + 1}",
            )

            out_path = f"{output_base_name}_layer_{orig_i + 1}.ai"
            with open(out_path, "w", encoding="latin-1") as f:
                f.write(ai_content)
            print(f"  -> Saved: {out_path}")

        # --- combined layout ---
        combined_blocks = []
        for layer_idx, (orig_i, _) in enumerate(valid_layers):
            outer_ps = per_layer_outer[layer_idx]
            inner_ps = per_layer_inner[layer_idx]
            if not outer_ps and not inner_ps:
                continue

            col = layer_idx % layout_cols
            row = layer_idx // layout_cols
            cell_x0 = padding_pt + col * (cell_w + padding_pt)
            cell_y0 = ARTBOARD_H_PT - padding_pt - (row + 1) * (cell_h + padding_pt) + padding_pt
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
                    stroke_width=STROKE_WIDTH,
                    layer_name=f"Layer {orig_i + 1}",
                )
            )

        combined_content = _build_ai_header(ARTBOARD_W_PT, ARTBOARD_H_PT)
        combined_content += "\n".join(combined_blocks)
        combined_content += _build_ai_footer()

        combined_out = f"{output_base_name}_all_layers_layout.ai"
        with open(combined_out, "w", encoding="latin-1") as f:
            f.write(combined_content)
        print(f"  -> Saved combined layout: {combined_out}")


# Stroke colors
_CUT_RGB     = (1.0, 0.0, 0.0)   # red   – outer cut
_ENGRAVE_RGB = (0.0, 0.0, 1.0)   # blue  – inner engrave


def _contours_to_ps_paths(edge_map: np.ndarray, px_to_pt: float, img_h_pt: float) -> list[str]:
    """
    Trace contours from a single-channel edge map and return a list of
    PostScript path command strings (one string per contour).
    Y is flipped to convert from image-space (y=0 top) to PS-space (y=0 bottom).
    """
    import cv2
    contours, _ = cv2.findContours(edge_map, cv2.RETR_LIST, cv2.CHAIN_APPROX_TC89_KCOS)
    ps_paths = []
    for contour in contours:
        if len(contour) < 2:
            continue
        pts = contour.squeeze()
        if pts.ndim == 1:
            pts = pts[np.newaxis, :]
        cmds = []
        for j, (px, py) in enumerate(pts):
            ps_x = px * px_to_pt
            ps_y = img_h_pt - py * px_to_pt
            cmds.append(f"{ps_x:.4f} {ps_y:.4f} {'moveto' if j == 0 else 'lineto'}")
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


def _build_layer_block(outer_paths: list[str], inner_paths: list[str],
                        offset_x: float, offset_y: float, content_scale: float,
                        stroke_width: float, layer_name: str = "Layer") -> str:
    """
    PostScript block for one layer.
    Outer paths → red (cut), inner paths → blue (engrave). No fill.
    """
    lines = [
        f"% --- {layer_name} ---",
        "gsave",
        f"{offset_x:.4f} {offset_y:.4f} translate",
        f"{content_scale:.6f} {content_scale:.6f} scale",
    ]
    lines += _stroke_paths_block(outer_paths, *_CUT_RGB,     stroke_width)
    lines += _stroke_paths_block(inner_paths, *_ENGRAVE_RGB, stroke_width)
    lines.append("grestore")
    return "\n".join(lines) + "\n"


def _build_ai_document(artboard_w: float, artboard_h: float,
                        outer_paths: list[str], inner_paths: list[str],
                        offset_x: float, offset_y: float, content_scale: float,
                        stroke_width: float, layer_name: str = "Layer") -> str:
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
    )
    doc += _build_ai_footer()
    return doc

def main():
    MODEL_TYPE = "vit_h"
    CHECKPOINT_PATH = "src/checkpoint1/sam_vit_h_4b8939.pth"

    print("=== Tunnel Book Generator ===")
    image_path = input("Enter image path: ").strip()

    try:
        num_layers = int(
            input("How many layers do you want in your tunnel book? "))
        if num_layers < 1:
            raise ValueError("You must have at least 1 layer.")
    except ValueError as e:
        print("Invalid number of layers. Please enter an integer.")
        return

    try:
        generator = TunnelBookGenerator(MODEL_TYPE, CHECKPOINT_PATH)

        # Starts the GUI
        generator.run_interactive(image_path, num_layers)

        # Save output based on the original filename
        output_base = image_path.rsplit('.', 1)[0]

        # Debug PNGs
        generator.save_layers(output_base)

        # Edge detection → vectorisation → .ai export
        edge_data = generator.detect_edges()
        generator.export_ai_files(output_base, edge_data=edge_data)

        print("\nDone! Your tunnel book layers are ready to print and cut.")

    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    main()
