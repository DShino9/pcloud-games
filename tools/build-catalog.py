#!/usr/bin/env python3
"""OpenEmu の台帳からゲーム棚の games.json と箱絵を起こす。

OpenEmu の Library.storedata（Core Data の SQLite）には、題名・機種・遊んだ回数・
箱絵の在処まで入っている。棚の見た目はここから起こせるので、集め直さない。

  python3 tools/build-catalog.py            # 全機種
  python3 tools/build-catalog.py Famicom "Super Famicom"
"""
import json, os, re, shutil, sqlite3, subprocess, sys, unicodedata
from pathlib import Path
from urllib.parse import unquote

OE   = Path.home() / "Library/Application Support/OpenEmu/Game Library"
DB   = OE / "Library.storedata"
ROMS = OE / "roms"
ART  = OE / "Artwork"
HERE = Path(__file__).resolve().parent.parent
OUT  = HERE / "games.json"
COVERS = HERE / "covers"

# ブラウザでどのコアを使うか。無い機種は棚に並ぶだけ。
CORES = {
    "Famicom":       "fceumm",
    "Super Famicom": "snes9x",
    "Nintendo 64":   "mupen64plus_next",
    "Nintendo DS":   "melonds",
    "Sony PSP":      None,
}
SHORT = {
    "Famicom": "FC", "Super Famicom": "SFC", "Nintendo 64": "N64",
    "Nintendo DS": "DS", "Sony PSP": "PSP",
}

COVER_W = 320   # 棚に並べる幅。元は 600〜1200px あって重い


def norm(s):
    """NFD と NFC の食い違いで取りこぼさないため、突き合わせは必ずここを通す。"""
    return unicodedata.normalize("NFC", s or "")


def rom_index():
    """棚の実物。NFC に正規化した相対パス → 実ファイル。"""
    idx = {}
    for p in ROMS.rglob("*"):
        if p.is_file() and not p.name.startswith("."):
            idx[norm(str(p.relative_to(ROMS)))] = p
    return idx


def shrink(src, dst):
    """sips は macOS に最初から入っている。幅だけ決めて縦は成り行き。"""
    subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "78",
         "--resampleWidth", str(COVER_W), str(src), "--out", str(dst)],
        check=True, capture_output=True)


def main():
    want = [norm(a) for a in sys.argv[1:]]
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute("""
        select g.Z_PK pk, g.ZNAME name, g.ZGAMETITLE title, g.ZRATING rating,
               g.ZGAMEDESCRIPTION note, s.ZLASTLOCALIZEDNAME sys,
               r.ZLOCATION loc, r.ZFILESIZE size, r.ZPLAYCOUNT plays,
               r.ZLASTPLAYED last, r.ZCRC32 crc, r.ZMD5 md5,
               i.ZRELATIVEPATH art, ge.ZNAME genre
          from ZGAME g
          left join ZSYSTEM s on s.Z_PK = g.ZSYSTEM
          left join ZROM    r on r.ZGAME = g.Z_PK
          left join ZIMAGE  i on i.Z_PK  = g.ZBOXIMAGE
          left join ZGENRE ge on ge.ZGAMES = g.Z_PK
         order by s.ZLASTLOCALIZEDNAME, g.ZNAME
    """).fetchall()

    disk = rom_index()
    COVERS.mkdir(exist_ok=True)
    games, missing, no_art = [], [], 0

    for r in rows:
        sysname = norm(r["sys"])
        if want and sysname not in want:
            continue
        if not r["loc"]:
            missing.append((sysname, r["name"], "台帳に在処が無い"))
            continue

        rel = norm(unquote(r["loc"]))
        f = disk.get(rel)
        if f is None:
            missing.append((sysname, r["name"], f"棚に実物が無い: {rel}"))
            continue

        gid = f"{SHORT.get(sysname, sysname)}-{r['pk']}"

        cover = None
        if r["art"]:
            src = ART / r["art"]
            if src.exists():
                dst = COVERS / f"{gid}.jpg"
                try:
                    shrink(src, dst)
                    cover = f"covers/{gid}.jpg"
                except subprocess.CalledProcessError:
                    shutil.copy2(src, dst)      # 縮められなければ素のまま
                    cover = f"covers/{gid}.jpg"
        if not cover:
            no_art += 1

        games.append({
            "id":     gid,
            "name":   norm(r["name"]) or f.stem,      # 日本語の題名
            "title":  norm(r["title"]) or None,       # 英語の題名（検索用）
            "system": sysname,
            "short":  SHORT.get(sysname, sysname),
            "core":   CORES.get(sysname),
            "file":   f.name,                          # pCloud 側でもこの名前
            "path":   rel,
            "ext":    f.suffix.lower().lstrip("."),
            "bytes":  f.stat().st_size,
            "genre":  norm(r["genre"]) or None,
            "plays":  r["plays"] or 0,
            "rating": r["rating"] or 0,
            "md5":    (r["md5"] or "").lower() or None,
            "cover":  cover,
        })

    by_sys = {}
    for g in games:
        by_sys.setdefault(g["system"], 0)
        by_sys[g["system"]] += 1

    OUT.write_text(json.dumps({
        "note": "OpenEmu の台帳から起こした。作り直すには tools/build-catalog.py",
        "systems": [
            {"name": s, "short": SHORT.get(s, s), "core": CORES.get(s), "count": n}
            for s, n in sorted(by_sys.items())
        ],
        "games": games,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"棚に入れた: {len(games)} 本")
    for s, n in sorted(by_sys.items()):
        print(f"  {s}: {n}")
    print(f"箱絵なし: {no_art} 本")
    if missing:
        print(f"\n取りこぼし {len(missing)} 件:")
        for s, n, why in missing[:20]:
            print(f"  [{s}] {n} — {why}")


if __name__ == "__main__":
    main()
