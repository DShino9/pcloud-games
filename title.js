'use strict';
/* 本の頁。**その本にまつわることは、全部ここに集める。**

   これまでは「遊ぶ」は札を押す、「書庫へ下ろす」は設定の奥、「版を選ぶ」は
   押したときだけ、「箱絵を直す」は別の画面…と散らばっていた。
   どこに何があるか分からないのは、当たり前だった。

   Steam や プロジェクトEGG と同じ形にする ——
   一覧から本を開くと、その本の頁が出る。遊ぶのもそこから。 */

function screenTitle(id) {
  const g = S.items.find(x => x.id === id)
        || grouped(S.items).find(x => x.id === id);
  if (!g) return go('#/lib');
  $('#title').textContent = g.name;

  const cov = S.covurl[g.id] || g.cover;
  const inWare = hasAll(g);
  const onShelf = gotIt(g);
  const maker = (window.Makers ? Makers.makerOf(g.name, g.path) : '') || '';
  const vers = g.gkey ? (S.gmap || {})[g.gkey] : null;

  /* いまの状態を1行で。ここが分からないと、次に何を押せばいいか分からない。 */
  const state = onShelf ? '<b style="color:var(--ok)">棚にあります</b>（すぐ遊べます）'
              : inWare  ? '倉庫にあります（遊ぶと棚に取り寄せます）'
              : '<b style="color:var(--danger)">倉庫にありません</b>（遊べません）';

  main().innerHTML = `
  <div class="tpage">
    <div class="tcov">${cov ? `<img src="${esc(cov)}" alt="">`
      : `<div class="ph">${esc(g.name)}</div>`}</div>
    <div class="tbody">
      <h2>${esc(g.name)}</h2>
      <div class="tmeta">
        <span class="tag" data-s="${esc(g.short)}">${esc(g.short)}</span>
        <span>${esc(g.system)}</span>
        ${maker ? `<span>・${esc(maker)}</span>` : ''}
        ${g.genre ? `<span>・${esc(g.genre)}</span>` : ''}
        ${g.files.length > 1 ? `<span>・${g.files.length}枚</span>` : ''}
        ${g.bytes ? `<span>・${size(g.bytes)}</span>` : ''}
      </div>
      <div class="sub" style="margin:8px 0 14px">${state}</div>

      <div class="tacts">
        <button class="primary" id="tplay"${inWare ? '' : ' disabled'}>▶ 遊ぶ</button>
        ${vers && vers.length > 1
          ? `<button class="hbtn" id="tver">版を選ぶ（${vers.length}）</button>` : ''}
        ${g.pc98 || g.system === 'PC-98'
          ? '<button class="hbtn" id="tdisk">ディスクの組み合わせを忘れる</button>' : ''}
        <button class="hbtn" id="tcov">箱絵を差し替える</button>
        ${onShelf ? '<button class="hbtn" id="tdown">書庫へ下ろす</button>'
                  : inWare ? '<button class="hbtn" id="tstock">棚に取り寄せる</button>' : ''}
      </div>

      <div class="msg" id="tm"></div>

      <h3 style="margin-top:20px">中身</h3>
      <div class="rowlist">
        ${g.files.map((f, i) => `<div class="row">
          <span class="nm" style="text-align:left;font-size:13px">${esc(f)}</span>
          <span class="sub">${g.fids && g.fids[i] ? '倉庫にあります' : (S.files[P.nfc(f)] ? '倉庫にあります' : '無い')}</span>
        </div>`).join('')}
      </div>
      ${g.path ? `<div class="sub" style="margin-top:8px">置き場: ${esc(g.path)}</div>` : ''}
    </div>
  </div>
  <input type="file" id="tfile" accept="image/*" style="display:none">`;

  $('#tplay').onclick = () => play(g.id);
  const tv = $('#tver');
  if (tv) tv.onclick = () => pickVer(g.gkey, vers);
  const td = $('#tdisk');
  if (td) td.onclick = () => {
    const pick = LS.get('fdpick', {});
    delete pick[g.id]; LS.set('fdpick', pick);
    $('#tm').textContent = '次に遊ぶとき、ディスクを選び直せます';
  };
  $('#tcov').onclick = () => {
    const f = $('#tfile');
    f.onchange = async () => {
      const file = f.files && f.files[0];
      f.value = '';
      if (!file) return;
      try {
        await MYCOV.put(g.id, await shrinkImage(file));
        await loadMyCovers();
        screenTitle(id);
      } catch (e) { $('#tm').textContent = '入れられません: ' + e.message; }
    };
    f.click();
  };
  const ts = $('#tstock');
  if (ts) ts.onclick = async () => {
    ts.disabled = true;
    try {
      await stock(g, t => { $('#tm').textContent = t; });
      $('#tm').textContent = '棚に取り寄せました（本体・箱絵・メモを1つのフォルダに）';
    } catch (e) { $('#tm').textContent = '取り寄せられません: ' + e.message; ts.disabled = false; }
  };
  const tdn = $('#tdown');
  if (tdn) tdn.onclick = async () => {
    if (!confirm(`${g.name} を棚から下ろし、周りのもの（箱絵・メモ・セーブ）ごと書庫へ移します。\n\n倉庫の元の置き場はそのままです。`)) return;
    tdn.disabled = true;
    try {
      await archive(g, t => { $('#tm').textContent = t; });
      if (!g.pc98) await removeCached(g.id);
      else for (const f of g.files) {
        const fid = S.files[P.nfc(f)];
        if (fid) await removeCached(String(fid));
      }
      await refreshHere();
      screenTitle(id);
    } catch (e) { $('#tm').textContent = '下ろせません: ' + e.message; tdn.disabled = false; }
  };
}
