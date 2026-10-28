from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
(root / 'build').mkdir(exist_ok=True)
image = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((5, 5, 251, 251), radius=58, fill='#9c7857')
cream = '#fff7e5'
draw.line([(61, 75), (84, 71), (108, 80), (128, 95), (148, 80), (172, 71), (195, 75), (195, 183), (172, 180), (148, 187), (128, 201), (108, 187), (84, 180), (61, 183), (61, 75)], fill=cream, width=9, joint='curve')
draw.line((128, 95, 128, 201), fill=cream, width=8)
for points in [((81, 109), (107, 118)), ((81, 137), (107, 146)), ((149, 118), (175, 109)), ((149, 146), (175, 137))]:
    draw.line(points, fill=cream, width=6)
image.save(root / 'build' / 'icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(root / 'build' / 'icon.png')
