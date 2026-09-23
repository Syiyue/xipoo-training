# -*- coding: utf-8 -*-
"""生成 AI 录入课程的参考示意图（一次性工具脚本）
仿 eBridge 周课表截图 + OCR 识别标注风格，供用户在上传截图前参考。"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = 'assets/schedule'
os.makedirs(OUT, exist_ok=True)

YAHEI_BD = 'C:/Windows/Fonts/msyhbd.ttc'
YAHEI = 'C:/Windows/Fonts/msyh.ttc'

GREEN = (38, 166, 65)
BLUE = (41, 128, 210)
RED = (220, 60, 60)
GRID = (210, 210, 210)
TEXT = (51, 51, 51)
BLOCK_BG = (175, 165, 235)   # 课程块填充紫
BLOCK_BG2 = (150, 205, 230)  # 课程块填充蓝

W, H = 1080, 640
img = Image.new('RGB', (W, H), (255, 255, 255))
d = ImageDraw.Draw(img)

f_head = ImageFont.truetype(YAHEI_BD, 26)
f_cell = ImageFont.truetype(YAHEI_BD, 20)
f_small = ImageFont.truetype(YAHEI, 17)
f_legend = ImageFont.truetype(YAHEI_BD, 24)
f_legend_sm = ImageFont.truetype(YAHEI, 19)

# ---------- 左侧：迷你周课表 ----------
GX, GY = 30, 70          # 网格原点
TIME_W = 64              # 时间列宽
COL_W = 92               # 每天列宽
ROW_H = 46               # 每半小时行高
ROWS = 11                # 09:00 - 19:30
DAYS = ['一', '二', '三', '四', '五', '六', '日']

d.text((GX, 24), 'eBridge 周课表截图（示例）', font=f_head, fill=TEXT)

# 表头
for i, day in enumerate(DAYS):
    x = GX + TIME_W + i * COL_W
    d.rectangle([x, GY, x + COL_W, GY + ROW_H], outline=GRID)
    bbox = d.textbbox((0, 0), day, font=f_cell)
    d.text((x + (COL_W - bbox[2] + bbox[0]) / 2, GY + 10), day, font=f_cell, fill=TEXT)
# 时间列
for r in range(ROWS):
    y = GY + ROW_H * (r + 1)
    label = '%02d:00' % (9 + r // 2) if r % 2 == 0 else '%02d:30' % (9 + r // 2)
    d.rectangle([GX, y, GX + TIME_W, y + ROW_H], outline=GRID)
    d.text((GX + 6, y + 12), label, font=f_small, fill=(120, 120, 120))
# 空网格
for i in range(len(DAYS)):
    for r in range(ROWS):
        x = GX + TIME_W + i * COL_W
        y = GY + ROW_H * (r + 1)
        d.rectangle([x, y, x + COL_W, y + ROW_H], outline=GRID)

def block(day_idx, row, span, title, sub, border, bg):
    x = GX + TIME_W + day_idx * COL_W + 3
    y = GY + ROW_H * (row + 1) + 3
    w = COL_W - 6
    h = ROW_H * span - 6
    d.rectangle([x, y, x + w, y + h], fill=bg, outline=border, width=4)
    d.text((x + 6, y + 5), title, font=f_small, fill=(40, 40, 80))
    d.text((x + 6, y + 26), sub, font=f_small, fill=(40, 40, 80))

# 课程块：绿=识别成功，蓝=教室待定，红=需确认
block(0, 0, 4, 'MTH019', 'Lecture D1/09', GREEN, BLOCK_BG)       # 周一 09:00-10:50
block(1, 4, 4, 'EAP041', 'SIP-FB-281', GREEN, BLOCK_BG2)         # 周二 13:00-14:50
block(2, 2, 4, 'CCT011', 'SIP-SB-123', GREEN, BLOCK_BG)          # 周三 11:00-12:50
block(3, 6, 4, 'FIN001', '教室 TBD', BLUE, BLOCK_BG2)            # 周四 15:00-16:50
block(4, 0, 4, 'TH007', 'SIP-FBG95', GREEN, BLOCK_BG)            # 周五 09:00-10:50
block(1, 16 // 2, 3, 'XPU001', '时间需确认', RED, BLOCK_BG)      # 周二 19:20 起

# ---------- 右侧：识别结果图例 ----------
LX = GX + TIME_W + COL_W * 7 + 40
d.text((LX, 24), 'AI 识别结果图例', font=f_head, fill=TEXT)

legend = [
    (GREEN, '绿色 = 识别成功'),
    (BLUE, '蓝色 = 教室待定'),
    (RED, '红色 = 需人工确认'),
]
ly = 80
for color, label in legend:
    d.rectangle([LX, ly, LX + 34, ly + 24], outline=color, width=4, fill=(245, 245, 250))
    d.text((LX + 48, ly - 2), label, font=f_legend_sm, fill=TEXT)
    ly += 44

tips = [
    '拍摄/截图建议：',
    '· 使用 eBridge 周视图完整截图',
    '· 课程名称、时间、地点清晰可见',
    '· 包含周一至周日整周与时间轴',
    '· 图片端正、无遮挡、不模糊',
]
ty = ly + 16
for i, line in enumerate(tips):
    d.text((LX, ty), line, font=f_legend_sm if i else f_legend, fill=TEXT)
    ty += 34

img.save(os.path.join(OUT, 'ai-import-sample.png'))
print('generated:', os.path.join(OUT, 'ai-import-sample.png'), img.size)
