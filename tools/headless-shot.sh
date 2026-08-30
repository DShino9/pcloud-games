#!/bin/sh
# ブラウザの画面を1枚撮る（人の目に触れない確かめ用）。
#
#   sh tools/headless-shot.sh <URL> <出力.png> [仮想時計のミリ秒]
#
# **必ず音を止める。** 内部の確かめで音を鳴らさないこと。
# エミュレータは起動しただけで鳴り始めるので、指定を忘れると部屋に音が出る。
set -e
URL="$1"; OUT="$2"; VT="${3:-20000}"
[ -n "$URL" ] && [ -n "$OUT" ] || { echo "使い方: $0 <URL> <出力.png> [ミリ秒]"; exit 2; }
PROF=$(mktemp -d)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --mute-audio \
  --autoplay-policy=document-user-activation-required \
  --disable-audio-output \
  --disable-gpu --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader \
  --no-sandbox --hide-scrollbars --window-size=800,600 \
  --user-data-dir="$PROF" \
  --virtual-time-budget="$VT" \
  --screenshot="$OUT" \
  "$URL" >/dev/null 2>&1 || true
rm -rf "$PROF"
[ -f "$OUT" ] && echo "撮った: $OUT" || { echo "撮れなかった"; exit 1; }
