#!/usr/bin/env python3
"""倉庫（/EMU）を API で歩いて、ファイルの台帳を作る。

    python3 tools/scan-emu.py            → emu-files.json（name/path/fileid/size）

**マウントは使わない**（固まる）。**recursive も頼まない**（この倉庫は断る）。
1階ずつ listfolder で降りる。棚のフォルダ（/ゲーム棚）は見ない —— 倉庫だけ。
"""
import json, ssl, sys, time, unicodedata, urllib.request
from pathlib import Path
from urllib.parse import urlencode

TOKEN = Path.home() / ".config/pcloud-games/token"
CTX = ssl.create_default_context()
OUT = Path(__file__).resolve().parent.parent / "emu-files.json"


def api(host, auth, method, **p):
    url = f"https://{host}/{method}?" + urlencode({"auth": auth, **p})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60, context=CTX) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def main():
    t = json.load(open(TOKEN))
    host, auth = t["host"], t["auth"]

    # /EMU の folderid を根の一覧から取る（path 指定は NFD 名で外れることがある）
    root = api(host, auth, "listfolder", folderid=0)
    emu = next((c for c in root["metadata"]["contents"]
                if unicodedata.normalize("NFC", c.get("name", "")) == "EMU"
                and c.get("isfolder")), None)
    if not emu:
        sys.exit("倉庫 /EMU が見つからない")

    # ROM の無い区画は歩かない（エミュレータはアプリの束＝フォルダの塊で、
    # 降りると何百部屋も空回りする）
    SKIP = {"エミュレータ", "BIOS", "資料", "System Volume Information"}

    files = []
    queue = [(emu["folderid"], "/EMU")]
    folders = 0
    while queue:
        fid, path = queue.pop()
        j = api(host, auth, "listfolder", folderid=fid)
        folders += 1
        for c in j.get("metadata", {}).get("contents", []):
            name = unicodedata.normalize("NFC", c.get("name", ""))
            if c.get("isfolder"):
                if path == "/EMU" and name in SKIP:
                    continue
                if name.endswith(".app"):
                    continue
                queue.append((c["folderid"], path + "/" + name))
            else:
                files.append({"name": name, "path": path,
                              "fileid": c["fileid"], "size": c.get("size", 0)})
        if folders % 100 == 0:
            print(f"{folders} 部屋 / {len(files)} ファイル", flush=True)
        time.sleep(0.05)  # 置き場に優しく

    OUT.write_text(json.dumps({"歩いた": time.strftime("%Y-%m-%dT%H:%M:%S"),
                               "部屋": folders, "本数": len(files),
                               "files": files}, ensure_ascii=False))
    print(f"終わり: {folders} 部屋 / {len(files)} ファイル → {OUT}")


if __name__ == "__main__":
    main()
