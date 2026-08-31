#!/bin/sh
# 夜の通し（再起動後の再開）。**直列**で走らせ、耳読と取り合わない
# （nice で CPU を譲る・各道具の間隔制御はそのまま）。
cd "$(dirname "$0")/.."
LOG=covers-found/night.log
N="nice -n 15 python3"
echo "=== night-chain 開始 $(date '+%F %T')" >> "$LOG"
$N tools/unpack-all.py           >> "$LOG" 2>&1   # 残り〜836本（続きから）
$N tools/unpack-all.py --retry   >> "$LOG" 2>&1   # 駄目700本を新しい拡張子リストで
$N tools/scan-emu.py             >> "$LOG" 2>&1   # 展開後の姿で走査し直す
$N tools/build-ledger.py         >> "$LOG" 2>&1   # 走査.json を更新
$N tools/cover-hunt.py --hash    >> "$LOG" 2>&1   # 箱絵: ハッシュ照合の続き
$N tools/cover-hunt.py --search  >> "$LOG" 2>&1   # 箱絵: 題名照合つき検索
$N tools/cover-hunt.py --pics    >> "$LOG" 2>&1   # 箱絵: 最後の手段（倉庫の絵）
$N tools/crop-found.py           >> "$LOG" 2>&1   # 写真の箱を四角く起こす
$N tools/push-covers.py          >> "$LOG" 2>&1   # 確実な分だけ倉庫へ＋索引
echo "=== night-chain 終わり $(date '+%F %T')" >> "$LOG"
$N tools/cover-hunt.py           >> "$LOG" 2>&1   # 集計
