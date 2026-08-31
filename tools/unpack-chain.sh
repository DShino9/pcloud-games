#!/bin/sh
# 一括展開 → 走査 → 台帳の組み直し → 絵の索引更新（#82 の通し）
cd "$(dirname "$0")/.."
LOG=covers-found/unpack.log
echo "=== unpack-chain 開始 $(date '+%F %T')" >> "$LOG"
python3 tools/unpack-all.py    >> "$LOG" 2>&1
python3 tools/scan-emu.py      >> "$LOG" 2>&1
python3 tools/build-ledger.py  >> "$LOG" 2>&1
python3 tools/push-covers.py   >> "$LOG" 2>&1
echo "=== unpack-chain 終わり $(date '+%F %T')" >> "$LOG"
