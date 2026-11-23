"""Joins PNG frames into a small looping GIF: python3 dev/frames-to-gif.py <frames-dir> <out.gif> (needs Pillow)."""
import sys, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
names = sorted(f for f in os.listdir(src) if f.endswith('.png'))
frames = []
for f in names:
    im = Image.open(os.path.join(src, f)).convert('RGB')
    im = im.resize((640, int(im.height * 640 / im.width)), Image.LANCZOS)
    frames.append(im.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
frames[0].save(out, save_all=True, append_images=frames[1:], duration=220, loop=0, optimize=True, disposal=2)
print(f'{out}: {len(frames)} frames, {os.path.getsize(out) // 1024} KB')
