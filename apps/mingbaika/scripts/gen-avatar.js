// 用 Pillow 生成明白卡小程序头像（144x144 PNG）。
// 配色取邮戳 + 米黄明信片，主体一个"明"字稳重可识别。
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PY = 'C:/Users/nihao/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
const OUT = path.join(__dirname, '..', 'docs', 'avatar.png');

const py = `
from PIL import Image, ImageDraw, ImageFont
import os, sys

SIZE = 144
OUT = ${JSON.stringify(OUT.replace(/\\/g, '\\\\'))}

# 字体：雅黑（常规 + 粗体）
font_big = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 84)
font_sub = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)

# 配色
BG = '#FCEED6'      # 暖米色
INK = '#2C2C2A'     # 接近黑的深灰
SUB = '#5F5E5A'     # 中灰
ACCENT = '#EF9F27'  # 邮戳橙

img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# 圆角矩形背景（头像预览会被切成圆形，构图在圆内）
draw.rounded_rectangle((0, 0, SIZE-1, SIZE-1), radius=26, fill=BG)

# 邮戳装饰（左上 + 右下各一个）
draw.ellipse((114, 14, 134, 34), fill=ACCENT)

# 测文字尺寸
def tw(s, f):
    b = draw.textbbox((0, 0), s, font=f)
    return b[2]-b[0], b[3]-b[1], b

# 主字"明" 居中略偏上
w, h, bb = tw('明', font_big)
x = (SIZE - w) / 2 - bb[0]
y = (SIZE - h) / 2 - 8 - bb[1]
draw.text((x, y), '明', font=font_big, fill=INK)

# 副字"白卡" 右下
w2, h2, bb2 = tw('白卡', font_sub)
draw.text((SIZE - w2 - 18 - bb2[0], SIZE - h2 - 16 - bb2[1]),
          '白卡', font=font_sub, fill=SUB)

img.save(OUT, 'PNG')
print('OK', OUT, os.path.getsize(OUT), 'bytes')
`;

try {
  const out = execFileSync(PY, ['-c', py], { encoding: 'utf8' });
  console.log(out.trim());
} catch (e) {
  console.error('失败：', e.stderr || e.message);
  process.exit(1);
}
