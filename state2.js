'use strict';
/* 状態の一本化（#75）——**2冊に分けた版**。

   最初は1冊（台帳.json・丸ごと後勝ち）にしたら、端末が遊んだ記録を書くついでに
   **古い走査結果を新しい時刻で押し返し、Mac が組んだ 9,980 冊を上書き**した
   （2026-08-31 の夜に実際に起きた）。書く人が違うものは、冊を分けるしかない。

     /ゲーム棚/_台帳/走査.json   extra・files・pics・scan
         …… **Mac の道具と「いま見直す」だけ**が書く
     /ゲーム棚/_台帳/手元.json   renamed・genre2・fdpick・ver・plays・roots
         …… 端末が書く（8秒まとめて）

   開いたとき・画面に戻ったときに両方を見て、新しければ取り込む。
   見た目の好み（畳み・並び）と合鍵は端末に残す。 */

const S2 = {
  SCAN: ['extra', 'files', 'pics', 'scan'],
  HAND: ['renamed', 'genre2', 'fdpick', 'ver', 'plays', 'roots'],
  applying: false,
  timer: 0,
  busy: false,
  dirty: false,
};

async function s2folder() {
  return P.ensureFolder(S.rootId, '_台帳', { host: S.host, auth: S.auth });
}

async function s2read(fname) {
  const fid = await s2folder();
  const r = await call('listfolder', { folderid: fid });
  const f = (r.metadata.contents || []).find(x => P.nfc(x.name) === fname);
  if (!f) return null;
  /* **中継所ごしで読む。** file_open はこの倉庫では 2003 で断られる
     （ROM は通るのに、こちらで上げた JSON は駄目 —— 実測）。
     ROM と同じ、実績のある道を使う。 */
  const blob = await P.fetchFile(S.relay, { fileid: f.fileid, host: S.host, auth: S.auth });
  return JSON.parse(await blob.text());
}

async function s2write(fname, keys) {
  const body = { 書いた: new Date().toISOString(), 端末: deviceTag(), keys: {} };
  for (const k of keys) body.keys[k] = LS.get(k, null);
  const fid = await s2folder();
  const text = JSON.stringify(body);
  await P.uploadFile(fid, fname,
    new Blob([text], { type: 'application/json' }), { host: S.host, auth: S.auth });
  return body.書いた;
}

function s2apply(d, keys, stampKey) {
  S2.applying = true;
  try {
    for (const k of keys) if (d.keys && d.keys[k] != null) LS.set(k, d.keys[k]);
    /* **書けたことを確かめてから印を押す。** 印だけ先に付くと、
       中身が無いのに「取り込み済み」になり、直す糸口ごと消える。 */
    if (d.keys && Array.isArray(d.keys.extra)) {
      const got = LS.get('extra', []);
      if (!Array.isArray(got) || got.length !== d.keys.extra.length)
        throw new Error('端末に書き込めていません（' + got.length + '/' + d.keys.extra.length + '）');
    }
    LS.set(stampKey, d.書いた);
  } finally { S2.applying = false; }
}

function s2rebuild() {
  S.files = LS.get('files', {});
  S.roots = LS.get('roots', S.roots || []);
  S.ver = LS.get('ver', {});
  S.plays = LS.get('plays', {});
  S.items = mergeCatalogs();
}

/* ---- 取り込む ---- */
async function s2pull() {
  if (!S.auth || !S.rootId) return false;
  /* 大きい控えの引っ越しが済むまで待つ（先に取り込むと、後から古い方で上書きされる）。 */
  while (!S2.ready) await new Promise(r => setTimeout(r, 100));
  let changed = false;
  try {
    const sc = await s2read('走査.json');
    if (sc && sc.書いた && sc.書いた > LS.get('scanAt3', '')) {
      s2apply(sc, S2.SCAN, 'scanAt3');
      changed = true;
      log.note(`走査の台帳を取り込んだ（${sc.端末 || '?'}・${String(sc.書いた).slice(0, 16)}）`);
    }
    const hd = await s2read('手元.json');
    if (hd && hd.書いた && hd.書いた > LS.get('handAt2', '')) {
      s2apply(hd, S2.HAND, 'handAt2');
      changed = true;
    }
  } catch (e) { S2.err = e.message; log.note('台帳を読めない: ' + e.message); }
  if (changed) s2rebuild();
  return changed;
}

/* ---- 端末の分（手元.json）を上げる ---- */
async function s2push() {
  if (!S.auth || !S.rootId || S2.busy) { S2.dirty = true; return; }
  S2.busy = true; S2.dirty = false;
  try {
    LS.set('handAt2', await s2write('手元.json', S2.HAND));
  } catch (e) {
    S2.dirty = true;
    log.note('手元の台帳を上げられない: ' + e.message);
  } finally {
    S2.busy = false;
    if (S2.dirty) s2schedule();
  }
}

function s2schedule() {
  clearTimeout(S2.timer);
  S2.timer = setTimeout(s2push, 8000);
}

/* ---- 走査の分（走査.json）。**「いま見直す」が走ったときだけ**上げる ---- */
async function s2pushScan() {
  if (!S.auth || !S.rootId) return;
  try {
    LS.set('scanAt3', await s2write('走査.json', S2.SCAN));
    log.note('走査の台帳を倉庫へ');
  } catch (e) { log.note('走査の台帳を上げられない: ' + e.message); }
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
    const blob = await P.fetchFile(S.relay, { fileid: f.fileid, host: S.host, auth: S.auth });
    const j = JSON.parse(await blob.text());
    LS.set('artmap', j.map || {});
    LS.set('genremap', j.ジャンル || {});
    LS.set('artAt', f.modified || '');
    S.items = mergeCatalogs();
    log.note(`箱絵の索引を取り込んだ: 絵 ${j.枚数 || 0} 枚・ジャンル ${Object.keys(j.ジャンル || {}).length} 本`);
  } catch (e) { log.note('箱絵の索引を読めない: ' + e.message); }
}

/* ---- 大きい控えの置き場 ----
   **localStorage は約5MBで頭を打つ。** 台帳（extra 8MB超）を LS.set すると
   **黙って失敗**し（store() は catch するだけ）、印だけ書けて中身が入らない
   —— 「取り込んだのに586冊のまま・バナーも出ない」の正体。
   大きい鍵は Cache API（数GB級）に置き、読み書きはメモリごしにする。 */
const BIG = ['extra', 'files', 'pics', 'itempath', 'hunted', 'gather', 'gtree'];
const M = {};
const DB = {
  async c() { return caches.open('pg-big-v1'); },
  async get(k) {
    const r = await (await this.c()).match('/big/' + encodeURIComponent(k));
    return r ? r.json() : undefined;
  },
  async set(k, v) {
    await (await this.c()).put('/big/' + encodeURIComponent(k),
      new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } }));
  },
};

/* ---- 配線 ---- */
/* 大きい鍵はメモリ＋Cache API へ。手元の鍵だけが押し上げの引き金になる。 */
(() => {
  const rawGet = LS.get.bind(LS);
  const rawSet = LS.set.bind(LS);
  LS.get = (k, d) => BIG.includes(k) ? (k in M ? M[k] : d) : rawGet(k, d);
  LS.set = (k, v) => {
    if (BIG.includes(k)) {
      M[k] = v;
      DB.set(k, v).catch(e => log.note('大きい控えを書けない: ' + e.message));
    } else {
      rawSet(k, v);
    }
    if (!S2.applying && S2.HAND.includes(k)) s2schedule();
    return true;
  };
  /* 起き上がり: 昔 localStorage に入っていた分は一度だけ引っ越し、
     以後は Cache API から読む。読み終わったら組み立て直す。 */
  (async () => {
    for (const k of BIG) {
      const legacy = rawGet(k, undefined);
      if (legacy !== undefined) {
        M[k] = legacy;
        try { await DB.set(k, legacy); localStorage.removeItem('pg.' + k); } catch (e) {}
      } else {
        try { const v = await DB.get(k); if (v !== undefined) M[k] = v; } catch (e) {}
      }
    }
    S2.ready = true;
    s2rebuild();
    render();
  })();
})();

/* 「いま見直す」（scanAll）が終わったら、走査の分を上げる。 */
addEventListener('load', () => {
  if (typeof scanAll === 'function') {
    const orig = scanAll;
    // eslint-disable-next-line no-global-assign
    scanAll = async function (...a) {
      const r = await orig.apply(this, a);
      s2pushScan();
      return r;
    };
  }
});

addEventListener('load', async () => {
  if (await s2pull()) render();
  /* 手元の分がまだ倉庫に無い初回は、この端末の分を種として上げる。 */
  else if (S.auth && S.rootId && !LS.get('handAt2', '')) s2schedule();
  s2art();
});
/* 画面に戻ってきたときも見る（別の端末や Mac が進めた分を拾う）。 */
addEventListener('visibilitychange', () => {
  if (!document.hidden) s2pull().then(ch => { if (ch) render(); s2art(); });
});
