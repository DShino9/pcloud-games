#!/usr/bin/env python3
"""大捜索で拾った箱絵のうち、**写真のもの**（画像検索・倉庫の絵）を四角く起こす。

    python3 tools/crop-found.py

まとめ場（libretro・openvgdb）から来た絵は切らない（もともと綺麗）。
やり方は tools/crop-cover.py と同じ（塊で掴む → 角が取れれば起こす）。
元は covers-found-orig/ に残る。本人の指定「斜めの写真は四角形に切り出して」。
"""
import importlib.util, json, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
FOUND = BASE / "covers-found"
ORIG = BASE / "covers-found-orig"
WIDTH = 320

spec = importlib.util.spec_from_file_location("cc", HERE / "crop-cover.py")
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)


def main():
    led = json.loads((FOUND / "found.json").read_text(encoding="utf-8"))
    ORIG.mkdir(exist_ok=True)
    import re
    safe = lambda gid: re.sub(r'[\\/:*?"<>|]', "_", gid)
    want = {safe(gid) + ".jpg" for gid, e in led.items()
            if e.get("img") in ("search", "倉庫")}
    print(f"写真の箱絵 {len(want)} 枚が対象")
    cut = keep = skew = 0
    for f in sorted(FOUND.glob("*.jpg")):
        if f.name not in want:
            continue
        src = ORIG / f.name if (ORIG / f.name).exists() else f
        try:
            im = Image.open(src)
            im.load()
        except Exception:
            continue
        r = cc.mask_of(im)
        b = cc.box_of(im)
        if not cc.judge(im, b):
            keep += 1
            continue
        cut += 1
        if not (ORIG / f.name).exists():
            shutil.copy2(f, ORIG / f.name)
        out = None
        if r:
            mask, (sx, sy), _ = r
            q = cc.quad_of(mask)
            if q is None:
                q = cc.min_rect(mask)
            if q is not None:
                q = q * np.array([sx, sy])
                if cc.worth_deskew(im, q, b):
                    out = cc.deskew(im, q)
                    if out is not None:
                        skew += 1
        if out is None:
            out = im.convert("RGB").crop(b)
        if out.width > WIDTH:
            out = out.resize((WIDTH, round(out.height * WIDTH / out.width)), Image.LANCZOS)
        out.save(f, "JPEG", quality=86)
    print(f"切る {cut} 枚（うち起こした {skew} 枚）/ そのまま {keep} 枚")


if __name__ == "__main__":
    main()
