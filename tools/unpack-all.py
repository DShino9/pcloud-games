#!/usr/bin/env python3
"""PC-98 の圧縮の本を**一括で起こす**（#82・本人の指定「最初に一気に展開しよう。
元の圧縮フォルダは別途退避させて」）。

    python3 tools/unpack-all.py [--limit N] [--dry]

やること（1本ずつ・再開可能）:
  1. 倉庫から圧縮（rar/zip/lzh）を落とす
  2. bsdtar で展開（駄目なら lsar —— rar5 と lzh はこちらが読める）
  3. ディスクの像だけを `PC98 Disk/<メーカー>/<題名>/` に上げる（1本=1フォルダ）
  4. 元の圧縮を `/EMU/その他/圧縮退避/<メーカー>/` へ**サーバー側で移す**（消さない）

対象は複製区画（PC98 Collection）を除く 2,849 本・13.4GB。
台帳 covers-found/unpacked.json に1本ずつ記録し、途中で止めても続きから。
展開に失敗した本は圧縮を**動かさず**、記録だけ残す。
終わったら scan-emu → build-ledger → push-covers を回すこと（unpack-chain.sh）。
"""
import json, os, re, shutil, ssl, subprocess, sys, tempfile, time, unicodedata, urllib.request, uuid
from pathlib import Path
from urllib.parse import urlencode

BASE = Path(__file__).resolve().parent.parent
TOKEN = Path.home() / ".config/pcloud-games/token"
LEDGER = BASE / "covers-found" / "unpacked.json"
CTX = ssl.create_default_context()
NFC = lambda s: unicodedata.normalize("NFC", s or "")
DISK = re.compile(r"\.(fdi|fdd|hdm|tfd|xdf|dup|2hd|d88|d98|88d|nfd|hdi|thd|nhd|vhd|slh|hdd|dip|dcp|dcu|dd6|dd9|hd4|hd5|hdb|fim|flp)$", re.I)
FMT = re.compile(r"\s*[([]\s*(FDI|FDD|HDM|HDI|DCP|DCU|DIP|D88|2HD|NFD|XDF|TFD|VHD|SLH|HDD|THD|NHD|88D|D98|FILES?)[^)\]]*[)\]]\s*$", re.I)
SAFE = lambda n: re.sub(r'[\\/:*?"<>|]', "_", n).strip()[:90] or "名無し"


def api(method, **p):
    t = json.load(open(TOKEN))
    url = f"https://{t['host']}/{method}?" + urlencode({"auth": t["auth"], **p})
    for a in range(3):
        try:
            with urllib.request.urlopen(url, timeout=180, context=CTX) as r:
                j = json.loads(r.read().decode())
            if j.get("result") != 0:
                raise RuntimeError(f"{method}: {j.get('result')} {j.get('error','')}")
            return j
        except Exception:
            if a == 2:
                raise
            time.sleep(2 * (a + 1))


def upload(folderid, name, path):
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; "
            f'name="file"; filename="{NFC(name)}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n").encode() \
        + Path(path).read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    t = json.load(open(TOKEN))
    url = f"https://{t['host']}/uploadfile?" + urlencode(
        {"auth": t["auth"], "folderid": folderid, "renameifexists": 0, "nopartial": 1})
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=600, context=CTX) as r:
        j = json.loads(r.read().decode())
    if j.get("result") != 0 or not j.get("metadata"):
        raise RuntimeError(f"uploadfile: {j.get('result')} {j.get('error','')}")
    return j["metadata"][0]["fileid"]


FID_CACHE = {}


def folder_id(path):
    """/EMU/… の道から folderid。1階ずつ（recursive は断られる）。無ければ作る。"""
    if path in FID_CACHE:
        return FID_CACHE[path]
    parts = [p for p in path.split("/") if p]
    fid = 0
    cur = ""
    for seg in parts:
        cur += "/" + seg
        if cur in FID_CACHE:
            fid = FID_CACHE[cur]
            continue
        j = api("listfolder", folderid=fid, nofiles=1)
        hit = next((c for c in j["metadata"].get("contents", [])
                    if c.get("isfolder") and NFC(c["name"]) == NFC(seg)), None)
        if hit:
            fid = hit["folderid"]
        else:
            fid = api("createfolderifnotexists", folderid=fid, name=seg)["metadata"]["folderid"]
        FID_CACHE[cur] = fid
    return fid


def extract(arc_path, outdir):
    """bsdtar → 駄目なら lsar。展開できたディスクの像の一覧を返す。"""
    r = subprocess.run(["bsdtar", "-xf", arc_path, "-C", outdir],
                       capture_output=True, timeout=300)
    if r.returncode != 0:
        # rar5 と lzh は bsdtar が読めないことがある。unar（The Unarchiver）で救済。
        # **必ず空にしてから。** bsdtar が途中まで出した上に重ねると
        # `-1` 付きの複製が混ざる（実際に3本でやらかした）。
        shutil.rmtree(outdir, ignore_errors=True)
        os.makedirs(outdir, exist_ok=True)
        subprocess.run(["unar", "-q", "-D", "-o", outdir, arc_path],
                       capture_output=True, timeout=300)
    disks = []
    for root, _, names in os.walk(outdir):
        for n in names:
            if DISK.search(n):
                disks.append(Path(root) / n)
    return disks


def main():
    dry = "--dry" in sys.argv
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    emu = json.load(open(BASE / "emu-files.json"))["files"]
    led = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else {}
    retry = "--retry" in sys.argv     # 駄目だった分をもう一度（拡張子を増やした後など）
    targets = [f for f in emu
               if "/PC98 Disk/" in f["path"] and "PC98 Collection" not in f["path"]
               and re.search(r"\.(rar|zip|lzh)$", f["name"], re.I)
               and (str(f["fileid"]) not in led
                    or (retry and led[str(f["fileid"])].get("status") == "fail"))]
    if limit:
        targets = targets[:limit]
    print(f"起こす対象: {len(targets)} 本（済 {len(led)}）", flush=True)
    if dry:
        return
    done = fail = 0
    for i, f in enumerate(targets):
        key = str(f["fileid"])
        maker = f["path"].split("/PC98 Disk/")[1].split("/")[0] if "/PC98 Disk/" in f["path"] else ""
        title = SAFE(FMT.sub("", re.sub(r"\.[^.]+$", "", f["name"])).split(" - ")[0].strip()
                     or re.sub(r"\.[^.]+$", "", f["name"]))
        try:
            j = api("getfilelink", fileid=f["fileid"])
            url = "https://" + j["hosts"][0] + j["path"]
            with tempfile.TemporaryDirectory() as td:
                arc = Path(td) / ("a" + Path(f["name"]).suffix.lower())
                with urllib.request.urlopen(url, timeout=600, context=CTX) as r2, open(arc, "wb") as w:
                    shutil.copyfileobj(r2, w)
                out = Path(td) / "out"
                out.mkdir()
                disks = extract(str(arc), str(out))
                if not disks:
                    raise RuntimeError("中にディスクの像が無い（または展開できない）")
                disks.sort(key=lambda p: p.name)
                dest = folder_id(f["path"] + "/" + title)
                names, fids = [], []
                for d in disks:
                    fids.append(upload(dest, d.name, d))
                    names.append(NFC(d.name))
            # 元の圧縮を退避（サーバー側移動・一瞬）
            park = folder_id("/EMU/その他/圧縮退避/" + maker)
            api("renamefile", fileid=f["fileid"], tofolderid=park)
            led[key] = {"name": f["name"], "maker": maker, "title": title,
                        "dir": f["path"] + "/" + title, "disks": names,
                        "fids": fids, "status": "ok"}
            done += 1
        except Exception as e:
            led[key] = {"name": f["name"], "maker": maker, "title": title,
                        "status": "fail", "err": str(e)[:160]}
            fail += 1
        if (i + 1) % 10 == 0:
            LEDGER.write_text(json.dumps(led, ensure_ascii=False))
            print(f"  {i+1}/{len(targets)}  起こした {done}／駄目 {fail}", flush=True)
        time.sleep(0.2)
    LEDGER.write_text(json.dumps(led, ensure_ascii=False))
    print(f"終わり: 起こした {done}／駄目 {fail}", flush=True)


if __name__ == "__main__":
    main()
