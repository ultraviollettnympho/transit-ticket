#!/usr/bin/env python3
"""Generate PWA icons for Metro Transit app."""

from PIL import Image, ImageDraw, ImageFont
import os

# Colors (Metro design)
ORANGE = (255, 107, 53)      # #FF6B35
GREEN = (124, 179, 66)       # #7CB342
WHITE = (255, 255, 255)      # #FFFFFF

def create_icon(size, is_maskable=False):
    """Create icon with optional maskable safe area."""
    img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    
    if is_maskable:
        # Maskable: center 66% is safe (corners will be hidden)
        radius = int(size * 0.33)  # Safe circle radius
    else:
        # Standard: use full circle
        radius = int(size * 0.45)
    
    center_x = size // 2
    center_y = size // 2
    
    # Draw outer orange circle
    draw.ellipse(
        [center_x - radius, center_y - radius, center_x + radius, center_y + radius],
        fill=ORANGE
    )
    
    # Draw white inner circle
    inner_radius = int(radius * 0.65)
    draw.ellipse(
        [center_x - inner_radius, center_y - inner_radius, center_x + inner_radius, center_y + inner_radius],
        fill=WHITE
    )
    
    # Draw green "M" text
    font = ImageFont.load_default()
    text = "M"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    text_x = center_x - text_width // 2 - 2
    text_y = center_y - text_height // 2 - 3
    
    draw.text((text_x, text_y), text, fill=GREEN, font=font)
    
    return img

# Create icons directory if needed
os.makedirs('icons', exist_ok=True)

# Generate all 4 icon variants
print("Generating icon-192.png...")
icon_192 = create_icon(192, is_maskable=False)
icon_192.save('icons/icon-192.png', 'PNG')

print("Generating icon-192-maskable.png...")
icon_192_maskable = create_icon(192, is_maskable=True)
icon_192_maskable.save('icons/icon-192-maskable.png', 'PNG')

print("Generating icon-512.png...")
icon_512 = create_icon(512, is_maskable=False)
icon_512.save('icons/icon-512.png', 'PNG')

print("Generating icon-512-maskable.png...")
icon_512_maskable = create_icon(512, is_maskable=True)
icon_512_maskable.save('icons/icon-512-maskable.png', 'PNG')

# Verify files
print("\n✅ Icons generated successfully!")
import subprocess
result = subprocess.run(['ls', '-lh', 'icons/'], capture_output=True, text=True)
print(result.stdout)
