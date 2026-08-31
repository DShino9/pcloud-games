'use strict';
/* 状態の一本化（#75）。**端末には入れない** —— ブラウザを開けばどこでも同じ棚。

   これまで走査の結果（見つけた本 7,000冊・名前→fileid）や、目録で直した題名、
   ディスクの組み合わせ、選んだ版が**全部 localStorage にだけ**あった。
   別のブラウザで開くと空っぽになる（未達の最大項目だった）。

   → 倉庫の `/ゲーム棚/_台帳/台帳.json` に1つにまとめて置く。
     ・書くとき: 対象の鍵が変わったら、8秒まとめて1回上げる
     ・開くとき: 倉庫の台帳のほうが新しければ、端末に取り込んで描き直す
     ・新しい端末: つないだ瞬間に 7,000冊が揃う（走査し直さない）

   同期するのは**端末をまたぐ意味のあるものだけ**。
   見た目の好み（畳み・並び・札の大きさ）と合鍵は端末に残す。 */

const S2 = {
  /* 走査系 ／ 題名とジャンル ／ 遊び方 ／ 倉庫の場所 */
  KEYS: ['extra', 'files', 'pics', 'itempath', 'scan',
         'renamed', 'genre2', 'fdpick', 'ver', 'plays', 'roots'],
  applying: false,   // 取り込み中の書き込みで、また上げ直さないための旗
  timer: 0,
  busy: false,
  dirty: false,
};

async function s2folder() {
  return P.ensureFolder(S.rootId, '_台帳', { host: S.host, auth: S.auth });
}

/* ---- 上げる ---- */
async function s2push() {
  if (!S.auth || !S.rootId || S2.busy) { S2.dirty = true; return; }
  S2.busy = true; S2.dirty = false;
  try {
    const keys = {};
    for (const k of S2.KEYS) keys[k] = LS.get(k, null);
    const at = new Date().toISOString();
    const body = JSON.stringify({ 書いた: at, 端末: deviceTag(), keys });
    const fid = await s2folder();
    await P.uploadFile(fid, '台帳.json',
      new Blob([body], { type: 'application/json' }), { host: S.host, auth: S.auth });
    LS.set('syncAt', at);
    log.note('台帳を倉庫へ（' + Math.round(body.length / 1024) + 'KB）');
  } catch (e) {
    S2.dirty = true;               // 駄目なら次の変更のときにまた試す
    log.note('台帳を上げられない: ' + e.message);
  } finally {
    S2.busy = false;
    if (S2.dirty) s2schedule();
  }
}

function s2schedule() {
  clearTimeout(S2.timer);
  S2.timer = setTimeout(s2push, 8000);
}

/* ---- 取り込む ---- */
async function s2pull() {
  if (!S.auth || !S.rootId) return false;
  try {
    const fid = await s2folder();
    const r = await call('listfolder', { folderid: fid });
    const f = (r.metadata.contents || []).find(x => x.name === '台帳.json');
    if (!f) return false;
    /* 配信元（getfilelink の先）は CORS を返さないので、file_read の道で読む。 */
    const blob = await P.readFile(f.fileid, { host: S.host, auth: S.auth });
    const d = JSON.parse(await blob.text());
    const mine = LS.get('syncAt', '');
    if (!d.書いた || d.書いた <= mine) return false;   // 端末のほうが新しい
    S2.applying = true;
    try {
      for (const k of S2.KEYS) {
        if (d.keys && d.keys[k] != null) LS.set(k, d.keys[k]);
      }
      LS.set('syncAt', d.書いた);
    } finally { S2.applying = false; }
    /* 取り込んだら組み立て直す。 */
    S.files = LS.get('files', {});
    S.roots = LS.get('roots', S.roots || []);
    S.ver = LS.get('ver', {});
    S.plays = LS.get('plays', {});
    S.items = mergeCatalogs();
    log.note(`台帳を取り込んだ（${d.端末 || '?'} が ${String(d.書いた).slice(0, 16)} に書いた分）`);
    return true;
  } catch (e) {
    log.note('台帳を読めない: ' + e.message);
    return false;
  }
}

/* ---- 箱絵の索引（`/ゲーム棚/_絵/絵.json`。Mac 側の大捜索が書く）---- */
async function s2art() {
  if (!S.auth || !S.rootId) return;
  try {
    const r = await call('listfolder', { folderid: S.rootId });
    const d = (r.metadata.contents || []).find(c => c.isfolder && P.nfc(c.name) === '_絵');
    if (!d) return;
    const r2 = await call('listfolder', { folderid: d.folderid });
    const f = (r2.metadata.contents || []).find(c => P.nfc(c.name) === '絵.json');
    if (!f || (f.modified || '') === LS.get('artAt', '')) return;
    const blob = await P.readFile(f.fileid, { host: S.host, auth: S.auth });
    const j = JSON.parse(await blob.text());
    LS.set('artmap', j.map || {});
    LS.set('artAt', f.modified || '');
    log.note(`箱絵の索引を取り込んだ: ${j.枚数 || 0} 枚`);
  } catch (e) { log.note('箱絵の索引を読めない: ' + e.message); }
}

/* ---- 配線 ---- */
/* 書き込みに割り込む。同じ LS を app.js も見ているので、ここで1回だけ包む。 */
(() => {
  const raw = LS.set.bind(LS);
  LS.set = (k, v) => {
    raw(k, v);
    if (!S2.applying && S2.KEYS.includes(k)) s2schedule();
  };
})();

/* 開いたとき: 倉庫の台帳が新しければ取り込む。start() の描画と競わないよう、
   取り込めたら自分で描き直す。 */
addEventListener('load', async () => {
  if (await s2pull()) render();
  /* 倉庫にまだ台帳が無い初回は、この端末の分を種として上げる。 */
  else if (S.auth && S.rootId && !LS.get('syncAt', '')) s2schedule();
  s2art();
});
/* 画面に戻ってきたときも見る（別の端末で進めた分を拾う）。 */
addEventListener('visibilitychange', () => { if (!document.hidden) s2pull().then(ch => ch && render()); });
