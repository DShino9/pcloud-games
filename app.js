'use strict';
/* ゲーム棚 — pCloud に預けた ROM を、ブラウザだけで遊ぶ。
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
  relay:    UNDER_GATE ? RELAY_HERE : LS.get('relay', ''),   // 入口の下なら同居しているものを使う
  pub:      LS.get('pub', false),
  files:    LS.get('files', {}),      // NFCにした名前 → fileid
  plays:    LS.get('plays', {}),      // id → {n, last}
  sys:      LS.get('sys', ''),
  sort:     LS.get('sort', 'name'),
  fold:     LS.get('fold', 'sys'),   // 機種で畳む（既定）
  cell:     LS.get('cell', 'm'),
  onlyHere: LS.get('onlyHere', false),
  onlyHave: LS.get('onlyHave', true),   // 上げていないものを隠す。既定は隠す
  q:        '',
  tools:    LS.get('tools', false),   // PC-98 の道具ディスクも並べるか
  cat:      null,                     // games.json
  cat98:    null,                     // pc98.json
  items:    [],                       // 2つの台帳を1つにまとめたもの
  here:     {},
  covurl:   {},                      // 手で入れた箱絵（id → 見かけの住所）                       // id → 1（手元に置いた分）
};

/* 台帳が2つあるのは、中身の作りが違うから。
   ファミコン・スーファミは 1本＝1ファイル、PC-98 は 1本＝複数枚。
   棚に並べるところだけ、同じ形に揃える。 */
function mergeCatalogs() {
  const out = [];
  for (const g of ((S.cat && S.cat.games) || [])) {
    if (!g.core) continue;                       // ブラウザで動かない機種は出さない
    out.push({
      id: g.id, name: g.name, sub: g.title || '', system: g.system, short: g.short,
      cover: g.cover, bytes: g.bytes, kind: 'game', pc98: false, genre: g.genre || '',
      files: [g.file],
    });
  }
  /* 台帳に無い本。**pCloud には台帳より多く入っている。**
     台帳は Mac の中身から起こしたものなので、それ以外の道で pCloud に
     入れた分は載っていない。棚に出せないと「無いもの」になってしまうので、
     見つけた分を端末側で足す（置き場には触らない）。 */
  for (const e of LS.get('extra', [])) {
    out.push({ id: e.id, name: e.name, sub: e.sub || '', system: e.system, short: e.short, core: e.core,
               cover: e.cover || null, bytes: e.bytes || 0, kind: 'game',
               pc98: e.system === 'PC-98', genre: e.genre || '', files: e.files, extra: true });
  }
  for (const t of ((S.cat98 && S.cat98.titles) || [])) {
    out.push({
      id: t.id, name: t.name,
      sub: t.count > 1 ? t.count + '枚' : (t.hdd ? 'HDD' : ''),
      system: 'PC-98', short: '98',
      cover: t.cover || null, bytes: t.bytes, kind: t.kind, pc98: true, genre: '',
      files: t.disks.map(d => d.file),
      garbled: !!t.garbled,
    });
  }
  return out;
}

/* PC-98 は全部の枚が揃っていないと遊べない。1枚でも欠けていれば「棚にない」。 */
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
  let count = 0;
  const places = [...S.roots, ...(S.rootId ? [{ id: S.rootId, name: S.rootName }] : [])];
  for (const pl of places) {
    say(`${pl.name} を見ています…`);
    try {
      const r = await P.indexFolder(pl.id, { host: S.host, auth: S.auth });
      Object.assign(map, r.map);            // 後に来る棚のフォルダが勝つ
      count += r.count;
      log.note(`走査: ${pl.name} ${r.count} ファイル`);
    } catch (e) {
      log.note(`走査できない: ${pl.name} — ${e.message}`);
      say(`${pl.name} は見られません（${e.message}）`);
    }
  }
  S.files = map; LS.set('files', map);
  const added = learnFrom(map);
  return { count, kinds: Object.keys(map).length, places: places.length, added };
}

/* 見に行った場所で見つけた ROM のうち、**台帳に無いものを棚に起こす。**
   台帳は Mac の中身から作ったものなので、pCloud にしか無い分は載っていない。
   移させるのではなく、見つけた時点で棚に出す。置き場（GitHub）には触らない。 */
function learnFrom(map) {
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

/* ============ 画面の振り分け ============ */
/* ハッシュが同じだと hashchange が飛ばない。同じときは自分で描き直す。 */
function go(h) { if (location.hash === h) render(); else location.hash = h; }
addEventListener('hashchange', render);

function render() {
  const h = location.hash || '#/lib';
  document.body.dataset.cell = S.cell;
  $('#hcell').classList.toggle('hide', !S.auth || !S.rootId);
  if (h === '#/log')   return screenLog();
  if (h === '#/set')   return screenSet();
  if (h === '#/relay') return screenRelay();
  if (h === '#/edit')  return screenEdit();
  if (h === '#/runs')  return screenRuns();
  if (h === '#/disks') return screenDisks();
  if (h === '#/covers') return screenCovers();
  if (h === '#/gather') return screenGather();
  if (h.startsWith('#/places/')) return screenPlaces(h.slice(9));
  if (h === '#/places') return screenPlaces();
  if (!S.auth)         return screenLogin();
  if (h.startsWith('#/pick')) return screenPick(h.slice(7) || '0');
  if (!S.rootId)       return go('#/pick/0');
  return screenLib();
}

/* ============ ログイン ============ */
function screenLogin(keep) {
  $('#title').textContent = 'ゲーム棚';
  main().innerHTML = `
  <div class="card">
    <h2>ゲーム棚</h2>
    <p>pCloud に預けた ROM を、ブラウザだけで遊ぶ。<br>棚の中身は端末に入っているので、まず pCloud につなぐ。</p>
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
  $('#title').textContent = '棚のフォルダを選ぶ';
  main().innerHTML = '<div class="card"><p>見ています…</p></div>';
  let r;
  try { r = await call('listfolder', { folderid }); }
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
    <h2>ROM を置いたフォルダ</h2>
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
    <button class="primary" id="use">ここを棚にする</button>
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

/* ============ 棚 ============ */
function shelfList() {
  let list = S.items.slice();
  if (!S.tools) list = list.filter(g => g.kind === 'game');   // 道具ディスクは既定で伏せる
  if (S.onlyHave) list = list.filter(hasAll);                 // 上げていないものは伏せる
  if (S.sys) list = list.filter(g => g.system === S.sys);
  if (S.genre) list = list.filter(g => g.genre === S.genre);
  if (S.onlyHere) list = list.filter(g => S.here[g.id]);
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

function screenLib() {
  const list = shelfList();
  const systems = [...new Set(S.items.map(i => i.system))].sort();
  /* ジャンルは多い順に。数が少ないものは末尾に沈むので探しやすい。 */
  const gcount = {};
  for (const i of S.items) if (i.genre) gcount[i.genre] = (gcount[i.genre] || 0) + 1;
  const genres = Object.entries(gcount).sort((a, b) => b[1] - a[1]);
  $('#title').textContent = 'ゲーム棚';
  /* 「棚にない」は絞り込みに関係なく棚全体の話。並べ直しでは書き換わらないので、
     いま出ている一覧の数ではなく、遊べるもの全体から数える。 */
  const missing = S.items.filter(i => i.kind === 'game' && !hasAll(i)).length;
  main().innerHTML = `
  <div class="bar"><div class="row1">
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
    <button class="hbtn${S.onlyHave ? ' on' : ''}" id="have">棚にある分だけ</button>
    <button class="hbtn${S.onlyHere ? ' on' : ''}" id="here">手元にある分</button>
    <select id="fold">
      <option value="sys"${S.fold === 'sys' ? ' selected' : ''}>機種で畳む</option>
      <option value="genre"${S.fold === 'genre' ? ' selected' : ''}>ジャンルで畳む</option>
      <option value=""${S.fold ? '' : ' selected'}>畳まない</option>
    </select>
    <button class="hbtn${S.tools ? ' on' : ''}" id="tools">道具ディスク</button>
    <button class="hbtn" id="addto" style="margin-left:auto">＋ 棚に上げる</button>
  </div></div>
  ${missing ? `<div class="msg warn" style="margin:0 0 10px">
    まだ pCloud に上げていない本が ${missing} 本${S.onlyHave ? '（隠しています）' : '（押すと上げに行けます）'}。</div>` : ''}
  <div id="g">${gridHtml(list)}</div>`;

  $('#q').oninput    = e => { S.q = e.target.value; redrawGrid(); };
  $('#sys').onchange  = e => { S.sys = e.target.value; LS.set('sys', S.sys); screenLib(); };
  $('#gen').onchange  = e => { S.genre = e.target.value; LS.set('genre', S.genre); screenLib(); };
  $('#sort').onchange = e => { S.sort = e.target.value; LS.set('sort', S.sort); screenLib(); };
  $('#fold').onchange = e => { S.fold = e.target.value; LS.set('fold', S.fold); screenLib(); };
  $('#here').onclick  = () => { S.onlyHere = !S.onlyHere; LS.set('onlyHere', S.onlyHere); screenLib(); };
  $('#tools').onclick = () => { S.tools = !S.tools; LS.set('tools', S.tools); screenLib(); };
  $('#addto').onclick = () => go('#/gather');
  $('#have').onclick  = () => { S.onlyHave = !S.onlyHave; LS.set('onlyHave', S.onlyHave); screenLib(); };
  bindCells();
  bindFold();
}

function redrawGrid() {
  const g = $('#g');
  if (!g) return screenLib();
  g.innerHTML = gridHtml(shelfList());
  bindCells();
  bindFold();
}

/* 畳んだ束は端末ごとに覚える。数が増えると一覧が長くなるので、
   ふだん見ない機種は畳んだままにしておける。 */
const shut = () => new Set(LS.get('shut', []));

/* 一覧を組む。**探している最中は畳まない**（探した意味がなくなる）。 */
function gridHtml(list) {
  if (!list.length) {
    return `<div class="empty">${S.q || S.sys || S.genre || S.onlyHere ? '見つかりません' : '棚が空です'}</div>`;
  }
  if (!S.fold || S.q.trim()) return `<div class="grid">${list.map(cellHtml).join('')}</div>`;

  const key = i => S.fold === 'genre' ? (i.genre || 'ジャンル未設定') : i.system;
  const box = new Map();
  for (const i of list) {
    if (!box.has(key(i))) box.set(key(i), []);
    box.get(key(i)).push(i);
  }
  /* 機種は台帳の並び、ジャンルは多い順。どちらも「よく使う束が上」になる。 */
  const names = [...box.keys()].sort((a, b) => S.fold === 'genre'
    ? box.get(b).length - box.get(a).length || a.localeCompare(b, 'ja')
    : a.localeCompare(b, 'ja'));
  const cl = shut();
  return names.map(nm => {
    const open = !cl.has(nm);
    return `<h2 class="fold" data-fold="${esc(nm)}">
        <span class="tri">${open ? '▾' : '▸'}</span>${esc(nm)}
        <span class="cnt">${box.get(nm).length}</span></h2>
      <div class="grid" data-body="${esc(nm)}"${open ? '' : ' hidden'}>${
        box.get(nm).map(cellHtml).join('')}</div>`;
  }).join('');
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
  return `<button class="item" data-id="${esc(g.id)}" data-s="${esc(g.short)}"${has ? '' : ' data-no="1"'}>
    <div class="cov">${cov}
      <span class="tag${LOGOS[g.short] ? ' logo' : ''}" data-s="${esc(g.short)}">${
        LOGOS[g.short] ? `<img src="logos/${esc(g.short)}.png" alt="${esc(g.short)}"
          onerror="this.remove();this.parentNode.classList.remove('logo')">` : ''
      }<span>${esc(g.short)}</span>${g.kind === 'tool' ? '<span style="display:inline">道具</span>'
        : g.kind === 'save' ? '<span style="display:inline">セーブ</span>' : ''}</span>
      ${S.here[g.id] ? '<span class="off">●</span>' : ''}
      ${has ? '' : '<span class="no">未アップ</span>'}
    </div>
    <div class="t">${esc(nm)}</div>
    <div class="s">${esc(sub || g.genre || '')}</div>
  </button>`;
}

function bindCells() {
  main().querySelectorAll('.item').forEach(b => b.onclick = () => {
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

/* ============ 遊ぶ ============ */
function play(id) {
  const g = S.items.find(x => x.id === id);
  if (!g) return;
  if (!hasAll(g)) return toast('この本は pCloud の棚にありません');
  const p = S.plays[id] || { n: 0, last: 0 };
  p.n++; p.last = Date.now(); S.plays[id] = p; LS.set('plays', S.plays);
  log.note('遊ぶ: ' + g.short + ' ' + g.name);
  $('#pname').textContent = g.name;
  /* PC-98 はコアが別（自分で組んだ NP2kai）。画面も別立てにしてある。 */
  $('#pframe').src = g.pc98
    ? './play98.html?id=' + encodeURIComponent(id) + '&v=26'
    : './play.html?id=' + encodeURIComponent(id) +
      '&fid=' + S.files[P.nfc(g.files[0])] + '&v=10';
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
      <div class="row"><span class="nm">pCloud</span><span class="sub">${S.auth ? esc(S.email) : '未接続'}</span></div>
      <div class="row"><span class="nm">棚のフォルダ</span><span class="sub">${esc(S.rootName || '未選択')}</span></div>
      <div class="row"><span class="nm">台帳</span><span class="sub">${playable.length} 本中 ${found} 本が棚にある</span></div>
      <div class="row"><span class="nm">手元に置いた分</span><span class="sub">${Object.keys(S.here).length} 本</span></div>
      <button class="row" id="relay"><span class="nm">中継所</span><span class="sub">${S.relay ? '設定済み' : '未設定（無くても遊べます・あると速い）'}</span></button>
      <button class="row" id="gather"><span class="nm">棚に上げる</span><span class="sub">pCloud の中から移す・上げ直さない</span></button>
      <button class="row" id="edit"><span class="nm">Mac から上げる</span><span class="sub">手元のファイルを上げる・棚から下げる</span></button>
      <button class="row" id="places"><span class="nm">見に行く場所</span><span class="sub">${
        1 + S.roots.length} か所（棚のフォルダ＋足した分）</span></button>
      <button class="row" id="rescan"><span class="nm">棚を見直す</span><span class="sub">pCloud を走査し直す</span></button>
      <button class="row" id="repick"><span class="nm">フォルダを選び直す</span><span class="sub">→</span></button>
      <button class="row" id="fixcov"><span class="nm">箱絵を直す</span><span class="sub">自分の絵を入れる</span></button>
      <button class="row" id="disks"><span class="nm">ディスクの道具箱</span><span class="sub">中を見る・作る・複製する</span></button>
      <button class="row" id="runs"><span class="nm">動きの記録</span><span class="sub">端末ごとの速さ</span></button>
      <button class="row" id="log"><span class="nm">押した記録</span><span class="sub">→</span></button>
    </div>
    <button class="hbtn" id="fdclr">ディスクの組み合わせを忘れる</button>
    <button class="hbtn" id="clr" style="margin-left:6px">手元に置いた分を消す</button>
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
  $('#edit').onclick   = () => go('#/edit');
  $('#repick').onclick = () => go('#/pick/0');
  $('#rescan').onclick = async () => {
    const m = $('#m');
    if (!S.rootId) { m.textContent = '先にフォルダを選んでください'; return; }
    m.textContent = '見ています…';
    try {
      const r = await scanAll(t => { m.textContent = t; });
      toast(`${r.places} か所・${r.count} ファイル`
        + (r.added ? `／${r.added} 本を新たに棚へ` : ''));
      S.items = mergeCatalogs();
      screenSet();
    }
    catch (e) { m.textContent = e.message; m.className = 'msg err'; }
  };
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
    ${esc(S.rootName || '棚のフォルダが未選択')} に ${have} / ${list.length} 本。
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
          ・${here ? '<span style="color:var(--ok)">棚にある</span>' : '<span style="color:var(--warn)">無い</span>'}</span>
      </button>`;
    }).join('')}
  </div>

  <div style="position:fixed;left:0;right:0;bottom:0;z-index:20;padding:10px 14px calc(var(--safe-b) + 10px);
              background:rgba(16,16,20,.96);backdrop-filter:blur(10px);border-top:1px solid var(--line)">
    <div style="display:flex;gap:6px;align-items:center;overflow-x:auto;scrollbar-width:none">
      <span class="sub" style="flex:0 0 auto">${n} 本えらんだ</span>
      <button class="hbtn" id="esrc" style="flex:0 0 auto">元のフォルダを選ぶ</button>
      <button class="hbtn" id="esrcf" style="flex:0 0 auto">ファイルを選ぶ</button>
      <button class="hbtn" id="eup" style="flex:0 0 auto"${n && E.src ? '' : ' disabled'}>pCloud へ上げる</button>
      <button class="hbtn" id="edown" style="flex:0 0 auto"${n ? '' : ' disabled'}>pCloud から下げる</button>
      <button class="hbtn" id="ecache" style="flex:0 0 auto"${n ? '' : ' disabled'}>手元から消す</button>
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
  if (!need.length) return toast('選んだ本はすべて棚にあります');
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
  if (!ids.length) return toast('選んだ本は棚にありません');
  const names = items.slice(0, 5).map(i => i.name).join('、') + (items.length > 5 ? ' ほか' : '');
  if (!confirm(`pCloud から ${ids.length} ファイルを消します。\n\n${names}\n\n戻せません。よろしいですか。`)) return;
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

/* 手元の控えだけ消す。pCloud には触らない。 */
async function doUncache() {
  const items = picked();
  let n = 0;
  for (const i of items) {
    if (!i.pc98) { if (await removeCached(i.id)) n++; continue; }
    for (const f of i.files) {
      const fid = S.files[P.nfc(f)];
      if (fid && await removeCached(String(fid))) n++;
    }
  }
  await refreshHere();
  prog(`手元から ${n} 件消しました（pCloud はそのまま）`);
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
    ${runs.length ? '<button class="hbtn" id="push" style="margin-top:12px;margin-left:6px">棚へ上げる</button>' : ''}
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
  await loadMyCovers();
  await refreshHere();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
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
  [/\.(fdi|hdi|d88|hdm|xdf|nfd)$/i, 'PC-98',         '98',   null],
  /* PSP と PS1 は像の形が同じ（.iso）で見分けられない。棚には出さない。 */
];
const sysOf = name => (EXT_SYS.find(([re]) => re.test(name)) || []).slice(1);

/* ============ pCloud から棚へ ============ */
/* 耳読の書棚に倣った口。あちらは「pCloud にある本を並べて、その場でボタンを押す」だけで、
   **元のフォルダを選ばせない。** こちらの「棚を編む」は Mac の中から選ばせていたので、
   iPhone からは何もできなかった（Safari はフォルダを選べない）。

   すでに pCloud にあるものは、**上げ直す必要がない。**
   向こう側で動かせば一瞬で終わる（`renamefile` に行き先を渡す）。 */
async function screenGather() {
  $('#title').textContent = '棚に上げる';
  const G = S.gather || (S.gather = { files: null, pick: {}, busy: false });

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
  const line = r => `
    <button class="row" data-fid="${r.fileid}">
      <span style="width:18px;flex:0 0 18px;color:${G.pick[r.fileid] ? 'var(--accent)' : 'var(--dim2)'}">${
        G.pick[r.fileid] ? '☑' : '☐'}</span>
      <span class="nm" style="text-align:left">${esc(r.name)}
        <span class="sub">${r.item ? esc(r.item.name) + '・' + esc(r.item.short)
                                   : '台帳に無い・' + esc((sysOf(r.name)[1]) || '機種不明')}</span></span>
      <span class="sub" style="text-align:right">${size(r.size)}<br>${esc(r.path || '/')}</span>
    </button>`;

  main().innerHTML = `
  <div class="card" style="max-width:720px">
    <h2>棚に上げる</h2>
    <p><b>ふつうは移す必要がありません。</b>「見に行く場所」に ROM のフォルダを足せば、
       置いたまま棚に出ます（整理を崩さずに済みます）。<br>
       ここは<b>棚のフォルダへ寄せたいとき</b>だけ使ってください。すでに pCloud にあるので
       <b>上げ直しません</b>（向こう側で動かすだけ。一瞬で終わります）。</p>
    <button class="hbtn" id="scan"${G.busy ? ' disabled' : ''}>見に行く場所を探す</button>
    <button class="hbtn" id="toPlaces">場所を決める</button>
    ${G.files ? `<span class="sub" style="margin-left:8px">${G.files.length} ファイル見た</span>` : ''}
    <div class="msg" id="gm"></div>

    ${G.files ? ((rows.length + news.length) ? `
      <div style="display:flex;gap:6px;margin:10px 0">
        <button class="hbtn sm" id="gall">全部選ぶ</button>
        <button class="hbtn sm" id="gnone">選び直す</button>
      </div>
      ${rows.length ? `<h3>台帳にある（${rows.length}）</h3>
        <div class="rowlist">${rows.map(line).join('')}</div>` : ''}
      ${news.length ? `<h3 style="margin-top:16px">台帳に無い（${news.length}）</h3>
        <p class="sub">台帳は Mac の中身から起こしたものなので、それ以外の道で
          pCloud に入れた分は載っていません。移すと<b>この端末の棚に足します</b>
          （題名はファイル名から。あとで直せます）。</p>
        <div class="rowlist">${news.map(line).join('')}</div>` : ''}
      <div style="display:flex;gap:6px;align-items:center;margin-top:12px">
        <span class="sub">${n} 件えらんだ</span>
        <button class="hbtn" id="gmove"${n && !G.busy ? '' : ' disabled'}>棚へ移す</button>
        <button class="hbtn" id="gcopy"${n && !G.busy ? '' : ' disabled'}>写す（元を残す）</button>
      </div>`
      : '<div class="empty">棚の外に、台帳に載っているファイルは見つかりませんでした。</div>')
    : '<div class="empty">まだ探していません。</div>'}

    <div style="margin-top:16px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="hbtn" id="back">← 棚へ</button>
      <button class="hbtn" id="fromMac">Mac から上げる・棚から下げる</button>
    </div>
  </div>`;

  $('#back').onclick = () => go('#/lib');
  $('#fromMac').onclick = () => go('#/edit');
  $('#toPlaces').onclick = () => go('#/places');
  $('#scan').onclick = async () => {
    G.busy = true; $('#gm').textContent = 'pCloud の中を探しています…（本数が多いと少しかかります）';
    try {
      /* **根っこから歩かせない。** 全部を見に行くと、書類も控えも巻き込んで
         5万ファイルを数える羽目になる（実際にそうなった）。
         「見に行く場所」に挙げた所だけを見る。 */
      const places = [...S.roots, ...(S.rootId ? [{ id: S.rootId, name: S.rootName }] : [])];
      if (!places.length) {
        G.busy = false;
        $('#gm').textContent = '先に「見に行く場所」で ROM のあるフォルダを足してください。';
        return;
      }
      const all = [];
      for (const pl of places) {
        const r = await P.scanFolder(pl.id, { host: S.host, auth: S.auth,
          onStep: (n, left) => { $('#gm').textContent = `${pl.name} を見ています… ${n} ファイル・残り ${left} 部屋`; } });
        all.push(...r.files);
      }
      G.files = all.filter(f => /\.(nes|fds|smc|sfc|fig|swc|n64|v64|z64|nds|iso|cso|fdi|hdi|d88|hdm|xdf|nfd)$/i.test(f.name));
      G.busy = false; screenGather();
    } catch (e) {
      G.busy = false; $('#gm').textContent = '探せません: ' + e.message;
    }
  };
  const gall = $('#gall'), gnone = $('#gnone');
  if (gall)  gall.onclick  = () => { [...rows, ...news].forEach(r => G.pick[r.fileid] = 1); screenGather(); };
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
    screenGather();
    $('#gm').textContent = `${copy ? '写した' : '移した'} ${ok} / 駄目 ${ng}`;
    log.note(`pCloud の中で ${copy ? '写した' : '移した'} ${ok} / 駄目 ${ng}`);
  };
  const gm = $('#gmove'), gc = $('#gcopy');
  if (gm) gm.onclick = () => run(false);
  if (gc) gc.onclick = () => run(true);
}

/* ============ 見に行く場所 ============ */
/* **ROM を棚のフォルダへ移させない。** `/EMU/ROM/…` のようにメーカー別で
   整理してある置き場を崩すのは筋が悪い。**その場所も見に行けば済む。**
   遊ぶときに使うのは fileid なので、どこに置いてあっても関係ない。 */
async function screenPlaces(folderid) {
  $('#title').textContent = '見に行く場所';
  const browsing = folderid != null;

  if (!browsing) {
    const places = [{ id: S.rootId, name: S.rootName || '（未選択）', main: true }, ...S.roots];
    main().innerHTML = `
    <div class="card" style="max-width:640px">
      <h2>見に行く場所</h2>
      <p>棚は<b>ここに挙げた場所ぜんぶ</b>を見て、台帳の名前と突き合わせます。<br>
         ROM を1か所に集める必要はありません。<b>整理したまま置いておけます。</b><br>
         <span class="sub">上げ先と記録の置き先は、いちばん上の「棚のフォルダ」です。</span></p>
      <div class="rowlist">
        ${places.map((pl, i) => `<div class="row">
          <span class="nm" style="text-align:left">${esc(pl.name)}
            <span class="sub">${pl.main ? '棚のフォルダ（上げ先）' : '足した場所'}</span></span>
          ${pl.main ? '<button class="hbtn sm" id="repick2">選び直す</button>'
                    : `<button class="hbtn sm" data-off="${i - 1}">外す</button>`}
        </div>`).join('')}
      </div>
      <button class="hbtn" id="add" style="margin-top:12px">場所を足す</button>
      <button class="hbtn" id="scan2" style="margin-left:6px">いま見直す</button>
      <button class="hbtn" id="back" style="margin-left:6px">← 設定へ</button>
      <div class="msg" id="pm"></div>
    </div>`;
    $('#back').onclick = () => go('#/set');
    $('#add').onclick = () => go('#/places/0');
    $('#repick2').onclick = () => go('#/pick/0');
    $('#scan2').onclick = async () => {
      const m = $('#pm');
      try {
        const r = await scanAll(t => { m.textContent = t; });
        S.items = mergeCatalogs();
        m.textContent = `${r.places} か所・${r.count} ファイル。`
          + (r.added ? `台帳に無い本を ${r.added} 本、棚に起こしました。` : '台帳に無い本はありませんでした。');
      } catch (e) { m.textContent = '見られません: ' + e.message; }
    };
    for (const b of main().querySelectorAll('[data-off]')) b.onclick = () => {
      S.roots.splice(+b.dataset.off, 1);
      LS.set('roots', S.roots);
      screenPlaces();
    };
    return;
  }

  /* 足す場所を選ぶ。1階ずつ降りる（棚のフォルダ選びと同じ呼び方）。 */
  main().innerHTML = '<div class="card"><p>見ています…</p></div>';
  let r;
  try { r = await call('listfolder', { folderid }); }
  catch (e) {
    main().innerHTML = `<div class="card"><div class="msg err">${esc(e.message)}</div>
      <button class="hbtn" id="back">← 戻る</button></div>`;
    $('#back').onclick = () => go('#/places');
    return;
  }
  const md = r.metadata;
  const dirs = (md.contents || []).filter(c => c.isfolder)
    .sort((a, b) => collator.compare(a.name, b.name));
  const up = md.parentfolderid != null && String(folderid) !== '0';
  main().innerHTML = `
  <div class="card" style="max-width:560px">
    <h2>場所を足す</h2>
    <p>ROM の入っているフォルダを選んでください。<b>中の入れ子は問いません</b>
       （`/EMU/ROM` を選べば、その下のメーカー別のフォルダも全部見ます）。</p>
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
  $('#use2').onclick = async () => {
    if (S.roots.some(x => String(x.id) === String(folderid)) || String(S.rootId) === String(folderid)) {
      $('#pm').textContent = 'その場所はもう入っています';
      return;
    }
    S.roots.push({ id: folderid, name: md.name || '/' });
    LS.set('roots', S.roots);
    $('#pm').textContent = '足しました。見に行きます…';
    try {
      const r2 = await scanAll(t => { $('#pm').textContent = t; });
      toast(`${r2.places} か所・${r2.count} ファイルを見ました`);
    } catch (e) {}
    S.items = mergeCatalogs();
    go('#/places');
  };
}
