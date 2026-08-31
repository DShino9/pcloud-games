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
from skimage import measure, transform
from scipy.spatial import ConvexHull
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
COVERS = HERE / "covers"
ORIG = HERE / "covers-orig"
WIDTH = 320                      # 棚に置く幅（build-catalog.py と揃える）


def mask_of(im):
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
                best = (sc, x0, y0, x1, y1, lab == i)

    if not best:
        return None
    return best[5], (im.width / w, im.height / h), best[1:5]


def quad_of(mask):
    """塊の**角を4点**取る。取れなければ None。

       **四角く囲うだけでは、傾いた箱・斜めから撮った箱は直らない。**
       周りの机が残るし、箱そのものも歪んだまま。
       角が取れれば、そこから起こして（射影変換）真正面の四角にできる。"""
    cs = measure.find_contours(mask.astype(float), 0.5)
    if not cs:
        return None
    c = max(cs, key=len)
    if len(c) < 24:
        return None
    area = float(mask.sum())
    # 荒さを少しずつ上げて、4点になったところを採る
    for tol in (2, 3, 4, 6, 8, 11, 15, 20):
        q = measure.approximate_polygon(c, tolerance=tol)
        if len(q) and np.allclose(q[0], q[-1]):
            q = q[:-1]
        if len(q) != 4:
            continue
        # 角が塊とかけ離れていないか。行き過ぎ・足りなさを面積で見る。
        qa = 0.5 * abs(sum(q[i][1] * q[(i + 1) % 4][0] - q[(i + 1) % 4][1] * q[i][0]
                           for i in range(4)))
        if not 0.80 <= qa / max(area, 1) <= 1.30:
            continue
        return q[:, ::-1]                       # (行,列) → (x,y)
    return None


def min_rect(mask):
    """塊を包む**いちばん小さい「傾いた四角」**の4点を返す。

       角がぴったり4点に落ちることは稀（`approximate_polygon` では82枚中4枚しか
       取れなかった）。こちらは必ず求まるので、**傾いた箱**はこれで起きる。
       やり方は回転カリパス: 包む多角形の辺ごとに、その向きへ揃えて囲み、
       いちばん小さかった向きを採る。"""
    ys, xs = np.nonzero(mask)
    if len(xs) < 16:
        return None
    pts = np.column_stack([xs, ys]).astype(float)
    try:
        hull = pts[ConvexHull(pts).vertices]
    except Exception:
        return None
    best = None
    for i in range(len(hull)):
        e = hull[(i + 1) % len(hull)] - hull[i]
        n = np.hypot(*e)
        if n < 1e-6:
            continue
        c, s2 = e / n
        R = np.array([[c, s2], [-s2, c]])       # その辺を横向きに揃える
        r = hull @ R.T
        lo, hi = r.min(axis=0), r.max(axis=0)
        a = float((hi[0] - lo[0]) * (hi[1] - lo[1]))
        if not best or a < best[0]:
            corners = np.array([[lo[0], lo[1]], [hi[0], lo[1]],
                                [hi[0], hi[1]], [lo[0], hi[1]]])
            best = (a, corners @ R)             # 元の向きへ戻す
    return None if not best else best[1]


def order_quad(q):
    """左上・右上・右下・左下の順に並べ替える。"""
    q = np.asarray(q, dtype=float)
    s = q.sum(axis=1)
    d = np.diff(q, axis=1).ravel()
    return np.array([q[np.argmin(s)], q[np.argmin(d)], q[np.argmax(s)], q[np.argmax(d)]])


def deskew(im, q):
    """4点から真正面の四角へ起こす。**斜めに撮られた箱がまっすぐになる。**"""
    tl, tr, br, bl = order_quad(q)
    wid = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    hei = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    if wid < 60 or hei < 60:
        return None
    ar = wid / hei
    if not 0.45 <= ar <= 2.1:
        return None
    W2 = int(round(min(WIDTH, wid)))
    H2 = int(round(W2 / ar))
    dst = np.array([[0, 0], [W2, 0], [W2, H2], [0, H2]], dtype=float)
    t = transform.ProjectiveTransform()
    if not t.estimate(dst, np.array([tl, tr, br, bl], dtype=float)):
        return None
    a = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    out = transform.warp(a, t, output_shape=(H2, W2), order=1, mode="edge")
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))


def worth_deskew(im, q, b):
    """起こす値打ちがあるか。**まっすぐなものを起こすと粗くなるだけ。**
       四角の囲みに比べて、角で囲ったほうが十分小さいときだけ起こす。"""
    q = order_quad(q)
    qa = 0.5 * abs(sum(q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1]
                       for i in range(4)))
    ba = max(1.0, (b[2] - b[0]) * (b[3] - b[1]))
    return qa / ba < 0.93


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


def box_of(im):
    """四角い囲みを返す（角が取れなかったとき用）。"""
    r = mask_of(im)
    if not r:
        return None
    _, (sx, sy), (x0, y0, x1, y1) = r
    x0 = max(0, x0 - 3); y0 = max(0, y0 - 3)     # ほんの少し余白を残す
    return (int(x0 * sx), int(y0 * sy), int((x1 + 4) * sx), int((y1 + 4) * sy))


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

    rows, cut, keep, skew = [], 0, 0, 0
    for f in sorted(COVERS.glob("*.jpg")):
        if f.name not in want:
            continue
        src = ORIG / f.name if (ORIG / f.name).exists() else f
        try:
            im = Image.open(src)
            im.load()
        except Exception:
            continue
        r = mask_of(im)
        b = box_of(im)
        if not judge(im, b):
            keep += 1
            continue
        cut += 1
        if check:
            rows.append((f.name, src, b, im.size))
            continue
        if not (ORIG / f.name).exists():
            shutil.copy2(f, ORIG / f.name)

        out = None
        # まず角を4点取って起こす。取れないときだけ四角く切る。
        if r:
            mask, (sx, sy), _ = r
            # 角が4点取れればそれが一番良い（台形の歪みまで直る）。
            # 取れなければ、包むいちばん小さい傾いた四角で起こす（傾きは直る）。
            q = quad_of(mask)
            if q is None:
                q = min_rect(mask)
            if q is not None:
                q = q * np.array([sx, sy])       # 縮めた絵の座標を元の大きさへ戻す
                if worth_deskew(im, q, b):
                    out = deskew(im, q)
                    if out is not None:
                        skew += 1
        if out is None:
            out = im.convert("RGB").crop(b)
        if out.width > WIDTH:
            out = out.resize((WIDTH, round(out.height * WIDTH / out.width)), Image.LANCZOS)
        out.save(f, "JPEG", quality=86)

    print(f"切る {cut} 枚（うち起こした {skew} 枚）/ そのまま {keep} 枚")
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
