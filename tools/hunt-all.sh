#!/bin/sh
# 箱絵の大捜索を無人で通しで流す（#79）。走査待ち → ①ハッシュ → ②検索 → ③倉庫の絵
cd "$(dirname "$0")/.."
LOG=covers-found/run.log
echo "=== hunt-all 開始 $(date '+%F %T')" >> "$LOG"
until [ -f emu-files.json ]; do sleep 15; done
echo "--- 走査済みを確認 $(date '+%F %T')" >> "$LOG"
python3 tools/cover-hunt.py --hash --limit 30 >> "$LOG" 2>&1     # まず30本で様子見（記録に残る）
python3 tools/cover-hunt.py --hash          >> "$LOG" 2>&1
python3 tools/cover-hunt.py --search        >> "$LOG" 2>&1
python3 tools/cover-hunt.py --pics          >> "$LOG" 2>&1
echo "=== 終わり $(date '+%F %T')" >> "$LOG"
python3 tools/cover-hunt.py --report        >> "$LOG" 2>&1
