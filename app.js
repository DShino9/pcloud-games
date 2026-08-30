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
  rootName: LS.get('rootName', ''),
  relay:    UNDER_GATE ? RELAY_HERE : LS.get('relay', ''),   // 入口の下なら同居しているものを使う
  pub:      LS.get('pub', false),
  files:    LS.get('files', {}),      // NFCにした名前 → fileid
  plays:    LS.get('plays', {}),      // id → {n, last}
  sys:      LS.get('sys', ''),
  sort:     LS.get('sort', 'name'),
  cell:     LS.get('cell', 'm'),
  onlyHere: LS.get('onlyHere', false),
  onlyHave: LS.get('onlyHave', true),   // 上げていないものを隠す。既定は隠す
  q:        '',
  tools:    LS.get('tools', false),   // PC-98 の道具ディスクも並べるか
  cat:      null,                     // games.json
  cat98:    null,                     // pc98.json
  items:    [],                       // 2つの台帳を1つにまとめたもの
  here:     {},                       // id → 1（手元に置いた分）
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

async function refreshHere() { S.here = await ROMS.list(); }

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
    <button class="hbtn${S.tools ? ' on' : ''}" id="tools">道具ディスク</button>
  </div></div>
  ${missing ? `<div class="msg warn" style="margin:0 0 10px">
    まだ pCloud に上げていない本が ${missing} 本${S.onlyHave ? '（隠しています）' : '（押すと上げに行けます）'}。</div>` : ''}
  ${list.length ? `<div class="grid" id="g">${list.map(cellHtml).join('')}</div>`
    : `<div class="empty">${S.q || S.sys || S.genre || S.onlyHere ? '見つかりません' : '棚が空です'}</div>`}`;

  $('#q').oninput    = e => { S.q = e.target.value; redrawGrid(); };
  $('#sys').onchange  = e => { S.sys = e.target.value; LS.set('sys', S.sys); screenLib(); };
  $('#gen').onchange  = e => { S.genre = e.target.value; LS.set('genre', S.genre); screenLib(); };
  $('#sort').onchange = e => { S.sort = e.target.value; LS.set('sort', S.sort); screenLib(); };
  $('#here').onclick  = () => { S.onlyHere = !S.onlyHere; LS.set('onlyHere', S.onlyHere); screenLib(); };
  $('#tools').onclick = () => { S.tools = !S.tools; LS.set('tools', S.tools); screenLib(); };
  $('#have').onclick  = () => { S.onlyHave = !S.onlyHave; LS.set('onlyHave', S.onlyHave); screenLib(); };
  bindCells();
}

function redrawGrid() {
  const g = $('#g');
  if (!g) return screenLib();
  g.innerHTML = shelfList().map(cellHtml).join('');
  bindCells();
}

function cellHtml(g) {
  const has = hasAll(g);
  /* 元の名前が失われて読めないものは、化けた字をそのまま出さない。
     どのファイルかは分かるようにしておく（手で名前を直せるように）。 */
  const nm = g.garbled ? '名前が読めないディスク' : g.name;
  const sub = g.garbled ? g.files[0] : (g.sub || '');
  const cov = g.cover ? `<img loading="lazy" src="${esc(g.cover)}" alt="">`
                      : `<div class="ph">${esc(nm)}</div>`;
  return `<button class="item" data-id="${esc(g.id)}"${has ? '' : ' data-no="1"'}>
    <div class="cov">${cov}
      <span class="tag">${esc(g.short)}${g.kind === 'tool' ? ' 道具' : g.kind === 'save' ? ' セーブ' : ''}</span>
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
      '&fid=' + S.files[P.nfc(g.files[0])] + '&v=8';
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
      <button class="row" id="edit"><span class="nm">棚を編む</span><span class="sub">選んで上げる・下げる</span></button>
      <button class="row" id="rescan"><span class="nm">棚を見直す</span><span class="sub">pCloud を走査し直す</span></button>
      <button class="row" id="repick"><span class="nm">フォルダを選び直す</span><span class="sub">→</span></button>
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
  $('#edit').onclick   = () => go('#/edit');
  $('#repick').onclick = () => go('#/pick/0');
  $('#rescan').onclick = async () => {
    const m = $('#m');
    if (!S.rootId) { m.textContent = '先にフォルダを選んでください'; return; }
    m.textContent = '見ています…';
    try { const r = await scanFolder(S.rootId); toast(r.count + ' ファイルを見ました'); screenSet(); }
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
  $('#title').textContent = '棚を編む';
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
    ${E.src ? '元のフォルダ: ' + esc(E.srcName) + '（' + Object.keys(E.src).length + ' ファイル）'
            : '上げるには、先に元のフォルダを選んでください。'}
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
      <button class="hbtn" id="eup" style="flex:0 0 auto"${n && E.src ? '' : ' disabled'}>pCloud へ上げる</button>
      <button class="hbtn" id="edown" style="flex:0 0 auto"${n ? '' : ' disabled'}>pCloud から下げる</button>
      <button class="hbtn" id="ecache" style="flex:0 0 auto"${n ? '' : ' disabled'}>手元から消す</button>
    </div>
    <div class="msg" id="ep" style="min-height:0;margin-top:6px"></div>
  </div>
  <input type="file" id="efile" webkitdirectory directory multiple class="hide">`;

  main().querySelectorAll('.row[data-id]').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    if (E.pick[id]) delete E.pick[id]; else E.pick[id] = 1;
    screenEdit();
  });
  $('#esys').onchange = e => { E.sys = e.target.value; screenEdit(); };
  $('#eall').onclick  = () => { editList().forEach(i => E.pick[i.id] = 1); screenEdit(); };
  $('#enone').onclick = () => { E.pick = {}; screenEdit(); };
  $('#eback').onclick = () => go('#/set');

  /* 元のフォルダ。中身は憶えるが、この画面を離れると消える（ブラウザの決まり）。 */
  $('#esrc').onclick = () => $('#efile').click();
  $('#efile').onchange = ev => {
    const map = {};
    for (const f of ev.target.files) map[P.nfc(f.name)] = f;
    E.src = map;
    E.srcName = (ev.target.files[0] && ev.target.files[0].webkitRelativePath || '').split('/')[0] || 'えらんだフォルダ';
    log.note('元のフォルダを選んだ: ' + Object.keys(map).length + ' ファイル');
    screenEdit();
  };

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
function screenRuns() {
  $('#title').textContent = '動きの記録';
  const runs = LS.get('runs', []);
  main().innerHTML = `
  <div class="card" style="max-width:640px">
    <h2>動きの記録</h2>
    <p>PC-98 を動かすたびに、毎秒何コマ出たかを残しています（最新10回）。
       端末やブラウザを変えて比べると、重さの出どころが分かります。<br>
       <b>PC-98 は毎秒60コマが満点。</b></p>
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
        </div>
        <div class="sub">${esc(r.ua)}・${esc(r.os)}・CPU ${esc(String(r.cpu))}・${esc(String(r.mem))}GB・${esc(r.px)}・音 ${esc(String(r.rate))}Hz</div>
      </div>`).join('')}</div>`
      : '<div class="empty">まだ記録がありません。PC-98 を少し動かすと残ります。</div>'}
    ${runs.length ? '<button class="hbtn" id="cp" style="margin-top:12px">写す</button>' : ''}
    <button class="hbtn" id="clr" style="margin-top:12px${runs.length ? ';margin-left:6px' : ''}">消す</button>
    <button class="hbtn" id="back" style="margin-left:6px">← 設定へ</button>
    <div class="msg" id="m"></div>
  </div>`;
  $('#back').onclick = () => go('#/set');
  $('#clr').onclick  = () => { LS.del('runs'); screenRuns(); };
  const cp = $('#cp');
  if (cp) cp.onclick = async () => {
    const t = runs.map(r => `${r.at} ${r.fps}コマ/秒 輪${r.loop} ${r.name} [${r.core}] ${r.ua} ${r.os} CPU${r.cpu} ${r.mem}GB ${r.rate}Hz`).join('\n');
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
    S.cat = await (await fetch('./games.json?v=1', { cache: 'no-cache' })).json();
  } catch (e) {
    main().innerHTML = '<div class="card"><h2>台帳が読めません</h2>' +
      '<div class="msg err">games.json を取ってこられませんでした</div></div>';
    return;
  }
  /* PC-98 の台帳は無くても棚は開く（コアを組んでいない環境もある）。 */
  try { S.cat98 = await (await fetch('./pc98.json?v=1', { cache: 'no-cache' })).json(); }
  catch (e) { S.cat98 = null; }
  S.items = mergeCatalogs();
  await refreshHere();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
