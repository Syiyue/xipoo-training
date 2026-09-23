# -*- coding: utf-8 -*-
"""生成 PAI空间 品牌 Logo 与门面横幅（一次性工具脚本）"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

OUT = 'assets/publishers'
os.makedirs(OUT, exist_ok=True)

VIOLET = (124, 92, 191)  # #7c5cbf 品牌紫
DEEP = (56, 36, 102)

ARIAL_BD = 'C:/Windows/Fonts/arialbd.ttf'
YAHEI_BD = 'C:/Windows/Fonts/msyhbd.ttc'
YAHEI = 'C:/Windows/Fonts/msyh.ttc'

# ---------- Logo：紫底圆角方块 + 白色 AI ----------
S = 512
logo = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(logo)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=120, fill=VIOLET + (255,))
font = ImageFont.truetype(ARIAL_BD, 260)
bbox = d.textbbox((0, 0), 'AI', font=font)
w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((S - w) / 2 - bbox[0], (S - h) / 2 - bbox[1] - 10), 'AI', font=font, fill=(255, 255, 255, 255))
logo.save(os.path.join(OUT, 'paispace-logo.png'))

# ---------- 门面横幅：深紫渐变 + 二进制数字纹理 + 品牌名 ----------
W, H = 1200, 675
base = Image.new('RGB', (W, H), VIOLET)
dd = ImageDraw.Draw(base)
for y in range(H):
    t = y / H
    dd.line([(0, y), (W, y)], fill=tuple(int(DEEP[c] + (VIOLET[c] - DEEP[c]) * t) for c in range(3)))

overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
od = ImageDraw.Draw(overlay)

# 散落的 0/1 二进制位，营造“数据洪流”的纹理
random.seed(7)
digits = '01101001011000010110100101110011'
small = ImageFont.truetype(ARIAL_BD, 34)
for i in range(110):
    od.text((random.randint(-10, W - 20), random.randint(0, H - 30)),
            digits[i % len(digits)], font=small, fill=(255, 255, 255, 24))

# 右侧大号 AI 水印
big = ImageFont.truetype(ARIAL_BD, 430)
od.text((W - 560, H - 500), 'AI', font=big, fill=(255, 255, 255, 28))

# 品牌名与副标题
name_font = ImageFont.truetype(YAHEI_BD, 130)
od.text((80, H // 2 - 150), 'PAI空间', font=name_font, fill=(255, 255, 255, 255))
sub_font = ImageFont.truetype(YAHEI, 42)
od.text((86, H // 2 + 16), '人工智能创新社区 · PAI SPACE', font=sub_font, fill=(255, 255, 255, 215))

cover = Image.alpha_composite(base.convert('RGBA'), overlay).convert('RGB')
cover.save(os.path.join(OUT, 'paispace-cover.png'))
print('generated:', [f for f in os.listdir(OUT) if 'paispace' in f])
