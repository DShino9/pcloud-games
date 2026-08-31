'use strict';
/* 選ぶ画面（#74）。**画面を移らずに選ぶ** —— Steam・プロジェクトEGG・
   Switch・PlayStation のライブラリに倣った3列:

     左   機種 → メーカー／ジャンル（畳める。掛け合わせられる）
     中央 一覧（札／行・棚/ぜんぶ/倉庫に無い・題名順ほか・120本ずつ）
     右   選んだ本の札（遊ぶ・取り寄せる・下ろす・版・ジャンルを付ける）

   狭い画面ではレールが横のチップ、札が下からのシートになる。
   承認済みのモック（tools/mock-74-library.html）が正。 */

/* 画面の覚え。**キーは新しく切る**（意味を変えたら鍵も変える）。 */
const L = Object.assign({ sys: '', maker: '', genre: '', rows: false, sel: '' },
                        LS.get('l2', {}));
const l2save = () => LS.set('l2', { sys: L.sys, maker: L.maker, genre: L.genre,
                                    rows: L.rows });
/* 開いた束だけ覚える（既定は畳む）。 */
const l2open = () => new Set(LS.get('l2open', []));

/* ---- メーカーは倉庫のフォルダが正。共通の頭を除いた次の一節。 ---- */
function l2head(items) {
  const paths = items.map(i => i.path || '').filter(Boolean);
  if (!paths.length) return '';
  const segs = paths[0].split('/').filter(Boolean);
  const outer = [];
  for (let n = 0; n < segs.length; n++) {
    const cand = '/' + segs.slice(0, n + 1).join('/');
    if (paths.every(pp => pp === cand || pp.startsWith(cand + '/'))) outer.push(segs[n]);
    else break;
  }
  return outer.length ? '/' + outer.join('/') : '';
}
function l2maker(i, head) {
  const pp = i.path || '';
  if (pp && pp.length > head.length) {
    const seg = pp.slice(head.length).replace(/^\//, '').split('/')[0];
    if (seg) return seg;
  }
  return (window.Makers ? Makers.makerOf(i.name, pp) : '') || 'その他';
}

/* いま見ている機種の本（束ねた後）。メーカーも付けて返す。 */
function l2items() {
  let list = grouped(S.items).filter(g => S.tools || g.kind === 'game');
  if (L.sys) list = list.filter(g => g.system === L.sys);
  const head = l2head(list);
  for (const g of list) g._maker = l2maker(g, head);
  return list;
}

function l2list() {
  let list = l2items();
  if (L.maker) list = list.filter(g => g._maker === L.maker);
  if (L.genre) list = list.filter(g => L.genre === 'ジャンル未設定'
    ? !g.genre : g.genre === L.genre);
  if (S.view === 'play') list = list.filter(gotIt);
  else if (S.view === 'all') list = list.filter(hasAll);
  else if (S.view === 'none') list = list.filter(g => !hasAll(g));
  const q = S.q.trim().toLowerCase();
  if (q) list = list.filter(g =>
    (g.name || '').toLowerCase().includes(q) ||
    (g._maker || '').toLowerCase().includes(q) ||
    g.files.some(f => f.toLowerCase().includes(q)));
  const pl = g => (S.plays[g.id] || {});
  const cmp = {
    name:  (a, b) => collator.compare(a.name, b.name),
    plays: (a, b) => (pl(b).n || 0) - (pl(a).n || 0) || collator.compare(a.name, b.name),
    last:  (a, b) => (pl(b).last || 0) - (pl(a).last || 0) || collator.compare(a.name, b.name),
  }[S.sort] || ((a, b) => collator.compare(a.name, b.name));
  return list.sort((a, b) => (hasAll(b) - hasAll(a)) || cmp(a, b));
}

/* ---- 左レール ---- */
function l2rail() {
  const bySys = new Map();
  for (const g of grouped(S.items)) {
    if (g.kind !== 'game') continue;
    bySys.set(g.system, (bySys.get(g.system) || 0) + 1);
  }
  const order = [...bySys.entries()].sort((a, b) => b[1] - a[1]);
  const op = l2open();
  let html = '<h2 class="l2h">機種</h2>';
  html += order.map(([nm, n]) => {
    const openSys = L.sys === nm;
    let sub = '';
    if (openSys) {
      const items = l2items();
      /* メーカー */
      const mk = new Map();
      for (const g of items) mk.set(g._maker, (mk.get(g._maker) || 0) + 1);
      const mrows = [...mk.entries()].sort((a, b) =>
        a[0] === 'その他' ? 1 : b[0] === 'その他' ? -1
        : b[1] - a[1] || collator.compare(a[0], b[0]));
      /* ジャンル（未設定も1つの束） */
      const gn = new Map();
      for (const g of items) {
        const k = g.genre || 'ジャンル未設定';
        gn.set(k, (gn.get(k) || 0) + 1);
      }
      const grows = [...gn.entries()].sort((a, b) =>
        a[0] === 'ジャンル未設定' ? 1 : b[0] === 'ジャンル未設定' ? -1
        : b[1] - a[1] || collator.compare(a[0], b[0]));
      const grp = (kind, label, rows, cur) => {
        const key = nm + '/' + kind;
        const open = op.has(key);
        return `<button class="l2grp" data-grp="${esc(key)}">
            <span class="tri">${open ? '▾' : '▸'}</span>${label}</button>`
          + (open ? rows.map(([m, c]) => `
            <button class="l2mk${cur === m ? ' on' : ''}" data-${kind}="${esc(m)}">
              <span>${esc(m)}</span><span class="c">${c}</span></button>`).join('') : '');
      };
      sub = `<div class="l2sub">${grp('maker', 'メーカー', mrows, L.maker)}${
        grp('genre', 'ジャンル', grows, L.genre)}</div>`;
    }
    return `<button class="l2sys${openSys ? ' on' : ''}" data-sys="${esc(nm)}">
        <span class="tri">${openSys ? '▾' : '▸'}</span>
        <span class="n">${esc(nm)}</span><span class="c">${n}</span></button>${sub}`;
  }).join('');
  html += `<button class="l2sys${L.sys ? '' : ' on'}" data-sys="">
      <span class="tri"></span><span class="n">すべて</span>
      <span class="c">${[...bySys.values()].reduce((a, b) => a + b, 0)}</span></button>`;
  html += '<div class="l2foot">メーカーは倉庫のフォルダが正。<br>メーカーとジャンルは掛け合わせられます。</div>';
  return html;
}

/* ---- 中央 ---- */
function l2card(g) {
  const cov = S.covurl[g.id] || g.cover;
  const nm = g.garbled ? '名前が読めないディスク' : g.name;
  return `<button class="item${L.sel === g.id ? ' sel' : ''}" data-id="${esc(g.id)}">
    <div class="cov">${cov ? `<img loading="lazy" src="${esc(cov)}" alt="">`
                           : `<div class="ph">${esc(nm)}</div>`}
      <span class="tag${LOGOS[g.short] ? ' logo' : ''}" data-s="${esc(g.short)}">${
        LOGOS[g.short] ? `<img src="logos/${esc(g.short)}.png" alt="${esc(g.short)}"
          onerror="this.remove();this.parentNode.classList.remove('logo')">` : ''
      }<span>${esc(g.short)}</span></span>
      ${gotIt(g) ? '<span class="off">●</span>' : ''}
      ${hasAll(g) ? '' : '<span class="no">倉庫に無い</span>'}
    </div>
    <div class="t">${esc(nm)}</div>
    <div class="s">${esc(g.sub || g.genre || '')}${
      g.vers && !g.settled ? `<span class="vers">${g.vers.length}版</span>` : ''}</div>
  </button>`;
}
function l2row(g) {
  const cov = S.covurl[g.id] || g.cover;
  return `<button class="l2r${L.sel === g.id ? ' sel' : ''}" data-id="${esc(g.id)}">
    <span class="rc">${cov ? `<img loading="lazy" src="${esc(cov)}" alt="">` : ''}</span>
    <span class="rn">${esc(g.garbled ? '名前が読めないディスク' : g.name)}</span>
    ${gotIt(g) ? '<span class="off" style="position:static">●</span>' : ''}
    <span class="rs">${esc(g.genre || '')}${g.vers && !g.settled ? ` ${g.vers.length}版` : ''}</span>
  </button>`;
}

function l2grid(list) {
  const n = Math.min(list.length, S.more.l2 || STEP);
  const cells = list.slice(0, n).map(L.rows ? l2row : l2card).join('');
  const more = n < list.length
    ? `<button class="hbtn" data-more="l2" style="margin:10px 0">もっと見る（あと ${list.length - n} 本）</button>` : '';
  if (!list.length) return `<div class="empty">${S.q ? '見つかりません'
    : S.view === 'play' ? 'まだ棚に何も取り寄せていません。<br><span class="sub">「ぜんぶ」から選んで遊ぶと、その本が棚に入ります。</span>'
    : 'ここには何もありません'}</div>`;
  return (L.rows ? `<div class="l2rows">${cells}</div>` : `<div class="grid">${cells}</div>`) + more;
}

/* ---- 右の札 ---- */
function l2detail() {
  const g = l2items().find(x => x.id === L.sel)
        || grouped(S.items).find(x => x.id === L.sel);
  if (!g) return '<div class="l2none">一覧から本を選ぶと<br>ここに札が出ます</div>';
  const cov = S.covurl[g.id] || g.cover;
  const inWare = hasAll(g), onShelf = gotIt(g);
  const maker = g._maker || (window.Makers ? Makers.makerOf(g.name, g.path) : '') || '';
  const vers = g.gkey ? (S.gmap || {})[g.gkey] : null;
  return `<div class="sheetbar"></div>
    <div class="l2cov">${cov ? `<img src="${esc(cov)}" alt="">`
      : `<div class="ph">${esc(g.name)}</div>`}</div>
    <div class="l2t">${esc(g.name)}</div>
    <div class="l2m">${esc(maker)}${maker ? ' ／ ' : ''}${esc(g.system)}</div>
    <div class="l2state">
      ${onShelf ? '<span class="chip shelf">● 棚にある（すぐ遊べる）</span>'
        : g.arc ? '<span class="chip">圧縮のまま（起こすと遊べる・準備中）</span>'
        : inWare ? '<span class="chip">倉庫にある</span>'
        : '<span class="chip away">倉庫に無い</span>'}
      ${g.genre ? `<span class="chip">${esc(g.genre)}</span>`
        : `<button class="chip dashed" id="dgenre">＋ ジャンルを付ける</button>`}
    </div>
    <button class="primary l2play" id="dplay"${inWare && !g.arc ? '' : ' disabled'}>▶ 遊ぶ</button>
    <div class="l2acts">
      ${onShelf ? '<button class="hbtn" id="ddown">書庫へ下ろす</button>'
        : inWare ? '<button class="hbtn" id="dstock">棚に取り寄せる</button>' : ''}
      <button class="hbtn" id="dpage">本の頁</button>
    </div>
    <div class="msg" id="dm"></div>
    ${vers && vers.length > 1 ? `<div class="l2sec"><h3>版（${vers.length}つある）</h3>${
      vers.map(v => `<label class="l2ver"><input type="radio" name="dver"
          value="${esc(v.id)}"${(onShelf ? gotIt(v) : v.id === (S.ver[g.gkey] || vers[0].id))
            ? ' checked' : ''}${onShelf ? ' disabled' : ''}>
        <span>${esc(v.name)}</span></label>`).join('')}${
      onShelf ? '<div class="sub">棚にある版が「正」です（下ろすと選び直せます）</div>' : ''}</div>` : ''}
    ${g.pc98 && g.files.length > 1 ? `<div class="l2sec"><h3>ディスク（起動前に選ぶ）</h3>${
      g.files.slice(0, 8).map((f, i) => `<div class="l2disk">
        <span class="dk">${i === 0 ? 'Aドライブ' : i === 1 ? 'Bドライブ' : '　'}</span>
        <span>${esc(f)}</span></div>`).join('')}${
      g.files.length > 8 ? `<div class="sub">ほか ${g.files.length - 8} 枚</div>` : ''}</div>` : ''}
    <div class="l2sec"><h3>在処</h3>
      ${g.path ? `<div class="l2kv"><span>倉庫</span><code>${esc(g.path)}/</code></div>` : ''}
      ${onShelf ? `<div class="l2kv"><span>棚</span><code>/ゲーム棚/棚/${esc(g.name)}/</code></div>` : ''}
    </div>`;
}

function l2bindDetail() {
  const g = grouped(S.items).find(x => x.id === L.sel);
  if (!g) return;
  const dp = $('#dplay');
  if (dp) dp.onclick = () => play(g.id);
  const pg = $('#dpage');
  if (pg) pg.onclick = () => go('#/t/' + encodeURIComponent(g.id));
  const dg = $('#dgenre');
  if (dg) dg.onclick = () => {
    const v = prompt('この本のジャンル（例: 歴史シミュレーション）', '');
    if (!v || !v.trim()) return;
    const m = LS.get('genre2', {});
    m[g.id] = v.trim(); LS.set('genre2', m);
    S.items = mergeCatalogs();
    screenLibrary();
  };
  for (const r of main().querySelectorAll('[name="dver"]')) r.onchange = () => {
    S.ver[g.gkey] = r.value; LS.set('ver', S.ver);
    screenLibrary();
  };
  const ds = $('#dstock');
  if (ds) ds.onclick = async () => {
    ds.disabled = true;
    try {
      await stock(g, t => { const m = $('#dm'); if (m) m.textContent = t; });
      await refreshHere();
      screenLibrary();
    } catch (e) { $('#dm').textContent = '取り寄せられません: ' + e.message; ds.disabled = false; }
  };
  const dd = $('#ddown');
  if (dd) dd.onclick = async () => {
    if (!confirm(`${g.name} を棚から下ろし、周りのもの（箱絵・メモ・セーブ）ごと書庫へ移します。\n\n倉庫の元の置き場はそのままです。`)) return;
    dd.disabled = true;
    try {
      await archive(g, t => { const m = $('#dm'); if (m) m.textContent = t; });
      if (!g.pc98) await removeCached(g.id);
      else for (const f of g.files) {
        const fid = S.files[P.nfc(f)];
        if (fid) await removeCached(String(fid));
      }
      await refreshHere();
      screenLibrary();
    } catch (e) { $('#dm').textContent = '下ろせません: ' + e.message; dd.disabled = false; }
  };
}

/* ---- 画面 ---- */
function screenLibrary() {
  $('#title').textContent = 'ゲーム棚';
  const list = l2list();
  const scope = l2items().filter(g =>
    (!L.maker || g._maker === L.maker) &&
    (!L.genre || (L.genre === 'ジャンル未設定' ? !g.genre : g.genre === L.genre)));
  const nPlay = scope.filter(gotIt).length;
  const nAll = scope.filter(hasAll).length;
  const nNone = scope.length - nAll;
  const crumbs = ['<b>棚</b>']
    .concat(L.sys ? [esc(L.sys)] : [])
    .concat(L.maker ? [esc(L.maker)] : [])
    .concat(L.genre ? [esc(L.genre)] : [])
    .concat(S.q.trim() ? [`「${esc(S.q.trim())}」で探した分`] : [])
    .join(' <span>›</span> ');

  main().innerHTML = `
  <div class="l2wrap">
    <nav class="l2rail" id="lrail">${l2rail()}</nav>
    <section class="l2main">
      <div class="l2crumbs">${crumbs}</div>
      <div class="bar"><div class="row1">
        <div class="seg">
          <button data-view="play"${S.view === 'play' ? ' class="on"' : ''}>棚 (${nPlay})</button>
          <button data-view="all"${S.view === 'all' ? ' class="on"' : ''}>ぜんぶ (${nAll})</button>
          ${nNone ? `<button data-view="none"${S.view === 'none' ? ' class="on"' : ''}>倉庫に無い (${nNone})</button>` : ''}
        </div>
        <input class="search" id="q" placeholder="題名で探す" value="${esc(S.q)}"
          autocapitalize="off" autocorrect="off" spellcheck="false">
        <select id="sort">
          <option value="name"${S.sort === 'name' ? ' selected' : ''}>題名順</option>
          <option value="plays"${S.sort === 'plays' ? ' selected' : ''}>よく遊んだ順</option>
          <option value="last"${S.sort === 'last' ? ' selected' : ''}>最近遊んだ順</option>
        </select>
        <div class="seg" style="order:0;position:static">
          <button id="vcard"${L.rows ? '' : ' class="on"'}>▦ 札</button>
          <button id="vrow"${L.rows ? ' class="on"' : ''}>☰ 行</button>
        </div>
        <button class="hbtn${S.tools ? ' on' : ''}" id="tools2" title="PC-98 の道具ディスクも並べる">道具</button>
        <button class="hbtn" id="addto" style="margin-left:auto">＋ 棚に上げる</button>
      </div></div>
      <div class="sub" id="huntline" style="margin:0 0 8px;display:none"></div>
      <div id="g">${l2grid(list)}</div>
      <div class="sub" id="scanline" style="margin-top:14px">${(() => {
        const sc = LS.get('scan', null);
        return (sc ? `倉庫を見たのは <b>${esc(sc.at)}</b>（${esc(String(sc.count))} ファイル）`
                   : '<b>まだ倉庫を見ていません。</b>')
          + ' <button class="hbtn sm" id="rescan2">いま見直す</button>';
      })()}</div>
    </section>
    <aside class="l2side" id="lside">${l2detail()}</aside>
  </div>`;

  /* レール */
  for (const b of main().querySelectorAll('[data-sys]')) b.onclick = () => {
    const s = b.dataset.sys;
    if (L.sys === s && s) { L.sys = ''; }        // もう一度押すと枝ごと畳む
    else { L.sys = s; }
    L.maker = ''; L.genre = ''; S.more.l2 = 0; l2save();
    screenLibrary();
  };
  for (const b of main().querySelectorAll('[data-grp]')) b.onclick = () => {
    const op = l2open();
    op.has(b.dataset.grp) ? op.delete(b.dataset.grp) : op.add(b.dataset.grp);
    LS.set('l2open', [...op]);
    screenLibrary();
  };
  for (const b of main().querySelectorAll('[data-maker]')) b.onclick = () => {
    L.maker = (L.maker === b.dataset.maker) ? '' : b.dataset.maker;
    S.more.l2 = 0; l2save(); screenLibrary();
  };
  for (const b of main().querySelectorAll('[data-genre]')) b.onclick = () => {
    L.genre = (L.genre === b.dataset.genre) ? '' : b.dataset.genre;
    S.more.l2 = 0; l2save(); screenLibrary();
  };
  /* 一覧 */
  for (const b of main().querySelectorAll('[data-view]'))
    b.onclick = () => { S.view = b.dataset.view; LS.set('view2', S.view); screenLibrary(); };
  $('#q').oninput = e => { S.q = e.target.value; LS.set('q', S.q); l2redraw(); };
  $('#sort').onchange = e => { S.sort = e.target.value; LS.set('sort', S.sort); l2redraw(); };
  $('#tools2').onclick = () => { S.tools = !S.tools; LS.set('tools', S.tools); screenLibrary(); };
  $('#vcard').onclick = () => { L.rows = false; l2save(); screenLibrary(); };
  $('#vrow').onclick = () => { L.rows = true; l2save(); screenLibrary(); };
  $('#addto').onclick = () => go('#/gather');
  const rs = $('#rescan2');
  if (rs) rs.onclick = async () => {
    const line = $('#scanline');
    rs.disabled = true;
    try {
      const r = await scanAll(t => { line.textContent = t; });
      S.items = mergeCatalogs();
      screenLibrary();
      const l2 = $('#scanline');
      if (l2) l2.innerHTML = `見直しました: ${r.places} か所・${r.count} ファイル`
        + (r.added ? `／<b>${r.added} 本</b>を新たに棚へ` : '／新しい本はありませんでした');
    } catch (e) { line.textContent = '見られません: ' + e.message; rs.disabled = false; }
  };
  l2bindCells();
  l2bindDetail();
  huntCovers(list.slice(0, 200));
  huntLine();
}

function l2redraw() {
  const g = $('#g');
  if (!g) return screenLibrary();
  const list = l2list();
  g.innerHTML = l2grid(list);
  l2bindCells();
  huntCovers(list.slice(0, 200));
}

function l2bindCells() {
  for (const b of main().querySelectorAll('#g [data-id]')) b.onclick = () => {
    L.sel = b.dataset.id;
    const side = $('#lside');
    side.innerHTML = l2detail();
    side.classList.add('open');
    l2bindDetail();
    for (const x of main().querySelectorAll('#g .sel')) x.classList.remove('sel');
    b.classList.add('sel');
  };
  for (const b of main().querySelectorAll('[data-more]')) b.onclick = () => {
    S.more.l2 = (S.more.l2 || STEP) + STEP * 3;
    l2redraw();
  };
}

/* ---- 書庫（#75）。下ろした本を見る・棚へ戻す ---- */
async function screenStore() {
  $('#title').textContent = '書庫';
  main().innerHTML = '<div class="sub">書庫を見ています…</div>';
  if (!S.auth || !S.rootId) {
    main().innerHTML = '<div class="empty">pCloud につながっていません</div>';
    return;
  }
  let rows = [];
  try {
    const store = await shelfRoot('書庫');
    const r = await call('listfolder', { folderid: store });
    rows = (r.metadata.contents || []).filter(c => c.isfolder)
      .sort((a, b) => collator.compare(a.name, b.name));
  } catch (e) {
    main().innerHTML = `<div class="empty">書庫を見られません: ${esc(e.message)}</div>`;
    return;
  }
  main().innerHTML = `
  <div class="card" style="max-width:620px">
    <h2>書庫</h2>
    <div class="sub" style="margin-bottom:10px">棚から下ろした本が、周りのもの（箱絵・メモ・セーブ）ごとここにあります。
      倉庫の元の置き場はそのままなので、消えている本はありません。</div>
    ${rows.length ? `<div class="rowlist">${rows.map(c => `
      <div class="row"><span class="nm" style="text-align:left">${esc(c.name)}</span>
        <button class="hbtn sm" data-back="${c.folderid}" data-nm="${esc(c.name)}">棚へ戻す</button>
      </div>`).join('')}</div>`
      : '<div class="empty">書庫は空です（まだ何も下ろしていません）</div>'}
    <div class="msg" id="sm"></div>
  </div>`;
  for (const b of main().querySelectorAll('[data-back]')) b.onclick = async () => {
    if (!confirm(`${b.dataset.nm} を書庫から棚へ戻します（フォルダごと1回の移動）。`)) return;
    b.disabled = true;
    try {
      const shelf = await shelfRoot('棚');
      await P.moveFolder(Number(b.dataset.back), shelf, { host: S.host, auth: S.auth });
      $('#sm').textContent = `${b.dataset.nm} を棚へ戻しました`;
      screenStore();
    } catch (e) { $('#sm').textContent = '戻せません: ' + e.message; b.disabled = false; }
  };
}

/* 狭い画面: 札の外を押したらシートを閉じる。 */
addEventListener('click', e => {
  const side = $('#lside');
  if (!side || innerWidth > 920) return;
  if (!e.target.closest('#lside') && !e.target.closest('#g [data-id]'))
    side.classList.remove('open');
});
