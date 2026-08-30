#!/usr/bin/env python3
"""パッケージ画像とジャンルを集める。

**エージェントにサイトを回らせない**（[[cover-art-lookup]] の方針）。
鍵の要らない決まった手順だけで引く。順番は:

  1. 手元の openvgdb.sqlite を **中身の md5** で引く（確実。ここで大半が付く）
  2. 当たらないものは **題名で照合**する（点数を付け、噛み合わないものは付けない）
  3. それでも無いものは **libretro のサムネイル置き場**（GitHub・鍵不要）。
     openvgdb が持っている No-Intro の名前が、そのまま画像の名前になっている。
     ここは日本の版も揃っている。

日本語版 Wikipedia は**ゲームの箱絵を載せていない**（非自由画像を原則置かない）ので、
記事はあっても絵は取れない。試して確かめた。

openvgdb は「余計な頭を外した中身」の md5 を持っている。
ファミコンは iNES の16バイト、スーファミは写し取り用の512バイト。
素のファイルの md5 では**1件も当たらない**（実際に踏んだ）。

  python3 tools/fetch-covers.py            # 足りないものだけ
  python3 tools/fetch-covers.py --all      # 全部引き直す
  python3 tools/fetch-covers.py --dry-run  # 何が付くか見るだけ
"""
import argparse, hashlib, json, re, sqlite3, subprocess, sys, time, unicodedata
from pathlib import Path
from urllib.request import Request, urlopen

HERE  = Path(__file__).resolve().parent.parent
ALIAS = {}             # 読みの表（covers-alias.txt）。あれば使う
CAT   = HERE / "games.json"
COVERS = HERE / "covers"
VG    = Path.home() / "Library/Application Support/OpenEmu/openvgdb.sqlite"
ROMS  = Path.home() / "Library/Application Support/OpenEmu/Game Library/roms"
COVER_W = 320
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 gamedana/1.0"
# Wikipedia には作法がある。**誰が叩いているか名乗り、間隔を空ける。**
# 守らないと 429（叩きすぎ）で全部断られる（実際に踏んだ）。
WIKI_UA = "gamedana/1.0 (personal game shelf; d_shino@hotmail.com)"
WIKI_WAIT = 1.5          # 秒。これより速く叩かない
SEARCH_WAIT = 8.0        # 画像検索の間隔。速いと相手が壊れて無関係な結果を返す


def vg_md5(p: Path):
    b = p.read_bytes()
    if b[:4] == b"NES\x1a":
        b = b[16:]
    elif len(b) % 1024 == 512:
        b = b[512:]
    return hashlib.md5(b).hexdigest().upper()


def norm(s):
    """題名を比べるための形。記号と括弧書きを落とし、小文字に。"""
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", s)
    s = re.sub(r"[^0-9a-z぀-ヿ一-鿿]+", " ", s)
    return " ".join(s.split())


def score(a, b):
    """Jaccard。部分一致に甘い指標だと、便乗ものが勝ってしまう。"""
    A, B = set(norm(a).split()), set(norm(b).split())
    if not A or not B:
        return 0.0
    return len(A & B) / len(A | B)


def fetch(url, timeout=30):
    req = Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
    with urlopen(req, timeout=timeout) as r:
        return r.read()


def shrink(src: Path, dst: Path):
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "78",
                    "--resampleWidth", str(COVER_W), str(src), "--out", str(dst)],
                   check=True, capture_output=True)


def img_search(query, want=12):
    """画像検索から「絵の直リンク」と「その絵に付いている題名」を拾う。**最後の手段。**
       まとめ場（libretro）に無いもの——PC-98 の光栄ものなど——はここしかない。

       **絵だけ見て選んではいけない。** 大きさと縦横比だけで通すと、
       ルンバの写真やF1の車やカタカナ表が箱絵として入る（実際に63枚入れて全部捨てた）。
       検索結果には題名が付いているので、そこと本の名前を突き合わせる。"""
    from urllib.parse import quote
    import html as _h
    url = "https://www.bing.com/images/search?q=" + quote(query) + "&form=HDRSC2"
    try:
        req = Request(url, headers={"User-Agent": UA})
        with urlopen(req, timeout=30) as r:
            s2 = r.read().decode("utf-8", "replace")
    except Exception:
        return []
    out, seen = [], set()
    for b in re.findall(r'm="(\{[^"]*?\})"', s2):
        try:
            j = json.loads(_h.unescape(b))
        except Exception:
            continue
        u, t = j.get("murl"), j.get("t") or ""
        if not u or u in seen:
            continue
        seen.add(u)
        out.append((u.replace("\\u0026", "&"), t))
        if len(out) >= want:
            break
    return out


def tight(s2):
    """突き合わせ用に詰める。ローマ数字は算用数字に、記号と空白は落とす。"""
    s2 = unicodedata.normalize("NFKC", s2 or "").lower()
    for a, b in [("viii", "8"), ("vii", "7"), ("iii", "3"), ("ii", "2"),
                 ("iv", "4"), ("ix", "9"), ("vi", "6"), ("v", "5")]:
        s2 = re.sub(r"(?<![a-z])" + a + r"(?![a-z])", b, s2)
    return re.sub(r"[^0-9a-z぀-ヿ一-鿿]", "", s2)


def title_ok(name, t):
    """その絵の題名に、本の名前が入っているか。
       入っていなければ別物。**ここを省くと何でも通る。**"""
    n, tt = tight(name), tight(t)
    if len(n) >= 3 and n in tt:
        return True
    # 末尾の数字はこちらが付けた通し番号のことがある（提督の決断1 など）
    base = re.sub(r"\d+$", "", n)
    if len(base) >= 3 and base in tt and ("9801" in tt or "pc98" in tt):
        return True
    return False


def looks_like_box(path):
    """箱らしいか。小さすぎるもの、横に長すぎるもの（画面写真や帯）は外す。"""
    try:
        r = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
                           capture_output=True, text=True, check=True).stdout
        w = int(re.search(r"pixelWidth:\s*(\d+)", r).group(1))
        h = int(re.search(r"pixelHeight:\s*(\d+)", r).group(1))
    except Exception:
        return False
    if min(w, h) < 240:
        return False
    ar = w / h
    return 0.55 <= ar <= 1.6


def load_alias():
    """読みの表。台帳の題名 → libretro を探すための言い方。
       英語の題名を持たない本（改造版・半角カナ など）は、これが無いと引けない。"""
    f = HERE / "covers-alias.txt"
    out = {}
    if not f.exists():
        return out
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].rstrip()
        if not line.strip() or "\t" not in line:
            continue
        k, v = line.split("\t", 1)
        if k.strip() and v.strip():
            out[k.strip()] = v.strip()
    return out


def clean_title(s):
    """引くための題名。半角カナは全角に直す（半角のままでは一件も当たらない）。
       括弧書き（版・地域）は落とす。"""
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]|（[^）]*）", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# libretro のサムネイル置き場。機種ごとに棚が分かれている。
LR = {
    "Famicom":       "Nintendo_-_Nintendo_Entertainment_System",
    "Super Famicom": "Nintendo_-_Super_Nintendo_Entertainment_System",
    "Nintendo 64":   "Nintendo_-_Nintendo_64",
    "Nintendo DS":   "Nintendo_-_Nintendo_DS",
    "PC-98":         "NEC_-_PC-98",
}
def lr_url(system, name):
    """No-Intro の名前がそのまま画像の名前になっている。"""
    repo = LR.get(system)
    if not repo:
        return None
    from urllib.parse import quote
    return ("https://raw.githubusercontent.com/libretro-thumbnails/" + repo +
            "/master/Named_Boxarts/" + quote(name) + ".png")


# PC-98 の題名を、libretro の名前（ローマ字）に橋渡しする表。
# 機械には読めないので、シリーズの読みだけ人が与える。ここに無いものは付かない。
YOMI = [
    ("三國志", "Sangokushi"), ("三国志", "Sangokushi"),
    ("信長の野望", "Nobunaga no Yabou"), ("信長", "Nobunaga no Yabou"),
    ("大航海時代", "Daikoukai Jidai"), ("水滸伝", "Suikoden"),
    ("太閤立志伝", "Taikou Risshiden"), ("維新の嵐", "Ishin no Arashi"),
    ("蒼き狼と白き牝鹿", "Aoki Ookami to Shiroki Mejika"),
    ("元朝秘史", "Genchou Hishi"), ("項劉記", "Kouryuuki"),
    ("提督の決断", "Teitoku no Ketsudan"), ("伊忍道", "Ininden"),
    ("ロイヤルブラッド", "Royal Blood"), ("麻雀大会", "Mahjong Taikai"),
    ("麻雀悟空", "Mahjong Gokuu"), ("ブランディッシュ", "Brandish"),
    ("英傑伝", "Eiketsuden"), ("覇王伝", "Haouden"), ("武将風雲録", "Bushou Fuuunroku"),
    ("戦国群雄伝", "Sengoku Gunyuuden"), ("群雄伝", "Sengoku Gunyuuden"),
    ("全国版", "Zenkokuban"), ("パワーアップキット", "Power Up Kit"),
    ("天下統一", "Tenka Touitsu"), ("エメラルドドラゴン", "Emerald Dragon"),
    ("ぷよぷよ", "Puyo Puyo"), ("レミングス", "Lemmings"),
    ("プリンスオブペルシャ", "Prince of Persia"), ("ロードモナーク", "Lord Monarch"),
    ("リターンオブイシター", "Return of Ishtar"), ("アルカノイド", "Arkanoid"),
]
ROMAN = {"Ⅰ": "I", "Ⅱ": "II", "Ⅲ": "III", "Ⅳ": "IV", "Ⅴ": "V", "Ⅵ": "VI",
         "１": "1", "２": "2", "３": "3", "４": "4", "５": "5"}

def to_roman(name):
    """日本語の題名を、突き合わせ用のローマ字に置き換える。"""
    s2 = unicodedata.normalize("NFKC", name)
    for a, b in ROMAN.items():
        s2 = s2.replace(a, b)
    for jp, rm in YOMI:
        s2 = s2.replace(jp, " " + rm + " ")
    # 日本語が残っていたら、読みを与えていないということ
    if re.search(r"[぀-ヿ一-鿿]", s2):
        return None
    return " ".join(s2.split())

_tree_cache = {}

def lr_tree(repo):
    """libretro の箱絵一覧。機種ごとに一度だけ取って使い回す。"""
    if repo in _tree_cache:
        return _tree_cache[repo]
    try:
        req = Request(f"https://api.github.com/repos/libretro-thumbnails/{repo}"
                      "/git/trees/master?recursive=1",
                      headers={"User-Agent": UA, "Accept": "application/vnd.github+json"})
        with urlopen(req, timeout=60) as r:
            j = json.load(r)
        out = [t["path"][len("Named_Boxarts/"):-4]
               for t in j.get("tree", [])
               if t["path"].startswith("Named_Boxarts/") and t["path"].endswith(".png")]
        _tree_cache[repo] = out
        return out
    except Exception as e:
        print(f"一覧が取れない（{repo}）:", e)
        _tree_cache[repo] = []
        return []

def pc98_tree():
    return lr_tree("NEC_-_PC-98")

def numof(s2):
    """題名に付く番号（2 とか II とか）。シリーズ物を取り違えないための鍵。"""
    t = norm(s2)
    m = re.findall(r"\b(\d{1,2}|ii+|iv|vi*|ix|xi*)\b", t)
    return m[-1] if m else ""

_ROM2N = {"ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7", "viii": "8", "ix": "9"}
def numkey(s2):
    n = numof(s2)
    return _ROM2N.get(n, n)

def normnum(s2):
    """語に割る前に、ローマ数字を算用数字へ。
       「Brandish III」と「Brandish 3」が別の語に見えて外れるのを防ぐ。"""
    return [_ROM2N.get(w, w) for w in norm(s2).split()]

def lr_match(want, tree, need=0.8):
    """英語の題名を、libretro の名前（No-Intro）に突き合わせる。
       **含まれ具合**で測り、**番号の一致**を求める。日本の版を優先する。"""
    A = set(normnum(want))
    if not A:
        return None, 0.0
    qn = numkey(want)
    best, bs, bj = None, 0.0, False
    for cand in tree:
        if numkey(cand) != qn:
            continue
        B = set(normnum(cand))
        s2 = len(A & B) / len(A)
        jp = "japan" in B                       # 日本の版を優先
        if s2 > bs or (s2 == bs and jp and not bj):
            best, bs, bj = cand, s2, jp
    return (best, bs) if bs >= need else (None, bs)


def pc98_match(name, tree, need=0.8):
    """**題名の語がどれだけ含まれているか**で測る（Jaccard だと、余計な語
       （年・メーカー・ディスク番号）が多い相手に不利で当たらない）。
       あわせて**番号が一致すること**を求める。
       これが無いと ブランディッシュⅡ・Ⅲ・２ が全部「Brandish」に付いてしまう。"""
    q = to_roman(name)
    if not q:
        return None, 0.0
    A = set(normnum(q))
    if not A:
        return None, 0.0
    qn = numkey(q)
    best, bs = None, 0.0
    for cand in tree:
        if numkey(cand) != qn:
            continue
        B = set(normnum(cand))
        s2 = len(A & B) / len(A)
        # 同じ点なら、余計な語が少ないほう（＝素直な名前）を採る
        if s2 > bs or (s2 == bs and best and len(B) < len(set(normnum(best)))):
            best, bs = cand, s2
    return (best, bs) if bs >= need else (None, bs)


_wiki_last = [0.0]

def wiki_cover(title, want_score=0.5):
    """Wikipedia（日本語）で探して、記事の代表画像を返す。
       鍵は要らない。**題名が噛み合ったときだけ**返す（別物を付けないため）。
       間隔を必ず空け、断られたら少し待って一度だけ出直す。"""
    from urllib.parse import urlencode
    title = clean_title(title)
    if not title:
        return None, None, 0.0
    q = urlencode({
        "action": "query", "generator": "search", "gsrsearch": title,
        "gsrlimit": 3, "prop": "pageimages", "piprop": "thumbnail|original",
        "pithumbsize": 400, "format": "json", "formatversion": 2,
    })
    j = None
    for attempt in range(2):
        wait = WIKI_WAIT - (time.time() - _wiki_last[0])
        if wait > 0:
            time.sleep(wait)
        _wiki_last[0] = time.time()
        try:
            req = Request("https://ja.wikipedia.org/w/api.php?" + q,
                          headers={"User-Agent": WIKI_UA, "Accept": "application/json"})
            with urlopen(req, timeout=25) as r:
                j = json.load(r)
            break
        except Exception as e:
            if "429" in str(e) and attempt == 0:
                time.sleep(20)          # 叩きすぎ。落ち着くまで待つ
                continue
            return None, None, 0.0
    if j is None:
        return None, None, 0.0
    best, bs = None, 0.0
    for pg in (j.get("query", {}) or {}).get("pages", []) or []:
        thumb = (pg.get("thumbnail") or {}).get("source")
        if not thumb:
            continue
        s2 = score(title, pg.get("title", ""))
        if s2 > bs:
            best, bs = (thumb, pg.get("title")), s2
    if best and bs >= want_score:
        return best[0], best[1], bs
    return None, None, bs


def save_cover(url, gid, tmp):
    """取ってきて、幅320pxに縮めて置く。取れなければ False。"""
    try:
        tmp.write_bytes(fetch(url))
        shrink(tmp, COVERS / f"{gid}.jpg")
        return True
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="箱絵があるものも引き直す")
    ap.add_argument("--pc98", action="store_true", help="PC-98（pc98.json）を引く")
    ap.add_argument("--search", action="store_true",
                    help="まとめ場に無いものを画像検索で埋める（最後の手段）")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    COVERS.mkdir(exist_ok=True)
    tmp = HERE / ".cover.tmp"
    global ALIAS
    ALIAS = load_alias()
    if ALIAS:
        print(f"読みの表: {len(ALIAS)} 件")
    n = {"db": 0, "name": 0, "wiki": 0, "genre": 0, "ng": 0}

    if a.pc98:
        # PC-98 は openvgdb に無い。libretro の置き場にはあるが、**名前がローマ字**。
        # 日本語の題名とは直につながらないので、シリーズ名の読みを表で与えて突き合わせる。
        # 別物を付けないよう、点数が足りないものは付けない。
        tree = pc98_tree()
        if not tree:
            print("libretro の一覧が取れませんでした"); return
        cat = json.loads((HERE / "pc98.json").read_text(encoding="utf-8"))
        items = [t for t in cat["titles"] if t["kind"] == "game"]
        for t in items:
            if (t.get("cover") and not a.all) or t.get("garbled"):
                continue
            name, sc = pc98_match(t["name"], tree)
            if not name:
                if not a.search:
                    print(f"  無い: {t['name']}")
                    continue
                # まとめ場に無い。画像検索で埋める。
                q = f"{t['name']} PC-9801 パッケージ 箱"
                hit = False
                for u, wt in img_search(q):
                    if not title_ok(t["name"], wt):
                        continue
                    if a.dry_run:
                        print(f"  [検索] {t['name']}  ← {wt[:50]}"); hit = True; break
                    try:
                        tmp.write_bytes(fetch(u))
                    except Exception:
                        continue
                    if not looks_like_box(tmp):
                        continue
                    try:
                        shrink(tmp, COVERS / f"{t['id']}.jpg")
                    except Exception:
                        continue
                    t["cover"] = f"covers/{t['id']}.jpg"; n["wiki"] += 1; hit = True
                    print(f"  [検索] {t['name']}  ← {wt[:52]}")
                    break
                if not hit:
                    n["ng"] += 1
                    print(f"  見つからない: {t['name']}")
                # 続けて叩くと検索側が壊れ、無関係な結果を返し始める（実測）。
                # 76回で 水滸伝→Minecraft、三國志2→類語辞典 になった。大きく空ける。
                time.sleep(SEARCH_WAIT)
                continue
            if a.dry_run:
                print(f"  [{sc:.2f}] {t['name']}  ← {name}")
                n["wiki"] += 1
                continue
            u = lr_url("PC-98", name)
            if u and save_cover(u, t["id"], tmp):
                t["cover"] = f"covers/{t['id']}.jpg"; n["wiki"] += 1
                print(f"  [{sc:.2f}] {t['name']}  ← {name}")
            else:
                n["ng"] += 1
        if not a.dry_run:
            (HERE / "pc98.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1),
                                            encoding="utf-8")
        have = sum(1 for t in items if t.get("cover"))
        print(f"\n付けた {n['wiki']} / 取れなかった {n['ng']}")
        print(f"いま箱絵がある {have} / {len(items)}（PC-98）")
        return

    cat = json.loads(CAT.read_text(encoding="utf-8"))
    con = sqlite3.connect(f"file:{VG}?mode=ro", uri=True)
    SYSMAP = {"Famicom": "%NES%", "Super Famicom": "%Super Nintendo%",
              "Nintendo 64": "%Nintendo 64%", "Nintendo DS": "%Nintendo DS%",
              "Sony PSP": "%PlayStation Portable%"}

    for g in cat["games"]:
        row, how = None, ""

        # 1. 中身の md5 で引く
        p2 = ROMS / g["path"]
        if p2.exists():
            row = con.execute("""select e.releaseCoverFront, e.releaseGenre, e.releaseTitleName
                                 from ROMs r join RELEASES e on e.romID=r.romID
                                 where r.romHashMD5=? and (e.releaseCoverFront is not null
                                    or e.releaseGenre is not null) limit 1""",
                              (vg_md5(p2),)).fetchone()
            if row:
                how = "md5"; n["db"] += 1

        # 2. 題名で照合
        if not row:
            want = g.get("title") or g["name"]
            cands = con.execute("""select e.releaseCoverFront, e.releaseGenre, e.releaseTitleName
                                   from RELEASES e where e.TEMPsystemName like ?
                                     and e.releaseTitleName like ? limit 40""",
                                (SYSMAP.get(g["system"], "%"),
                                 (norm(want).split() or [""])[0] + "%")).fetchall()
            best, bs = None, 0.0
            for c in cands:
                sc2 = score(want, c[2])
                if sc2 > bs:
                    best, bs = c, sc2
            if best and bs >= 0.6:
                row = best; how = f"題名 {bs:.2f}"; n["name"] += 1

        if row and row[1] and (a.all or not g.get("genre")):
            g["genre"] = row[1].split(",")[0].strip(); n["genre"] += 1

        if g.get("cover") and not a.all:
            continue

        # 箱絵：DB の URL → 駄目なら Wikipedia、と順に降りる。
        if row and row[0]:
            if a.dry_run:
                print(f"  [{how}] {g['name']} ← {row[2]}"); continue
            if save_cover(row[0], g["id"], tmp):
                g["cover"] = f"covers/{g['id']}.jpg"
                print(f"  [{how}] {g['name']}  ← {row[2]}")
                continue
            print(f"  DB の絵は断られた: {g['name']} → Wikipedia を試す")

        if a.dry_run:
            continue
        # 3. libretro の置き場。No-Intro の名前が鍵になる。
        done = False
        if p2.exists():
            fn = con.execute("select romFileName from ROMs where romHashMD5=? limit 1",
                             (vg_md5(p2),)).fetchone()
            if fn and fn[0]:
                base = re.sub(r"\.[^.]+$", "", fn[0])
                u = lr_url(g["system"], base)
                if u and save_cover(u, g["id"], tmp):
                    g["cover"] = f"covers/{g['id']}.jpg"; n["wiki"] += 1
                    print(f"  [libretro] {g['name']}  ← {base}")
                    done = True
        if not done:
            # 4. libretro の一覧と**英語の題名**で突き合わせる。
            #    openvgdb に載っていない本は、No-Intro の名前が手元に無いので、
            #    一覧を丸ごと取ってから照らす（地道だが確実）。
            want = ALIAS.get(g["name"]) or g.get("title") or g["name"]
            repo = LR.get(g["system"])
            if repo:
                name2, sc2 = lr_match(want, lr_tree(repo))
                if name2:
                    u = lr_url(g["system"], name2)
                    if u and save_cover(u, g["id"], tmp):
                        g["cover"] = f"covers/{g['id']}.jpg"; n["wiki"] += 1
                        print(f"  [一覧 {sc2:.2f}] {g['name']}  ← {name2}")
                        done = True
        if not done:
            n["ng"] += 1

    if tmp.exists():
        tmp.unlink()
    if not a.dry_run:
        CAT.write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")

    pl = [g for g in cat["games"] if g["core"]]
    print(f"\nDB {n['db']} / 題名 {n['name']} / Wikipedia {n['wiki']} / 付かなかった {n['ng']}")
    print(f"ジャンルを付けた {n['genre']}")
    print(f"遊べる本 {len(pl)}：箱絵 {sum(1 for g in pl if g.get('cover'))}、"
          f"ジャンル {sum(1 for g in pl if g.get('genre'))}")


if __name__ == "__main__":
    main()
