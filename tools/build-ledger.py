#!/usr/bin/env python3
"""「いま見直す」の代行。アプリの走査（scanAll＋learnFrom）と**同じ規則**で
台帳を組み、倉庫の `/ゲーム棚/_台帳/台帳.json` に上げる。

    python3 tools/build-ledger.py          組んで上げる
    python3 tools/build-ledger.py --dry    組んで数を見るだけ

端末は開いたときにこれを取り込む（state2.js）ので、本人は開くだけでよい。
組む規則を app.js（learnFrom）から**丸写し**している —— 変えるときは両方。
上げる鍵は extra / files / pics / scan だけ。fdpick・ver・plays など
本人の操作の記録には触らない（無い鍵は取り込みで上書きされない）。
"""
import json, re, ssl, sys, time, unicodedata, urllib.request
from pathlib import Path
from urllib.parse import urlencode

BASE = Path(__file__).resolve().parent.parent
TOKEN = Path.home() / ".config/pcloud-games/token"
CTX = ssl.create_default_context()
NFC = lambda s: unicodedata.normalize("NFC", s or "")

# app.js の EXT_SYS と揃える（変えるときは両方）
EXT_SYS = [
    (r"\.(nes|fds|unf)$", "Famicom", "FC", "fceumm"),
    (r"\.(smc|sfc|fig|swc)$", "Super Famicom", "SFC", "snes9x"),
    (r"\.(n64|v64|z64)$", "Nintendo 64", "N64", "mupen64plus_next"),
    (r"\.nds$", "Nintendo DS", "DS", "melonds"),
    (r"\.(gbc|gb)$", "ゲームボーイ", "GB", "gambatte"),
    (r"\.gba$", "ゲームボーイアドバンス", "GBA", "mgba"),
    (r"\.(md|gen|smd)$", "メガドライブ", "MD", "genesis_plus_gx"),
    (r"\.sms$", "マスターシステム", "SMS", "genesis_plus_gx"),
    (r"\.gg$", "ゲームギア", "GG", "genesis_plus_gx"),
    (r"\.pce$", "PCエンジン", "PCE", "mednafen_pce"),
    (r"\.(ws|wsc)$", "ワンダースワン", "WS", "mednafen_wswan"),
    (r"\.(ngp|ngc)$", "ネオジオポケット", "NGP", "mednafen_ngp"),
    (r"\.vb$", "バーチャルボーイ", "VB", "beetle_vb"),
    (r"\.(fdi|fdd|hdm|tfd|xdf|dup|2hd|d88|d98|88d|nfd|hdi|thd|nhd|vhd|slh|hdd|dip|dcp|dcu|dd6|dd9|hd4|hd5|hdb|fim|flp)$",
     "PC-98", "98", None),
    (r"\.(dsk|mx1|mx2|cas)$", "MSX", "MSX", "bluemsx"),
]
def sys_of(name):
    for re_, *rest in EXT_SYS:
        if re.search(re_, name, re.I):
            return rest
    return None


def api(method, **p):
    t = json.load(open(TOKEN))
    url = f"https://{t['host']}/{method}?" + urlencode({"auth": t["auth"], **p})
    for a in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120, context=CTX) as r:
                return json.loads(r.read().decode())
        except Exception:
            if a == 2:
                raise
            time.sleep(2 * (a + 1))


def walk(folderid, path):
    """1階ずつ歩く（recursive はこの倉庫では断られる）。"""
    out = []
    queue = [(folderid, path)]
    while queue:
        fid, pp = queue.pop()
        j = api("listfolder", folderid=fid)
        for c in j.get("metadata", {}).get("contents", []):
            nm = NFC(c.get("name", ""))
            if c.get("isfolder"):
                queue.append((c["folderid"], pp + "/" + nm))
            else:
                out.append({"name": nm, "path": pp, "fileid": c["fileid"],
                            "size": c.get("size", 0)})
        time.sleep(0.04)
    return out


def main():
    dry = "--dry" in sys.argv
    emu = json.load(open(BASE / "emu-files.json"))["files"]

    # /ゲーム棚 も見る（棚に取り寄せた本の分。アプリの走査も両方見ている）
    root = api("listfolder", folderid=0)
    dana = next(c for c in root["metadata"]["contents"]
                if NFC(c.get("name", "")) == "ゲーム棚" and c.get("isfolder"))
    print("ゲーム棚 を歩いています…", flush=True)
    dfiles = walk(dana["folderid"], "/ゲーム棚")
    allf = emu + dfiles
    print(f"合わせて {len(allf)} ファイル", flush=True)

    # ---- scanAll 相当 ----
    fmap, pics, ext = {}, {}, {}
    for f in allf:
        fmap[NFC(f["name"])] = f["fileid"]
        if re.search(r"\.(jpe?g|png|gif|webp|bmp)$", f["name"], re.I):
            d = f["path"]
            if d not in pics or f["name"] < pics[d]["name"]:
                pics[d] = {"id": f["fileid"], "name": f["name"]}
        e = (re.search(r"\.([^.]{1,6})$", f["name"]) or [None, "(拡張子なし)"])[1].lower()
        ext[e] = ext.get(e, 0) + 1
    seen = [f for f in allf
            if sys_of(f["name"]) or re.search(r"\.(rar|zip|lzh)$", f["name"], re.I)]
    top = sorted(ext.items(), key=lambda x: -x[1])[:24]
    scan = {"at": time.strftime("%Y-%m-%d %H:%M"),
            "places": [f"EMU: {len(emu)}", f"ゲーム棚: {len(dfiles)}"],
            "count": len(allf),
            "ext": [{"e": e, "n": n, "拾う": bool(sys_of("x." + e))} for e, n in top]}

    # ---- learnFrom 相当 ----
    known = set()
    for cat, key, fk in (("games.json", "games", "file"), ("pc98.json", "titles", None)):
        try:
            j = json.loads((BASE / cat).read_text(encoding="utf-8"))
        except Exception:
            continue
        for t in j[key]:
            if fk:
                known.add(NFC(t[fk]))
            else:
                for d2 in t["disks"]:
                    known.add(NFC(d2["file"]))

    dir_count = {}
    for f in seen:
        if sys_of(f["name"]):
            dir_count[f["path"]] = dir_count.get(f["path"], 0) + 1

    group = {}
    DUMPDIR = re.compile(r"/(PC-?98/Collection|PC98 Collection)/", re.I)
    for f in seen:
        name, dirp = f["name"], f["path"]
        if NFC(name) in known:
            continue
        # 複製の区画は本にしない（app.js learnFrom と揃える）
        if DUMPDIR.search(dirp + "/"):
            continue
        if re.search(r"\.(rar|zip|lzh)$", name, re.I):
            if not re.search(r"PC-?98", dirp, re.I):
                continue
            akey = dirp + "|" + name
            group[akey] = {"system": "PC-98", "short": "98", "core": None,
                           "files": [name], "paths": [dirp], "fids": [f["fileid"]],
                           "base": re.sub(r"\.[^.]+$", "", name), "arc": True}
            continue
        s2 = sys_of(name)
        if not s2:
            continue
        if re.search(r"\b(bios|font|sound)\b", name, re.I):
            continue
        base = re.sub(r"\.[^.]+$", "", name)
        if s2[0] == "PC-98":
            key = dirp + "|" + re.sub(r"[ _-]?(disk)?[ _-]?[A-Da-d1-9]$", "", base, flags=re.I)
        else:
            key = dirp + "|" + base
        g = group.setdefault(key, {"system": s2[0], "short": s2[1], "core": s2[2],
                                   "files": [], "paths": [], "fids": [], "base": base})
        g["files"].append(name)
        g["paths"].append(dirp)
        g["fids"].append(f["fileid"])

    extra = []
    for key, g in group.items():
        # files を名前順に（paths/fids も同じ順で）
        order = sorted(range(len(g["files"])), key=lambda i: g["files"][i])
        for k2 in ("files", "paths", "fids"):
            g[k2] = [g[k2][i] for i in order]
        dir0 = g["paths"][0]
        tail = dir0.rsplit("/", 1)[-1]
        nice = re.sub(r"^【[^】]*】\s*", "", tail).strip()
        alone = dir_count.get(dir0, 0) == len(g["files"]) and len(g["files"]) <= 12
        name0 = nice if (alone and nice and not re.match(r"^(PC98|PC-98|disk|rom|games?)$", nice, re.I)) \
            else key.split("|")[-1]
        if g.get("arc"):
            nm2 = re.sub(r"\s*[([]\s*(FDI|FDD|HDM|HDI|DCP|DCU|DIP|D88|2HD|NFD|XDF|TFD|VHD|SLH|HDD|THD|NHD|88D|D98|FILES?)[^)\]]*[)\]]\s*$",
                         "", g["base"], flags=re.I).strip() or g["base"]
        else:
            nm2 = name0
        extra.append({"id": "X-" + key, "name": nm2, "system": g["system"],
                      "short": g["short"], "core": g["core"], "bytes": 0,
                      "files": g["files"], "paths": g["paths"], "fids": g["fids"],
                      "path": dir0, "arc": bool(g.get("arc")),
                      "sub": "圧縮のまま" if g.get("arc")
                             else (f"{len(g['files'])}枚" if len(g["files"]) > 1 else "見つけた分")})

    from collections import Counter
    c = Counter(e["system"] for e in extra)
    print("見つけた本:", len(extra), dict(c.most_common()))
    print("うち圧縮のまま:", sum(1 for e in extra if e["arc"]))
    if dry:
        return

    body = json.dumps({"書いた": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                       "端末": "Mac-builder",
                       "keys": {"extra": extra, "files": fmap, "pics": pics, "scan": scan}},
                      ensure_ascii=False)
    print(f"台帳 {round(len(body.encode())/1e6, 1)} MB を上げます…", flush=True)
    e2 = api("createfolderifnotexists", folderid=dana["folderid"], name="_台帳")
    tfid = e2["metadata"]["folderid"]
    import uuid
    boundary = uuid.uuid4().hex
    data = (f"--{boundary}\r\nContent-Disposition: form-data; "
            f'name="file"; filename="走査.json"\r\n'
            "Content-Type: application/json\r\n\r\n").encode() \
        + body.encode() + f"\r\n--{boundary}--\r\n".encode()
    t = json.load(open(TOKEN))
    url = f"https://{t['host']}/uploadfile?" + urlencode(
        {"auth": t["auth"], "folderid": tfid, "renameifexists": 0, "nopartial": 1})
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=600, context=CTX) as r:
        j = json.loads(r.read().decode())
    if j.get("result") != 0:
        raise RuntimeError(f"uploadfile: {j}")
    print("上げた: /ゲーム棚/_台帳/走査.json")


if __name__ == "__main__":
    main()
