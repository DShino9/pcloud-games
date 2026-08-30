#!/usr/bin/env python3
"""PC-98 のディスクイメージを、棚に出せる形にまとめる。

RetroArch の np2kai フォルダは 282 枚が平置きで、
  ・複数枚組（_A/_B、 1/ 2、#1、ﾃﾞｨｽｸ1、Disk 1 of 2、DATA1…）
  ・道具ディスク（MS-DOS・N88BASIC・ATOK・一太郎…）
  ・同じ題の別リップ（三国志Ⅱ と 三國志2 など）
が混ざっている。1枚1本として並べると棚にならないので、題名で束ねる。

  python3 tools/build-pc98-catalog.py            # pc98.json を書く
  python3 tools/build-pc98-catalog.py --show     # 束ね方を確かめる（書かない）
"""
import json, re, sys, unicodedata
from pathlib import Path

SRC = Path.home() / "Documents/RetroArch/system/np2kai/PC98 select"
OUT = Path(__file__).resolve().parent.parent / "pc98.json"

FD  = {".fdi", ".fdd", ".d88", ".d98", ".hdm", ".xdf", ".dup", ".2hd", ".tfd", ".flp", ".bkdsk"}
HDD = {".thd", ".hdi", ".nhd", ".hdd", ".sln", ".vhd"}

# 遊ぶものではないもの。棚では「道具」として別の棚に置く。
TOOL_WORDS = [
    "MS-DOS", "MSDOS", "N88BASIC", "N88-BASIC", "ATOK", "一太郎", "まいとーく",
    "BLANK", "FD+LHA", "FD232", "editdisk", "anex86", "TADL", "Prg", "Dat",
    "HDD DOS", "HD ", "保存用",
]
# 遊ぶものに付いてくる、単体では起動しない札
SAVE_WORDS = ["セーブ", "SAVE", "Save", "ﾕｰｻﾞｰ", "ユーザー", "User", "user", "USER"]

# 「三国志Ⅱ」と「三國志2」のような別のリップは、混ぜない。
# 混ぜると A・A・B・B と並んで、どちらの組で起動すべきか分からなくなる。
# 同じ題が二度出るほうが正直で、遊ぶときに困らない。

# 枚数の札。長いものから順に当てる。(正規表現, 並び順の取り出し方)
DISK_PATTERNS = [
    (re.compile(r"[\s_(（]*\(?Disk\s*(\d+)\s*of\s*\d+\)?.*$", re.I), lambda m: int(m.group(1))),
    (re.compile(r"[\s_]*ﾃﾞｨｽｸ\s*(\d+)\s*$"),                      lambda m: int(m.group(1))),
    (re.compile(r"[\s_]*ディスク\s*(\d+)\s*$"),                     lambda m: int(m.group(1))),
    (re.compile(r"[\s_]*#\s*(\d+)\s*$"),                          lambda m: int(m.group(1))),
    (re.compile(r"[\s_]*(?:DATA|DISC|DISK)\s*(\d+)\s*$", re.I),   lambda m: int(m.group(1))),
    (re.compile(r"[\s_]+(\d{1,2})\s*$"),                          lambda m: int(m.group(1))),
    (re.compile(r"[\s_]+([A-H])\s*$"),                            lambda m: ord(m.group(1).upper()) - 64),
    (re.compile(r"_([A-H])\s*$"),                                 lambda m: ord(m.group(1).upper()) - 64),
    (re.compile(r"(?<=[^A-Za-z])([A-H])\s*$"),                    lambda m: ord(m.group(1).upper()) - 64),
]
# 役割の札（枚数ではないが、その1枚が何かを表す）
ROLE_PATTERNS = re.compile(
    r"[\s_　]*\(?("
    r"ﾏｽﾀｰﾌﾟﾛｸﾞﾗﾑ(?:ﾃﾞｨｽｸ)?|MasterProgram|マスタープログラム|"
    r"ﾌﾟﾛｸﾞﾗﾑﾃﾞｨｽｸ|ﾌﾟﾛｸﾞﾗﾑ|プログラムディスク|プログラム|Program|PROG|pro|"
    r"ｹﾞｰﾑﾃﾞｨｽｸ\s*\d*|ゲームディスク\s*\d*|GAME\s*\d*|"
    r"ｼｽﾃﾑ|システム|SYSTEM|SYS|"
    r"ｼﾅﾘｵ\s*\d*|シナリオ\s*\d*|ｴﾝﾄﾞ|ENDING|Opening|ope|OP|"
    r"ｺｰｽﾃﾞｨｽｸ|ﾃﾞｰﾀﾃﾞｨｽｸ|ﾃﾞｰﾀ|データ|DATA|dat|"
    r"ﾕｰｻﾞｰﾃﾞｨｽｸ|ﾕｰｻﾞｰ|ユーザー|User|USER|"
    r"セーブディスク|セーブ|Save|SAVE|辞書.*|ﾌｫﾝﾄ|起動|保存用.*"
    r")\s*\)?\s*$", re.I)

# 役割の札の後ろに (ﾃﾞｨｽｸ1) のように枚数が括弧で付くことがある。先に外す。
PAREN_DISK = re.compile(r"[\s_　]*[(（]\s*(?:ﾃﾞｨｽｸ|ディスク|Disk|DISC)\s*(\d+)\s*[)）]\s*$", re.I)

# 起動する1枚の選び方。小さいほど先。
BOOT_RANK = [
    (1, ["ﾏｽﾀｰﾌﾟﾛｸﾞﾗﾑ", "MasterProgram", "マスタープログラム", "起動"]),
    (2, ["ｼｽﾃﾑ", "システム", "SYSTEM", "SYS"]),
    (3, ["ﾌﾟﾛｸﾞﾗﾑ", "プログラム", "Program", "PROG", "pro"]),
    (4, ["ｹﾞｰﾑﾃﾞｨｽｸ", "ゲームディスク", "GAME"]),
    (8, ["Opening", "ope", "OP", "ｼﾅﾘｵ", "シナリオ"]),
    (9, ["ﾃﾞｰﾀ", "データ", "DATA", "dat", "ｺｰｽﾃﾞｨｽｸ"]),
    (10, ["ｴﾝﾄﾞ", "ENDING"]),
    (20, SAVE_WORDS),
]


def boot_rank(d):
    """起動に使えそうな順。札が無ければ 5（並び順で決める）。"""
    lab = (d["label"] or "")
    if not lab:
        return (5, d["order"] if d["order"] is not None else 99)
    for rank, words in BOOT_RANK:
        for w in words:
            if w.lower() in lab.lower():
                return (rank, d["order"] if d["order"] is not None else 0)
    return (5, d["order"] if d["order"] is not None else 99)


def demojibake(name):
    """Shift-JIS の名前が別の文字集合で読まれて壊れているものを戻す。
       戻せなければ元のまま返す（無理に直さない）。"""
    try:
        fixed = name.encode("cp1252", errors="strict").decode("cp932", errors="strict")
    except Exception:
        return name
    # 戻した結果が日本語として通っていそうなら採る
    ok = sum(1 for c in fixed if "\u3040" <= c <= "\u30ff" or "\u4e00" <= c <= "\u9fff")
    return fixed if ok >= max(2, len(fixed) // 3) else name


def nfc(s):
    """macOS のファイル名は NFD。見せるときも比べるときも NFC に揃える。
       揃えないと「セーブ」で始まるかどうかの判定すら通らない（実際に踏んだ）。"""
    return unicodedata.normalize("NFC", s or "")


def garbled(s):
    """元の名前が失われて読めなくなっているもの。直せないので、そう印を付ける。"""
    return sum(1 for c in s if 0x80 <= ord(c) < 0x2000) >= max(3, len(s) // 3)


def key_of(s):
    """束ねるための鍵。表示には使わない。"""
    k = unicodedata.normalize("NFKC", s)
    k = re.sub(r"[\s　_\-–—・.,'\"()（）\[\]【】]", "", k)
    return k.lower()


def split_disk(stem):
    """題名 と 枚の札 に割る。返り値 (題名, 並び順 or None, 札)"""
    # 「ﾌﾟﾛｸﾞﾗﾑﾃﾞｨｽｸ(ﾃﾞｨｽｸ1)」のように、札の後ろに括弧で枚数が付くことがある
    paren = PAREN_DISK.search(stem)
    pnum = None
    if paren and len(stem) - len(paren.group(0)) >= 2:
        pnum = int(paren.group(1))
        stem = stem[: paren.start()].rstrip(" 　_-")

    # まず役割の札（プログラム／データ／ユーザー…）
    m = ROLE_PATTERNS.search(stem)
    role = None
    if m and len(stem) - len(m.group(0)) >= 2:
        role = m.group(1)
        stem2 = stem[: m.start()].rstrip(" 　_-")
        # 役割の札の前にさらに枚数があることがある（ブランディッシュ２ ﾃﾞｨｽｸ1 など）
        for pat, num in DISK_PATTERNS:
            m2 = pat.search(stem2)
            if m2 and len(stem2) - len(m2.group(0)) >= 2:
                return stem2[: m2.start()].rstrip(" 　_-"), num(m2), (str(num(m2)) + " " + role)
        return stem2, pnum, (role if pnum is None else f"{pnum} {role}")
    for pat, num in DISK_PATTERNS:
        m = pat.search(stem)
        if m and len(stem) - len(m.group(0)) >= 2:
            return stem[: m.start()].rstrip(" 　_-"), num(m), m.group(0).strip(" 　_-")
    return stem, pnum, (None if pnum is None else str(pnum))


def kind_of(name):
    for w in TOOL_WORDS:
        if w.lower() in name.lower():
            return "tool"
    return "game"


def main():
    show = "--show" in sys.argv
    if not SRC.exists():
        raise SystemExit(f"ディスクの置き場がありません: {SRC}")

    disks = []
    for p in sorted(SRC.rglob("*")):
        if not p.is_file() or p.name.startswith("."):
            continue
        ext = p.suffix.lower()
        if ext not in FD and ext not in HDD:
            continue
        rel = p.relative_to(SRC)
        # np21/ は上の階層とほぼ同じものの写し。二重に並べない。
        dup_folder = rel.parts[0] == "np21" if len(rel.parts) > 1 else False
        title, order, label = split_disk(nfc(p.stem))
        disks.append({
            "file": p.name, "path": str(rel), "bytes": p.stat().st_size,
            "ext": ext.lstrip("."), "hdd": ext in HDD,
            "title": title, "order": order, "label": nfc(label) if label else None,
            "key": key_of(title), "dup": dup_folder,
        })

    groups = {}
    for d in disks:
        if d["dup"]:
            continue
        groups.setdefault(d["key"], []).append(d)

    out = []
    for i, (k, ds) in enumerate(sorted(groups.items(), key=lambda kv: kv[0]), 1):
        ds.sort(key=lambda d: (d["order"] is None, d["order"] or 0, d["file"]))
        # 表示名は、いちばん短い題名を採る（余計な札が付いていないもの）
        name = nfc(demojibake(min((d["title"] for d in ds), key=len)))
        kind = kind_of(name)
        if kind == "game" and name.startswith(("セーブ", "SAVE", "Save")):
            kind = "save"
        # 中身がセーブ／ユーザーディスクだけの本は、遊ぶものではない。
        # 「三国志2セーブディスク」が題名だけ「三国志2」になって遊べる本に見えていた。
        if kind == "game" and ds and all(
                any(w in (d["label"] or "") for w in SAVE_WORDS) for d in ds):
            kind = "save"
            name = name + "（セーブディスク）"
        # 起動する1枚: マスタープログラム → システム → プログラム → ゲームディスク の順。
        # セーブ・ユーザーディスクは最後（単体では起動しない）。
        boot = min(ds, key=boot_rank)
        out.append({
            "id": f"PC98-{i:04d}",
            "name": name,
            "kind": kind,
            "hdd": any(d["hdd"] for d in ds),
            "garbled": garbled(name),
            "count": len(ds),
            "bytes": sum(d["bytes"] for d in ds),
            "boot": boot["file"],
            "disks": [{"file": d["file"], "path": d["path"], "bytes": d["bytes"],
                       "label": d["label"], "hdd": d["hdd"]} for d in ds],
        })

    out.sort(key=lambda e: (e["kind"] != "game", e["name"]))

    games = [e for e in out if e["kind"] == "game"]
    tools = [e for e in out if e["kind"] != "game"]
    bad   = [e for e in out if e["garbled"]]
    skipped = sum(1 for d in disks if d["dup"])
    print(f"ディスク {len(disks)} 枚（うち np21/ の写し {skipped} 枚は除外）")
    print(f"→ 遊ぶもの {len(games)} 本 / 道具 {len(tools)} 本  計 {len(out)}")
    print(f"   複数枚組 {sum(1 for e in out if e['count'] > 1)} 本")
    if bad:
        print(f"   名前が壊れていて読めない {len(bad)} 本: " +
              "、".join(e["disks"][0]["file"] for e in bad))

    if show:
        for e in out:
            mark = {"game": "🎮", "tool": "🔧", "save": "💾"}.get(e["kind"], "・")
            print(f"\n{mark} {e['name']}  [{e['count']}枚 {e['bytes']/1e6:.1f}MB]"
                  f"{' HDD' if e['hdd'] else ''}")
            for d in e["disks"]:
                star = "▶" if d["file"] == e["boot"] else " "
                print(f"   {star} {d['file']}   ({d['label'] or '—'})")
        return

    OUT.write_text(json.dumps({
        "note": "RetroArch の np2kai フォルダから起こした。作り直すには tools/build-pc98-catalog.py",
        "source": str(SRC),
        "titles": out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"書いた: {OUT.name}")


if __name__ == "__main__":
    main()
