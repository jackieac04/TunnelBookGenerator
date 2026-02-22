import cv2
import numpy as np
import torch
import matplotlib.pyplot as plt
from matplotlib.widgets import Button
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

    # Handle mouse clicks on the image.
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

        # prev layers in blue
        for i in range(self.current_layer):
            if self.layer_masks[i] is not None:
                mask = self.layer_masks[i]
                # Mix 70% original pixel color + 30% blue
                display_img[mask] = (display_img[mask] * 0.7) + \
                    (np.array([0, 0, 255]) * 0.3)

        # cur layer in green
        if self.layer_masks[self.current_layer] is not None:
            mask = self.layer_masks[self.current_layer]
            # Mix 50% original pixel color + 50% green
            display_img[mask] = (display_img[mask] * 0.5) + \
                (np.array([0, 255, 0]) * 0.5)

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
    # def save_layers(self, output_base_name):
    #     """Export each layer as a separate transparent PNG."""
    #     print("\nSaving layers...")
    #     for i, mask in enumerate(self.layer_masks):
    #         if mask is None:
    #             print(f"Skipping Layer {i + 1} (No mask generated)")
    #             continue

    #         # Create RGBA image with transparent background
    #         result = np.dstack(
    #             [self.image_rgb, np.zeros_like(mask, dtype=np.uint8)])
    #         result[:, :, 3] = mask.astype(np.uint8) * 255

    #         output_path = f"{output_base_name}_layer_{i + 1}.png"
    #         Image.fromarray(result, 'RGBA').save(output_path)
    #         print(f"-> Saved: {output_path}")


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
        generator.save_layers(output_base)

        print("\nDone! Your tunnel book layers are ready to print and cut.")

    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    main()


#  -- apoorva

# take in images with masks applied
# edge detection for each image
#  return edges of each layer

# take in edges of each layer
# convert edges to vectors
# layout on 32"x18" ai file
#  return .ai files of vectorized edge layers
