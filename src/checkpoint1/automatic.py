import torch
import cv2
import numpy as np
from torchvision import transforms
from PIL import Image
import matplotlib.pyplot as plt

# Import from points.py
from points import TunnelBookGenerator

# Load the MiDaS model
midas = torch.hub.load("intel-isl/MiDaS", "MiDaS_small")
midas.to("cpu")
midas.eval()

# Define transforms
transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])


def create_depth_map(img_rgb):
    input_tensor = transform(img_rgb).unsqueeze(0).to("cpu")
    with torch.no_grad():
        prediction = midas(input_tensor)
        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=img_rgb.shape[:2],
            mode="bicubic",
            align_corners=False
        ).squeeze()
    depth_map = prediction.cpu().numpy()
    return depth_map


def split_depth_into_layers(depth_map, num_layers):
    depth_min = depth_map.min()
    depth_max = depth_map.max()
    if depth_min == depth_max:
        # Flat depth, create single layer
        mask = np.ones_like(depth_map, dtype=bool)
        return [mask] * num_layers
    else:
        thresholds = np.linspace(depth_min, depth_max, num_layers + 1)
        masks = []
        for i in range(num_layers):
            mask = (depth_map >= thresholds[i]) & (
                depth_map < thresholds[i + 1])
            masks.append(mask.astype(bool))
        return masks


def main():
    MODEL_TYPE = "vit_h"
    CHECKPOINT_PATH = "sam_vit_h_4b8939.pth"

    print("=== Automatic Tunnel Book Generator ===")
    image_path = input("Enter image path: ").strip()

    try:
        num_layers = int(input("Enter number of layers: ").strip())
        if num_layers < 1:
            raise ValueError("Number of layers must be at least 1")
    except ValueError as e:
        print(f"Invalid number of layers: {e}")
        return

    # Load image
    img = cv2.imread(image_path)
    if img is None:
        print("Could not load image")
        return
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # Create depth map
    print("Creating depth map...")
    depth_map = create_depth_map(img_rgb)

    # Optional: Show depth map
    depth_normalized = cv2.normalize(
        depth_map, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
    plt.imshow(depth_normalized, cmap='gray')
    plt.title("Depth Map")
    plt.show()

    # Split into layers
    print(f"Splitting into {num_layers} layers...")
    layer_masks = split_depth_into_layers(depth_map, num_layers)

    # Initialize generator (even though we don't use SAM for segmentation)
    try:
        gen = TunnelBookGenerator(MODEL_TYPE, CHECKPOINT_PATH)
        gen.image_rgb = img_rgb  # Set the image
        gen.layer_masks = layer_masks
    except Exception as e:
        print(f"Failed to initialize generator: {e}")
        return

    # Detect edges
    print("Detecting edges...")
    edge_data = gen.detect_edges()

    # Export AI files
    output_base_name = image_path.rsplit(".", 1)[0] + "_automatic"
    print(f"Exporting AI files to {output_base_name}...")
    gen.export_ai_files(output_base_name, edge_data)

    print("Done!")


if __name__ == "__main__":
    main()
