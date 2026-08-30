#!/usr/bin/env python3
"""ROM の中身を「どの道なら取れるか」を測る。読むだけ。何も変えない。

    python3 tools/diagnose-fetch.py

棚から小さいファイルを1つ選び、次の道を順に試して結果を並べる。
ブラウザから使えるのは「CORS が開いている」道だけなので、そこまで見る。

  1. getfilelink            … 合鍵で直リンクをもらう
  2. file_open / file_read  … api ホスト経由で中身を読む
  3. 公開リンク の符号       … getfilepublink → getpublinkdownload
  4. 出てきた配信元に Origin を付けて当てる（CORS が返るか）
"""
import json, sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from importlib import import_module
up = import_module("upload-to-pcloud".replace("-", "_")) if False else None

# upload-to-pcloud.py の sign_in をそのまま使う（同じ入り方をする）
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "up", pathlib.Path(__file__).resolve().parent / "upload-to-pcloud.py")
up = importlib.util.module_from_spec(spec)
spec.loader.exec_module(up)


def call(pc, method, **params):
    params = {k: v for k, v in params.items() if v is not None}
    params["auth"] = pc.auth
    url = f"https://{pc.host}/{method}?{urlencode(params)}"
    with urlopen(url, timeout=60) as r:
        body = r.read()
    try:
        return json.loads(body)
    except Exception:
        return {"_raw": len(body)}


def head(url, origin=None):
    req = Request(url, method="GET")
    req.add_header("Range", "bytes=0-15")
    if origin:
        req.add_header("Origin", origin)
    try:
        with urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read(16)
    except HTTPError as e:
        return e.code, dict(e.headers), b""
    except Exception as e:
        return None, {"error": str(e)}, b""


def main():
    pc = up.sign_in()
    print(f"\n入れた host={pc.host}")

    # 棚から小さいものを1つ選ぶ
    root = call(pc, "listfolder", folderid=0)
    shelf = None
    for c in root["metadata"].get("contents", []):
        if c.get("isfolder") and up.nfc(c["name"]) == "ゲーム棚":
            inner = call(pc, "listfolder", folderid=c["folderid"], recursive=1)
            files = []
            def walk(n):
                for k in n.get("contents", []):
                    walk(k) if k.get("isfolder") else files.append(k)
            walk(inner["metadata"])
            if files:
                shelf = (c["folderid"], sorted(files, key=lambda f: f.get("size", 0))[0])
                break
    if not shelf:
        raise SystemExit("ゲーム棚の中にファイルが見つかりません")
    folderid, f = shelf
    fid, name, size = f["fileid"], f["name"], f.get("size")
    print(f"試すファイル: {name}  fileid={fid}  {size} バイト\n")

    print("── 1. getfilelink（合鍵で直リンク）")
    j = call(pc, "getfilelink", fileid=fid, forcedownload=0)
    print("   ", j.get("result"), j.get("error") or "OK")
    link = None
    if j.get("result") == 0:
        link = "https://" + j["hosts"][0] + j["path"]
        print("    →", link[:70] + "…")

    print("\n── 2. file_open / file_size / file_read（api ホスト経由）")
    o = call(pc, "file_open", flags=0, fileid=fid)
    print("    file_open :", o.get("result"), o.get("error") or f"fd={o.get('fd')}")
    if o.get("result") == 0:
        sz = call(pc, "file_size", fd=o["fd"])
        print("    file_size :", sz.get("result"), sz.get("error") or f"{sz.get('size')} バイト")
        rd = call(pc, "file_read", fd=o["fd"], count=16)
        print("    file_read :", rd.get("_raw", rd.get("result")), rd.get("error") or "バイト読めた")
        call(pc, "file_close", fd=o["fd"])

    print("\n── 3. 公開リンクの符号")
    mk = call(pc, "getfilepublink", fileid=fid)
    print("    getfilepublink :", mk.get("result"), mk.get("error") or "OK")
    plink = None
    if mk.get("result") == 0:
        dl = call(pc, "getpublinkdownload", code=mk["code"])
        print("    getpublinkdownload :", dl.get("result"), dl.get("error") or "OK")
        if dl.get("result") == 0:
            plink = "https://" + dl["hosts"][0] + dl["path"]
            print("    →", plink[:70] + "…")

    print("\n── 4. 配信元に Origin を付けて当てる（CORS が返るか）")
    for label, u in [("直リンク", link), ("公開リンク", plink)]:
        if not u:
            print(f"    {label}: 取れていないので試せない")
            continue
        st, hd, body = head(u, origin="http://localhost:8790")
        acao = hd.get("Access-Control-Allow-Origin") or hd.get("access-control-allow-origin")
        print(f"    {label}: status={st} CORS={acao or 'なし'} 先頭={body[:8].hex() or '—'}")

    print("\n読み方: CORS が『*』なら、その道はブラウザから中継所なしで使える。")


if __name__ == "__main__":
    main()
