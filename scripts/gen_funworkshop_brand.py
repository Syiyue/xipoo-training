# -*- coding: utf-8 -*-
"""生成 Fun Workshop 品牌 Logo 与门面横幅（一次性工具脚本）
主题：海报同款青绿机器人风（深色底 + 青色光效）"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = 'assets/publishers'
os.makedirs(OUT, exist_ok=True)

TEAL = (23, 148, 138)      # 主色 青绿
DEEP = (11, 60, 58)        # 深青
LIGHT = (126, 232, 218)    # 浅青光

YAHEI_BD = 'C:/Windows/Fonts/msyhbd.ttc'
YAHEI = 'C:/Windows/Fonts/msyh.ttc'
ARIAL_BD = 'C:/Windows/Fonts/arialbd.ttf'

# ---------- Logo：深青圆角方块 + 机器人圆脸 ----------
S = 512
logo = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(logo)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=120, fill=DEEP + (255,))
# 机器人头
d.rounded_rectangle([116, 150, 396, 360], radius=70, fill=(240, 248, 247, 255), outline=TEAL + (255,), width=10)
# 天线
d.line([256, 96, 256, 148], fill=TEAL + (255,), width=12)
d.ellipse([240, 72, 272, 104], fill=LIGHT + (255,))
# 眼睛（青色发光）
d.rounded_rectangle([160, 210, 220, 280], radius=24, fill=TEAL + (255,))
d.rounded_rectangle([292, 210, 352, 280], radius=24, fill=TEAL + (255,))
# 微笑
d.arc([200, 270, 312, 340], start=20, end=160, fill=DEEP + (255,), width=10)
logo.save(os.path.join(OUT, 'funworkshop-logo.png'))

# ---------- 门面横幅：深青渐变 + 光斑 + 品牌名 ----------
W, H = 1200, 675
base = Image.new('RGB', (W, H), DEEP)
dd = ImageDraw.Draw(base)
for y in range(H):
    t = y / H
    dd.line([(0, y), (W, y)], fill=tuple(int(DEEP[c] + (TEAL[c] - DEEP[c]) * t * 0.7) for c in range(3)))

overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
od = ImageDraw.Draw(overlay)
# 光斑（海报同款 bokeh）
for cx, cy, r, alpha in [(1000, 120, 150, 40), (1080, 420, 90, 34), (880, 560, 60, 28), (150, 540, 110, 26)]:
    od.ellipse([cx - r, cy - r, cx + r, cy + r], fill=LIGHT + (alpha,))
# 右侧机器人水印
od.rounded_rectangle([900, 210, 1120, 420], radius=50, outline=LIGHT + (60,), width=8)
od.line([1010, 140, 1010, 208], fill=LIGHT + (60,), width=8)
od.ellipse([998, 118, 1022, 142], fill=LIGHT + (70,))
od.rounded_rectangle([940, 270, 985, 320], radius=14, fill=LIGHT + (60,))
od.rounded_rectangle([1035, 270, 1080, 320], radius=14, fill=LIGHT + (60,))

name_font = ImageFont.truetype(ARIAL_BD, 120)
od.text((70, 200), 'Fun', font=name_font, fill=(255, 122, 122, 255))
od.text((270, 200), 'Workshop', font=name_font, fill=(150, 225, 255, 255))
sub_font = ImageFont.truetype(ARIAL_BD, 54)
od.text((76, 370), 'Claw Twin Initiative', font=sub_font, fill=(255, 250, 230, 255))
zh_font = ImageFont.truetype(YAHEI, 40)
od.text((76, 460), '这个夏天，一起开发 · 探索 · 讨论', font=zh_font, fill=(220, 240, 236, 215))
zh_font2 = ImageFont.truetype(YAHEI, 32)
od.text((76, 530), 'Cozy Coffee · 太仓校区 E 栋一楼', font=zh_font2, fill=(180, 215, 208, 190))

cover = Image.alpha_composite(base.convert('RGBA'), overlay).convert('RGB')
cover.save(os.path.join(OUT, 'funworkshop-cover.png'))
print('generated:', sorted(os.listdir(OUT)))
