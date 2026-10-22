// 测试夹具：按原版格式拼一个 .mrpro 备份（SQLite 用 sql.js 在 Node 里建，表结构和手机上的一致）
import JSZip from 'jszip';
import initSqlJs from 'sql.js';

const BASE = 'com.flyersoft.moonreaderp';

export interface FakeBackup {
  books?: { book: string; filename: string; author?: string; description?: string; category?: string; addTime?: string; favorite?: string }[];
  notes?: { filename: string; chapter: number; position: number; length: number; color?: number; bookmark?: string; note?: string; original?: string; bak?: string }[];
  stats?: { filename: string; usedTime: number; readWords: number; dates: string }[];
  positions?: Record<string, string>;
  history?: string[];
  state?: Record<string, number>;
  top?: string[];
  /** 带进备份的外部文件：绝对路径 → 内容 */
  outer?: Record<string, Uint8Array | string>;
  noNamesList?: boolean;
}

/** 按原版格式拼一个 .mrpro（SQLite 用 sql.js 在 Node 里建，和手机上的表结构一致） */
export async function makeMrpro(fb: FakeBackup): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`create table books (_id integer primary key autoincrement, book text, filename text, lowerFilename text, author text, description text, category text, thumbFile text, coverFile text, addTime text, favorite text, downloadUrl text, rate text, bak1 text, bak2 text)`);
  db.run(`create table notes (_id integer primary key autoincrement, book text, filename text, lowerFilename text, lastChapter NUMERIC, lastSplitIndex NUMERIC, lastPosition NUMERIC, highlightLength NUMERIC, highlightColor NUMERIC, time NUMERIC, bookmark text, note text, original text, underline NUMERIC, strikethrough NUMERIC, bak text)`);
  db.run(`create table statistics (_id integer primary key autoincrement, filename text, usedTime NUMERIC, readWords NUMERIC, dates text)`);
  for (const b of fb.books ?? []) db.run('insert into books (book, filename, lowerFilename, author, description, category, addTime, favorite) values (?,?,?,?,?,?,?,?)', [b.book, b.filename, b.filename.toLowerCase(), b.author ?? '', b.description ?? '', b.category ?? '', b.addTime ?? '1700000000000', b.favorite ?? '']);
  for (const n of fb.notes ?? [])
    db.run('insert into notes (book, filename, lowerFilename, lastChapter, lastSplitIndex, lastPosition, highlightLength, highlightColor, time, bookmark, note, original, underline, strikethrough, bak) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      n.filename.replace(/^.*\//, ''), n.filename, n.filename.toLowerCase(), n.chapter, 0, n.position, n.length, n.color ?? 0, 1700000000000, n.bookmark ?? '', n.note ?? '', n.original ?? '', 0, 0, n.bak ?? '0',
    ]);
  for (const s of fb.stats ?? []) db.run('insert into statistics (filename, usedTime, readWords, dates) values (?,?,?,?)', [s.filename, s.usedTime, s.readWords, s.dates]);
  const dbBytes = db.export();
  db.close();

  const prefs = (m: Record<string, string | number>) => `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n${Object.entries(m).map(([k, v]) => (typeof v === 'number' ? `    <int name="${k}" value="${v}" />` : `    <string name="${k}">${v}</string>`)).join('\n')}\n</map>\n`;
  const files: [string, Uint8Array | string][] = [
    [`${BASE}/databases/mrbooks.db`, dbBytes],
    [`${BASE}/shared_prefs/options1002.xml`, prefs({ shelf_sort_by2: 1 })],
    [`${BASE}/shared_prefs/positions10.xml`, prefs(fb.positions ?? {})],
    [`${BASE}/shared_prefs/state_filter.xml`, prefs(fb.state ?? {})],
    [`${BASE}/shared_prefs/history.txt`, (fb.history ?? []).join('\n') + '\n'],
    [`${BASE}/shared_prefs/shelf_top_books`, (fb.top ?? []).join('\n') + '\n'],
  ];
  for (const [p, c] of Object.entries(fb.outer ?? {})) files.push([`?${p}`, c]);
  const zip = new JSZip();
  if (fb.noNamesList) for (const [n, c] of files) zip.file(n.replace(/^\?/, 'outer'), c);
  else {
    files.forEach(([, c], i) => zip.file(`${BASE}/${i + 1}.tag`, c));
    zip.file(`${BASE}/_names.list`, files.map(([n]) => n).join('\n') + '\n');
  }
  return zip.generateAsync({ type: 'uint8array' });
}

