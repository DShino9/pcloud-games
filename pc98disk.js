'use strict';
/* PC-98 のディスクイメージを、ブラウザの中で読む・作る。
   昔の EditDisk / DiskExplorer にあたるもの。心臓（NP2kai）には一切触らない。

   .fdi は「4096バイトの頭 ＋ セクタを並べただけの中身」。
   中身は MS-DOS の FAT12 なので、見出し（BPB）を読めば中を辿れる。

   対応するのは 1.23MB 2HD（PC-98 の標準）。頭の値は本物から読み取ったもの。 */

(function (root) {

const FDI_HEAD = 4096;
const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/* ---- 作る ---- */
/* 整形済み（FORMAT 済み）で作る。差せばすぐ書き込める。
   並び: 0=起動セクタ, 1-2=FAT1, 3-4=FAT2, 5-10=ルート, 11-=データ */
function makeBlank(opt = {}) {
  const SEC = 1024, TOTAL = 1232;              // 1024×8×2×77
  const body = SEC * TOTAL;
  const buf = new Uint8Array(FDI_HEAD + body);
  const v = new DataView(buf.buffer);
  const u32 = (o, n) => v.setUint32(o, n, true);
  const u16 = (o, n) => v.setUint16(o, n, true);

  u32(0x00, 0); u32(0x04, 0x90); u32(0x08, FDI_HEAD); u32(0x0c, body);
  u32(0x10, SEC); u32(0x14, 8); u32(0x18, 2); u32(0x1c, 77);

  const b = FDI_HEAD;
  buf[b] = 0xEB; buf[b + 1] = 0x1C; buf[b + 2] = 0x90;
  const oem = (opt.oem || 'NEC 2.00').padEnd(8).slice(0, 8);
  for (let i = 0; i < 8; i++) buf[b + 3 + i] = oem.charCodeAt(i);
  u16(b + 11, SEC); buf[b + 13] = 1; u16(b + 14, 1); buf[b + 16] = 2;
  u16(b + 17, 192); u16(b + 19, TOTAL); buf[b + 21] = 0xFE;
  u16(b + 22, 2); u16(b + 24, 8); u16(b + 26, 2); u32(b + 28, 0);

  for (const start of [1, 3]) {
    const o = FDI_HEAD + start * SEC;
    buf[o] = 0xFE; buf[o + 1] = 0xFF; buf[o + 2] = 0xFF;
  }
  return buf;
}

/* ---- 読む ---- */
/* 頭を外して中身と見出しを取り出す。HDD（.hdi）も頭の大きさが書いてある。 */
function open(bytes, name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  let head = 0;
  if (ext === 'fdi' || ext === 'hdi') {
    const h = le32(bytes, 0x08);
    if (h > 0 && h < bytes.length) head = h;
  }
  const body = bytes.subarray(head);
  const bpb = readBPB(body);
  return { head, body, bpb, ext };
}

function readBPB(b) {
  const sec = le16(b, 11);
  if (!sec || sec % 128) return null;                 // 見出しが読めない
  const bpb = {
    sec, spc: b[13], reserved: le16(b, 14), fats: b[16],
    roots: le16(b, 17), total: le16(b, 19) || le32(b, 32),
    media: b[21], spf: le16(b, 22), spt: le16(b, 24), heads: le16(b, 26),
    oem: String.fromCharCode(...b.subarray(3, 11)).trim(),
  };
  if (!bpb.spc || !bpb.fats || !bpb.spf) return null;
  bpb.rootStart = bpb.reserved + bpb.fats * bpb.spf;
  bpb.rootSecs  = Math.ceil(bpb.roots * 32 / bpb.sec);
  bpb.dataStart = bpb.rootStart + bpb.rootSecs;
  bpb.clusters  = Math.floor((bpb.total - bpb.dataStart) / bpb.spc);
  return bpb;
}

const ATTR = { RO: 1, HIDDEN: 2, SYS: 4, VOL: 8, DIR: 16, ARCH: 32 };

/* ルートの一覧。消したもの（先頭 0xE5）は「消えた」印を付けて残す。 */
function listRoot(d) {
  const { body, bpb } = d;
  if (!bpb) return [];
  const out = [];
  const start = bpb.rootStart * bpb.sec;
  for (let i = 0; i < bpb.roots; i++) {
    const o = start + i * 32;
    const first = body[o];
    if (first === 0x00) break;                       // ここから先は未使用
    const attr = body[o + 11];
    if (attr === 0x0F) continue;                     // 長い名前の断片
    const raw = body.subarray(o, o + 11);
    const name = String.fromCharCode(...raw.subarray(0, 8)).trim();
    const ext  = String.fromCharCode(...raw.subarray(8, 11)).trim();
    out.push({
      deleted: first === 0xE5,
      name: (first === 0xE5 ? '?' + name.slice(1) : name) + (ext ? '.' + ext : ''),
      attr,
      dir: !!(attr & ATTR.DIR),
      vol: !!(attr & ATTR.VOL),
      size: le32(body, o + 28),
      cluster: le16(body, o + 26),
      time: le16(body, o + 22),
      date: le16(body, o + 24),
    });
  }
  return out;
}

/* 日付は「1980年からの年数・月・日」で詰まっている。 */
function stamp(date, time) {
  if (!date) return '';
  const y = 1980 + ((date >> 9) & 0x7f), m = (date >> 5) & 0x0f, d = date & 0x1f;
  const hh = (time >> 11) & 0x1f, mm = (time >> 5) & 0x3f;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ` +
         `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* FAT を辿って中身を取り出す。FAT12 は1つ半バイトなので、偶奇で取り方が変わる。 */
function readChain(d, cluster) {
  const { body, bpb } = d;
  const fat = bpb.reserved * bpb.sec;
  const get = n => {
    const o = fat + Math.floor(n * 3 / 2);
    const v = body[o] | (body[o + 1] << 8);
    return (n & 1) ? (v >> 4) : (v & 0x0fff);
  };
  const out = [];
  let n = cluster, guard = 0;
  while (n >= 2 && n < 0xff0 && guard++ < bpb.clusters + 4) {
    out.push(n);
    n = get(n);
  }
  return out;
}

function readFile(d, entry) {
  const { body, bpb } = d;
  const chain = readChain(d, entry.cluster);
  const out = new Uint8Array(entry.size);
  let put = 0;
  for (const c of chain) {
    const off = (bpb.dataStart + (c - 2) * bpb.spc) * bpb.sec;
    const n = Math.min(bpb.sec * bpb.spc, entry.size - put);
    if (n <= 0) break;
    out.set(body.subarray(off, off + n), put);
    put += n;
  }
  return out;
}

/* 使っている量。FAT を数える。 */
function usage(d) {
  const { body, bpb } = d;
  if (!bpb) return null;
  const fat = bpb.reserved * bpb.sec;
  const get = n => {
    const o = fat + Math.floor(n * 3 / 2);
    const v = body[o] | (body[o + 1] << 8);
    return (n & 1) ? (v >> 4) : (v & 0x0fff);
  };
  let used = 0;
  for (let n = 2; n < bpb.clusters + 2; n++) if (get(n)) used++;
  const unit = bpb.sec * bpb.spc;
  return { used: used * unit, free: (bpb.clusters - used) * unit, total: bpb.clusters * unit };
}

root.PC98Disk = { FDI_HEAD, makeBlank, open, readBPB, listRoot, readFile, readChain, usage, stamp, ATTR };

})(window);
