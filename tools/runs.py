#!/usr/bin/env python3
"""棚に上がった「動きの記録」を読む。

    python3 tools/runs.py            動きの記録を読む
    python3 tools/runs.py --shelf    棚の題名の一覧を落とす（絵の捜索用）
    python3 tools/runs.py --login    合鍵を取り直す

**手で写して貼る必要をなくすための道具。** 遊んでいる最中、棚は20秒ごとに
記録を `/ゲーム棚/_記録/<端末>.json` へ上げている。落ちても直前までは残る。

パスワードは**この場で本人が打つ**。合鍵（auth）だけを
`~/.config/pcloud-games/token` に 600 で置き、次からはそれを使う。
合鍵は取り消せる（pCloud の設定 → セキュリティ）。
"""
import json, os, ssl, sys, urllib.request, unicodedata
from pathlib import Path
from hashlib import sha1 as _s
from getpass import getpass
from urllib.parse import urlencode

HOSTS = ["api.pcloud.com", "eapi.pcloud.com"]
TOKEN = os.path.expanduser("~/.config/pcloud-games/token")
CTX = ssl.create_default_context()


def get(host, method, params):
    url = f"https://{host}/{method}?" + urlencode(params)
    with urllib.request.urlopen(url, timeout=30, context=CTX) as r:
        return json.loads(r.read().decode())


def sha1(s):
    return _s(s.encode()).hexdigest()


def login():
    """合鍵を取る。**パスワードはここで本人が打ち、保存もしない。**"""
    email = input("pCloud のメールアドレス: ").strip()
    password = getpass("パスワード（表示されません）: ")
    for host in HOSTS:
        try:
            digest = get(host, "getdigest", {})["digest"]
        except Exception:
            continue
        pd = sha1(password + sha1(email.lower()) + digest)
        for method, params in (
            ("userinfo", {"username": email, "digest": digest, "passworddigest": pd}),
            ("login",    {"username": email, "digest": digest, "passworddigest": pd}),
            ("userinfo", {"username": email, "password": password}),
            ("login",    {"username": email, "password": password}),
        ):
            try:
                j = get(host, method, {**params, "getauth": 1})
            except Exception:
                continue
            if j.get("auth"):
                os.makedirs(os.path.dirname(TOKEN), exist_ok=True)
                with open(TOKEN, "w") as f:
                    json.dump({"host": host, "auth": j["auth"]}, f)
                os.chmod(TOKEN, 0o600)
                print(f"合鍵を置いた: {TOKEN}")
                return host, j["auth"]
    sys.exit("入れなかった")


def creds():
    if os.path.exists(TOKEN):
        d = json.load(open(TOKEN))
        return d["host"], d["auth"]
    return login()


def find_folder(host, auth, name):
    """棚の中から名前で探す。**NFC に揃えて比べる**（macOS の名前は NFD のことがある）。"""
    j = get(host, "listfolder", {"auth": auth, "folderid": 0, "recursive": 1})
    want = unicodedata.normalize("NFC", name)

    def walk(m):
        if m.get("isfolder"):
            if unicodedata.normalize("NFC", m.get("name", "")) == want:
                return m
            for c in m.get("contents", []):
                r = walk(c)
                if r:
                    return r
        return None
    return walk(j["metadata"])


def bar(v, top=60, w=22):
    n = max(0, min(w, round(v / top * w)))
    return "█" * n + "·" * (w - n)


def shelf_list():
    """倉庫の `_記録/棚.json` を読む。棚が書き出した題名の一覧。
       **絵の捜索はブラウザからできない**（CORS）ので、Mac 側はこれを見て探す。"""
    host, auth = creds()
    f = find_folder(host, auth, "_記録")
    if not f:
        sys.exit("倉庫に _記録 がまだ無い。棚で一度「倉庫を見直す」を回すと置かれる。")
    c = next((x for x in f.get("contents", []) if x.get("name") == "棚.json"), None)
    if not c:
        sys.exit("_記録 に 棚.json が無い。棚で一度「倉庫を見直す」を回す。")
    j = get(host, "getfilelink", {"auth": auth, "fileid": c["fileid"]})
    url = "https://" + j["hosts"][0] + j["path"]
    with urllib.request.urlopen(url, timeout=120, context=CTX) as r:
        d = json.loads(r.read().decode())
    print(f"{d.get('本数')} 本（書いた: {d.get('書いた','')[:16]}）")
    out = Path(__file__).resolve().parent.parent / "棚.json"
    out.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"置いた: {out}")
    return d


def main():
    if "--login" in sys.argv:
        login()
    if "--shelf" in sys.argv:
        shelf_list()
        return
    host, auth = creds()
    f = find_folder(host, auth, "_記録")
    if not f:
        sys.exit("棚に _記録 がまだ無い。一度遊べば上がる。")
    for c in sorted(f.get("contents", []), key=lambda x: x.get("name", "")):
        if c.get("isfolder"):
            continue
        j = get(host, "getfilelink", {"auth": auth, "fileid": c["fileid"]})
        url = "https://" + j["hosts"][0] + j["path"]
        with urllib.request.urlopen(url, timeout=60, context=CTX) as r:
            d = json.loads(r.read().decode())
        print(f"\n=== {d.get('端末')} ({c['name']}) 上げた {d.get('上げた','')[:16]}")
        print(f"    {d.get('ua','')[:110]}")
        for run in d.get("runs", []):
            mark = "" if run.get("done") else "  ← 途中で切れた（落ちた）"
            print(f"\n  {run.get('at')} {run.get('name')} [{run.get('core')}] "
                  f"{run.get('sec')}秒 平均 {run.get('fps')}コマ/秒{mark}")
            if run.get("err"):
                print(f"    {run['err']}")
            j2 = run.get("j") or {}
            if j2:
                print(f"    間隔 中{j2.get('mid')}ms p95 {j2.get('p95')}ms "
                      f"最大 {j2.get('max')}ms 荒れ {j2.get('rough')}%")
            for i, v in enumerate(run.get("tl") or []):
                print(f"    {i*10:3d}秒 {bar(v)} {v}")


if __name__ == "__main__":
    main()
