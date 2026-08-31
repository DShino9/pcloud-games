#!/usr/bin/env python3
"""詰め合わせの箱絵を、中身の絵を重ねて作る。

    python3 tools/pack-cover.py

**なぜ要るか。** 「ブランディッシュ1.2.3詰め合わせ」のような寄せ集めには、
そういう箱が世の中に無い。探しても出てこないので、**中身の絵から作る**。

重ね方は、棚に並べたとき「3本入り」だと一目で分かる形にする。
左から少しずつずらして重ね、右のものほど手前に。
"""
import json, re
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
W, H = 320, 320          # 棚の枠に合わせる

# 詰め合わせの名前 → 中身の本の名前（左から並ぶ順）
PACKS = {
    "PC98_ブランディッシュ1.2.3詰め合わせ":
        ["ブランディッシュ", "ブランディッシュⅡ", "ブランディッシュⅢ"],
    "セーブ　PC98_ブランディッシュ1.2.3詰め合わせ":
        ["ブランディッシュ", "ブランディッシュⅡ", "ブランディッシュⅢ"],
}


def load(cat, key):
    return json.loads((HERE / cat).read_text(encoding="utf-8")), key


def make(paths, out):
    """左から少しずつずらして重ねる。右ほど手前。"""
    ims = []
    for p in paths:
        im = Image.open(HERE / p).convert("RGB")
        # 縦長の箱に揃える。はみ出す分は真ん中を残して落とす。
        th = int(H * 0.80)
        tw = int(th * 0.72)
        r = max(tw / im.width, th / im.height)
        im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
        x = (im.width - tw) // 2
        y = (im.height - th) // 2
        ims.append(im.crop((x, y, x + tw, y + th)))

    canvas = Image.new("RGB", (W, H), (16, 17, 20))
    n = len(ims)
    tw, th = ims[0].size
    # 3枚が枠に収まるよう、重なりの幅を決める
    step = (W - tw - 16) // max(1, n - 1)
    y = (H - th) // 2
    for i, im in enumerate(ims):
        x = 8 + i * step
        # 縁取りを付けて、重なりの境目が分かるように
        edge = Image.new("RGB", (im.width + 4, im.height + 4), (60, 62, 70))
        edge.paste(im, (2, 2))
        canvas.paste(edge, (x, y - 2))
    canvas.save(HERE / out, "JPEG", quality=88)


def main():
    made = 0
    for cat, key in (("pc98.json", "titles"), ("games.json", "games")):
        j = json.loads((HERE / cat).read_text(encoding="utf-8"))
        by = {t["name"]: t for t in j[key]}
        for name, members in PACKS.items():
            t = by.get(name)
            if not t:
                continue
            paths = [by[m]["cover"] for m in members if by.get(m, {}).get("cover")]
            if len(paths) < 2:
                print(f"  中身の絵が足りない: {name}")
                continue
            out = f"covers/{t['id']}.jpg"
            make(paths, out)
            t["cover"] = out
            t["csrc"] = "合成"          # 切り出しの対象にしない
            made += 1
            print(f"  合成: {name} ← {len(paths)}本")
        (HERE / cat).write_text(json.dumps(j, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"作った {made} 枚")


if __name__ == "__main__":
    main()
