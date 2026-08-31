#!/usr/bin/env python3
"""機種のロゴを取ってきて、白抜きに揃える。

    python3 tools/fetch-logos.py

**なぜ白抜きにするか。** ロゴは赤・黒・多色とばらばらで、そのまま暗い札に
載せると読めるものと読めないものが出る。**形だけ borrow して色は棚が決める**
ことにすれば、6機種が同じ調子で並ぶ。

出どころはウィキメディアの共有置き場（Commons）。取ってきた元の名前は
`logos/出どころ.txt` に残す。
"""
import json, time, urllib.request as u
from pathlib import Path
from urllib.parse import quote
from PIL import Image
import io

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / "logos"
UA = "pcloud-games/1.0 (personal shelf)"

# 棚での呼び名 → Commons のファイル名
LOGOS = {
    "FC":  "Family Computer logo.svg",
    "SFC": "Nintendo Super Famicom logo.svg",
    "N64": "Nintendo 64 wordmark.svg",
    "DS":  "Nintendo DS Logo.svg",
    "PSP": "PSP Logo.svg",
    # PC-98 のロゴは「PC-98」では出てこない。**"PC9800" で引くと出る。**
    "98":  "PC9800 logo 1982.svg",
}
WIDTH = 240          # 取ってくる大きさ。札では小さく出すが、拡大に耐えるように


def fetch(name, tries=3):
    """続けて叩くと 429 で断られる（実際に PSP で断られた）。間を空けて、駄目なら待ち直す。"""
    for i in range(tries):
        try:
            return _get(name)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(4 * (i + 1))


def _get(name):
    url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + quote(name) + f"?width={WIDTH}"
    with u.urlopen(u.Request(url, headers={"User-Agent": UA}), timeout=40) as r:
        return r.read()


def whiten(data):
    """色を捨てて形だけ残す。

       **地が付いている絵は、明暗のどちらを抜くか見てから決める。**
       PSP のロゴは黒地に白抜きで、白くするだけだと真っ白の板になった。
       四隅を見て、地が明るければ暗いところを、地が暗ければ明るいところを残す。"""
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    px = im.load()
    w, h = im.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    solid = all(c[3] > 200 for c in corners)
    bright = sum((c[0] + c[1] + c[2]) / 3 for c in corners) / 4 > 128
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if solid and a > 0:
                lum = (r * 299 + g * 587 + b * 114) // 1000
                a = max(0, 255 - lum) if bright else min(255, lum)
            px[x, y] = (255, 255, 255, a)
    return im


def main():
    OUT.mkdir(exist_ok=True)
    note = []
    for short, name in LOGOS.items():
        try:
            im = whiten(fetch(name))
        except Exception as e:
            print(f"  取れない: {short} ({name}) {e}")
            continue
        im.save(OUT / f"{short}.png")
        time.sleep(2)
        note.append(f"{short}\t{name}\thttps://commons.wikimedia.org/wiki/File:{quote(name)}")
        print(f"  取れた: {short}  {im.size[0]}x{im.size[1]}  ← {name}")
    (OUT / "出どころ.txt").write_text(
        "機種のロゴの出どころ。ウィキメディアの共有置き場（Commons）から。\n"
        "白抜きに直してあるので、元の色は残っていない。\n"
        + "\n".join(note) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
