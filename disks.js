'use strict';
/* ディスクの道具箱。昔の EditDisk / DiskExplorer にあたるもの。

   セーブディスクが増えてくると、「どれが何のセーブか」「空きはあるか」が
   分からなくなる。差して起動してみるまで中身が見えないのが元凶なので、
   **差さずに中を見られる**ようにする。

   できること: 整形済みブランクを作る／複製する／名前を変える／消す／
   中を見る／中のファイルを取り出す／組み合わせに入れる。

   コア（NP2kai）には一切触らない。読み書きは pc98disk.js に任せる。 */

const D = PC98Disk;

/* 道具箱で作ったディスクは `disk-<名前>` で手元に置く。
   遊ぶ画面（play98）の「ほかから足す」は、この頭文字を見て拾う。 */
const DISK_KEY = n => 'disk-' + (/\.[a-z0-9]+$/i.test(n) ? n : n + '.fdi');
const isMine   = k => k.startsWith('disk-');
const mineName = k => k.slice(5).replace(/\.fdi$/i, '');

/* 本に付いているディスクか（pCloud にある実物）。 */
const isImage = n => /\.(fdi|hdi|d88|hdm|xdf|nfd)$/i.test(n);

async function diskBytes(key) {
  const r = await ROMS.get(key);
  return r ? new Uint8Array(await r.arrayBuffer()) : null;
}

/* ============ 一覧 ============ */
async function screenDisks() {
  $('#title').textContent = 'ディスクの道具箱';
  main().innerHTML = '<div class="card"><div class="empty">読んでいます…</div></div>';
  await refreshHere();

  const keys  = Object.keys(S.here);
  const mine  = keys.filter(isMine).sort();
  /* 本のディスクで、すでに取り寄せ済みのもの。取り寄せ済みなら中が見られる。 */
  const held  = keys.filter(k => !isMine(k) && isImage(k)).sort();
  /* 棚にはあるが、まだまだ取り寄せていないもの。 */
  const away  = [];
  for (const t of (S.cat98 ? S.cat98.titles : []))
    for (const d of (t.disks || []))
      if (!S.here[d.file] && S.files[P.nfc(d.file)])
        away.push({ file: d.file, of: t.name, bytes: d.bytes });

  const card = (k, sub, acts) => `
    <div class="row" style="display:block;padding:11px 14px">
      <div class="nm" style="font-size:14px">${esc(k)}</div>
      <div class="sub" style="margin-top:2px">${sub}</div>
      <div style="margin-top:7px;display:flex;gap:6px;flex-wrap:wrap">${acts}</div>
    </div>`;

  main().innerHTML = `
  <div class="card" style="max-width:680px">
    <h2>ディスクの道具箱</h2>
    <p>ディスクを<b>差さずに中を見る</b>ための道具です。セーブディスクが増えてきたとき、
       どれが何のセーブか、空きはどれだけかを、起動せずに確かめられます。</p>
    <button class="hbtn" id="new">整形済みのブランクを作る</button>

    <h3 style="margin-top:18px">作ったディスク（${mine.length}）</h3>
    ${mine.length ? `<div class="rowlist">${mine.map(k => card(mineName(k),
        '道具箱で作ったもの・組み合わせに入れられます',
        `<button class="hbtn sm" data-see="${esc(k)}">中を見る</button>
         <button class="hbtn sm" data-cp="${esc(k)}">複製</button>
         <button class="hbtn sm" data-rn="${esc(k)}">名前を変える</button>
         <button class="hbtn sm" data-rm="${esc(k)}">消す</button>`)).join('')}</div>`
      : '<div class="empty">まだありません。上の「整形済みのブランクを作る」から。</div>'}

    <h3 style="margin-top:18px">取り寄せたディスク（${held.length}）</h3>
    ${held.length ? `<div class="rowlist">${held.map(k => card(k,
        '取り寄せ済み・中が見られます',
        `<button class="hbtn sm" data-see="${esc(k)}">中を見る</button>
         <button class="hbtn sm" data-cp="${esc(k)}">複製して道具箱へ</button>`)).join('')}</div>`
      : '<div class="empty">まだ取り寄せていません。一度遊ぶと取り寄せた分として残ります。</div>'}

    ${away.length ? `<h3 style="margin-top:18px">棚にある（まだ取り寄せていない・${away.length}）</h3>
      <div class="rowlist">${away.slice(0, 40).map(d => card(d.file,
        esc(d.of) + '・' + (d.bytes / 1024 / 1024).toFixed(2) + 'MB',
        `<button class="hbtn sm" data-get="${esc(d.file)}">取り寄せる</button>`)).join('')}
      </div>${away.length > 40 ? `<div class="sub">ほか ${away.length - 40} 枚</div>` : ''}` : ''}

    <button class="hbtn" id="back" style="margin-top:14px">← 設定へ</button>
    <div class="msg" id="m"></div>
  </div>`;

  $('#back').onclick = () => go('#/set');
  $('#new').onclick  = newBlank;
  for (const b of main().querySelectorAll('[data-see]')) b.onclick = () => seeDisk(b.dataset.see);
  for (const b of main().querySelectorAll('[data-cp]'))  b.onclick = () => copyDisk(b.dataset.cp);
  for (const b of main().querySelectorAll('[data-rn]'))  b.onclick = () => renameDisk(b.dataset.rn);
  for (const b of main().querySelectorAll('[data-rm]'))  b.onclick = () => removeDisk(b.dataset.rm);
  for (const b of main().querySelectorAll('[data-get]')) b.onclick = () => getDisk(b.dataset.get);
}

/* ============ 作る・写す・名前・消す ============ */

/* **整形済みで作る。** 素の空きディスクを渡すと、ゲーム側の「セーブ」で
   「ディスクが初期化されていません」と言われて詰む。差せばすぐ書ける状態にする。 */
async function newBlank() {
  const n = ask('新しいディスクの名前', nextName('セーブ'));
  if (!n) return;
  await ROMS.put(DISK_KEY(n), new Blob([D.makeBlank({ label: n.slice(0, 11) })]));
  toast('作りました（整形済み・そのまま書けます）');
  screenDisks();
}

function nextName(base) {
  let i = 1;
  while (S.here[DISK_KEY(base + i)]) i++;
  return base + i;
}

/* 複製。**元は触らない。** セーブを分岐させたいとき（この先で失敗したら戻る）に使う。 */
async function copyDisk(key) {
  const src = isMine(key) ? mineName(key) : key.replace(/\.[^.]+$/, '');
  const n = ask('複製の名前', nextName(src + 'のコピー'));
  if (!n) return;
  const b = await ROMS.get(key);
  if (!b) return toast('中身が取り寄せていません');
  await ROMS.put(DISK_KEY(n), await b.blob());
  toast('複製しました');
  screenDisks();
}

async function renameDisk(key) {
  const n = ask('新しい名前', mineName(key));
  if (!n || n === mineName(key)) return;
  if (S.here[DISK_KEY(n)]) return toast('その名前はもうあります');
  const b = await ROMS.get(key);
  if (!b) return toast('中身が取り寄せていません');
  await ROMS.put(DISK_KEY(n), await b.blob());
  await ROMS.del(key);
  toast('名前を変えました');
  screenDisks();
}

/* **消すのは取り寄せた分だけ。** pCloud には触らない。
   ただし道具箱で作ったものは pCloud に無いので、消したら戻らない。 */
async function removeDisk(key) {
  if (!confirm(mineName(key) + ' を消します。\n道具箱で作ったディスクは pCloud に控えが無いので、戻せません。'))
    return;
  await ROMS.del(key);
  toast('消しました');
  screenDisks();
}

async function getDisk(file) {
  const id = S.files[P.nfc(file)];
  if (!id) return toast('棚に見つかりません');
  $('#m').textContent = file + ' を取り寄せています…';
  try {
    const blob = await P.fetchFile(S.relay, { fileid: id, name: file },
                                   p => { $('#m').textContent = '取り寄せ中… ' + Math.round(p * 100) + '%'; });
    await ROMS.put(file, blob);
    toast('取り寄せました');
    screenDisks();
  } catch (e) {
    $('#m').textContent = '取り寄せられません: ' + e.message;
  }
}

/* ============ 中を見る ============ */
async function seeDisk(key) {
  const name = isMine(key) ? mineName(key) : key;
  $('#title').textContent = name;
  main().innerHTML = '<div class="card"><div class="empty">読んでいます…</div></div>';

  const bytes = await diskBytes(key);
  if (!bytes) return void (main().innerHTML =
    `<div class="card"><div class="empty">中身が取り寄せていません</div>
     <button class="hbtn" id="back">← 道具箱へ</button></div>`,
    $('#back').onclick = () => go('#/disks'));

  let d, files, use, vol = '', err = '';
  try {
    d = D.open(bytes, name);
    const all = D.listRoot(d);
    /* 名札は「入っているもの」ではないので、上の見出しに回す。
       消したものの跡（先頭が 0xE5）は残っていても中身は当てにならないので、
       印を付けて分けて出す。 */
    vol = (all.find(f => f.vol) || {}).name || '';
    files = all.filter(f => !f.vol);
    use = D.usage(d);
  } catch (e) { err = e.message; }

  main().innerHTML = `
  <div class="card" style="max-width:680px">
    <h2>${esc(name)}</h2>
    ${err ? `<div class="empty">中を読めません（${esc(err)}）<br>
       <span class="sub">PC-98 の 1.23MB 2HD・FAT12 のものだけ読めます。
       HDD の像や、独自の形のものは開けません。</span></div>`
    : `<p class="sub">${vol ? '名札「' + esc(vol) + '」・' : ''}${d.bpb.oem ? esc(d.bpb.oem) + '・' : ''}
        1枚 ${(bytes.length / 1024 / 1024).toFixed(2)}MB・
        ${d.bpb.sec}バイト×${d.bpb.spc}／かたまり・${d.bpb.clusters}かたまり</p>
      <div style="height:9px;background:var(--line);border-radius:5px;overflow:hidden;margin:8px 0">
        <div style="height:100%;width:${(use.used / use.total * 100).toFixed(1)}%;background:var(--accent)"></div>
      </div>
      <div class="sub">使用 ${(use.used / 1024).toFixed(0)}KB ／
        空き <b>${(use.free / 1024).toFixed(0)}KB</b> ／ 全体 ${(use.total / 1024).toFixed(0)}KB</div>

      <h3 style="margin-top:16px">入っているもの（${files.filter(f => !f.deleted).length}${
        files.some(f => f.deleted) ? '＋消した跡 ' + files.filter(f => f.deleted).length : ''}）</h3>
      ${files.length ? `<div class="rowlist">${files.map((f, i) => `
        <div class="row" style="padding:9px 14px">
          <span class="nm" style="font-family:ui-monospace,monospace;font-size:13px${f.deleted ? ';opacity:.45;text-decoration:line-through' : ''}">${esc(f.name)}</span>
          <span class="sub" style="min-width:78px;text-align:right">${
            f.dir ? 'フォルダ' : (f.size / 1024).toFixed(1) + 'KB'}</span>
          <span class="sub" style="min-width:112px;text-align:right">${esc(D.stamp(f.date, f.time))}</span>
          ${f.dir || f.deleted ? '' : `<button class="hbtn sm" data-out="${i}">取り出す</button>`}
        </div>`).join('')}</div>`
        : '<div class="empty">空です（整形済み・そのまま書けます）</div>'}`}

    <button class="hbtn" id="back" style="margin-top:14px">← 道具箱へ</button>
    <div class="msg" id="m"></div>
  </div>`;

  $('#back').onclick = () => go('#/disks');
  for (const b of main().querySelectorAll('[data-out]')) b.onclick = () => {
    const f = files[+b.dataset.out];
    const blob = new Blob([D.readFile(d, f)], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = f.name;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}

/* 名前を聞く。空なら取りやめ。 */
function ask(label, def) {
  const v = prompt(label, def);
  return v == null ? '' : v.trim().replace(/[\/\\?%*:|"<>]/g, '') || '';
}
