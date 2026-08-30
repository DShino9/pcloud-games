#!/usr/bin/env python3
"""棚の ROM を pCloud へ上げる。

pCloud のマウントは使わない（刺さるので）。HTTP API に直接置く。

  python3 tools/upload-to-pcloud.py                       # ファミコン＋スーファミ
  python3 tools/upload-to-pcloud.py --system Famicom
  python3 tools/upload-to-pcloud.py --all                 # 台帳にある機種すべて
  python3 tools/upload-to-pcloud.py --pc98                # PC-98 のディスクと BIOS
  python3 tools/upload-to-pcloud.py --dry-run             # 何を上げるか見るだけ

パスワードはこの場で聞き、画面にも履歴にもファイルにも残さない。
合鍵は動いているあいだだけメモリに置く。
"""
import argparse, hashlib, json, os, sys, time
from getpass import getpass
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import unicodedata

HERE = Path(__file__).resolve().parent.parent
CAT  = HERE / "games.json"
CAT98 = HERE / "pc98.json"
ROMS = Path.home() / "Library/Application Support/OpenEmu/Game Library/roms"
NP2  = Path.home() / "Documents/RetroArch/system/np2kai"
# PC-98 を動かすのに要る、ディスク以外のもの。これが無いと画面が出ない。
NP2_ROMS = ["BIOS.ROM", "FONT.ROM", "sound.rom", "itf.rom", "font.bmp"]
HOSTS = ["api.pcloud.com", "eapi.pcloud.com"]
DEFAULT_SYSTEMS = ["Famicom", "Super Famicom"]

nfc = lambda s: unicodedata.normalize("NFC", s or "")
sha1 = lambda s: hashlib.sha1(s.encode()).hexdigest()


class PCloud:
    def __init__(self, host, auth):
        self.host, self.auth = host, auth

    def call(self, method, **params):
        params = {k: v for k, v in params.items() if v is not None}
        params["auth"] = self.auth
        url = f"https://{self.host}/{method}?{urlencode(params)}"
        with urlopen(url, timeout=60) as r:
            j = json.load(r)
        if j.get("result") != 0:
            raise RuntimeError(f"{method}: {j.get('result')} {j.get('error')}")
        return j

    def upload(self, folderid, path, retries=3):
        """multipart を手で組む。標準ライブラリだけで済ませる。"""
        name = nfc(path.name)
        body, boundary = multipart(name, path.read_bytes())
        url = f"https://{self.host}/uploadfile?" + urlencode(
            {"auth": self.auth, "folderid": folderid, "filename": name, "nopartial": 1})
        for i in range(retries):
            try:
                req = Request(url, data=body, method="POST",
                              headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
                with urlopen(req, timeout=300) as r:
                    j = json.load(r)
                if j.get("result") != 0:
                    raise RuntimeError(f"{j.get('result')} {j.get('error')}")
                return j
            except Exception as e:
                if i == retries - 1:
                    raise
                time.sleep(2 * (i + 1))


def multipart(filename, data):
    b = "----pgames" + os.urandom(8).hex()
    head = (f"--{b}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n").encode()
    tail = f"\r\n--{b}--\r\n".encode()
    return head + data + tail, b


def sign_in():
    """合鍵の取り方は一通りではない。順に試して、通ったもので入る。"""
    email = input("pCloud のメールアドレス: ").strip()
    password = getpass("パスワード（表示されません）: ")
    last = None
    for host in HOSTS:
        try:
            with urlopen(f"https://{host}/getdigest", timeout=30) as r:
                digest = json.load(r)["digest"]
        except Exception as e:
            last = e
            continue
        pd = sha1(password + sha1(email.lower()) + digest)
        tries = [
            ("userinfo", {"username": email, "digest": digest, "passworddigest": pd}),
            ("login",    {"username": email, "digest": digest, "passworddigest": pd}),
            ("userinfo", {"username": email, "password": password}),
            ("login",    {"username": email, "password": password}),
        ]
        for method, params in tries:
            try:
                url = f"https://{host}/{method}?" + urlencode({**params, "getauth": 1})
                with urlopen(url, timeout=30) as r:
                    j = json.load(r)
                if j.get("auth"):
                    print(f"  つながった（{method} @ {host}）")
                    return PCloud(host, j["auth"])
                last = RuntimeError(f"{method}: 合鍵が返らない")
            except Exception as e:
                last = e
    raise SystemExit(f"入れませんでした: {last}")


def ensure_folder(pc, parent, name):
    """既にあれば使い、無ければ作る。

    pCloud の createfolderifnotexists は名前を字面で比べる。macOS 由来の名前は NFD、
    こちらが渡す名前は NFC なので、「既にあるのに見つからず、もう一つ作られる」ことが起きる
    （実際に『ゲーム棚』が2つできた）。先に自分で NFC に揃えて探す。
    """
    want = nfc(name)
    listing = pc.call("listfolder", folderid=parent)
    for c in listing["metadata"].get("contents", []):
        if c.get("isfolder") and nfc(c["name"]) == want:
            return c["folderid"]
    j = pc.call("createfolderifnotexists", folderid=parent, name=name)
    return j["metadata"]["folderid"]


def show_where(a):
    """どのフォルダに何が入っているかを見るだけ。何も作らず、何も消さない。
       同じ名前のフォルダが複数できてしまったときに、どれが本命かを見分けるため。"""
    pc = sign_in()
    root = pc.call("listfolder", folderid=0)
    print("\npCloud の一番上:")
    for c in root["metadata"].get("contents", []):
        if not c.get("isfolder"):
            continue
        inner = pc.call("listfolder", folderid=c["folderid"])
        kids = inner["metadata"].get("contents", [])
        dirs = [k["name"] for k in kids if k.get("isfolder")]
        nfil = len(kids) - len(dirs)
        mark = "  ← これ" if nfil or dirs else ""
        print(f"  📁 {c['name']}  (folderid={c['folderid']})")
        if dirs or nfil:
            print(f"       中: {'、'.join(dirs) if dirs else ''}"
                  f"{'／' if dirs and nfil else ''}{f'ファイル {nfil} 個' if nfil else ''}")
            for d in dirs:
                did = next(k["folderid"] for k in kids if k.get("isfolder") and k["name"] == d)
                sub = pc.call("listfolder", folderid=did)
                sk = sub["metadata"].get("contents", [])
                print(f"         └ {d}: {len([x for x in sk if not x.get('isfolder')])} ファイル")
        else:
            print("       中: 空っぽ")
    print("\n棚に選ぶのは、Famicom / Super Famicom / PC-98 が揃って入っているほう。")
    print("分かれてしまっていたら、pCloud 側でフォルダごと移すか、")
    print("  python3 tools/upload-to-pcloud.py --pc98 --pick pc98-pick.txt --root-id <番号>")
    print("で上げ直す（済んでいる分は飛ばす）。")


def upload_pc98(a):
    """PC-98 は台帳の作りが違う（1本＝複数枚）ので、別に扱う。
       BIOS とフォントの ROM も一緒に上げる。これが無いと画面が出ない。"""
    if not CAT98.exists():
        raise SystemExit("pc98.json がありません。先に tools/build-pc98-catalog.py を走らせてください")
    cat = json.loads(CAT98.read_text(encoding="utf-8"))
    src_root = Path(cat.get("source") or (NP2 / "PC98 select"))
    titles = cat["titles"]

    # 選ぶ表があれば絞る。BIOS とフォントは選び方に関係なく上げる（無いと画面が出ない）。
    if a.pick:
        want, bad = [], []
        for line in Path(a.pick).read_text(encoding="utf-8").splitlines():
            line = line.split("#")[0].strip()
            if line:
                want.append(line)
        byid = {t["id"]: t for t in titles}
        bad = [w for w in want if w not in byid]
        if bad:
            raise SystemExit("台帳に無い id: " + "、".join(bad))
        titles = [byid[w] for w in want]
        print(f"選んだ本: {len(titles)} 本")

    # 同じ名前のディスクが複数の本に出てくることはあるので、名前で1つにまとめる。
    disks = {}
    for t in titles:
        for d in t["disks"]:
            disks.setdefault(nfc(d["file"]), src_root / d["path"])

    roms = [(n, NP2 / n) for n in NP2_ROMS if (NP2 / n).exists()]
    missing = [n for n in NP2_ROMS if not (NP2 / n).exists()]

    total = sum(p.stat().st_size for p in disks.values() if p.exists()) \
          + sum(p.stat().st_size for _, p in roms)
    print(f"上げるもの: ディスク {len(disks)} 枚 + ROM {len(roms)} 個 / {total/1e6:.1f}MB")
    if missing:
        print(f"  ※ 見つからない ROM: {'、'.join(missing)}")
        if "BIOS.ROM" in missing or "FONT.ROM" in missing:
            print("  ※ BIOS.ROM と FONT.ROM が無いと画面が出ません")
    if a.dry_run:
        for t in titles[:60] if a.pick else []:
            print(f"  {t['count']:2d}枚 {t['bytes']/1e6:5.1f}MB  {t['name']}")
        if not a.pick:
            for n in list(disks)[:8]:
                print("  例)", n)
        print("  …（--dry-run なのでここまで）")
        return

    pc = sign_in()
    root = a.root_id if a.root_id else ensure_folder(pc, 0, a.root)
    fid98 = ensure_folder(pc, root, "PC-98")
    listing = pc.call("listfolder", folderid=fid98)
    present = {nfc(c["name"]) for c in listing["metadata"].get("contents", []) if not c["isfolder"]}
    print(f"置き場: /{a.root}/PC-98 （すでに {len(present)} 個）")

    items = [(n, p) for n, p in sorted(disks.items())] + [(n, p) for n, p in roms]
    done = skipped = failed = 0
    for i, (name, path) in enumerate(items, 1):
        if nfc(name) in present:
            skipped += 1
            continue
        if not path.exists():
            print(f"  [{i}/{len(items)}] 実物が無い: {path}")
            failed += 1
            continue
        try:
            pc.upload(fid98, path)
            done += 1
            print(f"  [{i}/{len(items)}] {name}")
        except Exception as e:
            failed += 1
            print(f"  [{i}/{len(items)}] 失敗: {name} — {e}")
    print(f"\n上げた {done} / 済んでいた {skipped} / 駄目 {failed}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--system", action="append", help="機種名（何度でも指定できる）")
    ap.add_argument("--all", action="store_true", help="台帳にある機種すべて")
    ap.add_argument("--root", default="ゲーム棚", help="pCloud 側の置き場（既定: ゲーム棚）")
    ap.add_argument("--pc98", action="store_true", help="PC-98 のディスクと BIOS を上げる")
    ap.add_argument("--pick", help="上げる本を選ぶ表（1行に1つ id。# から後ろは覚え書き）")
    ap.add_argument("--where", action="store_true",
                    help="pCloud のどこに何が入っているかを見るだけ（何も変えない）")
    ap.add_argument("--root-id", type=int,
                    help="置き場を folderid で名指しする（同じ名前が複数あるとき）")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.where:
        return show_where(a)
    if a.pc98:
        return upload_pc98(a)

    if not CAT.exists():
        raise SystemExit("games.json がありません。先に tools/build-catalog.py を走らせてください")
    cat = json.loads(CAT.read_text(encoding="utf-8"))

    want = a.system or (None if a.all else DEFAULT_SYSTEMS)
    games = [g for g in cat["games"] if want is None or g["system"] in want]
    if not games:
        raise SystemExit("その機種は台帳にありません")

    total = sum(g["bytes"] for g in games)
    by_sys = {}
    for g in games:
        by_sys[g["system"]] = by_sys.get(g["system"], 0) + 1
    print(f"上げるもの: {len(games)} 本 / {total/1e6:.1f}MB")
    for s, n in sorted(by_sys.items()):
        print(f"  {s}: {n}")

    if a.dry_run:
        for g in games[:10]:
            print("  例)", g["system"], "/", g["file"])
        print("  …（--dry-run なのでここまで）")
        return

    pc = sign_in()
    root = a.root_id if a.root_id else ensure_folder(pc, 0, a.root)
    print(f"置き場: /{a.root} (folderid={root})")

    # 機種ごとにフォルダを作り、すでに上がっている分は飛ばす。
    folders, present = {}, {}
    for s in sorted(by_sys):
        fid = ensure_folder(pc, root, s)
        folders[s] = fid
        listing = pc.call("listfolder", folderid=fid)
        present[s] = {nfc(c["name"]): c["fileid"]
                      for c in listing["metadata"].get("contents", []) if not c["isfolder"]}
        print(f"  /{a.root}/{s}: すでに {len(present[s])} 本")

    done = skipped = failed = 0
    sent = 0
    for i, g in enumerate(games, 1):
        src = ROMS / g["path"]
        name = nfc(g["file"])
        if name in present[g["system"]]:
            skipped += 1
            continue
        if not src.exists():
            print(f"  [{i}/{len(games)}] 実物が無い: {g['path']}")
            failed += 1
            continue
        try:
            pc.upload(folders[g["system"]], src)
            done += 1
            sent += g["bytes"]
            print(f"  [{i}/{len(games)}] {g['short']} {g['name']}  "
                  f"({sent/1e6:.0f}/{total/1e6:.0f}MB)")
        except Exception as e:
            failed += 1
            print(f"  [{i}/{len(games)}] 失敗: {g['name']} — {e}")

    print(f"\n上げた {done} / 済んでいた {skipped} / 駄目 {failed}")
    print(f"棚のページで「設定 → フォルダを選び直す」から /{a.root} を選ぶ。")


if __name__ == "__main__":
    main()
