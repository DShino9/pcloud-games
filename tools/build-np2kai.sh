#!/bin/sh
# NP2kai（PC-98 エミュレータ・MIT）を wasm に組む。
#
#   sh tools/build-np2kai.sh            組んで pcloud-games/np2/ に置く
#   sh tools/build-np2kai.sh --clean    取り直してから組む
#
# 道具は Emscripten。無ければ ~/.emsdk に入れる。
# NP2kai の CMakeLists は Emscripten のとき libpng の枝が抜けているので、
# その場で当て木をする（本家を直しているわけではない。組むたびに当てる）。
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK="${NP2KAI_WORK:-$HERE/.build/np2kai}"
OUT="$HERE/np2"
REPO=https://github.com/AZO234/NP2kai.git

if [ "$1" = "--clean" ]; then rm -rf "$WORK"; fi

# ---- 道具 ----
if [ ! -d "$HOME/.emsdk" ]; then
  echo "Emscripten を入れます（~/.emsdk）"
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$HOME/.emsdk"
  (cd "$HOME/.emsdk" && ./emsdk install latest && ./emsdk activate latest)
fi
# shellcheck disable=SC1091
. "$HOME/.emsdk/emsdk_env.sh" >/dev/null 2>&1
echo "emcc: $(emcc --version | head -1)"

# ---- 素 ----
mkdir -p "$(dirname "$WORK")"
if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 --recursive "$REPO" "$WORK"
fi

# ---- 当て木: Emscripten では libpng を port から取る ----
CM="$WORK/CMakeLists.txt"
if ! grep -q "NP2KAI_EM_PNG_PATCH" "$CM"; then
  python3 - "$CM" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding='utf-8')
need = 'target_link_libraries(NP2kai_bbase INTERFACE PNG::PNG)'
patch = '''# NP2KAI_EM_PNG_PATCH
# Emscripten のときは find_package(PNG) の枝を通らないので PNG::PNG が無い。
# Emscripten には libpng の port があるので、それを指す入れ物をここで作る。
if(EMSCRIPTEN AND NOT TARGET PNG::PNG)
\tadd_library(PNG::PNG INTERFACE IMPORTED)
\ttarget_compile_options(PNG::PNG INTERFACE "SHELL:-s USE_LIBPNG=1")
\ttarget_link_options(PNG::PNG INTERFACE "SHELL:-s USE_LIBPNG=1")
endif()
'''
assert need in s, "当て木の場所が見つからない"
p.write_text(s.replace(need, patch + need, 1), encoding='utf-8')
print("当て木を入れた")
PY
fi

# ---- 当て木2: Emscripten の枝だけ引数を渡し忘れている ----
# mousemng_hidecursor/showcursor は SDL_Window* を取る宣言なのに、
# EMSCRIPTEN の枝だけ引数なしで呼んでいる。SDL2 のときは中で window を使わないので
# NULL を渡せば通る（SDL3 の枝でだけ使われる）。本家の書き間違い。
MM="$WORK/sdl/mousemng.c"
if grep -q "mousemng_hidecursor();" "$MM"; then
  sed -i '' 's/mousemng_hidecursor();/mousemng_hidecursor(NULL);/; s/mousemng_showcursor();/mousemng_showcursor(NULL);/' "$MM"
  echo "当て木2を入れた"
fi

# ---- 当て木3: Emscripten に ssl / crypto は無い ----
# Emscripten 用の入れ物が m ssl crypto を繋ごうとするが、port が無いので連結で落ちる。
# 通信は切って組む（-DUSE_NETWORK=OFF）ので、この2つは要らない。
if grep -q "NP2kai_Emscripten_SDL2_base INTERFACE m ssl crypto" "$CM"; then
  sed -i '' 's/\(NP2kai_Emscripten_SDL[123]_base INTERFACE m\) ssl crypto/\1/' "$CM"
  echo "当て木3を入れた"
fi

# ---- 当て木4: bmsio_reset だけ形が合っていない ----
# C-bus のリセット表は void(*)(const NP2CFG*) の並びだが、bmsio_reset だけ
# void bmsio_reset(void) と宣言されている。ネイティブでは余分な引数が無視されて
# 通ってしまうが、wasm は呼び出しの形を照合するので
# 「function signature mismatch」で起動の途中（pccore_reset の中）で必ず落ちる。
# 表のある場所で形を合わせる包みを噛ませる（本家の宣言には触らない）。
CB="$WORK/cbus/cbuscore.c"
if ! grep -q "NP2KAI_EM_BMS_PATCH" "$CB"; then
  python3 - "$CB" <<'PYEOF'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding='utf-8', errors='surrogateescape')
shim = """/* NP2KAI_EM_BMS_PATCH */
static void bmsio_reset_cb(const NP2CFG *pConfig) { (void)pConfig; bmsio_reset(); }

static const FNIORESET resetfn[] = {"""
assert "static const FNIORESET resetfn[] = {" in s
s = s.replace("static const FNIORESET resetfn[] = {", shim, 1)
assert "\t\t\tbmsio_reset," in s or "bmsio_reset," in s
s = s.replace("bmsio_reset,", "bmsio_reset_cb,", 1)
p.write_text(s, encoding='utf-8', errors='surrogateescape')
print("当て木4を入れた")
PYEOF
fi

# ---- 当て木5: 譲る回数を減らす（カクつきの元） ----
# NP2kai は輪が1回まわるたびに emscripten_sleep(0) を呼ぶ。
# ブラウザではこれが setTimeout に化け、1回あたり 4〜7ms かかる。
# つまり**どんなに軽くても毎秒 150 回前後が上限**。PC-98 は 60 コマ要るので、
# 1コマ分の仕事が数回に分かれた時点で間に合わなくなり、描くのを間引き始める
# （実測: 輪 145回/秒 に対して 絵は 10.5 コマ/秒）。
# 時間で区切って譲れば、そのあいだは詰めて計算できる。
# 2026-08-30、これを入れたあと固まったので一度外したが、**冤罪だった**。
# 本当の原因は EXPORTED_FUNCTIONS に np2web_* を書いていたこと
# （落とされると missing Wasm export で起動ごと死ぬ）。こちらは無罪。
NP="$WORK/sdl/np2.c"
if ! grep -q "NP2KAI_EM_YIELD_PATCH" "$NP"; then
  python3 - "$NP" <<'PYEOF'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding='utf-8', errors='surrogateescape')
old = """//\t\temscripten_sleep_with_yield(0);
\t\temscripten_sleep(0);"""
new = """/* NP2KAI_EM_YIELD_PATCH — 毎回譲るとブラウザでは 1 回 4〜7ms かかり、
   どんなに軽くても毎秒 150 回が上限になる。時間で区切って譲る。 */
\t\t{
\t\t\tstatic double np2web_last = 0;
\t\t\tdouble np2web_now = emscripten_get_now();
\t\t\tif (np2web_now - np2web_last >= 8.0) {
\t\t\t\tnp2web_last = np2web_now;
\t\t\t\temscripten_sleep(0);
\t\t\t}
\t\t}"""
assert old in s, "譲るところが見つからない"
p.write_text(s.replace(old, new, 1), encoding='utf-8', errors='surrogateescape')
print("当て木5を入れた")
PYEOF
fi

# ---- 当て木6: メニューとマウスを直に呼べるようにする ----
# 本家はブラウザ版で Ctrl+F11 / Ctrl+F12 に割り当てているが、判定が
# mod == KMOD_LCTRL の**完全一致**なので、こちらが作った鍵では通らないことがある。
# Mac は fn も要り、F11 は OS に取られる。押しボタンから直に呼べる口を足す。
TM="$WORK/sdl/taskmng.c"
if ! grep -q "NP2KAI_EM_HOOK_PATCH" "$TM"; then
  cat >> "$TM" <<'CEOF'

/* NP2KAI_EM_HOOK_PATCH — 画面の押しボタンから直に呼ぶための口。
   鍵を作って送る道は、本家の完全一致の判定に阻まれることがある。 */
#if defined(EMSCRIPTEN) && !defined(__LIBRETRO__)
#include <emscripten.h>
#include <statsave.h>
EMSCRIPTEN_KEEPALIVE void np2web_menu(void) {
	if (menuvram == NULL) {
		sysmenu_menuopen(0, 0, 0);
	} else {
		menubase_close();
	}
}
EMSCRIPTEN_KEEPALIVE void np2web_mouse(void) {
	mousemng_toggle(MOUSEPROC_SYSTEM);
}
/* いつでもセーブ／巻き戻し。
   statsave_save/load は「頼むだけ」で、実際の書き出しは主ループが
   フレームの切れ目で行う（g_u8ControlState を見ている）。
   だから画面から呼んでも、途中の状態を掴むことがない。 */
EMSCRIPTEN_KEEPALIVE void np2web_savestate(const char *path) {
	statsave_save((const OEMCHAR *)path);
}
EMSCRIPTEN_KEEPALIVE void np2web_loadstate(const char *path) {
	statsave_load((const OEMCHAR *)path);
}
#endif
CEOF
  echo "当て木6を入れた"
fi

# ---- 組む ----
# 心臓は2種類組む。
#   asyncify … どこでも動くが、1コマごとにスタックを巻き戻すので重い
#   jspi     … ブラウザ側の仕組みで切り替える。速いが対応した端末だけ
# NP2kai は1コマごとに emscripten_sleep(0) を呼ぶ造りなので、この差が大きく出る。
MODE="${NP2KAI_MODE:-asyncify}"
if [ "$MODE" = "jspi" ]; then
  EMLINK="-sALLOW_MEMORY_GROWTH=1 -sJSPI=1"
else
  EMLINK="-sALLOW_MEMORY_GROWTH=1 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=32768"
fi
# **器ごと分ける。** 出来上がりを後から改名しても、JS の中に焼き付いた
# wasm の名前は変わらない。改名していたせいで
# 「JSPI の JS が ASYNCIFY の wasm を読む」状態になり、起動が死んだ（実際に踏んだ）。
OUT="$OUT/$MODE"
EMLINK="$EMLINK -sFORCE_FILESYSTEM=1 -lidbfs.js"
# 画面からディスクを差し替えるのに要る。diskdrv_setfdd は入れ物（マクロ）なので、
# 実体の diskdrv_setfddex を名指しで外に出す。
# np2web_* は EMSCRIPTEN_KEEPALIVE で出させる。ここに名前を書くと、
# 落とされたときに「missing Wasm export」で**起動そのものが死ぬ**（実際に踏んだ）。
# 無ければ画面側が鍵を送る道に降りるので、ここでは要求しない。
EMLINK="$EMLINK -sEXPORTED_FUNCTIONS=_main,_diskdrv_setfddex,_pccore_reset"
EMLINK="$EMLINK -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,addRunDependency,removeRunDependency,callMain,ccall,cwrap,getValue,setValue" 

mkdir -p "$WORK/build"
cd "$WORK/build"
# -D__EMSCRIPTEN__=ON が要る。CMakeLists の Emscripten 用の枝は
# if(__EMSCRIPTEN__) で囲まれており、これは CMake の変数。定義しないと偽になり、
# sdl/em（compiler.h がある）が include に入らないまま組もうとして落ちる。
# README には書かれていないが、これが無いと通らない。
# Release で組む。既定のままだとデバッグ情報が入って wasm が 12MB になる。
# ウェブに置くものなので、最適化して落とす。
emcmake cmake .. -D__EMSCRIPTEN__=ON -DUSE_SDL=2 -DUSE_NETWORK=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_EXE_LINKER_FLAGS="$EMLINK"

# ALLOW_MEMORY_GROWTH が要る。本家は INITIAL_MEMORY=64MB / MAXIMUM_MEMORY=1GB を
# 指定しているが、増やす許可を出していない。PC-98 の初期化は 64MB を超えるので、
# 「Cannot enlarge memory arrays（OOM）」で必ず落ちる。
# MAXIMUM_MEMORY は増やす許可とセットでないと意味が無い、と emcc も警告を出す。
#
# ASYNCIFY も要る。NP2kai の Emscripten の枝は emscripten_sleep を使うが、
# 非同期の許可が無いと「Please compile your program with async support」で落ちる。
#
# FS と addRunDependency を外に出す。自前の画面は、ディスクと ROM を
# 仮想の置き場へ書いてから心臓を起こす造りなので、この2つが要る。
# IDBFS はセーブを端末に残すため。
# SDL2 版だけを組む。SDL3 版の的は USE_SDL=2 では入れ物が作られないのに
# 繋ごうとして落ちる（本家の的の切り分けが甘い）。
make -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" emnp21kai_sdl2

# ---- 置く ----
mkdir -p "$OUT"
found=0
for f in emnp21kai_sdl2.js emnp21kai_sdl2.wasm emnp21kai_sdl2.html emnp21kai_sdl2.data; do
  if [ -f "$f" ]; then cp "$f" "$OUT/"; echo "置いた: np2/$MODE/$f"; found=1; fi
done
cp "$WORK/LICENSE" "$OUT/LICENSE.NP2kai"
echo "NP2kai は MIT。LICENSE.NP2kai を必ず一緒に置くこと。" > "$OUT/README.txt"
[ "$found" = "1" ] || { echo "出来上がりが見つかりません"; ls; exit 1; }
