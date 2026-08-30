# ゲーム棚

pCloud に預けた ROM を、ブラウザだけで遊ぶ。マウントは使わない。
共通部品は [`shelf-core`](../shelf-core)（`core/` は配られたもの。ここで直さない）。

    棚（index.html）  ─ 台帳 games.json を並べる。pCloud には「fileid はどれか」だけ聞く
    遊ぶ（play.html） ─ 1本につき1文書。閉じればコアは確実に止まる
    core/             ─ shelf-core から配られた共通部品

## 棚に並ぶもの

台帳は OpenEmu の `Library.storedata` から起こす。題名・機種・遊んだ回数・箱絵が
すでに入っているので、集め直さない。

    python3 tools/build-catalog.py                       # 全機種
    python3 tools/build-catalog.py Famicom "Super Famicom"

| 機種 | 本数 | ブラウザのコア |
|---|---|---|
| ファミコン | 191 | `fceumm` |
| スーパーファミコン | 44 | `snes9x` |
| Nintendo 64 | 6 | `mupen64plus_next`（重い） |
| Nintendo DS | 12 | `melonds`（重い） |
| Sony PSP | 18 | 無し（棚に並ぶだけ） |

箱絵は 173 枚。幅 320px に縮めて `covers/` に置く（元は1枚 350KB あって重い）。

## 棚を編む（あとから増やす・減らす）

棚の「設定 → 棚を編む」から、本を選んで pCloud に**上げる／下げる**ことができる。
毎回この置き場の道具を走らせなくてよい。

- **上げる** … ブラウザは勝手に Mac の中を読めないので、まず「元のフォルダを選ぶ」で
  ROM の入ったフォルダを一度指定する。中身はその画面を開いているあいだだけ憶える
  （ブラウザの決まりで、閉じると忘れる）。名前で突き合わせて、棚に無いものだけ上げる。
- **下げる** … pCloud から消す。**戻せない**ので必ず一度確かめる窓が出る。
- **手元から消す** … 端末に置いた控えだけ消す。pCloud には触らない。

上げ下げは `api.pcloud.com` に直に頼める（CORS が開いている）。
中継所が要るのは「中身を取る」ときだけ。

## ROM を上げる

pCloud のマウントは刺さるので使わない。HTTP API に直接置く。

    python3 tools/upload-to-pcloud.py --dry-run     # 何を上げるか見るだけ
    python3 tools/upload-to-pcloud.py               # ファミコン＋スーファミ（235本・106MB）
    python3 tools/upload-to-pcloud.py --all
    python3 tools/upload-to-pcloud.py --pc98 --pick pc98-pick.txt   # PC-98 を選んで

`pc98-pick.txt` は上げる本を選ぶ表。1行に1つ `pc98.json` の id、`#` から後ろは覚え書き。
いまは**光栄・ブランディッシュ・麻雀悟空の42本**（119枚 ＋ BIOS 5個で 190.6MB）。
BIOS とフォントの ROM は、選び方に関係なく必ず一緒に上がる（無いと画面が出ない）。

パスワードはその場で聞く。画面にも履歴にもファイルにも残さない。
すでに上がっている分は飛ばすので、途中で止めても続きから流せる。

上げ終わったら、棚の「設定 → フォルダを選び直す」で `/ゲーム棚` を選ぶ。
中を丸ごと走査して、台帳の名前と突き合わせる（フォルダの入れ子は問わない）。

## 中継所は「速くする物」。無くても遊べる

pCloud の配信元（`ptok2.pcloud.com` など）は **CORS を返さない**。
`getfilelink` でも公開リンクの符号でも、リンクは取れるが中身を JS が掴めない。
（`<audio src>` は CORS 無しで鳴る。**中身をプログラムに渡すときだけ困る**）

→ 素の中継所を1台立てる。中身は `core/relay.js`（正本は
[`shelf-core/relay.js`](../shelf-core/relay.js)）。fileid を選ばないので棚もの共用。
いま使っているもの: `https://gamedana.d-shino.workers.dev`
立て方は [`shelf-core/wrangler.toml`](../shelf-core/wrangler.toml) の頭と、
棚の「設定 → 中継所」に書いてある。

**中継所が落ちても遊べる。** `api.pcloud.com` の `file_open` / `file_read` は
CORS が開いていて、ブラウザから直に読める。`PCloud.fetchFile` が
「中継所の直リンク → 公開リンク → 中継所なし」の順に自動で降りるので、
中継所を消しても、Cloudflare が落ちても、**遅くなるだけで止まらない。**

ROM は元々まるごと読んでからコアを起こすので、頭出しが効かない不利がここには無い。
ゲーム棚にとって中継所は、速さだけの物。

> 以前ここに「`file_open` は `2003` で使えない」と書いてあったが、
> `flags:0` と `fileid` の組み合わせで通る。`core/pcloud.js` の `readFile` が正しい。
>
> 音楽棚の中継所は「入口」に作り替わっていて合言葉の内側にある。ここからは 401。
> だから棚もの共用の素の中継所（`gamedana`）を別に持っている。

## 手元に置く

一度取り寄せた本は Cache Storage（`roms-v1`）に残る。次からは圏外でも遊べる。
棚では右上に ● が付く。「手元にある分」で絞り込める。

## 踏んだ罠

- **blob の URL で ROM を渡すと拡張子が消える。** EmulatorJS はそこから中身の種類を
  決めるので、`.nes` / `.smc` が分からず**灰色のまま止まる**。`File` にして名前ごと渡す。
  （EmulatorJS は `gameUrl` が `File` なら、読み込んだ後に名前へ差し替える造り）
- **EmulatorJS に日本語の言語ファイルは無い。** `ja-JP` も `ja` も 404。指定しない。
- **同じ文書で作り直せない。** 前のコアが残って音だけ鳴り続ける。1本1文書にして、
  閉じるときに iframe を `about:blank` にする。
- **隠れているページでは動かない。** ブラウザは見えていないページの
  `requestAnimationFrame` を止める。エミュレータのコアはそこで回っているので、
  裏のタブ・裏の窓では数フレームで止まる（不具合ではない）。

## PC-98

コアは NP2kai（**MIT**）を自分で wasm に組む。

    sh tools/build-np2kai.sh          # ~/.emsdk が無ければ入れるところから
    sh tools/build-np2kai.sh --clean  # 取り直してから

**本家のままでは通らない。台本が2つ当て木をする。**

1. **`-D__EMSCRIPTEN__=ON` が要る。** CMakeLists の Emscripten 用の枝は
   `if(__EMSCRIPTEN__)` で囲まれているが、これは CMake の変数で、Emscripten の
   ツールチェーンは定義しない（定義するのは `EMSCRIPTEN`）。未定義＝偽なので枝が丸ごと
   飛ばされ、`sdl/em`（`compiler.h` がある）が include に入らないまま組もうとして落ちる。
   README には書かれていない。
2. **libpng の枝が Emscripten に無い。** `find_package(PNG)` は
   `NOT EMSCRIPTEN` の中にあるのに、`PNG::PNG` は無条件で使われる。
   Emscripten には libpng の port があるので、それを指す入れ物を作って渡す。
3. **`mousemng_hidecursor` の呼び方が本家で間違っている。**
   宣言は `SDL_Window*` を取るのに、EMSCRIPTEN の枝だけ引数なしで呼んでいる。
   SDL2 では中で使わないので `NULL` を渡す。
4. **`bmsio_reset` だけ形が合っていない。**
   C-bus のリセット表は `void(*)(const NP2CFG*)` の並びなのに、`bmsio_reset` だけ
   `void bmsio_reset(void)` と宣言されている。ネイティブでは余分な引数が
   無視されて通ってしまうが、**wasm は呼び出しの形を照合するので必ず落ちる**
   （`function signature mismatch`、`pccore_reset` の中）。表のある場所で
   形を合わせる包みを噛ませる。表に並ぶ74個を総当たりで調べて、ずれているのはこれ1つだけ。

組み方でも3つ要る。

- **`-DCMAKE_BUILD_TYPE=Release`** — 既定はデバッグ情報込みで wasm が 11.9MB になる。
- **`-sALLOW_MEMORY_GROWTH=1`** — 本家は `INITIAL_MEMORY=64MB` / `MAXIMUM_MEMORY=1GB` を
  指定しているのに増やす許可を出していない。PC-98 の初期化は 64MB を超えるので
  `Cannot enlarge memory arrays（OOM）`で必ず落ちる。
- **`-sASYNCIFY=1`** — Emscripten の枝は `emscripten_sleep` を使う。
  許可が無いと `Please compile your program with async support` で落ちる。
  これを入れると wasm は 2.16MB → **3.09MB**。

出来上がりは `np2/`。**MIT なので `LICENSE.NP2kai` を必ず一緒に置く。**

### 遊ぶ画面（play98.html）

ファミコン・スーファミの `play.html` とは別立て（EmulatorJS ではないので）。

コアへの渡し方は、実測で次のとおり。

- **ディスクは argv に並べる。** `np2_main` が拡張子を見て FD / HDD の口に割り当てる。
  `Module.arguments = ['〜.fdi', …]`。口は2つまで。
- **置き場は根（`/`）に揃える。** コアは動かす場所を `./` として組み立てるので、
  別のフォルダに置いて `chdir` しても設定は `/np21kai.cfg` を見に行き、
  ROM もディスクも見つからない。
- **コアを起こす前に、ROM とディスクを仮想の置き場へ書いておく。**
  `addRunDependency` で待たせる（そのために `FS` ごと外に出して組んである）。
- **3枚目からの差し替えは `diskdrv_setfddex(drv, name, ftype, readonly)`。**
  `diskdrv_setfdd` は入れ物（マクロ）なので、実体を名指しで外に出してある。
  `ftype=0` は拡張子から見分けさせる指定。
- **セーブはディスクそのものに書かれる。** 離れるとき・隠れるときに `FS` から読み戻して
  手元の控え（Cache Storage）を上書きする。

### 確かめるときは音を止める

    sh tools/headless-shot.sh <URL> <出力.png> [ミリ秒]

`--mute-audio` が必ず入る。`play98.html?mute=1` でも音の器を塞げる。
**エミュレータは起動しただけで鳴る。**

ファミコンとスーファミは**実機の画面で動くことを確認済み**（2026-08-30）。

PC-98 も**実機の画面で動くことを確認済み**（2026-08-30）。
麻雀悟空で絵と音、麻雀大会（2枚組）で MS-DOS 3.10 の起動画面まで。

### 複数枚組は起動前に選ばせる

**起動する1枚は台帳では決まらない。** 麻雀大会は名前が A / B なのに **B が本体**だった。
台帳は名前から推しているだけなので外れる。so 複数枚組は起動前に
「1番の口 / 2番の口」を選ばせ、選んだ組み合わせを本ごとに覚える（`pg.fdpick`）。
帯の「ディスクを選び直す」でいつでも組み替えられる。
**入っている札も押せること** — 押せないと、いちばんやりたい入れ替えができない。

### 操作

| したいこと | やり方 |
|---|---|
| 本体の設定（CPU・メモリ・音源・画面） | 帯の「メニュー」＝ **Ctrl+F11**。F11 単独ではない |
| マウスを捕まえる／放す | 帯の「マウス」＝ **Ctrl+F12** |
| キーボード | 画面を一度クリックすれば PC-98 のキーボードに入る |
| 全画面 | 棚の覆いごと広げる。**どのエミュでも同じボタン** |

Mac は `fn` が要るうえ F11 が「デスクトップを表示」に取られるので、押しボタンを出してある。
差し替えとリセットの口も呼べることを確認済み。
ただし**絵が出ているところは未確認**。NP2kai は `emscripten_set_main_loop` を使わず
`emscripten_sleep` で自分の輪を回すので、隠れたページでは `setTimeout` が絞られて
ほとんど進まない（不具合ではない）。見えている画面で一度確かめること。

### ディスクの束ね方

    python3 tools/build-pc98-catalog.py           # pc98.json を書く
    python3 tools/build-pc98-catalog.py --show    # 束ね方を目で確かめる

282枚が平置きで、複数枚組（`_A/_B`・` 1/ 2`・`#1`・`ﾃﾞｨｽｸ1`・`Disk 1 of 2`・`DATA1`）と
道具ディスク（MS-DOS・N88BASIC・ATOK・一太郎）が混ざっている。題名で束ねると
**遊ぶもの88本・道具24本**になる。`np21/` は上の階層の写しなので数えない。

起動する1枚は札の役割で選ぶ（マスタープログラム → システム → プログラム →
ゲームディスク。セーブ・ユーザーディスクは最後）。

**名前は必ず NFC に直してから比べる。** macOS のファイル名は NFD なので、
そのままだと「セーブ」で始まるかどうかの判定すら通らない（実際に踏んだ）。

1本だけ、元の名前が失われて読めないものがある（`éáéõé¦é+éßé±ò¿îÛ.hdi`）。
どの文字集合でも戻らないので `garbled` の印を付けてある。手で名前を直すしかない。

## まだ

- **絵が出ているところの確認**（見えている画面で一度開く）
- PC-98 のディスクと BIOS を pCloud へ上げる
  （`python3 tools/upload-to-pcloud.py --pc98`、249枚＋ROM5個で 570MB）
- **箱絵の無い 89 本**（ファミコン・スーファミ）。集め方は音楽棚と同じ筋で。
