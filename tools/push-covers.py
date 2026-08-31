#!/usr/bin/env python3
"""大捜索で当てた箱絵を倉庫へ上げ、索引を書く（#79 の仕上げ）。

    python3 tools/push-covers.py            上げる（済んだ分は飛ばす・再開可能）
    python3 tools/push-covers.py --dry      何を上げるか数えるだけ

置き先: /ゲーム棚/_絵/<安全な id>.jpg
索引:   /ゲーム棚/_絵/絵.json  …  {"<機種>|<先頭ファイル名>": fileid}

棚（アプリ）は runHunt の最初の段でこの索引を引く。
鍵を id でなく (機種|ファイル名) にするのは、id が #75 で fileid に
変わる予定だから（名前なら両側から引ける）。
"""
import json, re, ssl, sys, time, unicodedata, urllib.request
from pathlib import Path
from urllib.parse import urlencode

BASE = Path(__file__).resolve().parent.parent
FOUND = BASE / "covers-found"
TOKEN = Path.home() / ".config/pcloud-games/token"
CTX = ssl.create_default_context()
NFC = lambda s: unicodedata.normalize("NFC", s or "")
safe = lambda gid: re.sub(r'[\\/:*?"<>|]', "_", gid)


def api(method, data=None, **p):
    t = json.load(open(TOKEN))
    url = f"https://{t['host']}/{method}?" + urlencode({"auth": t["auth"], **p})
    req = urllib.request.Request(url, data=data)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120, context=CTX) as r:
                j = json.loads(r.read().decode())
            if j.get("result") not in (0, 2004):   # 2004 = already exists
                raise RuntimeError(f"{method}: {j.get('result')} {j.get('error','')}")
            return j
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def upload(folderid, name, path):
    import mimetypes, uuid
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; "
            f'name="file"; filename="{name}"\r\n'
            "Content-Type: image/jpeg\r\n\r\n").encode() \
        + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    t = json.load(open(TOKEN))
    url = f"https://{t['host']}/uploadfile?" + urlencode(
        {"auth": t["auth"], "folderid": folderid, "renameifexists": 0, "nopartial": 1})
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=300, context=CTX) as r:
        j = json.loads(r.read().decode())
    if j.get("result") != 0 or not j.get("metadata"):
        raise RuntimeError(f"uploadfile: {j.get('result')} {j.get('error','')}")
    return j["metadata"][0]["fileid"]


def main():
    dry = "--dry" in sys.argv
    # 既定は**ハッシュ照合の分だけ**（中身で照合済み＝間違いようがない）。
    # 検索・倉庫の絵は、本人が見本を確かめてから --all で。
    ok_img = {"libretro", "openvgdb"} if "--all" not in sys.argv \
        else {"libretro", "openvgdb", "search", "倉庫"}
    led = json.loads((FOUND / "found.json").read_text(encoding="utf-8"))
    arc = FOUND / "found-arc.json"
    if arc.exists():                     # 圧縮の本の台帳（別ファイル）も併せる
        led.update(json.loads(arc.read_text(encoding="utf-8")))

    # /ゲーム棚 → _絵 （path 指定は NFD 名で外れるので、名前を比べて降りる）
    root = api("listfolder", folderid=0)
    dana = next(c for c in root["metadata"]["contents"]
                if NFC(c.get("name", "")) == "ゲーム棚" and c.get("isfolder"))
    e = api("createfolderifnotexists", folderid=dana["folderid"], name="_絵")
    efid = e["metadata"]["folderid"]
    have = {NFC(c["name"]): c["fileid"]
            for c in api("listfolder", folderid=efid)["metadata"].get("contents", [])
            if not c.get("isfolder")}

    # 一括展開の後は、圧縮の本の鍵（PC-98|xxx.rar）を**先頭のディスク名**に読み替える
    # （起こした本の files[0] はディスク名になるため）。
    unp = {}
    upf = FOUND / "unpacked.json"
    if upf.exists():
        for v in json.loads(upf.read_text(encoding="utf-8")).values():
            if v.get("status") == "ok" and v.get("disks"):
                unp[NFC(v["name"])] = v["disks"][0]

    amap, gmap, todo = {}, {}, []
    # ジャンルは絵の有無に関係なく、ハッシュで当たった全部に付く。
    # openvgdb は英語なので、よくあるものは日本語に直す（複数はいちばん前を採る）。
    JA = {"Action": "アクション", "Adventure": "アドベンチャー",
          "Shooter": "シューティング", "Shooting": "シューティング",
          "Role-Playing": "RPG", "RPG": "RPG", "Sports": "スポーツ",
          "Racing": "レース", "Driving": "レース", "Puzzle": "パズル",
          "Strategy": "シミュレーション", "Simulation": "シミュレーション",
          "Fighting": "格闘", "Platform": "アクション", "Pinball": "ピンボール",
          "Board": "テーブル", "Trivia": "クイズ", "Education": "学習",
          "Music": "音楽", "Miscellaneous": "その他"}
    for gid, ent in led.items():
        if ent.get("method") == "hash" and ent.get("genre"):
            g = ent["genre"].split(",")[0].strip()
            gmap[ent["sys"] + "|" + NFC(ent["file"])] = JA.get(g, g)
    for gid, ent in led.items():
        if ent.get("img") not in ok_img:
            continue
        f = FOUND / (safe(gid) + ".jpg")
        if not f.exists():
            continue
        fkey = unp.get(NFC(ent["file"]), ent["file"])
        key = ent["sys"] + "|" + NFC(fkey)
        nm = safe(gid) + ".jpg"
        if NFC(nm) in have:
            amap[key] = have[NFC(nm)]
        else:
            todo.append((key, nm, f))
    print(f"上げる {len(todo)} 枚（済 {len(amap)}）")
    if dry:
        return
    for i, (key, nm, f) in enumerate(todo):
        try:
            amap[key] = upload(efid, nm, f)
        except Exception as ex:
            print(f"  上げられない {nm}: {ex}", flush=True)
        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{len(todo)}", flush=True)
        time.sleep(0.08)
    body = json.dumps({"書いた": time.strftime("%Y-%m-%dT%H:%M:%S"),
                       "枚数": len(amap), "map": amap,
                       "ジャンル": gmap}, ensure_ascii=False)
    tmp = FOUND / "絵.json"
    tmp.write_text(body, encoding="utf-8")
    upload(efid, "絵.json", tmp)
    print(f"索引を書いた: 絵 {len(amap)} 枚・ジャンル {len(gmap)} 本")


if __name__ == "__main__":
    main()
