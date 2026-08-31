'use strict';
/* 言葉づかい（本人の指定・2026-08-31）
     **倉庫** … pCloud。ROM の置き場。「ここを倉庫にする」「倉庫にある分だけ」
     **棚**   … この画面。並べて遊ぶ所。「棚に上げる」＝棚に出るようにする
   「棚のフォルダ」のような、どちらとも取れる言い方はしない。

   ゲーム棚 — pCloud に預けた ROM を、ブラウザだけで遊ぶ。
   マウントは一切使わない。pCloud への入り方・取り方は共通部品（core/pcloud.js）に寄せてある。

   棚の中身（題名・機種・箱絵）は games.json。これは OpenEmu の台帳から
   tools/build-catalog.py で起こしたもので、pCloud には問い合わせない。
   pCloud に聞くのは「その名前のファイルが棚のどこにあるか（fileid）」だけ。 */

const P = window.PCloud;
const $ = s => document.querySelector(s);
const main = () => $('#main');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
/* ファミコンの1本は数十KB。MB で出すと全部「0.0MB」になって読めない。 */
const size = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1e3)) + 'KB';

const LS  = P.store('pg');
const log = P.logger(LS);
/* いま動いている版。**画面に出す。** 「直したのに変わらない」を
   毎回やり取りしないで済むように、見れば分かる所に置く。 */
const VERSION = (document.querySelector('script[src*="app.js"]') || {})
  .getAttribute?.('src')?.match(/v=(\d+)/)?.[1] || '?';

try { document.getElementById('hver').textContent = 'v' + VERSION; } catch (e) {}

const ROMS = P.shelfCache('roms-v1', 'rom.local');
/* 手で入れた箱絵。**置き場に入れずに端末の中に置く。**
   探しても出てこない本（`Aya3` など3本）と、切り出しを外した本を、
   本人がその場で直せるように。棚の絵より手で入れたほうを先に使う。 */
const MYCOV = P.shelfCache('covers-v1', 'cover.local');
/* ロゴを持っている機種。持っていないものは字の札のまま出す。 */
const LOGOS = { FC: 1, SFC: 1, N64: 1, DS: 1, PSP: 1, '98': 1 };

let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
}

/* 入口（ds9）の下では、中継所は入口の中に同居している。
   だから設定させない。住所が同じなので /relay で届く。
   github.io で直に開いたときだけ、これまで通り端末の設定を見る。
   （端末ごとに中継所を入れ直させるのが、そもそもの間違いだった） */
const UNDER_GATE = !/(^|\.)github\.io$/.test(location.hostname);
const RELAY_HERE = location.origin + '/relay';
const RELAY_DEFAULT = 'https://gamedana.d-shino.workers.dev';

const S = {
  host:     LS.get('host', P.HOSTS[0]),
  auth:     LS.get('auth', ''),
  email:    LS.get('email', ''),
  rootId:   LS.get('rootId', null),
  /* **見に行く場所は1つとは限らない。** ROM は `/EMU/ROM/…` のように
     メーカー別で整理されていることがある。そこへ移させるのは筋が悪い
     （せっかくの整理を崩す）ので、**その場所も見に行く**。
     上げ先・記録の置き先は rootId のまま。 */
  roots:    LS.get('roots', []),      // [{id, name}]
  rootName: LS.get('rootName', ''),
  /* **中継所は既定で入れておく。** 中継所なしの道（`file_open`）は
     この倉庫では `2003 Access denied` で塞がっている。
     未設定のまま遊ぼうとすると、そこで詰む（実際に詰んだ）。
     ゲーム棚用に立ててある素の中継所を初めから指しておく。 */
  relay:    UNDER_GATE ? RELAY_HERE : (LS.get('relay', '') || RELAY_DEFAULT),
  pub:      LS.get('pub', false),
  files:    LS.get('files', {}),      // NFCにした名前 → fileid
  plays:    LS.get('plays', {}),      // id → {n, last}
  sys:      LS.get('sys', ''),
  sort:     LS.get('sort', 'name'),
  lastPath: LS.get('lastPath', ''),
  /* **知らない束ね方は捨てる。** 「フォルダを掘る」を廃したのに、
     端末に残った `path` がそのまま使われ、どの束にも当てはまらず
     中身が消えていた（見出しだけ出て札が0枚）。
     **選び方を廃したら、古い覚えも捨てる。** */
  fold:     (k => ['', 'sys', 'genre', 'maker'].includes(k) ? k : 'sys')(LS.get('fold', 'sys')),
  cell:     LS.get('cell', 'm'),
  /* **鍵の名前を変えてある。** `view` の意味を途中で変えた（遊べる＝倉庫にある →
     遊べる＝取り寄せ済み）ので、前の選択が残っていると 0 本の札に留まってしまう。
     意味を変えたら鍵も変える。 */
  view:     LS.get('view2', 'all'),   // 遊べる / ぜんぶ / 倉庫に無い
  more:     {},                       // 束ごとに、いくつまで出したか
  ver:      LS.get('ver', {}),        // 束 → 選んだ版の id
  dig:      LS.get('dig', {}),        // 機種 → いま掘っている場所
  q:        '',
  tools:    LS.get('tools', false),   // PC-98 の道具ディスクも並べるか
  cat:      null,                     // games.json
  cat98:    null,                     // pc98.json
  items:    [],                       // 2つの台帳を1つにまとめたもの
  here:     {},
  covurl:   {},                      // 手で入れた箱絵（id → 見かけの住所）                       // id → 1（取り寄せた分）
};

/* 台帳が2つあるのは、中身の作りが違うから。
   ファミコン・スーファミは 1本＝1ファイル、PC-98 は 1本＝複数枚。
   棚に並べるところだけ、同じ形に揃える。 */
function mergeCatalogs() {
  const out = [];
  /* 走査で分かった在処（本 → 道）。掘り下げに要る。 */
  const IP = LS.get('itempath', {});
  /* 目録（コレクションの HTML）で拾い直した題名。 */
  const RN = LS.get('renamed', {});
  for (const g of ((S.cat && S.cat.games) || [])) {
    if (!g.core) continue;                       // ブラウザで動かない機種は出さない
    out.push({
      id: g.id, name: RN[g.id] || g.name, sub: g.title || '', system: g.system, short: g.short,
      cover: g.cover, bytes: g.bytes, kind: 'game', pc98: false, genre: g.genre || '',
      files: [g.file], path: IP[g.id] || '',
    });
  }
  /* 台帳に無い本。**pCloud には台帳より多く入っている。**
     台帳は Mac の中身から起こしたものなので、それ以外の道で pCloud に
     入れた分は載っていない。棚に出せないと「無いもの」になってしまうので、
     見つけた分を端末側で足す（置き場には触らない）。 */
  for (const e of LS.get('extra', [])) {
    out.push({ id: e.id, name: RN[e.id] || e.name, sub: e.sub || '', system: e.system, short: e.short,
               core: e.core, path: IP[e.id] || e.path || '',
               cover: e.cover || null, bytes: e.bytes || 0, kind: 'game',
               pc98: e.system === 'PC-98', genre: e.genre || '', files: e.files, extra: true });
  }
  for (const t of ((S.cat98 && S.cat98.titles) || [])) {
    out.push({
      id: t.id, name: RN[t.id] || t.name,
      sub: t.count > 1 ? t.count + '枚' : (t.hdd ? 'HDD' : ''),
      system: 'PC-98', short: '98',
      cover: t.cover || null, bytes: t.bytes, kind: t.kind, pc98: true, genre: '',
      files: t.disks.map(d => d.file),
      path: IP[t.id] || '',
      garbled: !!t.garbled,
    });
  }
  return out;
}

/* PC-98 は全部の枚が揃っていないと遊べない。1枚でも欠けていれば「棚にない」。 */
/* **取り寄せ済みか。しまう鍵が機種で違う。**
   ファミコン系は本の id で、PC-98 はディスクの fileid で置いている
   （遊ぶ画面が別なので、置き方も別々に育ってしまった）。
   `S.here[g.id]` だけを見ていたので、**PC-98 には一度も当たっていなかった**。 */
const gotIt = it => it.pc98
  ? it.files.length > 0 && it.files.every(f => S.here[String(S.files[P.nfc(f)])])
  : !!S.here[it.id];

const hasAll = it => it.files.length > 0 && it.files.every(f => !!S.files[P.nfc(f)]);

const call = (m, p, ms) => P.api(m, p, { host: S.host, auth: S.auth, ms });
const fileidOf = g => S.files[P.nfc(g.file)] || null;

function forget() {
  ['auth', 'email', 'rootId', 'rootName', 'files'].forEach(LS.del);
  Object.assign(S, { auth: '', email: '', rootId: null, rootName: '', files: {} });
}

async function scanFolder(folderid, say = () => {}) {
  say('pCloud の棚を見ています…');
  const r = await P.indexFolder(folderid, { host: S.host, auth: S.auth });
  S.files = r.map; LS.set('files', r.map);
  log.note('棚を走査: ' + r.count + ' ファイル');
  return r;
}

/* 棚のフォルダと、足した場所を**全部**見る。
   同じ名前があれば**棚のフォルダを優先**（そちらが本来の置き場）。 */
async function scanAll(say = () => {}) {
  const map = {};
  const seen = [];
  const ext = {};
  let count = 0;
  const report = [];
  const places = [...S.roots, ...(S.rootId ? [{ id: S.rootId, name: S.rootName }] : [])];
  for (const pl of places) {
    say(`${pl.name} を見ています…`);
    try {
      const r = await P.scanFolder(pl.id, { host: S.host, auth: S.auth,
        onStep: (n, left) => say(`${pl.name} を歩いています… ${n} ファイル・残り ${left} 部屋`) });
      for (const f of r.files) map[f.name] = f.fileid;   // 後に来る倉庫のフォルダが勝つ
      /* **在処つきの一覧もここで残す。** 「棚に上げる」で同じ所を
         もう一度歩かせるのは無駄（本人「もう持ってるでしょ」）。 */
      seen.push(...r.files.filter(f => sysOf(f.name).length));
      /* **何を拾って何を捨てたかを数える。** 「ROM は終わったのか?」に
         数字で答えられるように。拾っていない拡張子が大量にあれば、
         それは取りこぼしの手がかりになる。 */
      for (const f of r.files) {
        const e = (f.name.match(/\.([^.]{1,6})$/) || ['', '(拡張子なし)'])[1].toLowerCase();
        ext[e] = (ext[e] || 0) + 1;
      }
      count += r.files.length;
      report.push(`${pl.name}: ${r.files.length}`
        + (r.truncated ? `（<b style="color:var(--danger)">途中で打ち切り・残り ${r.left} 部屋</b>）` : ''));
      log.note(`走査: ${pl.name} ${r.files.length} ファイル`);
    } catch (e) {
      /* **黙って落とさない。** 1か所が駄目でも他は続けるが、
         どこが駄目だったかは必ず出す（棚が空の理由が分からなくなる）。 */
      report.push(`${pl.name}: 見られません（${e.message}）`);
      log.note(`走査できない: ${pl.name} — ${e.message}`);
    }
  }
  S.files = map; LS.set('files', map);
  /* **走ったことを残す。** 見えないと「スキャンしているか」が分からない。 */
  const top = Object.entries(ext).sort((a, b) => b[1] - a[1]).slice(0, 24)
    .map(([e, n]) => ({ e, n, 拾う: !!sysOf('x.' + e).length }));
  LS.set('scan', { at: new Date().toISOString().slice(0, 16).replace('T', ' '),
                   places: report, count, ext: top });
  /* 「棚に上げる」がそのまま使えるように、在処つきの一覧を渡しておく。 */
  S.gather = Object.assign(S.gather || { pick: {}, busy: false },
    { files: seen, where: { id: places[0] && places[0].id, name: '見に行く場所ぜんぶ' },
      at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
  keepGather(S.gather);
  const added = learnFrom(map, seen);
  /* **在処は台帳の本にも要る。** 掘り下げは在処が無いと出せないのに、
     台帳（`games.json`/`pc98.json`）から来た本は在処を持っていなかった。
     走査で分かった道を、本ごとに覚えておく。 */
  const byName = {};
  for (const f of seen) byName[f.name] = f.path || '';
  const ip = {};
  for (const it of S.items) {
    const p0 = byName[P.nfc(it.files[0])];
    if (p0) ip[it.id] = p0;
  }
  LS.set('itempath', ip);
  pushCatalog();          // 絵の捜索の続きは Mac 側がやる。題名を渡しておく
  return { count, kinds: Object.keys(map).length, places: places.length, added, report };
}

/* 見に行った場所で見つけた ROM のうち、**台帳に無いものを棚に起こす。**
   台帳は Mac の中身から作ったものなので、pCloud にしか無い分は載っていない。
   移させるのではなく、見つけた時点で棚に出す。置き場（GitHub）には触らない。 */
function learnFrom(map, seen = []) {
  /* **在処も持たせる。** 倉庫はメーカー別に分けてあるので
     （`/ROM/パソコン/PC-98/光栄`）、選ぶときもその形で見たい。 */
  const where = {};
  for (const f of seen) where[f.name] = f.path || '';
  const known = new Set();
  for (const g of ((S.cat && S.cat.games) || [])) known.add(P.nfc(g.file));
  for (const t of ((S.cat98 && S.cat98.titles) || []))
    for (const d of t.disks) known.add(P.nfc(d.file));

  const extra = LS.get('extra', []);
  const have = new Set(extra.flatMap(e => e.files));
  /* PC-98 は1本＝複数枚。`X_A.fdi` `X_B.fdi` のように末尾が1文字違いなら
     同じ本と見て束ねる（外れることもあるが、バラバラに並ぶよりは読める）。 */
  const group = new Map();
  for (const name of Object.keys(map)) {
    if (known.has(name) || have.has(name)) continue;
    const sys = sysOf(name);
    if (!sys.length) continue;
    if (/\b(bios|BIOS|font|sound)\b/i.test(name)) continue;
    const base = name.replace(/\.[^.]+$/, '');
    const key = sys[0] === 'PC-98'
      ? base.replace(/[ _-]?(disk)?[ _-]?[A-Da-d1-9]$/i, '')
      : base;
    if (!group.has(key)) group.set(key, { system: sys[0], short: sys[1], core: sys[2], files: [], base });
    group.get(key).files.push(name);
  }
  let n = 0;
  for (const [key, g] of group) {
    g.files.sort((a, b) => a.localeCompare(b, 'ja'));
    extra.push({ id: 'X-' + key, name: key, system: g.system, short: g.short,
                 core: g.core, bytes: 0, files: g.files,
                 path: where[g.files[0]] || '',
                 sub: g.files.length > 1 ? g.files.length + '枚' : '見つけた分' });
    n++;
  }
  if (n) { LS.set('extra', extra); S.items = mergeCatalogs(); }
  return n;
}

async function refreshHere() { S.here = await ROMS.list(); }

/* 手で入れた絵を読み戻す。見かけの住所（blob:）を作って札に渡す。 */
async function loadMyCovers() {
  S.covurl = {};
  for (const id of Object.keys(await MYCOV.list())) {
    const r = await MYCOV.get(id);
    if (r) S.covurl[id] = URL.createObjectURL(await r.blob());
  }
}

/* **どの画面からでも戻れるようにする。**
   奥まで潜ったとき、戻る道が画面ごとにばらばらだと迷う。
   見出しに「←（一つ上）」と「棚（トップ）」を常に置く。 */
const UP = {
  '#/set': '#/lib', '#/log': '#/set', '#/runs': '#/set', '#/relay': '#/set',
  '#/covers': '#/set', '#/disks': '#/set', '#/places': '#/set',
  '#/dupes': '#/places', '#/gather': '#/lib', '#/edit': '#/gather',
  '#/all': '#/lib',
};
function upOf(h) {
  if (h.startsWith('#/sys/')) return '#/lib';
  if (h.startsWith('#/places/')) return '#/places';
  if (h.startsWith('#/gather/')) return '#/gather';
  if (h.startsWith('#/dupes/')) return '#/dupes';
  if (h.startsWith('#/pick')) return '#/set';
  return UP[h] || '#/lib';
}

/* ============ 画面の振り分け ============ */
/* ハッシュが同じだと hashchange が飛ばない。同じときは自分で描き直す。 */
function go(h) { if (location.hash === h) render(); else location.hash = h; }
addEventListener('hashchange', render);

function render() {
  const h = location.hash || '#/lib';
  /* 見出しの戻り口。トップでは出さない（戻る先が無い）。 */
  try {
    const top = (h === '#/lib' || h === '');
    $('#hback').classList.toggle('hide', top);
    $('#hhome').classList.toggle('hide', top);
    $('#hback').onclick = () => go(upOf(h));
    $('#hhome').onclick = () => go('#/lib');
  } catch (e) {}
  document.body.dataset.cell = S.cell;
  $('#hcell').classList.toggle('hide', !S.auth || !S.rootId);
  if (h === '#/log')   return screenLog();
  if (h === '#/set')   return screenSet();
  if (h === '#/relay') return screenRelay();
  if (h === '#/edit')  return screenEdit();
  if (h === '#/runs')  return screenRuns();
  if (h === '#/disks') return screenDisks();
  if (h === '#/covers') return screenCovers();
  if (h.startsWith('#/gather/')) return screenGather(h.slice(9));
  if (h === '#/gather') return screenGather();
  if (h.startsWith('#/places/')) return screenPlaces(h.slice(9));
  if (h.startsWith('#/dupes/')) return dupesPick(h.slice(8));
  if (h === '#/dupes') return screenDupes();
  if (h === '#/places') return screenPlaces();
  if (!S.auth)         return screenLogin();
  if (h.startsWith('#/pick')) return screenPick(h.slice(7) || '0');
  if (!S.rootId)       return go('#/pick/0');
  /* 入口は**機種から**。本数が増えて（350本超）平らに並べても選べなくなった。 */
  if (h.startsWith('#/sys/')) return screenLib(decodeURIComponent(h.slice(6)));
  if (h === '#/all')          return screenLib('');
  return screenHome();
}

/* ============ 入口（機種を選ぶ） ============ */
/* **平らに並べない。** 機種が14に増え、本数も350を超えた。
   まず機種を選び、その中を見る。探すときだけ機種をまたぐ。 */
function screenHome() {
  $('#title').textContent = 'ゲーム棚';
  const box = new Map();
  for (const i of S.items) {
    if (i.kind !== 'game') continue;
    if (!box.has(i.system)) box.set(i.system, { all: 0, have: 0, short: i.short, cover: null });
    const b = box.get(i.system);
    b.all++;
    if (hasAll(i)) b.have++;
    if (gotIt(i)) b.got = (b.got || 0) + 1;
    /* 棚の顔にする絵は、その機種で**いちばん遊んだ本**の箱絵。
       無ければ絵のある本から1枚借りる。 */
    const cov = S.covurl[i.id] || i.cover;
    if (cov && (!b.cover || (S.plays[i.id] || {}).n > (b.playn || 0))) {
      b.cover = cov; b.playn = (S.plays[i.id] || {}).n || 0;
    }
  }
  const order = [...box.entries()].sort((a, b) => b[1].all - a[1].all);
  const total = [...box.values()].reduce((n, b) => n + b.all, 0);
  const held  = [...box.values()].reduce((n, b) => n + b.have, 0);

  main().innerHTML = `
  <div class="bar"><div class="row1">
    <input class="search" id="hq" placeholder="題名で探す（機種をまたいで）"
      autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="hbtn" id="hall">ぜんぶ見る</button>
    <button class="hbtn" id="haddto" style="margin-left:auto">＋ 棚に上げる</button>
  </div></div>
  <div class="sysgrid">
    ${order.map(([name, b]) => `
      <button class="sysc" data-sys="${esc(name)}" data-s="${esc(b.short)}">
        <div class="syscov">${b.cover ? `<img src="${esc(b.cover)}" alt="">` : ''}<i></i></div>
        <div class="syshead">
          ${LOGOS[b.short] ? `<img class="syslogo" src="logos/${esc(b.short)}.png" alt="${esc(name)}">`
                           : `<span class="systag">${esc(b.short)}</span>`}
          <span class="sysname">${esc(name)}</span>
        </div>
        <div class="syscnt">倉庫 <b>${b.have}</b> 本${
          b.got ? ` ・<span style="color:var(--ok)">棚に ${b.got}</span>` : ''}</div>
      </button>`).join('')}
  </div>
  <div class="sub" style="margin-top:14px" id="scanline">${(() => {
    const sc = LS.get('scan', null);
    return sc
      ? `倉庫を見たのは <b>${esc(sc.at)}</b>（${esc(String(sc.count))} ファイル）　`
        + sc.places.join('　／　')
        + ' <button class="hbtn sm" id="rescan2">いま見直す</button>'
      : '<b>まだ倉庫を見ていません。</b> <button class="hbtn sm" id="rescan2">いま見直す</button>';
  })()}</div>
  <div class="sub" style="margin-top:6px">全部で ${total} 本。うち <b>${held} 本</b>が倉庫にあり、<b>${S.items.filter(gotIt).length} 本</b>を棚に取り寄せ済みです。<br>倉庫に無い本は遊べません。設定 →「倉庫の場所」で置き場を足すか、「＋ 棚に上げる」から。</div>`;

  for (const b of main().querySelectorAll('[data-sys]'))
    b.onclick = () => go('#/sys/' + encodeURIComponent(b.dataset.sys));
  $('#hall').onclick = () => go('#/all');
  $('#haddto').onclick = () => go('#/gather');
  const rs = $('#rescan2');
  if (rs) rs.onclick = async () => {
    const line = $('#scanline');
    rs.disabled = true;
    try {
      const r = await scanAll(t => { line.textContent = t; });
      S.items = mergeCatalogs();
      screenHome();
      const l2 = $('#scanline');
      if (l2) l2.innerHTML = `見直しました: ${r.places} か所・${r.count} ファイル`
        + (r.added ? `／<b>${r.added} 本</b>を新たに棚へ` : '／新しい本はありませんでした')
        + '<br>' + r.report.join('　／　');
    } catch (e) { line.textContent = '見られません: ' + e.message; rs.disabled = false; }
  };
  /* 探すのは機種をまたぐ。打ち始めたら一覧へ移る。 */
  $('#hq').oninput = e => {
    const v = e.target.value;
    if (!v.trim()) return;
    S.q = v; LS.set('q', v);
    go('#/all');
    setTimeout(() => { const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(v.length, v.length); } }, 30);
  };
}

/* ============ ログイン ============ */
function screenLogin(keep) {
  $('#title').textContent = 'ゲーム棚';
  main().innerHTML = `
  <div class="card">
    <h2>ゲーム棚</h2>
    <p>pCloud の<b>倉庫</b>に預けた ROM を、ブラウザだけで遊ぶ。<br>棚（この画面）の中身は端末に入っているので、まず倉庫につなぐ。</p>
    <div class="field"><label>pCloud のメールアドレス</label>
      <input id="em" type="email" autocomplete="username" autocapitalize="off"
        autocorrect="off" spellcheck="false" value="${esc(S.email)}"></div>
    <div class="field"><label>パスワード</label>
      <input id="pw" type="password" autocomplete="current-password"></div>
    <button class="primary" id="go">つなぐ</button>
    <div class="msg" id="m">${keep || ''}</div>
    <div class="note">
      あて先は <b>pcloud.com</b> だけ。合鍵はこの端末にだけ残り、どこにも送らない。<br>
      渡し方によっては、暗号化した通信でパスワードそのものを pCloud に送る。<br>
      パスワードは端末にも控えにも残さない。<br>
      うまくいかないときは <button class="hbtn" id="lg" style="padding:3px 8px;font-size:11.5px">押した記録</button>
    </div>
  </div>`;
  $('#lg').onclick = () => go('#/log');
  const say = (t, cls) => { const m = $('#m'); if (m) { m.textContent = t; m.className = 'msg' + (cls ? ' ' + cls : ''); } };
  $('#go').onclick = async () => {
    const em = $('#em').value.trim(), pw = $('#pw').value;
    if (!em || !pw) return say('メールとパスワードを入れてください', 'err');
    $('#go').disabled = true;
    log.note('つなぐを押した（メール' + em.length + '字 / パスワード' + pw.length + '字）');
    try {
      const r = await P.login(em, pw, t => say(t), log);
      /* 合鍵が無ければここで止める。成功したことにして先に進まない。 */
      if (!r || !r.auth) throw new P.PCloudError(-6, '合鍵が手に入りませんでした');
      S.host = r.host; S.auth = r.auth; S.email = r.email;
      LS.set('host', r.host); LS.set('auth', r.auth); LS.set('email', r.email);
      say('つながりました', 'ok');
      go('#/pick/0');
    } catch (e) {
      log.note('失敗: ' + e.code + ' ' + e.message);
      say(e.message + '（記録は「押した記録」から読めます）', 'err');
      $('#go').disabled = false;
    }
  };
}

/* ============ フォルダを選ぶ ============ */
async function screenPick(folderid) {
  $('#title').textContent = '倉庫のフォルダを選ぶ';
  /* **つないでいないと倉庫は見られない。** 先に断る（黙って待たせない）。 */
  if (!S.auth) {
    main().innerHTML = `<div class="card" style="max-width:560px">
      <div class="msg err">まだ pCloud につないでいません。</div>
      <button class="hbtn" id="back">← 戻る</button></div>`;
    $('#back').onclick = () => go('#/lib');
    return;
  }
  const t0 = Date.now();
  main().innerHTML = `<div class="card" style="max-width:560px">
    <p id="wait">見ています…</p>
    <div class="sub" id="slow" style="display:none;margin-top:8px">
      返事がありません。つながりが細いか、pCloud が混んでいます。</div>
    <button class="hbtn" id="again0" style="display:none;margin-top:8px">もう一度</button>
  </div>`;
  $('#again0').onclick = () => screenPlaces(folderid);
  const tick = setInterval(() => {
    const w = $('#wait');
    if (w) w.textContent = `見ています… ${Math.round((Date.now() - t0) / 1000)} 秒`;
    /* 8秒で「やり直す」を出す。待ち切るまで何もできないのは不親切。 */
    if (Date.now() - t0 > 8000) {
      const sl = $('#slow'), ag = $('#again0');
      if (sl) sl.style.display = '';
      if (ag) ag.style.display = '';
    }
  }, 1000);
  log.note(`倉庫を開く: folderid=${folderid}`);
  let r;
  try { r = await call('listfolder', { folderid }, 60000); }
  catch (e) {
    main().innerHTML = `<div class="card"><h2>開けません</h2><div class="msg err">${esc(e.message)}</div>
      <button class="primary" id="out" style="margin-top:14px">つなぎ直す</button></div>`;
    $('#out').onclick = () => { forget(); go('#/lib'); };
    return;
  }
  const md = r.metadata;
  const dirs = (md.contents || []).filter(c => c.isfolder)
    .sort((a, b) => collator.compare(a.name, b.name));
  const up = md.parentfolderid != null && String(folderid) !== '0';

  /* 同じ名前のフォルダが並ぶことがある。
     macOS 由来の名前は NFD、こちらが作る名前は NFC で、pCloud は字面で比べるため、
     「既にあるのに見つからず、もう一つ作られる」ことが起きる。
     名前だけでは選べないので、同名のものに限って中身を数えて見分けをつける。 */
  const seen = {};
  for (const d of dirs) { const k = P.nfc(d.name); seen[k] = (seen[k] || 0) + 1; }
  const dup = dirs.filter(d => seen[P.nfc(d.name)] > 1);
  main().innerHTML = `
  <div class="card" style="max-width:560px">
    <h2>ROM を置いた倉庫のフォルダ</h2>
    <p>この中を丸ごと見て、台帳の名前と突き合わせる。中の入れ子は問わない。</p>
    <div style="font-size:13px;color:var(--dim);margin-bottom:10px;word-break:break-all">
      ${esc(md.name || '/')}</div>
    <div class="rowlist">
      ${up ? `<button class="row" data-id="${md.parentfolderid}"><span class="nm">← 上へ</span></button>` : ''}
      ${dirs.map(d => `<button class="row" data-id="${d.folderid}">
        <span class="nm">📁 ${esc(d.name)}</span>
        <span class="sub" data-peek="${d.folderid}">${seen[P.nfc(d.name)] > 1 ? '数えています…' : '開く'}</span>
        </button>`).join('')
        || '<div class="row"><span class="sub">フォルダはありません</span></div>'}
    </div>
    <button class="primary" id="use">ここを倉庫にする</button>
    <div class="msg" id="m"></div>
    <div class="note">まだ ROM を上げていないなら、先に上げてから。<br>
      やり方は置き場の README（tools/upload-to-pcloud.py）に書いてある。</div>
  </div>`;
  main().querySelectorAll('.row[data-id]').forEach(b =>
    b.onclick = () => go('#/pick/' + b.dataset.id));

  /* 同名のものだけ中を覗く。全部覗くと開くのが遅くなる。 */
  if (dup.length) {
    const mine = location.hash;
    (async () => {
      for (const d of dup) {
        let txt = '見られません';
        try {
          const rr = await call('listfolder', { folderid: d.folderid });
          const cs = rr.metadata.contents || [];
          const nd = cs.filter(c => c.isfolder).length;
          const nf = cs.length - nd;
          txt = cs.length ? `中に ${nd ? nd + ' フォルダ' : ''}${nd && nf ? '・' : ''}${nf ? nf + ' ファイル' : ''}`
                          : '空っぽ';
        } catch (e) {}
        if (location.hash !== mine) return;
        const el = main().querySelector(`[data-peek="${d.folderid}"]`);
        if (el) el.textContent = txt;
      }
    })();
  }

  $('#use').onclick = async () => {
    $('#use').disabled = true;
    const say = t => { const m = $('#m'); if (m) m.textContent = t; };
    try {
      const r2 = await scanFolder(folderid, say);
      S.rootId = folderid; S.rootName = md.name || '/';
      LS.set('rootId', folderid); LS.set('rootName', S.rootName);
      const hit = (S.cat ? S.cat.games : []).filter(fileidOf).length;
      toast(r2.count + ' ファイル中 ' + hit + ' 本が棚と合いました');
      go('#/lib');
    } catch (e) {
      log.note('走査に失敗: ' + e.message);
      say(e.message); $('#use').disabled = false;
    }
  };
}

/* ============ 版違いをまとめる ============ */
/* 倉庫には同じ本の版がいくつも入っている
   （`4人打ち麻雀` `4人打ち麻雀 [a1][b1]` `4人打ち麻雀 (FMG Pirate) [p1]` …）。
   **棚では1冊に見せる。** 版は取り寄せるとき・起動するときに選ぶ。
   3380本の多くはこれで、並べたままでは探せない。 */
const DUMP_TAG = /\[(a|b|o|p|t|h|f|!|hM|hI|hFFE)\d*\]|\[!\]|\[[a-z]\]/gi;

function baseName(n) {
  return String(n)
    .replace(/\.[^.]+$/, '')
    .replace(DUMP_TAG, ' ')
    .replace(/\((FMG[^)]*|Pirate|Hack[^)]*|Rev\s*\w+|V\d[\d.]*|PRG\d|MODE7|WRG\w*)\)/gi, ' ')
    .replace(/\((JU|J|U|E|UE|JE|W|Japan|USA|Europe|World)\)/gi, ' ')
    .replace(/^\d{3,4}\s*-\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 表に出す単位。同じ機種・同じ base で束ねる。 */
/* その版を見分ける印だけ抜く（`いっき [!]` → `[!]`）。
   棚に入れた版がどれかを、短く添えるために使う。 */
function verTag(name) {
  const base = baseName(name);
  const rest = String(name).replace(/\.[^.]+$/, '').replace(base, '').trim();
  return rest ? '棚: ' + rest : '棚にある';
}

function grouped(list) {
  const box = new Map();
  for (const i of list) {
    const key = i.system + '|' + baseName(i.name);
    if (!box.has(key)) box.set(key, []);
    box.get(key).push(i);
  }
  const out = [];
  S.gmap = {};
  for (const [key, vs] of box) {
    /* 代表は「素の名前に近いもの」。付け足しが少ない＝短いものを採る。 */
    vs.sort((a, b) => a.name.length - b.name.length || collator.compare(a.name, b.name));
    /* **棚に入れた版があれば、それが「正」。**
       取り寄せた時点で「どれを使うか」は決まっているので、
       倉庫側の版違いをもう並べる必要はない（本人の気づき）。
       次に選んだ版、それも無ければ素の名前に近いもの。 */
    const onShelf = vs.find(gotIt);
    const chosen = onShelf || vs.find(v => v.id === (S.ver[key] || '')) || vs[0];
    out.push(vs.length === 1 ? chosen
      : (S.gmap[key] = vs, { ...chosen,
          name: baseName(chosen.name) || chosen.name,
          gkey: key, vers: vs,
          /* 棚に入っていれば、どの版かを添える（決まっているので数は出さない）。 */
          settled: !!onShelf,
          sub: onShelf ? verTag(onShelf.name) : '' }));
  }
  return out;
}

/* ============ 棚 ============ */
function shelfList() {
  let list = grouped(S.items);
  /* 3つの見方。遊べる＝倉庫にある。倉庫に無いものは遊べないので分けて置く。 */
  if (S.view === 'play') list = list.filter(gotIt);
  else if (S.view === 'all') list = list.filter(hasAll);
  else if (S.view === 'none') list = list.filter(i => !hasAll(i));
  if (!S.tools) list = list.filter(g => g.kind === 'game');   // 道具ディスクは既定で伏せる
  if (S.sys) list = list.filter(g => g.system === S.sys);
  if (S.genre) list = list.filter(g => g.genre === S.genre);

  const q = S.q.trim().toLowerCase();
  if (q) list = list.filter(g =>
    (g.name || '').toLowerCase().includes(q) ||
    (g.sub || '').toLowerCase().includes(q) ||
    g.files.some(f => f.toLowerCase().includes(q)));
  const pl = g => (S.plays[g.id] || {});
  const cmp = {
    name:  (a, b) => collator.compare(a.name, b.name),
    sys:   (a, b) => collator.compare(a.system, b.system) || collator.compare(a.name, b.name),
    plays: (a, b) => (pl(b).n || 0) - (pl(a).n || 0) || collator.compare(a.name, b.name),
    last:  (a, b) => (pl(b).last || 0) - (pl(a).last || 0) || collator.compare(a.name, b.name),
    size:  (a, b) => b.bytes - a.bytes,
  }[S.sort] || ((a, b) => collator.compare(a.name, b.name));
  /* 棚に無い本は後ろへ。上げていない機種で埋まって、遊べる本が沈むのを防ぐ。 */
  return list.sort((a, b) => (hasAll(b) - hasAll(a)) || cmp(a, b));
}

function screenLib(sys) {
  if (sys !== undefined) {
    S.sys = sys; LS.set('sys', sys);
    /* **本数が多い機種は、はじめから束ねて開く。** 3000本を平らに並べても選べない。
       ここで `path`（廃した束ね方）を入れ続けていたのが、
       棚が `PC-98` 1束・中身なしになっていた正体。**廃したものは代入もしない。** */
    const n = S.items.filter(i => i.system === sys);
    if (n.length > 300 && !LS.get('foldPicked', false)) S.fold = 'sys';
  }
  const list = shelfList();
  const systems = [...new Set(S.items.map(i => i.system))].sort();
  /* ジャンルは多い順に。数が少ないものは末尾に沈むので探しやすい。 */
  const gcount = {};
  for (const i of S.items) if (i.genre) gcount[i.genre] = (gcount[i.genre] || 0) + 1;
  const genres = Object.entries(gcount).sort((a, b) => b[1] - a[1]);
  $('#title').textContent = S.sys || 'ゲーム棚';
  /* 「棚にない」は絞り込みに関係なく棚全体の話。並べ直しでは書き換わらないので、
     いま出ている一覧の数ではなく、遊べるもの全体から数える。 */
  /* 札に出す数。**説明文の代わりに数で示す**（耳読の書棚と同じ作り）。
     いま見ている機種の中で数える（機種を選んで入っているので）。 */
  const inSys = S.items.filter(i => i.kind === 'game' && (!S.sys || i.system === S.sys));
  const nAll = inSys.length;
  /* **遊べる＝棚にある＝取り寄せ済み。** すぐ遊べるもの。
     **倉庫＝pCloud にある。** 遊ぶには取り寄せが要る（取り寄せ済みも含む蔵書）。 */
  const nPlay = inSys.filter(gotIt).length;
  const nWare = inSys.filter(hasAll).length;
  const nNone = nAll - nWare;
  const missing = nNone;
  main().innerHTML = `
  <div class="bar"><div class="row1">
    <div class="seg">
      <button data-view="play"${S.view === 'play' ? ' class="on"' : ''}>遊べる (${nPlay})</button>
      <button data-view="all"${S.view === 'all' ? ' class="on"' : ''}>倉庫 (${nWare})</button>
      ${nNone ? `<button data-view="none"${S.view === 'none' ? ' class="on"' : ''}>倉庫に無い (${nNone})</button>` : ''}
    </div>
    <input class="search" id="q" placeholder="題名で探す" value="${esc(S.q)}"
      autocapitalize="off" autocorrect="off" spellcheck="false">
    <select id="sys">
      <option value=""${S.sys ? '' : ' selected'}>ぜんぶ</option>
      ${systems.map(n => `<option value="${esc(n)}"${S.sys === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <select id="gen">
      <option value=""${S.genre ? '' : ' selected'}>ジャンル：すべて</option>
      ${genres.map(([g, n]) => `<option value="${esc(g)}"${S.genre === g ? ' selected' : ''}>${esc(g)}（${n}）</option>`).join('')}
    </select>
    <select id="sort">
      <option value="name"${S.sort === 'name' ? ' selected' : ''}>五十音</option>
      <option value="sys"${S.sort === 'sys' ? ' selected' : ''}>機種順</option>
      <option value="plays"${S.sort === 'plays' ? ' selected' : ''}>よく遊んだ順</option>
      <option value="last"${S.sort === 'last' ? ' selected' : ''}>最近遊んだ順</option>
      <option value="size"${S.sort === 'size' ? ' selected' : ''}>大きい順</option>
    </select>
    <select id="fold">
      <option value="sys"${S.fold === 'sys' ? ' selected' : ''}>${S.sys ? 'ジャンルで畳む' : '機種で畳む'}</option>
      <option value="genre"${S.fold === 'genre' ? ' selected' : ''}>ジャンルで畳む</option>
      <option value="maker"${S.fold === 'maker' ? ' selected' : ''}>メーカーで畳む</option>
      <option value=""${S.fold ? '' : ' selected'}>畳まない</option>
    </select>
    <button class="hbtn${S.tools ? ' on' : ''}" id="tools">道具ディスク</button>
    <button class="hbtn" id="home" style="margin-left:auto">← 機種へ</button>
    <button class="hbtn" id="addto">＋ 棚に上げる</button>
  </div></div>
  <div class="sub" id="huntline" style="margin:0 0 8px;display:none"></div>
  <div id="g">${gridHtml(list)}</div>`;

  $('#q').oninput    = e => { S.q = e.target.value; redrawGrid(); };
  $('#sys').onchange  = e => go(e.target.value ? '#/sys/' + encodeURIComponent(e.target.value) : '#/all');
  $('#gen').onchange  = e => { S.genre = e.target.value; LS.set('genre', S.genre); screenLib(); };
  $('#sort').onchange = e => { S.sort = e.target.value; LS.set('sort', S.sort); screenLib(); };
  $('#fold').onchange = e => { S.fold = e.target.value; LS.set('fold', S.fold);
    LS.set('foldPicked', true);   // 本人が選んだら、こちらで勝手に変えない
    screenLib(); };
  for (const b of main().querySelectorAll('[data-view]'))
    b.onclick = () => { S.view = b.dataset.view; LS.set('view2', S.view); screenLib(); };
  $('#tools').onclick = () => { S.tools = !S.tools; LS.set('tools', S.tools); screenLib(); };
  $('#addto').onclick = () => go('#/gather');
  $('#home').onclick  = () => { S.q = ''; LS.set('q', ''); go('#/lib'); };
  bindCells();
  bindFold();
  bindMore();
  bindDig();
  huntCovers(shelfList().slice(0, 200));   // 裏で箱絵を探す
  huntLine();
}

function redrawGrid() {
  const g = $('#g');
  if (!g) return screenLib();
  g.innerHTML = gridHtml(shelfList());
  bindCells();
  bindFold();
  bindMore();
  bindDig();
  huntCovers(shelfList().slice(0, 200));   // 裏で箱絵を探す
}

/* 畳んだ束は端末ごとに覚える。数が増えると一覧が長くなるので、
   ふだん見ない機種は畳んだままにしておける。 */
/* 畳んだ束の覚え。**束ね方ごとに分ける**（`maker/光栄` のように）。
   分けていなかったので、「ぜんぶ」の画面で畳んだ `PC-98` が、
   機種の中の同じ名前の束まで隠していた（中身が丸ごと消えて見えた）。
   古い形（`/` を含まない）は捨てる。 */
const shut = () => new Set(LS.get('shut', []).filter(k => String(k).includes('/')));

/* 一覧を組む。**探している最中は畳まない**（探した意味がなくなる）。 */
function gridHtml(list) {
  /* 何も出ないときに黙って白紙にしない。理由が分からないと直せない。 */
  if (!window.Makers) log.note('makers.js が読めていない');
  if (!list.length) {
    return `<div class="empty">${S.q ? '見つかりません'
      : S.view === 'play' ? 'まだ棚に何も取り寄せていません。<br><span class="sub">「倉庫」の札から選んで遊ぶと、その本が棚に入ります。次からはすぐ遊べます（圏外でも）。</span>'
      : S.view === 'none' ? '倉庫に無い本はありません。'
      : '棚が空です'}</div>`;
  }
  /* **一度に全部は描かない。** 倉庫を読んだら 7171 本になった。
     3000枚の札を一度に組み立てると、iPhone は固まる。
     区切って出し、「もっと見る」で伸ばす。 */
  if (!S.fold || S.q.trim()) return capped(list, 'flat');
  /* **掘っていく。** 倉庫はメーカー別に分けてある
     （`/ROM/パソコン/PC-98/PC98/PC98 Disk`）。畳んで並べるのではなく、
     1階ずつ降りるほうが、その整理をそのまま辿れる。 */


  /* 機種を選んで入っているときに「機種で畳む」は意味がない（束が1つ）。
     その場合はジャンルで畳む。 */
  /* 機種を選んで入っているときに「機種で畳む」は意味がない（束が1つ）。
     **メーカーで束ねる**（本人「フォルダの場所は選ぶ時はほとんどいらない」）。 */
  const by = (S.sys && S.fold === 'sys') ? 'maker' : S.fold;
  /* 在処で畳むときは、深い順ではなく道の順に並べたほうが辿りやすい。 */
  const key = i => by === 'genre' ? (i.genre || 'ジャンル未設定')
                  : by === 'maker' ? ((window.Makers ? Makers.makerOf(i.name, i.path) : '') || 'その他')
                  : i.system;
  const box = new Map();
  for (const i of list) {
    if (!box.has(key(i))) box.set(key(i), []);
    box.get(key(i)).push(i);
  }
  /* 機種は台帳の並び、ジャンルは多い順。どちらも「よく使う束が上」になる。 */
  const names = [...box.keys()].sort((a, b) => {
    /* 「その他」は最後。中身が分からないものを先頭に置いても仕方がない。 */
    if (a === 'その他') return 1;
    if (b === 'その他') return -1;
    return (by === 'genre' || by === 'maker')
      ? box.get(b).length - box.get(a).length || collator.compare(a, b)
      : collator.compare(a, b);
  });
  const cl = shut();
  return names.map(nm => {
    const fkey = by + '/' + nm;
    const open = !cl.has(fkey);
    /* 倉庫の道は深い（`/ROM/パソコン/PC-98/PC98/PC98 Disk`）。
       見出しでは末尾だけ見せ、全体は当てれば出る。 */
    const label = nm;
    return `<h2 class="fold" data-fold="${esc(fkey)}" title="${esc(nm)}">
        <span class="tri">${open ? '▾' : '▸'}</span>${esc(label)}
        <span class="cnt">${box.get(nm).length}</span></h2>
      <div data-body="${esc(fkey)}"${open ? '' : ' hidden'}>${capped(box.get(nm), fkey)}</div>`;
  }).join('');
}

/* いま掘っている場所。機種ごとに覚える。 */
const digAt = () => (S.dig || {})[S.sys || '*'] || '';

function digHtml(list) {
  /* **倉庫のフォルダをそのまま見せない。**
     `ROM › パソコン › PC-98` のような、その機種では**全部に共通する道**は
     ただの飾りで、押させる意味がない。走査で分かった道から
     **その機種の中で分かれる所＝メーカーの階**を組み直して見せる。

     やり方: いま見ている機種の本の道の**共通の頭を取り除く**。
     残りの最初の一節がメーカー（あるいはその機種なりの分け方）になる。
     共通の頭を削るだけなので、**分かれている階は決して飛ばさない**。 */
  const paths = list.map(i => i.path || '').filter(Boolean);
  let head = '';
  if (paths.length) {
    const segs = paths[0].split('/').filter(Boolean);
    const outer = [];
    for (let i = 0; i < segs.length; i++) {
      const cand = '/' + segs.slice(0, i + 1).join('/');
      if (paths.every(pp => pp === cand || pp.startsWith(cand + '/'))) outer.push(segs[i]);
      else break;
    }
    head = outer.length ? '/' + outer.join('/') : '';
  }

  /* いま掘っている場所は**共通の頭より下**で持つ。
     機種を移ったとき、前の機種の道が残らないように必ず確かめる。 */
  let rel = digAt();
  const under = pp => !rel || pp === head + rel || pp.startsWith(head + rel + '/');
  if (rel && !paths.some(under)) rel = '';

  const dirs = new Map();
  const here = [];
  for (const i of list) {
    const pp = i.path || '';
    if (!pp) { if (!rel) here.push(i); continue; }
    if (!under(pp)) continue;
    const rest = pp.slice((head + rel).length).replace(/^\//, '');
    if (!rest) { here.push(i); continue; }
    const seg = rest.split('/')[0];
    dirs.set(seg, (dirs.get(seg) || 0) + 1);
  }

  const crumbs = rel ? rel.split('/').filter(Boolean) : [];
  const bar = `<div class="crumb">
    <button data-dig="">${esc(S.sys || 'ぜんぶ')}</button>
    ${crumbs.map((c, n) => `<span>›</span><button data-dig="${
      esc('/' + crumbs.slice(0, n + 1).join('/'))}">${esc(c)}</button>`).join('')}
  </div>`;
  const rows = [...dirs.entries()].sort((a2, b2) => collator.compare(a2[0], b2[0]));
  return bar
    + (rows.length ? `<h2 class="fold" style="cursor:default">${
        crumbs.length ? 'この中' : 'メーカー・置き場'}
        <span class="cnt">${rows.length}</span></h2>
      <div class="tree" style="margin-bottom:14px;max-height:46vh;overflow:auto">${
        rows.map(([nm, n]) => `
        <div class="tnode">
          <button class="trow" data-dig="${esc(rel + '/' + nm)}">
            <span class="tri">📁</span><span class="tname">${esc(nm)}</span>
            <span class="cnt">${n}</span>
          </button>
        </div>`).join('')}</div>` : '')
    + (here.length ? `<h2 class="fold" style="cursor:default">ここに置いてある本
        <span class="cnt">${here.length}</span></h2>` + capped(here, 'dig:' + rel)
       : (rows.length ? '' : '<div class="empty">この下に本がありません</div>'));
}

/* 区切って出す。いくつまで出したかは束ごとに覚える。 */
const STEP = 120;
function capped(list, key) {
  const n = Math.min(list.length, S.more[key] || STEP);
  return `<div class="grid">${list.slice(0, n).map(cellHtml).join('')}</div>`
    + (n < list.length
      ? `<button class="hbtn" data-more="${esc(key)}" style="margin:10px 0">
           もっと見る（あと ${list.length - n} 本）</button>`
      : '');
}

function bindDig() {
  for (const b of main().querySelectorAll('[data-dig]')) b.onclick = () => {
    S.dig = S.dig || {};
    S.dig[S.sys || '*'] = b.dataset.dig;
    LS.set('dig', S.dig);
    redrawGrid();
  };
}

function bindMore() {
  for (const b of main().querySelectorAll('[data-more]')) b.onclick = () => {
    const k = b.dataset.more;
    S.more[k] = (S.more[k] || STEP) + STEP * 3;
    redrawGrid();
  };
}

function bindFold() {
  for (const h of main().querySelectorAll('h2.fold')) h.onclick = () => {
    const nm = h.dataset.fold, cl = shut();
    cl.has(nm) ? cl.delete(nm) : cl.add(nm);
    LS.set('shut', [...cl]);
    const body = main().querySelector(`.grid[data-body="${CSS.escape(nm)}"]`);
    const open = !cl.has(nm);
    if (body) body.hidden = !open;
    h.querySelector('.tri').textContent = open ? '▾' : '▸';
  };
}

function cellHtml(g) {
  const has = hasAll(g);
  /* 元の名前が失われて読めないものは、化けた字をそのまま出さない。
     どのファイルかは分かるようにしておく（手で名前を直せるように）。 */
  const nm = g.garbled ? '名前が読めないディスク' : g.name;
  const sub = g.garbled ? g.files[0] : (g.sub || '');
  const cov = (S.covurl[g.id] || g.cover)
    ? `<img loading="lazy" src="${esc(S.covurl[g.id] || g.cover)}" alt="">`
                      : `<div class="ph">${esc(nm)}</div>`;
  return `<button class="item" data-id="${esc(g.id)}" data-s="${esc(g.short)}"${
    g.gkey ? ` data-g="${esc(g.gkey)}"` : ''}${has ? '' : ' data-no="1"'}>
    <div class="cov">${cov}
      <span class="tag${LOGOS[g.short] ? ' logo' : ''}" data-s="${esc(g.short)}">${
        LOGOS[g.short] ? `<img src="logos/${esc(g.short)}.png" alt="${esc(g.short)}"
          onerror="this.remove();this.parentNode.classList.remove('logo')">` : ''
      }<span>${esc(g.short)}</span>${g.kind === 'tool' ? '<span style="display:inline">道具</span>'
        : g.kind === 'save' ? '<span style="display:inline">セーブ</span>' : ''}</span>
      ${gotIt(g) ? '<span class="off">●</span>' : ''}
      ${has ? '' : '<span class="no">倉庫に無い</span>'}
    </div>
    <div class="t">${esc(nm)}</div>
    <div class="s">${esc(sub || g.genre || '')}${
      g.vers && !g.settled ? `<span class="vers">${g.vers.length}版</span>` : ''}</div>
  </button>`;
}

function bindCells() {
  main().querySelectorAll('.item').forEach(b => b.onclick = () => {
    /* 版がいくつもある本は、**遊ぶ前に選ばせる**（取り寄せるのも起動するのも
       選んだ版）。一度選べば覚えるので、次からは黙って同じ版で始まる。 */
    if (b.dataset.g && !b.dataset.no) {
      const vs = (S.gmap || {})[b.dataset.g];
      const settled = vs && vs.some(gotIt);
      if (vs && vs.length > 1 && !settled && !S.ver[b.dataset.g])
        return pickVer(b.dataset.g, vs);
    }
    /* まだ上げていない本は遊べない。行き止まりにせず、上げる画面へ連れて行く。 */
    if (b.dataset.no) {
      const g = S.items.find(x => x.id === b.dataset.id);
      E.pick = { [b.dataset.id]: 1 };
      E.sys = '';
      toast((g ? g.name : 'この本') + ' はまだ pCloud に上げていません。上げに行きます');
      return setTimeout(() => go('#/edit'), 600);
    }
    play(b.dataset.id);
  });
}

$('#hcell').onclick = () => {
  S.cell = { s: 'm', m: 'l', l: 's' }[S.cell] || 'm';
  LS.set('cell', S.cell);
  document.body.dataset.cell = S.cell;
  $('#hcell').textContent = { s: '小', m: '中', l: '大' }[S.cell];
};
$('#hset').onclick = () => go('#/set');

/* ============ 動きの記録を棚へ上げる ============ */
/* **手で写させない。** 落ちたときの記録は端末の中にあるが、
   それを本人に写して貼ってもらうのは無駄。棚（pCloud）に上げておけば、
   直す側がそのまま読める。

   落ちると上げる隙も無いので、**遊んでいる最中に20秒ごと**上げ続ける。
   中身は速さ・端末の型・しくじりの言い分だけ。遊んだ中身は入れない。 */
function deviceTag() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
           : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac'
           : /Windows/.test(ua) ? 'Windows' : 'その他';
  const br = (ua.match(/(CriOS|Chrome|Firefox|Edg)/) || [])[1] || 'Safari';
  return `${os}-${br}-${screen.width}x${screen.height}`;
}

let RUNPUSH = 0, RUNTIMER = 0;
async function pushRuns(force) {
  if (!S.auth || !S.rootId) return;
  const now = Date.now();
  if (!force && now - RUNPUSH < 20000) return;
  const runs = LS.get('runs', []);
  if (!runs.length) return;
  RUNPUSH = now;
  try {
    const fid = await P.ensureFolder(S.rootId, '_記録', { auth: S.auth });
    const body = JSON.stringify({ 端末: deviceTag(), ua: navigator.userAgent,
                                  上げた: new Date().toISOString(), runs }, null, 1);
    await P.uploadFile(fid, deviceTag() + '.json',
                       new Blob([body], { type: 'application/json' }), { auth: S.auth });
  } catch (e) { RUNPUSH = 0; }      // 駄目なら次の機会にすぐ試す
}

/* 棚の題名を倉庫へ書き出す。**ブラウザからは画像検索ができない**（CORS）ので、
   絵の捜索の続きは Mac 側の道具（`tools/fetch-covers.py`）がやる。
   そのための題名の一覧を、倉庫の `_記録/棚.json` に置いておく。 */
async function pushCatalog() {
  if (!S.auth || !S.rootId) return;
  try {
    const fid = await P.ensureFolder(S.rootId, '_記録', { auth: S.auth });
    const list = S.items.filter(i => i.kind === 'game').map(i => ({
      id: i.id, name: i.name, system: i.system, files: i.files,
      cover: !!(i.cover || S.covurl[i.id]),
    }));
    const body = JSON.stringify({ 書いた: new Date().toISOString(), 本数: list.length, 本: list });
    await P.uploadFile(fid, '棚.json', new Blob([body], { type: 'application/json' }),
                       { auth: S.auth });
    log.note(`題名の一覧を倉庫へ: ${list.length} 本`);
  } catch (e) { log.note('題名の一覧を書き出せない: ' + e.message); }
}

/* ============ 遊ぶ ============ */
function play(id) {
  const g = S.items.find(x => x.id === id);
  if (!g) return;
  if (!hasAll(g)) return toast('この本は倉庫にありません');
  const p = S.plays[id] || { n: 0, last: 0 };
  p.n++; p.last = Date.now(); S.plays[id] = p; LS.set('plays', S.plays);
  log.note('遊ぶ: ' + g.short + ' ' + g.name);
  $('#pname').textContent = g.name;
  /* PC-98 はコアが別（自分で組んだ NP2kai）。画面も別立てにしてある。 */
  $('#pframe').src = g.pc98
    ? './play98.html?id=' + encodeURIComponent(id) + '&v=27'
    : './play.html?id=' + encodeURIComponent(id) +
      '&fid=' + S.files[P.nfc(g.files[0])] + '&v=11';
  $('#play').classList.remove('hide');
  /* 遊んでいるあいだ、棚を**空にする**。
     display:none では、iPhone は読み込んだ絵を抱えたまま離さない。
     中身ごと捨てれば絵の分の重さが本当に減る（閉じたら描き直す）。
     見出しの帯も消す。ぼかしが掛かっていて、隠れていても描画の費用がかかる。 */
  main().innerHTML = '';
  main().style.display = 'none';
  document.querySelector('header').style.display = 'none';
  /* 遊ぶ画面は iframe の中にある。そこへ焦点を移さないと、キーが棚側に吸われて
     コアまで届かない（PC-98 の「どれかキーを押してください」で止まる）。 */
  const fr = $('#pframe');
  fr.onload = () => { try { fr.contentWindow.focus(); } catch (e) {} };
  /* 遊び始めたら、その本を棚に取り寄せる（本体・箱絵・メモを1つのフォルダに）。
     裏でやる。遊ぶのを待たせない。 */
  stock(g).catch(e => log.note('棚に取り寄せられない: ' + e.message));
  /* 遊んでいるあいだ上げ続ける。落ちても直前までは棚に残る。 */
  clearInterval(RUNTIMER);
  RUNTIMER = setInterval(() => pushRuns(), 20000);
}

/* 棚側でキーが押されたら、それは行き先を間違えている。iframe へ焦点を戻す。 */
addEventListener('keydown', e => {
  if ($('#play').classList.contains('hide')) return;
  if (e.target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
  try { $('#pframe').contentWindow.focus(); } catch (err) {}
});
/* 全画面。ブラウザの窓いっぱいではなく、OS ごと本当の全画面にする。
   覆い（#play）ごと広げるので、ファミコンでも PC-98 でも同じように効く。
   注文の形（{navigationUI}）を受け付けない版があるので、素で頼む。 */
const full = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function paintFull() {
  const b = $('#pfull'); if (b) b.textContent = full() ? '戻す' : '全画面';
}
$('#pfull').onclick = () => {
  const el = $('#play');
  if (full()) {
    const x = document.exitFullscreen || document.webkitExitFullscreen;
    try { x.call(document); } catch (e) {}
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  /* iOS の Safari は動画以外を全画面にできない。
     そこでは上の帯を畳んで、絵に画面を全部渡す。左上の丸で戻せる。
     本当の全画面が要るなら「ホーム画面に追加」して、そこから開く。 */
  if (!req) {
    el.classList.add('wide');
    toast('帯を畳みました。ホーム画面に追加すると、本当の全画面で開けます', 3600);
    return;
  }
  /* 押した流れの中でそのまま頼むこと。await をはさむと「利用者の操作」の資格が切れる。 */
  let r;
  try { r = req.call(el); } catch (e) { return toast('全画面にできません: ' + e.message); }
  if (r && r.catch) r.catch(e => toast('全画面にできません: ' + (e && e.message || e)));
};
for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'fullscreenerror']) {
  document.addEventListener(ev, paintFull);
}

$('#pback').onclick = () => { $('#play').classList.remove('wide'); };

$('#pclose').onclick = async () => {
  $('#play').classList.remove('wide');
  if (full()) { try { await document.exitFullscreen(); } catch (e) {} }
  $('#pframe').src = 'about:blank';       // 中のコアを確実に止める
  $('#play').classList.add('hide');
  main().style.display = '';
  document.querySelector('header').style.display = '';
  clearInterval(RUNTIMER); RUNTIMER = 0;
  await pushRuns(true);
  await refreshHere();
  render();
};

/* ============ 設定 ============ */
function screenSet() {
  $('#title').textContent = '設定';
  const playable = S.items.filter(i => i.kind === 'game');
  const found = playable.filter(hasAll).length;
  main().innerHTML = `
  <div class="card" style="max-width:520px">
    <h2>設定</h2>
    <div class="rowlist" style="margin-bottom:14px">
      <div class="row"><span class="nm">版</span><span class="sub">v${esc(VERSION)}</span></div>
      <div class="row"><span class="nm">pCloud</span><span class="sub">${S.auth ? esc(S.email) : '未接続'}</span></div>

      <div class="row"><span class="nm">台帳</span><span class="sub">${playable.length} 本中 ${found} 本が倉庫にある</span></div>
      <div class="row"><span class="nm">棚にある分</span><span class="sub">${S.items.filter(gotIt).length} 本・すぐ遊べます</span></div>
      <button class="row" id="relay"><span class="nm">中継所</span><span class="sub">${S.relay ? '設定済み' : '未設定（無くても遊べます・あると速い）'}</span></button>
      <button class="row" id="gather"><span class="nm">棚に上げる</span><span class="sub">倉庫の中から移す・上げ直さない</span></button>
      <button class="row" id="places"><span class="nm">棚と倉庫</span><span class="sub">棚の置き先と、見に行く場所 ${S.roots.length} か所</span></button>
      <button class="row" id="fixcov"><span class="nm">箱絵を直す</span><span class="sub">自分の絵を入れる</span></button>
      <button class="row" id="disks"><span class="nm">ディスクの道具箱</span><span class="sub">中を見る・作る・複製する</span></button>
      <button class="row" id="runs"><span class="nm">動きの記録</span><span class="sub">端末ごとの速さ</span></button>
      <button class="row" id="log"><span class="nm">押した記録</span><span class="sub">→</span></button>
    </div>
    <button class="hbtn" id="fdclr">ディスクの組み合わせを忘れる</button>
    <button class="hbtn" id="clr" style="margin-left:6px">端末の控えを全部消す</button>
    <button class="hbtn" id="out" style="margin-left:6px">つなぎを切る</button>
    <div class="msg" id="m"></div>
    <div class="note">
      pCloud の配信元は CORS を返さないので、<b>中継所が無いと ROM の中身を掴めません</b>。
      音楽棚のものは「入口」に作り替わっていて合言葉の内側なので、<b>ここからは使えません</b>。
      ゲーム棚用に素のものを1台立ててください（下に手順）。
    </div>
    <button class="hbtn" id="back" style="margin-top:16px">← 棚へ</button>
  </div>`;
  $('#back').onclick   = () => go('#/lib');
  $('#log').onclick    = () => go('#/log');
  $('#runs').onclick   = () => go('#/runs');
  $('#relay').onclick  = () => go('#/relay');
  $('#disks').onclick  = () => go('#/disks');
  $('#fixcov').onclick = () => go('#/covers');
  $('#gather').onclick = () => go('#/gather');
  $('#places').onclick = () => go('#/places');
  $('#clr').onclick = async () => {
    await ROMS.clear(); await refreshHere(); toast('消しました'); screenSet();
  };
  /* PC-98 の「どのディスクをどのドライブに」を全部忘れる。
     悪い組み合わせを覚えてしまったときの逃げ道。 */
  $('#fdclr').onclick = () => {
    const n = Object.keys(LS.get('fdpick', {})).length;
    LS.del('fdpick');
    toast(n + ' 本ぶんの組み合わせを忘れました');
  };
  $('#out').onclick = () => { forget(); go('#/lib'); };
}

function screenRelay() {
  $('#title').textContent = '中継所';
  main().innerHTML = `
  <div class="card" style="max-width:520px">
    <h2>中継所</h2>
    <p><b>無くても遊べます。</b>あると取り寄せが速くなります。<br>
       1台立てて、その URL をここに入れてください。</p>
    <div class="field"><label>URL</label>
      <input id="rl" placeholder="https://ongakudana.○○○.workers.dev"
        value="${esc(S.relay)}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
    <button class="primary" id="save">覚える</button>
    ${S.relay ? '<button class="hbtn" id="clr" style="margin-top:8px">やめる</button>' : ''}
    <div class="msg" id="m"></div>
    <div class="note">
      <b>立て方</b><br>
      1. Cloudflare の Workers &amp; Pages を開き、Worker を新しく作る（名前は <code>gamedana</code> など）<br>
      2. 「Edit code」に、置き場の <code>core/relay.js</code> を丸ごと貼る<br>
      3. Deploy して、出てきた <code>…workers.dev</code> の URL を上に入れる<br><br>
      <b>何のためにあるのか</b>（実測）<br>
      pCloud の配信元（<code>ptok2.pcloud.com</code> など）は
      <code>Access-Control-Allow-Origin</code> を返さない。リンク自体は
      <code>getfilelink</code> でも公開リンクの符号でも取れるが、どちらの配信元も
      CORS が無いので、ブラウザの JavaScript は中身を掴めない。
      あいだに一枚はさむと、そこが解ける。<br><br>
      <b>無いとどうなるか</b><br>
      <code>file_open</code> / <code>file_read</code> は CORS が開いているので、
      中継所が無くても・落ちていても中身は読めます。ただし丸ごと読むぶん遅い。
      中継所の設定を消しても、返事が来なくなっても、棚は勝手にこちらへ降ります
      （<b>遊べなくなることはありません</b>）。<br><br>
      中継所は fileid を選ばないので、<b>棚もの全部で1台を使い回せる</b>。
    </div>
    <button class="hbtn" id="back" style="margin-top:16px">← 設定へ</button>
  </div>`;
  $('#back').onclick = () => go('#/set');
  $('#save').onclick = async () => {
    const v = $('#rl').value.trim().replace(/\/+$/, '');
    const m = $('#m');
    if (!v) { m.textContent = 'URL を入れてください'; m.className = 'msg err'; return; }
    m.textContent = '確かめています…'; m.className = 'msg';
    try {
      await P.relayAlive(v);
      S.relay = v; LS.set('relay', v);
      m.textContent = '生きています。覚えました'; m.className = 'msg ok';
      log.note('中継所を設定');
    } catch (e) {
      m.textContent = '返事がありません: ' + e.message; m.className = 'msg err';
    }
  };
  const c = $('#clr');
  if (c) c.onclick = () => { S.relay = ''; LS.del('relay'); screenRelay(); };
}


/* ============ 棚を編む ============ */
/* pCloud の中身を、この画面から選んで増やしたり減らしたりする。
   上げるには元のファイルが要るが、ブラウザは勝手に Mac の中を読めない。
   一度フォルダを選んでもらい、その場（この画面を開いているあいだ）だけ憶える。 */
const E = { pick: {}, src: null, srcName: '', busy: false, sys: '' };

const srcOf = name => (E.src ? E.src[P.nfc(name)] : null) || null;

function editList() {
  let list = S.items.slice();
  if (E.sys) list = list.filter(i => i.system === E.sys);
  return list.sort((a, b) =>
    collator.compare(a.system, b.system) || collator.compare(a.name, b.name));
}

function screenEdit() {
  $('#title').textContent = 'Mac から上げる';
  const list = list0();
  function list0() { return editList(); }
  const systems = [...new Set(S.items.map(i => i.system))].sort();
  /* ジャンルは多い順に。数が少ないものは末尾に沈むので探しやすい。 */
  const gcount = {};
  for (const i of S.items) if (i.genre) gcount[i.genre] = (gcount[i.genre] || 0) + 1;
  const genres = Object.entries(gcount).sort((a, b) => b[1] - a[1]);
  const n = Object.keys(E.pick).length;
  const have = list.filter(hasAll).length;

  main().innerHTML = `
  <div class="bar"><div class="row1">
    <select id="esys">
      <option value=""${E.sys ? '' : ' selected'}>ぜんぶ</option>
      ${systems.map(x => `<option value="${esc(x)}"${E.sys === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}
    </select>
    <button class="hbtn" id="eall">見えている分を全部選ぶ</button>
    <button class="hbtn" id="enone">選び直す</button>
    <button class="hbtn" id="eback">← 設定へ</button>
  </div></div>

  <div class="msg" id="em" style="margin:0 0 8px">
    ${esc(S.rootName || '倉庫のフォルダが未選択')} に ${have} / ${list.length} 本が倉庫に。
    ${E.src ? '元: ' + esc(E.srcName) + '（' + Object.keys(E.src).length + ' ファイル）'
            : '上げるには、先に元のファイルを選んでください。'
              + '<br><span class="sub">iPhone・iPad はフォルダを選べないので（Safari が対応していない）、'
              + '「ファイルを選ぶ」で選んでください。まとめて選べます。</span>'}
  </div>

  <div class="rowlist" style="margin-bottom:96px">
    ${list.map(i => {
      const on = !!E.pick[i.id];
      const here = hasAll(i);
      const nm = i.garbled ? '名前が読めないディスク' : i.name;
      return `<button class="row" data-id="${esc(i.id)}">
        <span style="width:18px;flex:0 0 18px;color:${on ? 'var(--accent)' : 'var(--dim2)'}">${on ? '☑' : '☐'}</span>
        <span class="nm">${esc(nm)}</span>
        <span class="sub">${esc(i.short)}${i.files.length > 1 ? ' ' + i.files.length + '枚' : ''}
          ・${size(i.bytes)}
          ・${here ? '<span style="color:var(--ok)">倉庫にある</span>' : '<span style="color:var(--warn)">無い</span>'}</span>
      </button>`;
    }).join('')}
  </div>

  <div style="position:fixed;left:0;right:0;bottom:0;z-index:20;padding:10px 14px calc(var(--safe-b) + 10px);
              background:rgba(16,16,20,.96);backdrop-filter:blur(10px);border-top:1px solid var(--line)">
    <div style="display:flex;gap:6px;align-items:center;overflow-x:auto;scrollbar-width:none">
      <span class="sub" style="flex:0 0 auto">${n} 本えらんだ</span>
      <button class="hbtn" id="esrc" style="flex:0 0 auto">元のフォルダを選ぶ</button>
      <button class="hbtn" id="esrcf" style="flex:0 0 auto">ファイルを選ぶ</button>
      <button class="hbtn" id="eup" style="flex:0 0 auto"${n && E.src ? '' : ' disabled'}>倉庫へ上げる</button>
      <button class="hbtn" id="edown" style="flex:0 0 auto"${n ? '' : ' disabled'}>倉庫から下げる</button>
      <button class="hbtn" id="ecache" style="flex:0 0 auto"${n ? '' : ' disabled'}>棚から下ろす</button>
    </div>
    <div class="msg" id="ep" style="min-height:0;margin-top:6px"></div>
  </div>
  <input type="file" id="efile" webkitdirectory directory multiple class="hide">
  <input type="file" id="efile2" multiple class="hide">`;

  main().querySelectorAll('.row[data-id]').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    if (E.pick[id]) delete E.pick[id]; else E.pick[id] = 1;
    screenEdit();
  });
  $('#esys').onchange = e => { E.sys = e.target.value; screenEdit(); };
  $('#eall').onclick  = () => { editList().forEach(i => E.pick[i.id] = 1); screenEdit(); };
  $('#enone').onclick = () => { E.pick = {}; screenEdit(); };
  $('#eback').onclick = () => go('#/gather');

  /* 元のフォルダ。中身は憶えるが、この画面を離れると消える（ブラウザの決まり）。 */
  /* 元の置き場。**iPhone・iPad はフォルダを選べない**（Safari が
     webkitdirectory に対応していない）ので、ファイルを直に選ぶ口も出す。
     どちらで選んでも、名前を NFC に揃えて憶える（macOS の名前は NFD のことがある）。 */
  const takeFiles = (files, how) => {
    const map = {};
    for (const f of files) map[P.nfc(f.name)] = f;
    /* 選び直しではなく**足す**。何度かに分けて選べる（一度に選びきれないとき用）。 */
    E.src = { ...(E.src || {}), ...map };
    const first = files[0];
    const dir = (first && first.webkitRelativePath || '').split('/')[0];
    E.srcName = dir || (how === 'files' ? 'えらんだファイル' : 'えらんだフォルダ');
    log.note(`元を選んだ（${how}）: ${Object.keys(map).length} ファイル`);
    screenEdit();
  };
  $('#esrc').onclick  = () => $('#efile').click();
  $('#esrcf').onclick = () => $('#efile2').click();
  $('#efile').onchange  = ev => takeFiles(ev.target.files, 'folder');
  $('#efile2').onchange = ev => takeFiles(ev.target.files, 'files');

  $('#eup').onclick    = () => doUpload();
  $('#edown').onclick  = () => doDelete();
  $('#ecache').onclick = () => doUncache();
}

const picked = () => S.items.filter(i => E.pick[i.id]);
const prog = t => { const e = $('#ep'); if (e) e.textContent = t; };

/* 機種ごとの置き場。無ければ作る。 */
const SYS_FOLDER = { 'PC-98': 'PC-98' };
async function folderFor(system) {
  const name = SYS_FOLDER[system] || system;
  return await P.ensureFolder(S.rootId, name, { host: S.host, auth: S.auth });
}

async function doUpload() {
  if (E.busy) return;
  const items = picked();
  const need = [];
  for (const i of items) for (const f of i.files) {
    if (!S.files[P.nfc(f)]) need.push({ system: i.system, file: f });
  }
  if (!need.length) return toast('選んだ本はすべて倉庫にあります');
  const missing = need.filter(x => !srcOf(x.file));
  if (missing.length === need.length) {
    return prog('元のフォルダの中に、選んだ本のファイルが見つかりません（選び直してください）');
  }
  E.busy = true;
  let ok = 0, ng = 0, i = 0;
  const folders = {};
  for (const x of need) {
    i++;
    const f = srcOf(x.file);
    if (!f) { ng++; continue; }
    prog(`上げています… ${i}/${need.length}　${x.file}`);
    try {
      if (!folders[x.system]) folders[x.system] = await folderFor(x.system);
      const fid = await P.uploadFile(folders[x.system], x.file, f, { host: S.host, auth: S.auth });
      if (fid) { S.files[P.nfc(x.file)] = fid; ok++; }
    } catch (e) { ng++; log.note('上げ損ね: ' + x.file + ' — ' + e.message); }
  }
  LS.set('files', S.files);
  E.busy = false;
  prog(`上げた ${ok} / 駄目 ${ng}${missing.length ? '（元が見つからない ' + missing.length + '）' : ''}`);
  log.note(`上げた ${ok} / 駄目 ${ng}`);
  screenEdit();
}

/* pCloud から消す。戻せないので、必ず一度確かめる。 */
async function doDelete() {
  if (E.busy) return;
  const items = picked();
  const ids = [];
  for (const i of items) for (const f of i.files) {
    const fid = S.files[P.nfc(f)];
    if (fid) ids.push({ file: f, fid });
  }
  if (!ids.length) return toast('選んだ本は倉庫にありません');
  const names = items.slice(0, 5).map(i => i.name).join('、') + (items.length > 5 ? ' ほか' : '');
  if (!confirm(`倉庫から ${ids.length} ファイルを消します。\n\n${names}\n\n戻せません。よろしいですか。`)) return;
  E.busy = true;
  let ok = 0, ng = 0, n = 0;
  for (const x of ids) {
    n++;
    prog(`消しています… ${n}/${ids.length}　${x.file}`);
    try { await P.deleteFile(x.fid, { host: S.host, auth: S.auth }); delete S.files[P.nfc(x.file)]; ok++; }
    catch (e) { ng++; log.note('消し損ね: ' + x.file + ' — ' + e.message); }
  }
  LS.set('files', S.files);
  E.busy = false;
  prog(`消した ${ok} / 駄目 ${ng}`);
  log.note(`pCloud から消した ${ok} / 駄目 ${ng}`);
  screenEdit();
}

/* 棚から下ろすだけ。倉庫には触らない。 */
/* 棚から下ろす。**周りのものと紐づけたまま、書庫へ一箇所に寄せる。**
   端末に残っている分も消す（棚に無いものが端末にだけ残っていると分からなくなる）。
   倉庫の元の置き場（`/EMU/ROM` など）には触らない —— 棚へは写しただけなので。 */
async function doUncache() {
  const items = picked();
  if (!items.length) return;
  if (!confirm(`${items.length} 本を棚から下ろし、周りのもの（箱絵・メモ・セーブ）ごと`
    + `書庫へ移します。\n\n${items.slice(0, 5).map(i => i.name).join('、')}`
    + `${items.length > 5 ? ' ほか' : ''}\n\n倉庫の元の置き場はそのままです。`)) return;
  let moved = 0, dropped = 0;
  for (const i of items) {
    prog(`${i.name} を書庫へ…`);
    try { if (await archive(i, prog)) moved++; }
    catch (e) { log.note('書庫へ移せない: ' + i.name + ' — ' + e.message); }
    if (!i.pc98) { if (await removeCached(i.id)) dropped++; continue; }
    for (const f of i.files) {
      const fid = S.files[P.nfc(f)];
      if (fid && await removeCached(String(fid))) dropped++;
    }
  }
  await refreshHere();
  prog(`書庫へ ${moved} 本／端末からも ${dropped} 件消しました（倉庫はそのまま）`);
  screenEdit();
}

async function removeCached(key) {
  if (!('caches' in window)) return false;
  try { const c = await caches.open('roms-v1'); return await c.delete('https://rom.local/' + key); }
  catch (e) { return false; }
}

/* ============ 動きの記録 ============ */
/* PC-98 を動かすたびに、毎秒何コマ出たかを端末の型と一緒に残している（最新10回）。
   「重いのは機械のせいか、作りのせいか」を、端末をまたいで見分けるため。 */
/* 10秒ごとのコマ数を横に並べた棒。
   通しの平均では見えないもの——「出だしは良く途中から重くなる」
   「速くなったり重くなったり」——は、この形で初めて出る。 */
function spark(tl) {
  if (!Array.isArray(tl) || tl.length < 2) return '';
  const top = Math.max(60, ...tl);
  const bars = tl.map((v, i) => {
    const h = Math.max(2, Math.round(v / top * 26));
    const c = v >= 50 ? 'var(--ok)' : v >= 30 ? 'var(--warn)' : 'var(--danger)';
    return `<i title="${i * 10}〜${i * 10 + 10}秒: ${v}コマ/秒"
      style="display:inline-block;width:5px;height:${h}px;background:${c};
             margin-right:1px;vertical-align:bottom;border-radius:1px"></i>`;
  }).join('');
  const lo = Math.min(...tl), hi = Math.max(...tl);
  return `<div style="margin-top:6px;line-height:0">${bars}</div>
    <div class="sub" style="margin-top:3px">10秒ごと・${tl.length * 10}秒ぶん
      ・いちばん遅いとき ${lo}／速いとき ${hi} コマ/秒${hi - lo >= 15 ? '（<b>揺れている</b>）' : ''}</div>`;
}

function screenRuns() {
  $('#title').textContent = '動きの記録';
  const runs = LS.get('runs', []);
  main().innerHTML = `
  <div class="card" style="max-width:640px">
    <h2>動きの記録</h2>
    <p>PC-98 を動かすたびに、毎秒何コマ出たかを残しています（最新10回）。
       端末やブラウザを変えて比べると、重さの出どころが分かります。<br>
       <b>60コマ/秒が満点。</b>棒は10秒ごとの並びで、
       通しの平均では見えない「途中から重くなる」「速くなったり遅くなったり」が出ます。<br>
       <b>遊んでいるあいだ20秒ごとに棚へ上がります。</b>落ちても直前までは残るので、
       手で写す必要はありません。</p>
    ${runs.length ? `<div class="rowlist">${runs.map(r => `
      <div class="row" style="display:block;padding:11px 14px">
        <div style="display:flex;gap:8px;align-items:baseline">
          <span style="font-size:17px;font-weight:600;color:${r.fps >= 45 ? 'var(--ok)' : r.fps >= 25 ? 'var(--warn)' : 'var(--danger)'}">
            ${esc(String(r.fps))}</span>
          <span class="sub">コマ/秒</span>
          <span class="nm" style="text-align:right;font-size:12.5px">${esc(r.name)}</span>
        </div>
        <div class="sub" style="margin-top:3px">
          ${esc(r.at)}・${esc(r.core)}・輪 ${esc(String(r.loop))}/秒・${esc(String(r.sec))}秒
          ${r.done === false ? '<b style="color:var(--danger)">・途中で切れた（落ちた）</b>' : ''}
        </div>
        ${r.err ? `<div class="sub" style="color:var(--danger)">${esc(r.err)}</div>` : ''}
        <div class="sub">${esc(r.ua)}・${esc(r.os)}・CPU ${esc(String(r.cpu))}・${esc(String(r.mem))}GB・${esc(r.px)}・音 ${esc(String(r.rate))}Hz</div>
        ${spark(r.tl)}
      </div>`).join('')}</div>`
      : '<div class="empty">まだ記録がありません。PC-98 を少し動かすと残ります。</div>'}
    ${runs.length ? '<button class="hbtn" id="cp" style="margin-top:12px">写す</button>' : ''}
    ${runs.length ? '<button class="hbtn" id="push" style="margin-top:12px;margin-left:6px">倉庫へ上げる</button>' : ''}
    <button class="hbtn" id="clr" style="margin-top:12px${runs.length ? ';margin-left:6px' : ''}">消す</button>
    <button class="hbtn" id="back" style="margin-left:6px">← 設定へ</button>
    <div class="msg" id="m"></div>
  </div>`;
  $('#back').onclick = () => go('#/set');
  $('#clr').onclick  = () => { LS.del('runs'); screenRuns(); };
  const pu = $('#push');
  if (pu) pu.onclick = async () => {
    pu.disabled = true; $('#m').textContent = '上げています…';
    await pushRuns(true);
    $('#m').textContent = '棚の「_記録」に上げました'; pu.disabled = false;
  };
  const cp = $('#cp');
  if (cp) cp.onclick = async () => {
    const t = runs.map(r => `${r.at} ${r.fps}コマ/秒 輪${r.loop} ${r.name} [${r.core}] ${r.ua} ${r.os} CPU${r.cpu} ${r.mem}GB ${r.rate}Hz
  10秒ごと: ${(r.tl || []).join(' ')}
  間隔: 中${r.j?.mid} p95 ${r.j?.p95} 最大 ${r.j?.max} 荒れ ${r.j?.rough}%`).join('\n');
    try { await navigator.clipboard.writeText(t); toast('写しました'); }
    catch (e) { $('#m').textContent = t; }
  };
}

function screenLog() {
  $('#title').textContent = '押した記録';
  main().innerHTML = `
  <div class="card" style="max-width:560px">
    <h2>押した記録</h2>
    <p>押した時刻・入力の長さ・結果だけ。中身は残していない。</p>
    <pre class="log">${esc(log.read())}</pre>
    <button class="hbtn" id="clr">消す</button>
    <button class="hbtn" id="back" style="margin-left:6px">← 戻る</button>
  </div>`;
  $('#clr').onclick  = () => { log.clear(); screenLog(); };
  $('#back').onclick = () => go(S.auth ? '#/set' : '#/lib');
}

/* ============ 始まり ============ */
(async function start() {
  $('#hcell').textContent = { s: '小', m: '中', l: '大' }[S.cell] || '中';
  try {
    S.cat = await (await fetch('./games.json?v=20260831', { cache: 'no-cache' })).json();
  } catch (e) {
    main().innerHTML = '<div class="card"><h2>台帳が読めません</h2>' +
      '<div class="msg err">games.json を取ってこられませんでした</div></div>';
    return;
  }
  /* PC-98 の台帳は無くても棚は開く（コアを組んでいない環境もある）。 */
  try { S.cat98 = await (await fetch('./pc98.json?v=20260831', { cache: 'no-cache' })).json(); }
  catch (e) { S.cat98 = null; }
  S.items = mergeCatalogs();
  /* **前の走査で在処は分かっている。** もう一度歩かせずに、そこから補う
     （「棚に上げる」用に残した一覧が在処を持っている）。 */
  if (!Object.keys(LS.get('itempath', {})).length) {
    const g0 = LS.get('gather', {});
    if (g0.files && g0.files.length) {
      const byName = {};
      for (const f of g0.files) byName[f.name] = f.path || '';
      const ip = {};
      for (const it of S.items) {
        const p0 = byName[P.nfc(it.files[0])];
        if (p0) ip[it.id] = p0;
      }
      if (Object.keys(ip).length) {
        LS.set('itempath', ip);
        S.items = mergeCatalogs();
        log.note(`在処を補った: ${Object.keys(ip).length} 本`);
      }
    }
  }
  await loadMyCovers();
  await refreshHere();
  render();
  /* **一度だけ、よくある置き場を自分で探す。** 見つかれば見に行って棚を埋める。
     本人に登録させない（「場所も分かってるんだから読んどきなよ」）。 */
  /* **探し方を変えたら、もう一度探す。** `autoDone` を立てっぱなしにしていたので、
     広い場所（`/EMU`）を見に行くようにした後も走らなかった。版を添えて覚える。 */
  if (S.auth && S.rootId && LS.get('autoDone', '') !== 'v3-emu') {
    LS.set('autoDone', 'v3-emu');
    const found = await autoPlaces(t => toast(t));
    if (found.length) {
      toast(`置き場を見つけました: ${found.join('・')}`);
      try {
        const r = await scanAll(t => toast(t));
        toast(`${r.places} か所・${r.count} ファイル`
          + (r.added ? `／${r.added} 本を新たに棚へ` : ''));
        S.items = mergeCatalogs();
        render();
      } catch (e) { log.note('自動の走査に失敗: ' + e.message); }
    }
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    /* **`updateViaCache:'none'` が要る。** これが無いと、見張り番そのものが
       ブラウザの控えから配られ、GitHub Pages の `max-age=600` のぶん
       新しい版に気づかない。
       さらに、**開きっぱなしのページは見に行かない。** ブラウザが見張り番の
       更新を確かめるのは、たいてい遷移したときだけ。朝から開いたままだと
       いつまでも古い（実際に「全然反映されない」と言われた）。
       → 自分から確かめる: 5分ごとと、画面に戻ってきたとき。 */
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(reg => {
        const look = () => { try { reg.update(); } catch (e) {} };
        look();
        setInterval(look, 5 * 60 * 1000);
        addEventListener('visibilitychange', () => { if (!document.hidden) look(); });
      })
      .catch(() => {});
    /* **新しい版に入れ替わったら、一度だけ読み直す。**
       黙って古い画面を見せていると「直したのに変わらない」が起きる
       （実際に、畳む口も探し口も出ていないと言われた）。 */
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
})();

/* ============ 箱絵を直す ============ */
/* 探しても出てこない本（`Aya3` など）と、切り出しを外した本を、その場で直す。
   **置き場（GitHub）には触らない。** 入れた絵は端末の中に置き、棚の絵より先に使う。
   だから直しても押し出す手間が要らないし、他の端末には影響しない。 */
function screenCovers() {
  $('#title').textContent = '箱絵を直す';
  /* 絵の無い**遊ぶ本**を先に。道具ディスクやセーブディスクに箱絵は無いので後ろへ。 */
  const rank = g => ((S.covurl[g.id] || g.cover) ? 2 : 0)
                  + (g.kind === 'tool' || g.kind === 'save' ? 1 : 0);
  const list = S.items.slice().sort((a, b) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name, 'ja'));
  const q = (S.covq || '').trim();
  const show = q ? list.filter(g => g.name.includes(q)) : list;

  main().innerHTML = `
  <div class="card" style="max-width:720px">
    <h2>箱絵を直す</h2>
    <p>絵が無い本と、切り出しがうまくいかなかった本を、自分の絵で差し替えられます。<br>
       入れた絵は<b>この端末の中だけ</b>に残ります（置き場には送りません）。
       絵の無いものを先に並べています。</p>
    <div class="field"><input id="q" placeholder="題名で絞る" value="${esc(q)}"
      autocapitalize="off" autocorrect="off"></div>
    <div class="rowlist" style="margin-top:10px">
      ${show.slice(0, 60).map(g => {
        const url = S.covurl[g.id] || g.cover;
        return `<div class="row" style="align-items:center;gap:10px">
          <span style="flex:0 0 40px;height:52px;background:#000;border-radius:4px;overflow:hidden;
                       display:flex;align-items:center;justify-content:center">
            ${url ? `<img src="${esc(url)}" style="max-width:100%;max-height:100%;object-fit:contain">`
                  : '<span class="sub" style="font-size:9px">無し</span>'}</span>
          <span class="nm" style="text-align:left;font-size:13px">${esc(g.name)}
            <span class="sub">${esc(g.short)}${
              g.kind === 'tool' ? '・道具' : g.kind === 'save' ? '・セーブ' : ''
            }${S.covurl[g.id] ? '・手で入れた' : ''}</span></span>
          <button class="hbtn sm" data-pick="${esc(g.id)}">絵を選ぶ</button>
          ${S.covurl[g.id] ? `<button class="hbtn sm" data-drop="${esc(g.id)}">戻す</button>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${show.length > 60 ? `<div class="sub" style="margin-top:8px">ほか ${show.length - 60} 本。題名で絞ってください</div>` : ''}
    <input type="file" id="pf" accept="image/*" style="display:none">
    <button class="hbtn" id="back" style="margin-top:14px">← 設定へ</button>
    <div class="msg" id="m"></div>
  </div>`;

  $('#back').onclick = () => go('#/set');
  const qi = $('#q');
  qi.oninput = () => { S.covq = qi.value; clearTimeout(S.covt);
                       S.covt = setTimeout(() => { screenCovers(); $('#q').focus(); }, 300); };
  for (const b of main().querySelectorAll('[data-pick]')) b.onclick = () => {
    const f = $('#pf');
    f.onchange = async () => {
      const file = f.files && f.files[0];
      f.value = '';
      if (!file) return;
      try {
        await MYCOV.put(b.dataset.pick, await shrinkImage(file));
        await loadMyCovers();
        toast('入れました');
        screenCovers();
      } catch (e) { $('#m').textContent = '入れられません: ' + e.message; }
    };
    f.click();
  };
  for (const b of main().querySelectorAll('[data-drop]')) b.onclick = async () => {
    await MYCOV.del(b.dataset.drop);
    delete S.covurl[b.dataset.drop];
    toast('棚の絵に戻しました');
    screenCovers();
  };
}

/* 入れる絵は棚に合わせて縮める。**そのまま置くと端末の置き場を食う**
   （写真は1枚で数MB、棚の絵は320px で数十KB）。 */
function shrinkImage(file, width = 320) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.min(width, img.naturalWidth);
      const h = Math.round(img.naturalHeight * w / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? res(b) : rej(new Error('絵にできません')), 'image/jpeg', 0.86);
    };
    img.onerror = () => rej(new Error('絵として読めません'));
    img.src = URL.createObjectURL(file);
  });
}

/* 台帳に無い本を、この端末の棚に足す。**置き場（GitHub）には触らない。**
   題名はファイル名から起こす。あとで「箱絵を直す」や題名の直しで整える。 */
function addExtra(r, system, short, core) {
  const extra = LS.get('extra', []);
  if (extra.some(e => e.files.includes(r.name))) return;
  extra.push({
    id: 'X-' + r.fileid, name: r.name.replace(/\.[^.]+$/, ''), system, short, core,
    bytes: r.size, files: [r.name], sub: '見つけた分',
  });
  LS.set('extra', extra);
}

/* 拡張子から機種を当てる。台帳に無いものを拾うときに要る。
   **台帳に載っているのは Mac にあった5機種だけ**だが、pCloud には
   セガ・NEC・SNK・MSX なども置いてある。動かせるものは動かす。
   [拡張子, 機種, 短い名, コア]。コアが null のものは棚に出すが遊べない。 */
const EXT_SYS = [
  [/\.(nes|fds|unf)$/i,            'Famicom',        'FC',   'fceumm'],
  [/\.(smc|sfc|fig|swc)$/i,        'Super Famicom',  'SFC',  'snes9x'],
  [/\.(n64|v64|z64)$/i,            'Nintendo 64',    'N64',  'mupen64plus_next'],
  [/\.nds$/i,                      'Nintendo DS',    'DS',   'melonds'],
  [/\.(gbc|gb)$/i,                 'ゲームボーイ',    'GB',   'gambatte'],
  [/\.gba$/i,                      'ゲームボーイアドバンス', 'GBA', 'mgba'],
  [/\.(md|gen|smd)$/i,             'メガドライブ',    'MD',   'genesis_plus_gx'],
  [/\.sms$/i,                      'マスターシステム', 'SMS',  'genesis_plus_gx'],
  [/\.gg$/i,                       'ゲームギア',      'GG',   'genesis_plus_gx'],
  [/\.pce$/i,                      'PCエンジン',      'PCE',  'mednafen_pce'],
  [/\.(ws|wsc)$/i,                 'ワンダースワン',  'WS',   'mednafen_wswan'],
  [/\.(ngp|ngc)$/i,                'ネオジオポケット', 'NGP',  'mednafen_ngp'],
  [/\.vb$/i,                       'バーチャルボーイ', 'VB',   'beetle_vb'],
  /* **PC-98 の像は拡張子が多い。** NP2kai が読むのは
     FDI・FDD・HDM・TFD・XDF・DUP・2HD・D88・D98・88D・NFD・HDI・THD・NHD・VHD・SLH・HDD・DIP。
     `.d88` だけ見ていると取りこぼす（「ほぼ全てあるはず」の正体はこれ）。 */
  [/\.(fdi|fdd|hdm|tfd|xdf|dup|2hd|d88|d98|88d|nfd|hdi|thd|nhd|vhd|slh|hdd|dip)$/i,
                                    'PC-98',          '98',   null],
  [/\.(dsk|mx1|mx2|cas)$/i,        'MSX',            'MSX',  'bluemsx'],
  /* PSP と PS1 は像の形が同じ（.iso）で見分けられない。棚には出さない。 */
];
const sysOf = name => (EXT_SYS.find(([re]) => re.test(name)) || []).slice(1);

/* ============ pCloud から棚へ ============ */
/* 耳読の書棚に倣った口。あちらは「pCloud にある本を並べて、その場でボタンを押す」だけで、
   **元のフォルダを選ばせない。** こちらの「棚を編む」は Mac の中から選ばせていたので、
   iPhone からは何もできなかった（Safari はフォルダを選べない）。

   すでに pCloud にあるものは、**上げ直す必要がない。**
   向こう側で動かせば一瞬で終わる（`renamefile` に行き先を渡す）。 */
async function screenGather(browse) {
  $('#title').textContent = '棚に上げる';
  /* **調べた結果を捨てない。** 1万2千ファイル歩いた結果を、画面を離れただけで
     失うのは論外。端末に残して次に開いたら続きから。 */
  const G = S.gather || (S.gather = Object.assign(
    { files: null, pick: {}, busy: false, where: null, at: '' },
    LS.get('gather', {})));

  /* **探す場所は「見に行く場所」とは別に決める。**
     見に行く場所は「置いたまま棚に出す」ための登録で、
     こちらは「棚のフォルダへ寄せたいものを探す」ための一時の指定。
     同じにすると、寄せたくない置き場まで巻き込む。 */
  if (browse != null) return gatherPick(browse, G);

  const known = new Map();          // 台帳にあるファイル名 → その本
  for (const i of S.items) for (const f of i.files) known.set(P.nfc(f), i);
  const inShelf = new Set(Object.values(S.files));

  let rows = [], news = [];
  if (G.files) {
    for (const f of G.files) {
      if (inShelf.has(f.fileid)) continue;          // すでに棚にある
      if (S.files[f.name]) continue;                // 同じ名前が棚にもうある
      const item = known.get(f.name);
      /* **台帳に無いものも出す。** ここで捨てていたので「pCloud にはもっと
         あるはずなのに出てこない」ことになっていた。台帳は Mac の中身から
         起こしたものなので、それ以外の道で入れた分は載っていない。 */
      (item ? rows : news).push({ ...f, item });
    }
    rows.sort((a, b) => a.item.name.localeCompare(b.item.name, 'ja'));
    news.sort((a, b) => (a.path + a.name).localeCompare(b.path + b.name, 'ja'));
  }
  const n = Object.keys(G.pick).length;

  /* 同じ名前が倉庫の何か所にもある（`/その他/整理隔離/重複/…` など）。
     並べただけでは気づけないので**印を付ける**。 */
  const seen = {};
  for (const r of [...rows, ...news]) seen[r.name] = (seen[r.name] || 0) + 1;

  const q = (G.q || '').trim().toLowerCase();
  const hit = r => !q || r.name.toLowerCase().includes(q) || (r.path || '').toLowerCase().includes(q);

  const line = (r, depth = 0) => `
    <button class="row" data-fid="${r.fileid}" style="padding-left:${14 + depth * 14}px">
      <span style="width:18px;flex:0 0 18px;color:${G.pick[r.fileid] ? 'var(--accent)' : 'var(--dim2)'}">${
        G.pick[r.fileid] ? '☑' : '☐'}</span>
      <span class="nm" style="text-align:left">${esc(r.name)}
        <span class="sub">${r.item ? esc(r.item.name)
                                   : '<b>台帳に無い</b>'}${
          seen[r.name] > 1 ? ' <b style="color:var(--warn)">重複 ' + seen[r.name] + 'か所</b>' : ''}</span></span>
      <span class="sub" style="text-align:right;flex:0 0 auto">${size(r.size)}</span>
    </button>`;

  /* **フォルダの形のまま木にする。**
     機種で束ねても、1つの束が数百行になって縦に長いままだった。
     倉庫は `/ROM/家庭用ゲーム機/任天堂/NINTENDO64` のように整理されているので、
     **その形をそのまま出す**のがいちばん読める。
     開いた枝は端末に覚える。**探している最中は木にしない**（平らに出す）。 */
  const topen = () => new Set(LS.get('gtree', []));

  function treeOf(list) {
    const root = { dirs: new Map(), files: [], n: 0 };
    for (const r of list) {
      const parts = (r.path || '/').split('/').filter(Boolean);
      let node = root;
      node.n++;
      for (const seg of parts) {
        if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [], n: 0 });
        node = node.dirs.get(seg);
        node.n++;
      }
      node.files.push(r);
    }
    return root;
  }

  function renderNode(node, path, depth, op) {
    let out = '';
    for (const [name, kid] of [...node.dirs.entries()].sort((a, b) => b[1].n - a[1].n)) {
      const key = path + '/' + name;
      const open = op.has(key);
      out += `<div class="tnode" style="padding-left:${depth * 14}px">
        <button class="trow" data-tdir="${esc(key)}">
          <span class="tri">${open ? '▾' : '▸'}</span>
          <span class="tname">${esc(name)}</span>
          <span class="cnt">${kid.n}</span>
        </button>
        <button class="hbtn sm tsel" data-tpick="${esc(key)}">この下を選ぶ</button>
      </div>`;
      if (open) out += renderNode(kid, key, depth + 1, op);
    }
    for (const f of node.files.slice(0, 400)) out += line(f, depth);
    if (node.files.length > 400)
      out += `<div class="sub" style="padding:6px 14px">ほか ${node.files.length - 400} 件。題名で絞ってください</div>`;
    return out;
  }

  main().innerHTML = `
  <div class="card" style="max-width:720px">
    <h2>棚に上げる</h2>
    <p><b>ふつうは移す必要がありません。</b>「見に行く場所」に ROM のフォルダを足せば、
       置いたまま棚に出ます（整理を崩さずに済みます）。<br>
       ここは<b>倉庫の中で1か所に寄せたいとき</b>だけ使ってください。すでに pCloud にあるので
       <b>上げ直しません</b>（向こう側で動かすだけ。一瞬で終わります）。</p>
    <div class="msg" style="margin:6px 0">${G.files
      ? `<b>${esc(G.where ? G.where.name : '')}</b> の分をそのまま出しています${
          G.at ? '（' + esc(G.at) + ' に調べた分）' : ''}。<b>探し直す必要はありません。</b>`
      : '「見に行く場所」を見直すと、その結果をここでそのまま使えます。'}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
      <button class="hbtn" id="scan"${G.busy || !G.where ? ' disabled' : ''}>調べ直す</button>
      <button class="hbtn" id="pickwhere">ほかの場所を調べる</button>
    </div>
    ${G.files ? `<span class="sub" style="margin-left:8px">ROM ${G.files.length} 件${
      G.at ? '・' + esc(G.at) + ' に調べた分' : ''}</span>` : ''}
    <div class="msg" id="gm"></div>

    ${G.files ? ((rows.length + news.length) ? `
      <div style="display:flex;gap:6px;margin:10px 0">
        <button class="hbtn sm" id="gall">見えている分を全部選ぶ</button>
        <button class="hbtn sm" id="gnone">選び直す</button>
      </div>
      <input class="search" id="gq" placeholder="題名や置き場で絞る" value="${esc(G.q || '')}"
        autocapitalize="off" autocorrect="off" spellcheck="false" style="margin:10px 0">
      <div class="sub" style="margin-bottom:8px">
        台帳にある ${rows.length} 件・台帳に無い ${news.length} 件。
        <b>台帳に無い</b>ものは、移すとこの端末の棚に足します（題名はファイル名から）。</div>
      ${q ? `<div class="rowlist">${[...rows, ...news].filter(hit).slice(0, 300).map(r =>
              line(r)).join('')}</div>`
          : `<div class="tree">${renderNode(treeOf([...rows, ...news]), '', 0, topen())}</div>`}
      <div style="display:flex;gap:6px;align-items:center;margin-top:12px">
        <span class="sub">${n} 件えらんだ</span>
        <button class="hbtn" id="gmove"${n && !G.busy ? '' : ' disabled'}>棚へ移す</button>
        <button class="hbtn" id="gcopy"${n && !G.busy ? '' : ' disabled'}>写す（元を残す）</button>
      </div>`
      : '<div class="empty">棚の外に、台帳に載っているファイルは見つかりませんでした。</div>')
    : '<div class="empty">まだ探していません。</div>'}

    <div style="margin-top:16px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="hbtn" id="back">← 棚へ</button>
      <button class="hbtn" id="fromMac">Mac から上げる・倉庫から下げる</button>
    </div>
  </div>`;

  $('#back').onclick = () => go('#/lib');
  $('#fromMac').onclick = () => go('#/edit');
  $('#pickwhere').onclick = () => go('#/gather/0');
  $('#scan').onclick = async () => {
    G.busy = true; $('#gm').textContent = 'pCloud の中を探しています…（本数が多いと少しかかります）';
    try {
      /* **根っこから歩かせない。** 全部を見に行くと、書類も控えも巻き込んで
         5万ファイルを数える羽目になる（実際にそうなった）。指定した1か所だけ見る。 */
      if (!G.where) { G.busy = false; return; }
      const r = await P.scanFolder(G.where.id, { host: S.host, auth: S.auth,
        onStep: (n, left) => { $('#gm').textContent = `${G.where.name} を見ています… ${n} ファイル・残り ${left} 部屋`; } });
      const all = r.files;
      /* 拾う拡張子は EXT_SYS と揃える（別々に書くと必ずずれる）。 */
      G.files = all.filter(f => sysOf(f.name).length);
      G.at = new Date().toISOString().slice(0, 16).replace('T', ' ');
      keepGather(G);
      G.busy = false; screenGather();
    } catch (e) {
      G.busy = false; $('#gm').textContent = '探せません: ' + e.message;
    }
  };
  const gall = $('#gall'), gnone = $('#gnone');
  const gq = $('#gq');
  if (gq) gq.oninput = () => {
    G.q = gq.value;
    clearTimeout(G.qt);
    G.qt = setTimeout(() => { screenGather(); const e = $('#gq'); if (e) { e.focus();
      e.setSelectionRange(e.value.length, e.value.length); } }, 280);
  };
  /* 枝の開け閉め。開いた枝は端末に覚える。 */
  for (const b of main().querySelectorAll('[data-tdir]')) b.onclick = () => {
    const k = b.dataset.tdir, op = new Set(LS.get('gtree', []));
    op.has(k) ? op.delete(k) : op.add(k);
    LS.set('gtree', [...op]);
    screenGather();
  };
  /* 枝ごと選ぶ。メーカーの棚を丸ごと寄せたいときに要る。 */
  for (const b of main().querySelectorAll('[data-tpick]')) b.onclick = ev => {
    ev.stopPropagation();
    const k = b.dataset.tpick;
    const inside = [...rows, ...news].filter(r => ('/' + (r.path || '').replace(/^\//, '') + '/').includes(k + '/')
      || (r.path || '') === k);
    const allOn = inside.length && inside.every(r => G.pick[r.fileid]);
    for (const r of inside) { if (allOn) delete G.pick[r.fileid]; else G.pick[r.fileid] = 1; }
    screenGather();
  };
  /* 「全部選ぶ」は**いま見えている分だけ**。絞ってから押す使い方に合わせる
     （403件を丸ごと選ばせても、選び直すのが大変なだけ）。 */
  if (gall)  gall.onclick  = () => {
    [...rows, ...news].filter(hit).forEach(r => G.pick[r.fileid] = 1);
    screenGather();
  };
  if (gnone) gnone.onclick = () => { G.pick = {}; screenGather(); };
  for (const b of main().querySelectorAll('[data-fid]')) b.onclick = () => {
    const k = b.dataset.fid;
    if (G.pick[k]) delete G.pick[k]; else G.pick[k] = 1;
    screenGather();
  };
  const run = async copy => {
    if (G.busy) return;
    const todo = [...rows, ...news].filter(r => G.pick[r.fileid]);
    if (!todo.length) return;
    G.busy = true;
    let ok = 0, ng = 0, i = 0;
    const folders = {};
    for (const r of todo) {
      i++;
      $('#gm').textContent = `${copy ? '写して' : '移して'}います… ${i}/${todo.length}　${r.name}`;
      try {
        const [system] = r.item ? [r.item.system] : sysOf(r.name);
        if (!system) { ng++; continue; }
        if (!folders[system]) folders[system] = await folderFor(system);
        const fid = await P.moveFile(r.fileid, folders[system], { host: S.host, auth: S.auth, copy });
        S.files[r.name] = fid; ok++;
        if (!r.item) addExtra(r, system, (sysOf(r.name)[1] || ''), (sysOf(r.name)[2] || null));
        delete G.pick[r.fileid];
      } catch (e) { ng++; log.note('移し損ね: ' + r.name + ' — ' + e.message); }
    }
    LS.set('files', S.files);
    S.items = mergeCatalogs();
    G.busy = false;
    G.files = G.files.filter(f => !S.files[f.name] || f.fileid === S.files[f.name]);
    keepGather(G);
    screenGather();
    $('#gm').textContent = `${copy ? '写した' : '移した'} ${ok} / 駄目 ${ng}`;
    log.note(`pCloud の中で ${copy ? '写した' : '移した'} ${ok} / 駄目 ${ng}`);
  };
  const gm = $('#gmove'), gc = $('#gcopy');
  if (gm) gm.onclick = () => run(false);
  if (gc) gc.onclick = () => run(true);
}

/* **よくある置き場は、こちらから探しに行く。**
   置き場が分かっているのに本人に登録させるのは、ただの手間。
   道で直に聞けば1回で済む（`listfolder?path=…`）。
   見つからない道は黙って飛ばす。 */
/* **広いほうから試す。** `/EMU/ROM` だけ見ていると、
   `/EMU/その他/…` に置いてある分を取りこぼす（PC-98 がそうだった）。
   広いものが見つかったら、その下は足さない（二度歩く意味がない）。 */
const LIKELY = [
  ['/EMU', '/EMU/ROM', '/EMU/BIOS'],
  ['/ROM', '/roms'],
  ['/Games'],
  ['/ゲーム棚'],
];

async function autoPlaces(say = () => {}) {
  const found = [];
  for (const group of LIKELY) {
   let tookBroad = false;
   for (const path of group) {
    if (tookBroad) break;
    const have = [...S.roots, { id: S.rootId }].some(x => String(x.path || '') === path);
    if (have) continue;
    say(`${path} を見ています…`);
    try {
      const r = await call('listfolder', { path }, 30000);
      const id = r.metadata.folderid;
      if (String(id) === String(S.rootId)) continue;
      if (S.roots.some(x => String(x.id) === String(id))) continue;
      /* すでに**その下**が登録されているなら外す。
         `/EMU` を足したのに `/EMU/ROM` も残っていると、同じ所を二度歩く。 */
      const drop = S.roots.filter(x => x.path && x.path !== path
        && x.path.startsWith(path + '/'));
      if (drop.length) {
        S.roots = S.roots.filter(x => !drop.includes(x));
        log.note(`重なるので外した: ${drop.map(x => x.path).join('・')}`);
      }
      S.roots.push({ id, name: path, path });
      found.push(path);
      tookBroad = true;          // 広いほうが見つかった。その下は足さない
      log.note(`置き場を見つけた: ${path} → folderid=${id}`);
    } catch (e) { /* 無い道は飛ばす */ }
   }
  }
  if (found.length) LS.set('roots', S.roots);
  return found;
}

/* 道を直に打つ口。**降りて探させない。**
   置き場が分かっているのに根から1階ずつ降りるのは遅いし、
   根の一覧が重い倉庫では、そこで止まってしまう。 */
function pathBox() {
  return `
    <div class="field" style="margin:10px 0">
      <label>道が分かっているなら、そのまま打てます</label>
      <div style="display:flex;gap:6px">
        <input id="ppath" placeholder="/EMU/ROM" value="${esc(S.lastPath || '')}"
          autocapitalize="off" autocorrect="off" spellcheck="false" style="flex:1">
        <button class="hbtn" id="pgo">この道で足す</button>
      </div>
      <div class="msg" id="pmsg"></div>
    </div>`;
}

function bindPathBox(after) {
  const go2 = $('#pgo'), inp = $('#ppath');
  if (!go2 || !inp) return;
  go2.onclick = async () => {
    const path = inp.value.trim();
    if (!path.startsWith('/')) { $('#pmsg').textContent = '/ から始めてください（例 /EMU/ROM）'; return; }
    S.lastPath = path; LS.set('lastPath', path);
    go2.disabled = true; $('#pmsg').textContent = '見ています…';
    try {
      const r = await call('listfolder', { path }, 60000);
      const id = r.metadata.folderid;
      const nm = r.metadata.name || path.split('/').filter(Boolean).pop() || path;
      log.note(`道で開いた: ${path} → folderid=${id}`);
      after(id, nm);
    } catch (e) {
      log.note(`道で開けない: ${path} — ${e.message}`);
      $('#pmsg').textContent = '開けません: ' + e.message;
      go2.disabled = false;
    }
  };
}

/* ============ 見に行く場所 ============ */
/* **ROM を棚のフォルダへ移させない。** `/EMU/ROM/…` のようにメーカー別で
   整理してある置き場を崩すのは筋が悪い。**その場所も見に行けば済む。**
   遊ぶときに使うのは fileid なので、どこに置いてあっても関係ない。 */
async function screenPlaces(folderid) {
  $('#title').textContent = '倉庫の場所';
  const browsing = folderid != null;

  if (!browsing) {
    /* **棚と倉庫を同じ一覧に並べない。**
       `/ゲーム棚` は倉庫の置き場ではなく**棚そのもの**（取り寄せ先）。
       同じ表に混ぜたら「倉庫の場所が違う」と言われた。分けて出す。 */
    main().innerHTML = `
    <div class="card" style="max-width:640px">
      <h2>棚と倉庫</h2>

      <h3>棚（取り寄せ先）</h3>
      <p class="sub">遊ぶと決めた本が、周りのもの（箱絵・メモ・セーブ）ごとここに入ります。
         下ろしたものは、この下の <code>書庫</code> へ移ります。</p>
      <div class="rowlist">
        <div class="row">
          <span class="nm" style="text-align:left">${esc(S.rootName || '（未選択）')}
            <span class="sub">棚／書庫／記録の置き先</span></span>
          <button class="hbtn sm" id="repick2">選び直す</button>
        </div>
      </div>

      <h3 style="margin-top:18px">倉庫の場所（見に行く所）</h3>
      <p class="sub">棚は<b>ここに挙げた場所ぜんぶ</b>を見て並べます。
         ROM を1か所に集める必要はありません（整理したまま置いておけます）。</p>
      <div class="rowlist">
        ${S.roots.length ? S.roots.map((pl, i) => `<div class="row">
          <span class="nm" style="text-align:left">${esc(pl.name)}
            <span class="sub">${esc(pl.path || '')}</span></span>
          <button class="hbtn sm" data-off="${i}">外す</button>
        </div>`).join('')
        : '<div class="empty">まだ足していません。「よくある置き場を探す」から。</div>'}
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
        <button class="hbtn" id="auto">よくある置き場を探す</button>
        <button class="hbtn" id="add">場所を足す</button>
        <button class="hbtn" id="scan2">いま見直す</button>
        <button class="hbtn" id="dupes">重複を片付ける</button>
        <button class="hbtn" id="idx">目録を読む</button>
        <button class="hbtn" id="back">← 設定へ</button>
      </div>
      <div class="msg" id="pm">${S.lastScan ? S.lastScan : ''}</div>
      ${(() => {
        const sc = LS.get('scan', null);
        if (!sc || !sc.ext) return '';
        const got = sc.ext.filter(x => x.拾う), no = sc.ext.filter(x => !x.拾う);
        return `<h3 style="margin-top:18px">倉庫の中身（${esc(String(sc.count))} ファイル）</h3>
          <p class="sub">${esc(sc.at)} に見た分。<b>拾っている</b>のは棚に出る拡張子です。</p>
          <div class="sub" style="line-height:1.9">
            <b>拾っている</b>　${got.map(x => `${esc(x.e)} <b>${x.n}</b>`).join('　') || 'なし'}<br>
            <span style="color:var(--dim2)">拾っていない　${
              no.map(x => `${esc(x.e)} ${x.n}`).join('　') || 'なし'}</span>
          </div>`;
      })()}
    </div>`;
    $('#back').onclick = () => go('#/set');
    $('#add').onclick = () => go('#/places/0');
    $('#repick2').onclick = () => go('#/pick/0');
    $('#auto').onclick = async () => {
      const m = $('#pm');
      m.textContent = '探しています…';
      const found = await autoPlaces(t => { m.textContent = t; });
      if (!found.length) { m.textContent = 'よくある置き場は見つかりませんでした。「場所を足す」から選んでください。'; return; }
      m.textContent = `見つけた: ${found.join('・')}。見に行きます…`;
      try {
        const r = await scanAll(t => { m.textContent = t; });
        S.items = mergeCatalogs();
        m.innerHTML = `${r.places} か所・${r.count} ファイル。`
          + (r.added ? `台帳に無い本を <b>${r.added} 本</b>、棚に起こしました。` : '')
          + '<br><span class="sub">' + r.report.join('　／　') + '</span>';
      } catch (e) { m.textContent = '見に行けません: ' + e.message; }
      screenPlaces();
    };
    $('#dupes').onclick = () => go('#/dupes');
    $('#idx').onclick = async () => {
      const m = $('#pm');
      try {
        const r = await readIndexHtml(t => { m.textContent = t; });
        m.innerHTML = r.docs
          ? `目録 ${r.docs} 件のうち ${r.used} 件を読み、<b>${r.hit} 本</b>の題名を入れ直しました。`
          : '倉庫に目録（HTML・CSV・TXT）が見つかりませんでした。';
        screenPlaces();
      } catch (e) { m.textContent = '読めません: ' + e.message; }
    };
    $('#scan2').onclick = async () => {
      const m = $('#pm');
      try {
        const r = await scanAll(t => { m.textContent = t; });
        S.items = mergeCatalogs();
        S.lastScan = `${r.places} か所・${r.count} ファイル。`
          + (r.added ? `台帳に無い本を <b>${r.added} 本</b>、棚に起こしました。` : '台帳に無い本はありませんでした。')
          + '<br><span class="sub">' + r.report.join('　／　') + '</span>';
        m.innerHTML = S.lastScan;
      } catch (e) { m.textContent = '見られません: ' + e.message; }
    };
    for (const b of main().querySelectorAll('[data-off]')) b.onclick = () => {
      S.roots.splice(+b.dataset.off, 1);
      LS.set('roots', S.roots);
      screenPlaces();
    };
    return;
  }

  /* 足す場所を選ぶ。1階ずつ降りる（倉庫のフォルダ選びと同じ呼び方）。
     **待たせるときは秒を出す。** 黙って「見ています…」のまま止まると、
     動いているのか死んだのかが分からない（実際に固まって見えた）。 */
  const t0 = Date.now();
  main().innerHTML = `<div class="card" style="max-width:560px">
    <p id="wait">見ています…</p></div>`;
  const tick = setInterval(() => {
    const w = $('#wait');
    if (w) w.textContent = `見ています… ${Math.round((Date.now() - t0) / 1000)} 秒`;
  }, 1000);
  let r;
  try { r = await call('listfolder', { folderid }, 60000); }
  catch (e) {
    clearInterval(tick);
    log.note(`倉庫を開けない: folderid=${folderid} — ${e.message}`);
    main().innerHTML = `<div class="card" style="max-width:560px">
      <div class="msg err">開けません: ${esc(e.message)}</div>
      <div class="sub">つながりが細いか、pCloud が混んでいるのかもしれません。
        設定 →「押した記録」に残しています。</div>
      ${pathBox()}
      <button class="hbtn" id="again" style="margin-top:10px">もう一度</button>
      <button class="hbtn" id="back" style="margin-left:6px">← 戻る</button></div>`;
    bindPathBox(async (id, nm) => {
      if (!S.roots.some(x => String(x.id) === String(id)) && String(S.rootId) !== String(id)) {
        S.roots.push({ id, name: nm }); LS.set('roots', S.roots);
      }
      $('#pmsg').textContent = '足しました。見に行きます…';
      try { const r2 = await scanAll(t => { $('#pmsg').textContent = t; });
        toast(`${r2.places} か所・${r2.count} ファイル`
          + (r2.added ? `／${r2.added} 本を新たに棚へ` : '')); } catch (e) {}
      S.items = mergeCatalogs();
      go('#/places');
    });
    $('#again').onclick = () => screenPlaces(folderid);
    $('#back').onclick = () => go('#/places');
    return;
  }
  clearInterval(tick);
  log.note(`倉庫を開いた: folderid=${folderid} ${Math.round((Date.now() - t0) / 1000)}秒`);
  const md = r.metadata;
  const dirs = (md.contents || []).filter(c => c.isfolder)
    .sort((a, b) => collator.compare(a.name, b.name));
  const up = md.parentfolderid != null && String(folderid) !== '0';
  main().innerHTML = `
  <div class="card" style="max-width:560px">
    <h2>場所を足す</h2>
    <p>ROM の入っているフォルダを選んでください。<b>中の入れ子は問いません</b>
       （<code>/EMU/ROM</code> を選べば、その下のメーカー別のフォルダも全部見ます）。</p>
    ${pathBox()}
    <div style="font-size:13px;color:var(--dim);margin-bottom:10px">${esc(md.name || '/')}</div>
    <div class="rowlist">
      ${up ? `<button class="row" data-go="${md.parentfolderid}"><span class="nm">← 上へ</span></button>` : ''}
      ${dirs.map(d => `<button class="row" data-go="${d.folderid}">
        <span class="nm">📁 ${esc(d.name)}</span></button>`).join('')}
    </div>
    <button class="hbtn" id="use2" style="margin-top:12px"${String(folderid) === '0' ? ' disabled' : ''}>
      ここを足す</button>
    <button class="hbtn" id="back" style="margin-left:6px">← 場所の一覧へ</button>
    <div class="msg" id="pm"></div>
  </div>`;
  $('#back').onclick = () => go('#/places');
  for (const b of main().querySelectorAll('[data-go]')) b.onclick = () => go('#/places/' + b.dataset.go);
  bindPathBox((id, nm) => addPlace(id, nm));
  $('#use2').onclick = async () => addPlace(folderid, md.name || '/');
  async function addPlace(folderid, nm) {
    if (S.roots.some(x => String(x.id) === String(folderid)) || String(S.rootId) === String(folderid)) {
      const m = $('#pmsg') || $('#pm');
      if (m) m.textContent = 'その場所はもう入っています';
      return;
    }
    S.roots.push({ id: folderid, name: nm });
    LS.set('roots', S.roots);
    const m = $('#pmsg') || $('#pm');
    if (m) m.textContent = '足しました。見に行きます…';
    try {
      const r2 = await scanAll(t => { if (m) m.textContent = t; });
      toast(`${r2.places} か所・${r2.count} ファイル`
        + (r2.added ? `／${r2.added} 本を新たに棚へ` : ''));
    } catch (e) { if (m) m.textContent = '見に行けません: ' + e.message; }
    S.items = mergeCatalogs();
    go('#/places');
  }
}

/* 調べた結果を端末に残す。**大きいので、入らなければ諦めて黙って続ける**
   （残せないことより、動かないことのほうが困る）。 */
function keepGather(G) {
  try {
    LS.set('gather', { where: G.where, at: G.at,
      files: (G.files || []).slice(0, 6000) });
  } catch (e) { log.note('調べた結果を残せません（置き場がいっぱい）'); }
}

/* 「棚に上げる」で探す場所を選ぶ。1階ずつ降りる（棚のフォルダ選びと同じ呼び方）。 */
async function gatherPick(folderid, G) {
  const t0 = Date.now();
  main().innerHTML = `<div class="card" style="max-width:560px">
    <p id="wait">見ています…</p></div>`;
  const tick = setInterval(() => {
    const w = $('#wait');
    if (w) w.textContent = `見ています… ${Math.round((Date.now() - t0) / 1000)} 秒`;
  }, 1000);
  let r;
  try { r = await call('listfolder', { folderid }, 60000); }
  catch (e) {
    clearInterval(tick);
    main().innerHTML = `<div class="card" style="max-width:560px">
      <div class="msg err">開けません: ${esc(e.message)}</div>
      <button class="hbtn" id="back">← 戻る</button></div>`;
    $('#back').onclick = () => go('#/gather');
    return;
  }
  clearInterval(tick);
  const md = r.metadata;
  const dirs = (md.contents || []).filter(c => c.isfolder)
    .sort((a, b) => collator.compare(a.name, b.name));
  const files = (md.contents || []).filter(c => !c.isfolder && sysOf(P.nfc(c.name)).length).length;
  const up = md.parentfolderid != null && String(folderid) !== '0';
  main().innerHTML = `
  <div class="card" style="max-width:560px">
    <h2>探す場所を選ぶ</h2>
    <p>ここから下を探して、倉庫の中で寄せられるものを並べます。<br>
       <span class="sub">「見に行く場所」とは別です。あちらは<b>置いたまま棚に出す</b>登録、
       こちらは<b>寄せたいものを探す</b>ための一時の指定です。</span></p>
    <div style="font-size:13px;color:var(--dim);margin-bottom:10px">${esc(md.name || '/')}
      ${files ? `<span class="sub">・この階に ROM が ${files} 個</span>` : ''}</div>
    <div class="rowlist">
      ${up ? `<button class="row" data-go="${md.parentfolderid}"><span class="nm">← 上へ</span></button>` : ''}
      ${dirs.map(d => `<button class="row" data-go="${d.folderid}">
        <span class="nm">📁 ${esc(d.name)}</span></button>`).join('')}
    </div>
    <button class="hbtn" id="use3" style="margin-top:12px"${String(folderid) === '0' ? ' disabled' : ''}>
      ここを探す場所にする</button>
    <button class="hbtn" id="back" style="margin-left:6px">← 棚に上げるへ</button>
  </div>`;
  $('#back').onclick = () => go('#/gather');
  for (const b of main().querySelectorAll('[data-go]')) b.onclick = () => go('#/gather/' + b.dataset.go);
  $('#use3').onclick = () => {
    G.where = { id: folderid, name: md.name || '/' };
    G.files = null; G.pick = {}; G.at = '';
    keepGather(G);
    go('#/gather');
  };
}

/* ============ 重複を片付ける ============ */
/* 倉庫には同じ名前が何か所にもある（`/その他/整理隔離/重複/…` など）。
   **消す操作なので、安全側に倒す。**
   ・**大きさが違うものは重複と見なさない。** 同じ名前でも中身は別物のことがある
     （版違い・壊れた控え）。消す候補から外し、印だけ付ける
   ・残す1本は**置き場で決める**。`重複`・`隔離`・`バックアップ` の下は後回し、
     次に浅い所、それでも並べば名前順。**利用者が選び直せる**
   ・消す前に、何を何件どれだけ消すかを必ず出して確かめる */
const JUNKY = /重複|隔離|バックアップ|backup|copy|コピー|old|旧/i;

async function screenDupes() {
  $('#title').textContent = '重複を片付ける';
  const D2 = S.dupes || (S.dupes = { where: null, groups: null, keep: {}, busy: false });

  const body = D2.groups ? (() => {
    const same = D2.groups.filter(g => g.same);
    const diff = D2.groups.filter(g => !g.same);
    const extra = same.reduce((n, g) => n + g.files.length - 1, 0);
    const bytes = same.reduce((n, g) =>
      n + g.files.filter(f => f.fileid !== (D2.keep[g.name] || g.files[0].fileid))
              .reduce((m, f) => m + f.size, 0), 0);
    return `
      <div class="msg" style="margin:10px 0">
        同じ名前で<b>大きさも同じ</b>: ${same.length} 組（余り ${extra} 件・${size(bytes)}）<br>
        <span class="sub">同じ名前だが<b>大きさが違う</b>: ${diff.length} 組
          —— 中身が別物の見込みなので、消す候補から外しています。</span>
      </div>
      ${same.length ? `<div class="rowlist">${same.slice(0, 120).map(g => `
        <div class="row" style="display:block;padding:10px 14px">
          <div class="nm" style="text-align:left;font-size:13px">${esc(g.name)}
            <span class="sub">${size(g.files[0].size)}・${g.files.length} か所</span></div>
          ${g.files.map(f => {
            const keep = (D2.keep[g.name] || g.files[0].fileid) === f.fileid;
            return `<button class="row" data-keep="${esc(g.name)}|${f.fileid}"
              style="padding:5px 0;border:0;background:none;width:100%">
              <span style="width:16px;flex:0 0 16px;color:${keep ? 'var(--ok)' : 'var(--dim2)'}">${keep ? '●' : '○'}</span>
              <span class="sub" style="text-align:left;flex:1">${esc(f.path || '/')}</span>
              <span class="sub">${keep ? '残す' : '消す'}</span>
            </button>`;
          }).join('')}
        </div>`).join('')}</div>
        ${same.length > 120 ? `<div class="sub">ほか ${same.length - 120} 組</div>` : ''}
        <button class="hbtn" id="del" style="margin-top:12px"${D2.busy ? ' disabled' : ''}>
          余り ${extra} 件を倉庫から消す</button>`
      : '<div class="empty">消してよい重複はありません。</div>'}`;
  })() : '<div class="empty">まだ調べていません。</div>';

  main().innerHTML = `
  <div class="card" style="max-width:720px">
    <h2>重複を片付ける</h2>
    <p>倉庫の中で<b>同じ名前・同じ大きさ</b>のものを探し、1本だけ残して余りを消します。<br>
       <span class="sub">大きさが違うものは<b>中身が別物の見込み</b>なので触りません。
       残す1本は選び直せます（●が残す方）。<b>消したら戻せません。</b></span></p>
    <div class="msg" style="margin:6px 0">調べる場所: <b>${esc(D2.where ? D2.where.name : '未指定')}</b></div>
    <button class="hbtn" id="pick">場所を選ぶ</button>
    <button class="hbtn" id="scan"${D2.busy || !D2.where ? ' disabled' : ''}>調べる</button>
    <div class="msg" id="dm"></div>
    ${body}
    <button class="hbtn" id="back" style="margin-top:14px">← 倉庫の場所へ</button>
  </div>`;

  $('#back').onclick = () => go('#/places');
  $('#pick').onclick = () => go('#/dupes/0');
  $('#scan').onclick = async () => {
    D2.busy = true; $('#dm').textContent = '調べています…';
    try {
      const r = await P.scanFolder(D2.where.id, { host: S.host, auth: S.auth,
        onStep: (n, left) => { $('#dm').textContent = `見ています… ${n} ファイル・残り ${left} 部屋`; } });
      const box = new Map();
      for (const f of r.files) {
        if (!sysOf(f.name).length) continue;
        if (!box.has(f.name)) box.set(f.name, []);
        box.get(f.name).push(f);
      }
      const groups = [];
      for (const [name, files] of box) {
        if (files.length < 2) continue;
        /* 残すのは「まともな置き場」の1本。重複・隔離・控えの下は後回し、
           次に浅い所（`/` の数が少ない）、それでも並べば名前順。 */
        files.sort((a, b) => (JUNKY.test(a.path) - JUNKY.test(b.path))
          || (a.path.split('/').length - b.path.split('/').length)
          || a.path.localeCompare(b.path, 'ja'));
        groups.push({ name, files, same: files.every(f => f.size === files[0].size) });
      }
      groups.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      D2.groups = groups; D2.busy = false;
      screenDupes();
    } catch (e) { D2.busy = false; $('#dm').textContent = '調べられません: ' + e.message; }
  };
  for (const b of main().querySelectorAll('[data-keep]')) b.onclick = () => {
    const [nm, fid] = b.dataset.keep.split('|');
    D2.keep[nm] = +fid;
    screenDupes();
  };
  const del = $('#del');
  if (del) del.onclick = async () => {
    const same = D2.groups.filter(g => g.same);
    const todo = [];
    for (const g of same) {
      const keep = D2.keep[g.name] || g.files[0].fileid;
      for (const f of g.files) if (f.fileid !== keep) todo.push(f);
    }
    if (!todo.length) return;
    const mb = size(todo.reduce((n, f) => n + f.size, 0));
    if (!confirm(`倉庫から ${todo.length} 件（${mb}）を消します。\n\n`
      + todo.slice(0, 6).map(f => f.path + '/' + f.name).join('\n')
      + (todo.length > 6 ? `\nほか ${todo.length - 6} 件` : '')
      + '\n\n戻せません。よろしいですか。')) return;
    D2.busy = true;
    let ok = 0, ng = 0, i = 0;
    for (const f of todo) {
      i++;
      $('#dm').textContent = `消しています… ${i}/${todo.length}　${f.name}`;
      try { await P.deleteFile(f.fileid, { host: S.host, auth: S.auth }); ok++; }
      catch (e) { ng++; log.note('消し損ね: ' + f.path + '/' + f.name + ' — ' + e.message); }
    }
    D2.busy = false; D2.groups = null;
    log.note(`重複を消した ${ok} / 駄目 ${ng}`);
    screenDupes();
    $('#dm').textContent = `消した ${ok} / 駄目 ${ng}。もう一度「調べる」で確かめられます。`;
  };
}

/* 調べる場所を選ぶ。 */
async function dupesPick(folderid) {
  const D2 = S.dupes || (S.dupes = { where: null, groups: null, keep: {}, busy: false });
  main().innerHTML = '<div class="card"><p>見ています…</p></div>';
  let r;
  try { r = await call('listfolder', { folderid }); }
  catch (e) {
    clearInterval(tick);
    main().innerHTML = `<div class="card" style="max-width:560px">
      <div class="msg err">開けません: ${esc(e.message)}</div>
      <button class="hbtn" id="back">← 戻る</button></div>`;
    $('#back').onclick = () => go('#/dupes');
    return;
  }
  clearInterval(tick);
  const md = r.metadata;
  const dirs = (md.contents || []).filter(c => c.isfolder)
    .sort((a, b) => collator.compare(a.name, b.name));
  const up = md.parentfolderid != null && String(folderid) !== '0';
  main().innerHTML = `
  <div class="card" style="max-width:560px">
    <h2>調べる場所を選ぶ</h2>
    <p>ここから下を調べます。<b>広く取ったほうが重複は見つかります</b>
       （倉庫の根に近い所を選ぶと、離れた場所どうしの重複も拾えます）。</p>
    <div style="font-size:13px;color:var(--dim);margin-bottom:10px">${esc(md.name || '/')}</div>
    <div class="rowlist">
      ${up ? `<button class="row" data-go="${md.parentfolderid}"><span class="nm">← 上へ</span></button>` : ''}
      ${dirs.map(d => `<button class="row" data-go="${d.folderid}">
        <span class="nm">📁 ${esc(d.name)}</span></button>`).join('')}
    </div>
    <button class="hbtn" id="use4" style="margin-top:12px"${String(folderid) === '0' ? ' disabled' : ''}>
      ここを調べる</button>
    <button class="hbtn" id="back" style="margin-left:6px">← 戻る</button>
  </div>`;
  $('#back').onclick = () => go('#/dupes');
  for (const b of main().querySelectorAll('[data-go]')) b.onclick = () => go('#/dupes/' + b.dataset.go);
  $('#use4').onclick = () => {
    D2.where = { id: folderid, name: md.name || '/' };
    D2.groups = null; D2.keep = {};
    go('#/dupes');
  };
}

/* ============ 箱絵の捜索（裏で） ============ */
/* 倉庫が見えるようになって 7171 本。**台帳に絵は用意できない。**
   そこで、**いま画面に出ている本の絵を、裏で探して埋める。**

   ブラウザから叩けるのは libretro の置き場だけ。画像検索は CORS で塞がれている
   （そちらは Mac 側の `tools/fetch-covers.py` の担当）。
   探した結果は端末に残すので、二度同じ本を探さない。 */
const LR_REPO = {
  'Famicom':        'Nintendo_-_Nintendo_Entertainment_System',
  'Super Famicom':  'Nintendo_-_Super_Nintendo_Entertainment_System',
  'Nintendo 64':    'Nintendo_-_Nintendo_64',
  'Nintendo DS':    'Nintendo_-_Nintendo_DS',
  'ゲームボーイ':      'Nintendo_-_Game_Boy',
  'ゲームボーイアドバンス': 'Nintendo_-_Game_Boy_Advance',
  'メガドライブ':      'Sega_-_Mega_Drive_-_Genesis',
  'マスターシステム':   'Sega_-_Master_System_-_Mark_III',
  'ゲームギア':       'Sega_-_Game_Gear',
  'PCエンジン':      'NEC_-_PC_Engine_-_TurboGrafx-16',
  'ワンダースワン':    'Bandai_-_WonderSwan',
  'ネオジオポケット':   'SNK_-_Neo_Geo_Pocket',
  'バーチャルボーイ':   'Nintendo_-_Virtual_Boy',
  'MSX':            'Microsoft_-_MSX',
  'PC-98':          'NEC_-_PC-98',
};

/* 置き場の名前は No-Intro の書き方。手元の名前には配り手の付け足しが多いので、
   いくつかの形に均して当てる。 */
function lrNames(g) {
  const raw = (g.name || '').replace(/\.[^.]+$/, '');
  let n = raw
    .replace(/^\d{3,4}\s*-\s*/, '')          // `0228 - Mario Kart DS`
    .replace(/\[[^\]]*\]/g, '')              // `[b1]` `[!]` `[N64 Jap]`
    .replace(/\((FMG[^)]*|Pirate|MODE7|WRG\w*|V\d[\d.]*)\)/gi, '')
    .replace(/\s+/g, ' ').trim();
  const out = [];
  const push = v => { if (v && !out.includes(v)) out.push(v); };
  push(n);
  const bare = n.replace(/\s*\([^)]*\)\s*$/, '').trim();
  for (const tag of ['(Japan)', '(Japan, USA)', '(USA)', '(World)', '(Japan) (Rev 1)']) push(bare + ' ' + tag);
  push(bare);
  if (g.sub) { push(g.sub); push(g.sub + ' (Japan)'); push(g.sub + ' (USA)'); }
  return out.slice(0, 6);
}

const HUNT = { tried: null, busy: false, queue: [], found: 0, done: 0, miss: 0 };

/* **裏で動いているものは、見えるようにする。**
   黙って探していると「捜査状況がみえない」ことになる。 */
function huntLine() {
  const e = $('#huntline');
  if (!e) return;
  if (HUNT.busy || HUNT.queue.length) {
    e.innerHTML = `箱絵を探しています… 残り <b>${HUNT.queue.length}</b>`
      + `（見つけた <b style="color:var(--ok)">${HUNT.found}</b>`
      + `・無かった ${HUNT.miss}）`;
    e.style.display = '';
  } else if (HUNT.done) {
    e.innerHTML = `箱絵の捜索: 見つけた <b style="color:var(--ok)">${HUNT.found}</b>`
      + `／探した ${HUNT.done}　<span class="sub">この画面に出ている本から順に探します</span>`;
    e.style.display = '';
  } else {
    e.style.display = 'none';
  }
}

function huntTried() {
  if (!HUNT.tried) HUNT.tried = new Set(LS.get('hunted', []));
  return HUNT.tried;
}

/* 画面に出ている本のうち、絵の無いものを裏で探す。
   **見えている分だけ。** 7171本を総当たりしたら、置き場にも端末にも悪い。 */
function huntCovers(items) {
  const t = huntTried();
  const add = items.filter(g => !g.cover && !S.covurl[g.id] && !t.has(g.id) && LR_REPO[g.system]);
  for (const g of add) if (!HUNT.queue.some(x => x.id === g.id)) HUNT.queue.push(g);
  runHunt();
}

async function runHunt() {
  if (HUNT.busy || document.hidden) return;
  HUNT.busy = true;
  huntLine();
  const t = huntTried();
  try {
    while (HUNT.queue.length && !document.hidden) {
      const g = HUNT.queue.shift();
      if (t.has(g.id)) continue;
      t.add(g.id);
      HUNT.done++;
      let got = false;
      for (const nm of lrNames(g)) {
        const url = 'https://raw.githubusercontent.com/libretro-thumbnails/'
          + LR_REPO[g.system] + '/master/Named_Boxarts/' + encodeURIComponent(nm) + '.png';
        try {
          const r = await fetch(url, { cache: 'force-cache' });
          if (!r.ok) continue;
          const blob = await r.blob();
          if (blob.size < 1000) continue;
          await MYCOV.put(g.id, blob);
          S.covurl[g.id] = URL.createObjectURL(blob);
          got = true; HUNT.found++; huntLine();
          /* いま出ている札に、その場で貼る。描き直さない（探している間ずっと
             画面が跳ねると鬱陶しい）。 */
          const cell = main().querySelector(`.item[data-id="${CSS.escape(g.id)}"] .cov`);
          if (cell) cell.innerHTML = `<img src="${S.covurl[g.id]}" alt="">`
            + cell.innerHTML.replace(/^<img[^>]*>|<div class="ph">.*?<\/div>/, '');
          break;
        } catch (e) { /* 次の形を試す */ }
      }
      if (!got) HUNT.miss++;
      huntLine();
      await new Promise(r => setTimeout(r, 120));   // 置き場に優しく
      if (HUNT.found % 10 === 3) LS.set('hunted', [...t].slice(-9000));
    }
  } finally {
    HUNT.busy = false;
    huntLine();
    LS.set('hunted', [...t].slice(-9000));
  }
}
addEventListener('visibilitychange', () => { if (!document.hidden) runHunt(); });

/* ============ 棚に取り寄せる／棚から下ろす ============ */
/* **棚は倉庫の中の実体**。本ごとにフォルダを作り、その本にまつわるものを
   まとめて入れる。散らばらせない。

     /ゲーム棚/棚/<本の名前>/
         <ROM>        倉庫から**写す**（倉庫の整理は崩さない）
         箱絵.jpg
         メモ.json     ディスクの組み合わせ・機種・ジャンル
         セーブ/       書き換わったディスク（PC-98 のセーブはここに入る）

   下ろすときは、**フォルダごと** `/ゲーム棚/書庫/` へ動かす。
   1つずつ動かすと、途中で落ちたときに散らばる。 */

const SAFE = n => String(n).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 90) || '名無し';

async function shelfRoot(name) {
  const base = await P.ensureFolder(S.rootId, name, { host: S.host, auth: S.auth });
  return base;
}

/* 棚に取り寄せる。**遊べるようにするだけでなく、周りのものも揃える。** */
async function stock(item, say = () => {}) {
  if (!S.auth || !S.rootId) return null;
  const shelf = await shelfRoot('棚');
  const dir = await P.ensureFolder(shelf, SAFE(item.name), { host: S.host, auth: S.auth });

  /* ① 本体を写す。**移さない。** 倉庫の整理を崩さないため。 */
  for (const f of item.files) {
    const fid = S.files[P.nfc(f)];
    if (!fid) continue;
    say(`${f} を棚へ…`);
    try { await P.moveFile(fid, dir, { host: S.host, auth: S.auth, copy: true }); }
    catch (e) { log.note('棚へ写せない: ' + f + ' — ' + e.message); }
  }

  /* ② 箱絵。手で入れた絵があればそれ、無ければ棚の絵を取り直して置く。 */
  try {
    let blob = null;
    const r = await MYCOV.get(item.id);
    if (r) blob = await r.blob();
    else if (item.cover) blob = await (await fetch(item.cover)).blob();
    if (blob) {
      say('箱絵を置いています…');
      await P.uploadFile(dir, '箱絵.jpg', blob, { host: S.host, auth: S.auth });
    }
  } catch (e) { log.note('箱絵を置けない: ' + e.message); }

  /* ③ メモ。ディスクの組み合わせは本ごとに端末が覚えているので、ここに書き出す。 */
  try {
    const memo = {
      題名: item.name, 機種: item.system, ジャンル: item.genre || '',
      ファイル: item.files,
      ディスクの組み合わせ: LS.get('fdpick', {})[item.id] || null,
      置いた: new Date().toISOString(),
    };
    await P.uploadFile(dir, 'メモ.json',
      new Blob([JSON.stringify(memo, null, 1)], { type: 'application/json' }),
      { host: S.host, auth: S.auth });
  } catch (e) { log.note('メモを置けない: ' + e.message); }

  /* ④ セーブ。PC-98 はセーブがディスクそのものに書かれるので、
     端末に残っている書き換わったディスクを上げる。 */
  try {
    const here = await ROMS.list();
    const mine = Object.keys(here).filter(k =>
      k.startsWith('blank-' + item.id + '-') || k.startsWith('cfg-' + item.id)
      || item.files.some(f => String(S.files[P.nfc(f)]) === k));
    if (mine.length) {
      const sdir = await P.ensureFolder(dir, 'セーブ', { host: S.host, auth: S.auth });
      for (const k of mine) {
        const res = await ROMS.get(k);
        if (!res) continue;
        const nm = decodeURIComponent(res.headers.get('x-name') || k);
        say(`セーブ ${nm} を置いています…`);
        await P.uploadFile(sdir, nm, await res.blob(), { host: S.host, auth: S.auth });
      }
    }
  } catch (e) { log.note('セーブを置けない: ' + e.message); }

  log.note(`棚に取り寄せた: ${item.name}`);
  return dir;
}

/* 棚から下ろす。**周りのものごと**書庫へ。 */
async function archive(item, say = () => {}) {
  if (!S.auth || !S.rootId) return false;
  const shelf = await shelfRoot('棚');
  const store = await shelfRoot('書庫');
  const r = await call('listfolder', { folderid: shelf });
  const want = P.nfc(SAFE(item.name));
  const dir = (r.metadata.contents || [])
    .find(c => c.isfolder && P.nfc(c.name) === want);
  if (!dir) return false;
  say('書庫へ移しています…');
  await P.moveFolder(dir.folderid, store, { host: S.host, auth: S.auth });
  log.note(`棚から下ろした: ${item.name} → 書庫`);
  return true;
}

/* 版を選ぶ。**どれが「当たり」かは中を見ないと分からない**ので、
   名前と大きさを並べて本人に選ばせる。選んだ版は覚える（設定から選び直せる）。 */
function pickVer(gkey, vs) {
  const box = document.createElement('div');
  box.className = 'sheet';
  box.innerHTML = `
    <div class="sheetbox">
      <h3>どの版で遊びますか</h3>
      <p class="sub">同じ本が ${vs.length} 版あります。選んだ版を覚えます
        （あとで「版を選び直す」から変えられます）。</p>
      <div class="rowlist">
        ${vs.map(v => `<button class="row" data-v="${esc(v.id)}">
          <span class="nm" style="text-align:left">${esc(v.name)}</span>
          <span class="sub">${size(v.bytes || 0)}${
            hasAll(v) ? '' : ' <span style="color:var(--danger)">倉庫に無い</span>'}</span>
        </button>`).join('')}
      </div>
      <button class="hbtn" id="vclose" style="margin-top:12px">やめる</button>
    </div>`;
  document.body.appendChild(box);
  box.querySelector('#vclose').onclick = () => box.remove();
  box.onclick = e => { if (e.target === box) box.remove(); };
  for (const b of box.querySelectorAll('[data-v]')) b.onclick = () => {
    S.ver[gkey] = b.dataset.v;
    LS.set('ver', S.ver);
    box.remove();
    play(b.dataset.v);
  };
}

/* ============ 目録（コレクションの HTML）を読む ============ */
/* 倉庫に置いてある目録は、**本人が作った一番確かな出どころ**。
   ファイル名から題名を当てるより、これを読むほうがずっと正しい。

   形は決め打ちにしない（どう作られているか分からないので）。
   **ROM のファイル名が出てくる所を探し、その周りの字を題名として拾う。**
   `<a href="…fdi">題名</a>` でも `<td>ファイル名</td><td>題名</td>` でも拾える。 */
async function readIndexHtml(say = () => {}) {
  const g = LS.get('gather', {});
  const files = (g.files || []);
  /* 走査の一覧は ROM だけに絞ってあるので、目録は別に探す。 */
  say('目録を探しています…');
  const places = [...S.roots, ...(S.rootId ? [{ id: S.rootId, name: S.rootName }] : [])];
  const docs = [];
  for (const pl of places) {
    try {
      const r = await P.scanFolder(pl.id, { host: S.host, auth: S.auth });
      for (const f of r.files) if (/\.(html?|csv|txt)$/i.test(f.name)) docs.push(f);
    } catch (e) { log.note('目録を探せない: ' + pl.name + ' — ' + e.message); }
  }
  if (!docs.length) return { docs: 0, hit: 0 };

  /* 大きい順に見る（目録は普通いちばん大きい）。多くても3つまで。 */
  docs.sort((a, b) => (b.size || 0) - (a.size || 0));
  const known = new Map();
  for (const it of S.items) for (const f of it.files) known.set(P.nfc(f).toLowerCase(), it);

  let hit = 0, used = 0;
  const rename = {};
  for (const d of docs.slice(0, 3)) {
    say(`${d.name} を読んでいます…`);
    let text = '';
    try {
      const blob = await P.fetchFile(S.relay, { fileid: d.fileid, name: d.name },
                                     null, d.size);
      text = await blob.text();
    } catch (e) { log.note('目録を読めない: ' + d.name + ' — ' + e.message); continue; }
    used++;
    /* 行ごとに見て、ROM のファイル名が入っていれば、その行の他の字を題名にする。 */
    /* **タグの中の名前も拾う。** `<a href="AOKI.fdi">蒼き狼…</a>` は、
       タグごと消すとファイル名まで消えて当たらなくなる（実際に外した）。
       先に href/src を字に出しておく。 */
    const lines = text
      /* **タグの中で置き換えても駄目。** そのあとタグごと消すので、
         せっかく出した名前まで一緒に消える（実際に消えた）。
         タグを**丸ごと**名前に置き換える。 */
      .replace(/<[^>]*?(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi, '\t$1\t')
      .replace(/<\/(tr|li|p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '\t')
      .split('\n');
    for (const line of lines) {
      const low = line.toLowerCase();
      for (const [fn, it] of known) {
        if (!low.includes(fn)) continue;
        const cells = line.split('\t').map(x => x.replace(/&[a-z]+;/gi, ' ').trim())
                          .filter(x => x && x.toLowerCase() !== fn);
        const title = cells.sort((a, b) => b.length - a.length)[0];
        if (title && title.length >= 2 && title.length < 80) { rename[it.id] = title; hit++; }
        break;
      }
    }
  }
  /* 拾った題名で、端末側の本を書き換える。**倉庫には触らない。** */
  if (hit) {
    const extra = LS.get('extra', []);
    for (const e of extra) if (rename[e.id]) { e.title = e.name; e.name = rename[e.id]; }
    LS.set('extra', extra);
    LS.set('renamed', { ...LS.get('renamed', {}), ...rename });
    S.items = mergeCatalogs();
  }
  log.note(`目録を読んだ: ${used} 件・題名 ${hit} 本`);
  return { docs: docs.length, used, hit };
}
