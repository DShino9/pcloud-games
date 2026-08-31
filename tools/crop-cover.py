#!/usr/bin/env python3
"""箱の写真から、箱だけを四角く切り出す。

    python3 tools/crop-cover.py --check     切るとどうなるか見るだけ（並べた頁を作る）
    python3 tools/crop-cover.py             切る（元は covers-orig/ に残る）
    python3 tools/crop-cover.py --undo      元に戻す

**なぜ要るか。** まとめ場に無い本の箱絵は、売り買いの場の写真しか無い。
机や布や畳が一緒に写っていて、棚に並べると絵の大きさも位置もばらばらに見える。

**やり方。** 縁の色を「背景」と見なし、そこから離れた画素の広がりを箱と見る。
外れ画素に引っ張られないよう、**両端2%は切り捨てて**から囲む。
切っても減りが小さいとき（もともと箱が画面いっぱい）や、
細長くなりすぎるときは**触らない**。下手に切るより、そのままのほうが良い。
"""
import json, shutil, sys
from pathlib import Path
import numpy as np
from scipy import ndimage
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
COVERS = HERE / "covers"
ORIG = HERE / "covers-orig"
WIDTH = 320                      # 棚に置く幅（build-catalog.py と揃える）


def box_of(im):
    """箱のある四角を返す。見つからなければ None。

       **行と列の合計では取れない。** 明るい背景や写り込みに負けて、
       箱の一部しか掴めなかった（最初はそれで55枚中10枚以上を切り損ねた）。
       **一続きの塊として捉えて、いちばん大きいものを箱と見る。**"""
    long_side = 260
    if im.width >= im.height:
        size = (long_side, max(1, round(long_side * im.height / im.width)))
    else:
        size = (max(1, round(long_side * im.width / im.height)), long_side)
    small = im.convert("RGB").resize(size)
    a = np.asarray(small).astype(np.int16)
    h, w = a.shape[:2]
    if h < 40 or w < 40:
        return None

    # 縁を背景と見なす。四辺の細い帯の中央値を取る。
    edge = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3),
                           a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    d = np.abs(a - bg).sum(axis=2)

    best = None
    # しきい値は1つに決めきれない（白い机・木目・黒い布で最適が違う）。
    # 何通りか試して、いちばん「箱らしい」塊を採る。
    for q in (55, 70, 82):
        thr = max(36, float(np.percentile(d, q)))
        m = d > thr
        if m.mean() < 0.03 or m.mean() > 0.98:
            continue
        # 小さな穴を埋めてから塊に分ける。文字や絵柄で箱が割れないように。
        m = ndimage.binary_closing(m, np.ones((5, 5)))
        m = ndimage.binary_fill_holes(m)
        lab, cnt = ndimage.label(m)
        if not cnt:
            continue
        sizes = ndimage.sum(m, lab, range(1, cnt + 1))
        # **いちばん大きい塊が箱とは限らない。** 売り買いの写真は、
        # 箱・ディスク・説明書を机に広げて撮ってあることが多い。
        # 全部が一続きになると「机の上ぜんぶ」を切ってしまう（最初はそうなった）。
        # 大きい順に幾つか見て、**四角くて・大きくて・色が濃い**ものを箱と見る。
        for i in np.argsort(sizes)[::-1][:6] + 1:
            i = int(i)
            ys, xs = np.where(lab == i)
            y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
            aw, ah = x1 - x0 + 1, y1 - y0 + 1
            area = (aw * ah) / (w * h)
            if area < 0.07 or aw < w * 0.12 or ah < h * 0.12:
                continue
            ar = aw / ah
            if not 0.45 <= ar <= 2.1:
                continue
            fill = sizes[i - 1] / (aw * ah)      # 囲みの中がどれだけ埋まっているか
            if fill < 0.55:
                continue
            # 箱は刷り物なので色が濃い。説明書（白）やディスク（黒）と分かれる。
            sub = a[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
            mx = sub.max(axis=2); mn = sub.min(axis=2)
            sat = float(np.mean((mx - mn) / np.maximum(mx, 1)))
            sc = (fill ** 1.5) * (0.30 + area) * (0.45 + sat)
            if not best or sc > best[0]:
                best = (sc, x0, y0, x1, y1)

    if not best:
        return None
    _, x0, y0, x1, y1 = best
    pad = 0.012
    x0 = max(0, x0 - int(w * pad)); x1 = min(w - 1, x1 + int(w * pad))
    y0 = max(0, y0 - int(h * pad)); y1 = min(h - 1, y1 + int(h * pad))
    sx, sy = im.width / w, im.height / h
    return (int(x0 * sx), int(y0 * sy), int((x1 + 1) * sx), int((y1 + 1) * sy))


def judge(im, b):
    """切ってよいか。**減らないなら触らない。細長くなるなら触らない。**"""
    if not b:
        return False
    x0, y0, x1, y1 = b
    aw, ah = x1 - x0, y1 - y0
    if aw < 60 or ah < 60:
        return False
    if (aw * ah) / (im.width * im.height) > 0.88:      # ほとんど減らない
        return False
    ar = aw / ah
    return 0.45 <= ar <= 2.0


def main():
    check = "--check" in sys.argv
    undo = "--undo" in sys.argv
    ORIG.mkdir(exist_ok=True)

    if undo:
        n = 0
        for f in ORIG.glob("*.jpg"):
            shutil.copy2(f, COVERS / f.name); n += 1
        print(f"戻した {n} 枚")
        return

    # **写真から取ったものだけ切る。** まとめ場（libretro・openvgdb）の箱絵は
    # もともと綺麗に切り出されているので、触ると角を削るだけ損。
    want = set()
    for cat, key in (("pc98.json", "titles"), ("games.json", "games")):
        for t in json.loads((HERE / cat).read_text(encoding="utf-8"))[key]:
            if t.get("cover") and t.get("csrc") == "検索":
                want.add(Path(t["cover"]).name)
    print(f"写真から取った箱絵 {len(want)} 枚が対象")

    rows, cut, keep = [], 0, 0
    for f in sorted(COVERS.glob("*.jpg")):
        if f.name not in want:
            continue
        src = ORIG / f.name if (ORIG / f.name).exists() else f
        try:
            im = Image.open(src)
            im.load()
        except Exception:
            continue
        b = box_of(im)
        ok = judge(im, b)
        if not ok:
            keep += 1
            continue
        cut += 1
        if check:
            rows.append((f.name, src, b, im.size))
            continue
        if not (ORIG / f.name).exists():
            shutil.copy2(f, ORIG / f.name)
        out = im.convert("RGB").crop(b)
        if out.width > WIDTH:
            out = out.resize((WIDTH, round(out.height * WIDTH / out.width)), Image.LANCZOS)
        out.save(f, "JPEG", quality=86)

    print(f"切る {cut} 枚 / そのまま {keep} 枚")
    if check and rows:
        cells = "".join(
            f'<figure><div class=p style="background-image:url(covers-orig/{n2}),url(covers/{n2})">'
            f'<i style="left:{b[0]/s[0]*100:.1f}%;top:{b[1]/s[1]*100:.1f}%;'
            f'width:{(b[2]-b[0])/s[0]*100:.1f}%;height:{(b[3]-b[1])/s[1]*100:.1f}%"></i></div>'
            f'<figcaption>{n2}</figcaption></figure>' for n2, _, b, s in rows[:48])
        (HERE / "_sheet.html").write_text(f"""<!doctype html><meta charset=utf-8>
<style>body{{background:#111;color:#eee;font:11px sans-serif;margin:6px}}
main{{display:grid;grid-template-columns:repeat(8,1fr);gap:5px}}
figure{{margin:0;text-align:center}}
.p{{position:relative;width:100%;padding-top:100%;background-size:contain;
   background-repeat:no-repeat;background-position:center}}
i{{position:absolute;border:2px solid #4ade80}}</style>
<h4 style="margin:2px">切る所（緑の枠）{len(rows)}枚</h4>
<main>{cells}</main>""", encoding="utf-8")
        print("並べた: _sheet.html")


if __name__ == "__main__":
    main()
