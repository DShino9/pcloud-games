#!/usr/bin/env python3
"""棚に無い箱絵 6,846 本を、**正しい順**で探して当てる（#79）。

    python3 tools/cover-hunt.py --hash   [--only 機種] [--limit N]
        ① ハッシュ照合。pCloud の checksumfile（頭の無い機種は落とさずに済む）、
           FC/SFC だけ中身を落として頭を外して md5 → openvgdb →
           No-Intro の名前 → libretro の箱絵。**ジャンルも同時に取れる。**
    python3 tools/cover-hunt.py --search [--only 機種] [--limit N]
        ② 題名照合つきの画像検索（DuckDuckGo の JSON）。
           **絵だけ見て選ばない** —— 結果に付く題名と本の名前を突き合わせる。
    python3 tools/cover-hunt.py --pics   [--limit N]
        ③ 最後の手段（本人の指定）: 倉庫の同じフォルダの絵（PC-98 など）。
    python3 tools/cover-hunt.py --report

結果: covers-found/<id>.jpg と covers-found/found.json（台帳。何度でも再開できる）。
台帳には id のほかに (機種, 先頭ファイル名) も書く —— id は #75 で
fileid に替わる予定なので、名前でも突き合わせられるようにしておく。
"""
import importlib.util, json, hashlib, os, random, re, sqlite3, ssl, sys, time
import unicodedata, urllib.request
from pathlib import Path
from urllib.parse import urlencode, quote

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
OUT = BASE / "covers-found"
LEDGER = OUT / "found.json"
TOKEN = Path.home() / ".config/pcloud-games/token"
VG = Path.home() / "Library/Application Support/OpenEmu/openvgdb.sqlite"
CTX = ssl.create_default_context()

# fetch-covers.py の道具を使い回す（検索・突き合わせ・縮小は実績のある実装）
spec = importlib.util.spec_from_file_location("fc", HERE / "fetch-covers.py")
fc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fc)
fc.load_pc98_alias()

# openvgdb の systemID。FDS は頭16バイト、NES も16。ほかは頭なし。
SYSID = {
    "Famicom": (25, 18), "Super Famicom": (26,), "PCエンジン": (14, 17),
    "メガドライブ": (33,), "ゲームギア": (30,), "ゲームボーイアドバンス": (20,),
    "Nintendo DS": (24,), "Nintendo 64": (23,), "MSX": (42, 43),
}
# libretro のサムネイル置き場（fetch-covers の表に機種を足した版）
LR = dict(fc.LR)
LR.update({
    "PCエンジン":  "NEC_-_PC_Engine_-_TurboGrafx_16",
    "メガドライブ": "Sega_-_Mega_Drive_-_Genesis",
    "ゲームギア":   "Sega_-_Game_Gear",
    "ゲームボーイアドバンス": "Nintendo_-_Game_Boy_Advance",
    "MSX":        "Microsoft_-_MSX",
})
# 画像検索に添える機種の言い方（箱の写真に寄せる）
SYSWORD = {
    "PC-98": "PC-9801 パッケージ", "Famicom": "ファミコン パッケージ",
    "Super Famicom": "スーパーファミコン パッケージ", "PCエンジン": "PCエンジン パッケージ",
    "メガドライブ": "メガドライブ パッケージ", "ゲームギア": "ゲームギア パッケージ",
    "ゲームボーイアドバンス": "ゲームボーイアドバンス パッケージ",
    "Nintendo DS": "ニンテンドーDS パッケージ", "Nintendo 64": "NINTENDO64 パッケージ",
    "MSX": "MSX パッケージ",
}
NFC = lambda s: unicodedata.normalize("NFC", s or "")


def papi(method, **p):
    t = json.load(open(TOKEN))
    url = f"https://{t['host']}/{method}?" + urlencode({"auth": t["auth"], **p})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90, context=CTX) as r:
                return json.loads(r.read().decode())
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def dl(fileid):
    j = papi("getfilelink", fileid=fileid)
    url = "https://" + j["hosts"][0] + j["path"]
    with urllib.request.urlopen(url, timeout=180, context=CTX) as r:
        return r.read()


def load():
    shelf = json.load(open(BASE / "棚.json"))["本"]
    emu = json.load(open(BASE / "emu-files.json"))["files"]
    byname = {}
    for f in emu:
        byname.setdefault(NFC(f["name"]), []).append(f)
    led = json.load(open(LEDGER)) if LEDGER.exists() else {}
    OUT.mkdir(exist_ok=True)
    return shelf, emu, byname, led


def save(led):
    LEDGER.write_text(json.dumps(led, ensure_ascii=False, indent=1))


def targets(shelf, led, only, limit):
    out = [g for g in shelf if not g.get("cover") and g["id"] not in led
           and (not only or g["system"] == only)]
    return out[:limit] if limit else out


def md5_of(f):
    """中身の md5。頭が要らないものは checksumfile（落とさない）。"""
    ext = Path(f["name"]).suffix.lower()
    headered = ext in (".nes", ".fds") or \
        (ext in (".smc", ".swc", ".fig") and f["size"] % 1024 == 512)
    if not headered:
        j = papi("checksumfile", fileid=f["fileid"])
        return (j.get("md5") or "").upper() or None
    b = dl(f["fileid"])
    if b[:4] in (b"NES\x1a", b"FDS\x1a"):
        b = b[16:]
    elif len(b) % 1024 == 512:
        b = b[512:]
    return hashlib.md5(b).hexdigest().upper()


def vg_lookup(db, md5, sysids):
    q = """SELECT r.releaseTitleName, r.releaseGenre, r.releaseCoverFront,
                  r.TEMPregionLocalizedName, ro.romFileName
           FROM ROMs ro JOIN RELEASES r ON r.romID = ro.romID
           WHERE upper(ro.romHashMD5) = ? AND ro.systemID IN (%s)""" % \
        ",".join("?" * len(sysids))
    rows = db.execute(q, (md5, *sysids)).fetchall()
    if not rows:
        return None
    rows.sort(key=lambda r: 0 if "Japan" in (r[3] or "") else 1)
    return rows[0]


def put_cover(gid, raw):
    tmp = OUT / "_tmp.img"
    tmp.write_bytes(raw)
    if not fc.looks_like_box(tmp):
        tmp.unlink(missing_ok=True)
        return False
    dst = OUT / (safe_id(gid) + ".jpg")
    fc.shrink(tmp, dst)
    tmp.unlink(missing_ok=True)
    return True


def safe_id(gid):
    return re.sub(r'[\\/:*?"<>|]', "_", gid)


def lr_cover(system, name):
    """libretro の絵の名前は **No-Intro のファイル名**（`(Japan)` 付き）。
       題名（releaseTitleName）では当たらない —— romFileName の拡張子抜きを渡す。
       使えない字は `_` に置く決まり。"""
    repo = LR.get(system)
    if not repo or not name:
        return None
    fn = re.sub(r'[&*/:`<>?\\|"]', "_", name)
    url = ("https://raw.githubusercontent.com/libretro-thumbnails/" + repo +
           "/master/Named_Boxarts/" + quote(fn) + ".png")
    try:
        return fc.fetch(url, timeout=30)
    except Exception:
        return None


def stage_hash(only, limit):
    shelf, emu, byname, led = load()
    db = sqlite3.connect(VG)
    todo = [g for g in targets(shelf, led, only, limit) if g["system"] in SYSID]
    print(f"ハッシュ照合: {len(todo)} 本", flush=True)
    hit = miss = 0
    for i, g in enumerate(todo):
        cands = byname.get(NFC(g["files"][0]), [])[:3]
        row = None
        for f in cands:
            try:
                m = md5_of(f)
            except Exception as e:
                print(f"  読めない {g['name']}: {e}", flush=True)
                continue
            if m:
                row = vg_lookup(db, m, SYSID[g["system"]])
            if row:
                break
        if not row:
            miss += 1
            led[g["id"]] = {"name": g["name"], "sys": g["system"],
                            "file": g["files"][0], "method": "hash-miss"}
        else:
            name, genre, coverfront, region, nifile = row
            stem = re.sub(r"\.[^.]+$", "", nifile or "")
            raw = lr_cover(g["system"], stem) or lr_cover(g["system"], name)
            src = "libretro"
            if raw is None and coverfront:
                try:
                    raw = fc.fetch(coverfront, timeout=30)
                    src = "openvgdb"
                except Exception:
                    raw = None
            ok = bool(raw) and put_cover(g["id"], raw)
            hit += 1
            led[g["id"]] = {"name": g["name"], "sys": g["system"],
                            "file": g["files"][0], "method": "hash",
                            "nointro": name, "nifile": nifile or "",
                            "genre": genre or "",
                            "img": src if ok else ""}
        if (i + 1) % 20 == 0:
            save(led)
            print(f"  {i+1}/{len(todo)}  当たり {hit} / 外れ {miss}", flush=True)
        time.sleep(0.12)
    save(led)
    print(f"ハッシュ照合 終わり: 当たり {hit} / 外れ {miss}", flush=True)


def stage_search(only, limit):
    """②画像検索。**題名の突き合わせを通ったものだけ**採る。"""
    shelf, emu, byname, led = load()
    # ハッシュで外れたもの・ハッシュの道が無い機種（PC-98 など）が対象
    todo = []
    for g in shelf:
        if g.get("cover") or (only and g["system"] != only):
            continue
        e = led.get(g["id"])
        if e and e.get("method") not in ("hash-miss", "search-miss"):
            continue
        if e is None and g["system"] in SYSID:
            continue          # まずハッシュを試すべき機種は飛ばす
        todo.append(g)
    if limit:
        todo = todo[:limit]
    print(f"画像検索: {len(todo)} 本", flush=True)
    hit = 0
    BOXNAMES = {"pc98 disk", "pc98 hdd", "fdd", "select", "collection", "pc98"}
    for i, g in enumerate(todo):
        # PC-98 の名前はディスクのファイル名由来（3goku2 など）で検索に当たらない。
        # **フォルダ名が題名**（【PC98】天下統一）なので、そちらを使う。
        disp = g["name"]
        if g["system"] == "PC-98":
            for f in byname.get(NFC(g["files"][0]), []):
                seg = f["path"].rsplit("/", 1)[-1]
                m = re.sub(r"^【[^】]*】", "", seg).strip()
                if "【" in seg or (m.lower() not in BOXNAMES
                                  and re.search(r"[぀-ヿ一-鿿]", m)):
                    disp = m
                    break
        q = fc.search_name(fc.clean_title(disp)) + " " + SYSWORD.get(g["system"], "パッケージ")
        got = False
        for url, title, w, h in fc.img_search(q, want=20):
            if not fc.title_ok(fc.clean_title(disp), title):
                continue
            try:
                raw = fc.fetch(url, timeout=30)
            except Exception:
                continue
            if put_cover(g["id"], raw):
                led[g["id"]] = {"name": g["name"], "title": disp,
                                "sys": g["system"],
                                "file": g["files"][0], "method": "search",
                                "q": q, "src": url[:120], "img": "search"}
                hit += 1
                got = True
                break
        if not got:
            led[g["id"]] = {"name": g["name"], "sys": g["system"],
                            "file": g["files"][0], "method": "search-miss"}
        if (i + 1) % 10 == 0:
            save(led)
            print(f"  {i+1}/{len(todo)}  当たり {hit}", flush=True)
        time.sleep(fc.SEARCH_WAIT + random.random())
    save(led)
    print(f"画像検索 終わり: 当たり {hit} / {len(todo)}", flush=True)


def stage_pics(limit):
    """③最後の手段: 倉庫の同じフォルダの絵。"""
    shelf, emu, byname, led = load()
    imgs = {}
    for f in emu:
        if re.search(r"\.(jpe?g|png|gif|webp|bmp)$", f["name"], re.I):
            imgs.setdefault(f["path"], []).append(f)
    todo = []
    for g in shelf:
        e = led.get(g["id"])
        if g.get("cover") or not e or e.get("img"):
            continue
        if e.get("method") not in ("hash-miss", "search-miss"):
            continue
        todo.append(g)
    if limit:
        todo = todo[:limit]
    print(f"倉庫の絵（最後の手段）: {len(todo)} 本", flush=True)
    hit = 0
    for g in todo:
        cands = byname.get(NFC(g["files"][0]), [])
        for f in cands:
            pics = sorted(imgs.get(f["path"], []), key=lambda x: x["name"])
            if not pics:
                continue
            try:
                raw = dl(pics[0]["fileid"])
            except Exception:
                continue
            if put_cover(g["id"], raw):
                led[g["id"]].update({"method": "倉庫の絵", "img": "倉庫",
                                     "pic": f["path"] + "/" + pics[0]["name"]})
                hit += 1
            break
        time.sleep(0.1)
    save(led)
    print(f"倉庫の絵 終わり: 当たり {hit} / {len(todo)}", flush=True)


def stage_fiximg(limit):
    """当たったのに絵が付かなかったもの（題名で libretro を引いていた頃の分）を、
       No-Intro のファイル名で引き直す。"""
    shelf, emu, byname, led = load()
    db = sqlite3.connect(VG)
    todo = [(gid, e) for gid, e in led.items()
            if e.get("method") == "hash" and not e.get("img")]
    if limit:
        todo = todo[:limit]
    print(f"絵の引き直し: {len(todo)} 本", flush=True)
    hit = 0
    for i, (gid, e) in enumerate(todo):
        stems = [re.sub(r"\.[^.]+$", "", e["nifile"])] if e.get("nifile") else []
        if not stems:
            sysids = SYSID.get(e["sys"], ())
            if sysids:
                q = """SELECT ro.romFileName FROM ROMs ro
                       JOIN RELEASES r ON r.romID = ro.romID
                       WHERE r.releaseTitleName = ? AND ro.systemID IN (%s)
                       LIMIT 4""" % ",".join("?" * len(sysids))
                stems = [re.sub(r"\.[^.]+$", "", r[0] or "")
                         for r in db.execute(q, (e.get("nointro", ""), *sysids))]
        raw = None
        for st in stems:
            raw = lr_cover(e["sys"], st)
            if raw:
                break
        if raw and put_cover(gid, raw):
            e["img"] = "libretro"
            hit += 1
        if (i + 1) % 25 == 0:
            save(led)
            print(f"  {i+1}/{len(todo)}  付いた {hit}", flush=True)
        time.sleep(0.15)
    save(led)
    print(f"絵の引き直し 終わり: 付いた {hit} / {len(todo)}", flush=True)


def report():
    shelf, emu, byname, led = load()
    from collections import Counter
    c = Counter(e.get("method") for e in led.values())
    got = sum(1 for e in led.values() if e.get("img"))
    print("台帳:", dict(c))
    print(f"絵が付いた: {got} / 調べた {len(led)} / 絵なし全体 {sum(1 for g in shelf if not g.get('cover'))}")


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    if "--fiximg" in sys.argv:
        stage_fiximg(limit)
    elif "--hash" in sys.argv:
        stage_hash(only, limit)
    elif "--search" in sys.argv:
        stage_search(only, limit)
    elif "--pics" in sys.argv:
        stage_pics(limit)
    else:
        report()
