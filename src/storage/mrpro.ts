// 原版 Moon+ Reader 整库备份（.mrpro / .mrstd）的解析（BAK-001 的反向，spec 01 §4.5）。纯解析，不碰 IndexedDB。
//   zip ─ <应用数据目录名>/<n>.tag（n 从 1 起）+ <应用数据目录名>/_names.list（第 n 行 = 第 n 个 .tag 的原路径）
//   原路径形如 com.flyersoft.moonreaderp/databases/mrbooks.db、…/shared_prefs/positions10.xml；
//   以 ? 开头 = 内部存储的绝对路径（封面/书籍），以 * 开头 = 外置 SD 的绝对路径。
// SQLite 用 sql.js（wasm 由 sqljs-loader 内联进包里，单文件版也能用）。
import JSZip from 'jszip';
import type { SqlJsStatic } from 'sql.js';
import { parseXml, walk } from './xml';
import { DELETED, parseCategory, parseStatDates, type MoonNote } from './moon-formats';

export interface MrproBook {
  /** 原完整路径（压缩包内的书形如 a.zip?/b.epub） */
  path: string;
  lower: string;
  /** 去掉手动排序前缀（x#@#）后的书名 */
  title: string;
  /** 原始 book 列（带排序前缀），用来还原手动顺序 */
  rawTitle: string;
  authors: string[];
  description: string;
  tags: string[];
  series?: { name: string; index?: number };
  addedAt: number;
  favorite: string;
}

export interface MrproStat {
  path: string;
  usedMs: number;
  words: number;
  days: Record<number, { ms: number; words: number }>;
}

export interface MrproData {
  /** 来自 shelf 的书（books 表）；tmpbooks 里的临时书不导入 */
  books: MrproBook[];
  notes: (MoonNote & { path: string })[];
  stats: MrproStat[];
  /** 小写路径 → 位置串（positions10） */
  positions: Map<string, string>;
  /** 最近阅读：完整路径，最新在前 */
  history: string[];
  /** 小写路径 → 手动阅读状态 1/2/3 */
  readStates: Map<string, 1 | 2 | 3>;
  /** 置顶书路径，最新置顶在前 */
  top: string[];
  /** 备份里带的书籍文件（路径 → 读取函数） */
  bookFiles: Map<string, () => Promise<Uint8Array>>;
  /** 备份里带的封面图（文件名 → 读取函数） */
  coverFiles: Map<string, () => Promise<Uint8Array>>;
  /** 备份里 options1002.xml 的原始键值（只用于诊断，不导入设置） */
  hasOptions: boolean;
}

const MANUAL_SORT_TAG = '#@#';

export const removeSortTag = (t: string): string => (t.includes(MANUAL_SORT_TAG) ? t.slice(t.lastIndexOf(MANUAL_SORT_TAG) + MANUAL_SORT_TAG.length) : t);

const baseName = (p: string) => p.replace(/^.*[\\/]/, '');

/** 书在原路径里的「文件名」：压缩包内的书（a.zip?/b.epub）取包内文件名 */
export function legacyFileName(path: string): string {
  const inner = path.includes('?') ? path.slice(path.indexOf('?') + 1) : path;
  return baseName(inner);
}

/** Android SharedPreferences XML → 键值（<string name>…</string>、<int|long|boolean name value=…/>） */
export function parsePrefsXml(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const root = parseXml(xml);
  if (!root) return out;
  for (const n of walk(root)) {
    const name = n.attrs.name;
    if (name === undefined) continue;
    if (n.local === 'string') out.set(name, n.children.map((c) => (typeof c === 'string' ? c : '')).join(''));
    else if (['int', 'long', 'boolean', 'float'].includes(n.local) && n.attrs.value !== undefined) out.set(name, n.attrs.value);
  }
  return out;
}

const text = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);
const lines = (s: string) => s.replace(/\r/g, '').split('\n').filter(Boolean);

type Row = Record<string, string | number | Uint8Array | null>;

function rows(db: InstanceType<SqlJsStatic['Database']>, sql: string): Row[] {
  try {
    const st = db.prepare(sql);
    const out: Row[] = [];
    while (st.step()) out.push(st.getAsObject() as Row);
    st.free();
    return out;
  } catch {
    return []; // 表不存在（旧版本库）
  }
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export class NotMrproError extends Error {}

export async function parseMrpro(file: Blob, loadSql: () => Promise<SqlJsStatic>): Promise<MrproData> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new NotMrproError('不是有效的备份文件（不是 zip）');
  }
  const entryNames = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  // 原路径 → zip 条目名
  const mapping = new Map<string, string>();
  const listName = entryNames.find((n) => n.endsWith('_names.list'));
  if (listName) {
    const base = listName.slice(0, listName.length - '_names.list'.length);
    lines(await zip.file(listName)!.async('string')).forEach((l, i) => mapping.set(l, `${base}${i + 1}.tag`));
  } else {
    for (const n of entryNames) mapping.set(n, n);
  }
  const bytesOf = (zipName: string) => () => zip.file(zipName)!.async('uint8array');
  const findBySuffix = (suffix: string): string | undefined => {
    for (const [orig, zn] of mapping) if (!/^[?*]/.test(orig) && orig.replace(/\\/g, '/').endsWith(suffix) && zip.file(zn)) return zn;
    return undefined;
  };

  const dbName = findBySuffix('/mrbooks.db') ?? findBySuffix('mrbooks.db');
  if (!dbName) throw new NotMrproError('备份里没有书库数据库 mrbooks.db');
  const SQL = await loadSql();
  const db = new SQL.Database(await zip.file(dbName)!.async('uint8array'));
  const data: MrproData = { books: [], notes: [], stats: [], positions: new Map(), history: [], readStates: new Map(), top: [], bookFiles: new Map(), coverFiles: new Map(), hasOptions: false };
  try {
    for (const r of rows(db, 'select book, filename, lowerFilename, author, description, category, addTime, favorite from books')) {
      const path = str(r.filename);
      if (!path) continue;
      const cat = parseCategory(str(r.category));
      const authors = str(r.author)
        .split(/\r?\n/)
        .map((a) => a.trim())
        // (TXT) (PDF) (CBZ) 之类是原 app 给无作者书的占位，不是真作者
        .filter((a) => a && !/^\(.{1,8}\)$/.test(a));
      data.books.push({
        path,
        lower: str(r.lowerFilename) || path.toLowerCase(),
        title: removeSortTag(str(r.book)).trim() || legacyFileName(path).replace(/\.[^.]+$/, ''),
        rawTitle: str(r.book),
        authors,
        description: str(r.description),
        tags: cat.tags,
        series: cat.series,
        addedAt: num(r.addTime) || Date.now(),
        favorite: str(r.favorite),
      });
    }
    for (const r of rows(db, 'select * from notes')) {
      const path = str(r.filename);
      data.notes.push({
        path,
        id: num(r._id),
        book: str(r.book),
        filename: path,
        lowerFilename: str(r.lowerFilename) || path.toLowerCase(),
        chapter: num(r.lastChapter),
        split: num(r.lastSplitIndex),
        position: num(r.lastPosition),
        length: num(r.highlightLength),
        color: num(r.highlightColor),
        time: num(r.time),
        bookmark: str(r.bookmark),
        note: str(r.note),
        original: str(r.original),
        underline: num(r.underline),
        strikethrough: num(r.strikethrough),
        bak: str(r.bak),
      });
    }
    data.notes = data.notes.filter((n) => n.bak !== DELETED);
    for (const r of rows(db, 'select filename, usedTime, readWords, dates from statistics')) {
      data.stats.push({ path: str(r.filename), usedMs: num(r.usedTime), words: num(r.readWords), days: parseStatDates(str(r.dates)) });
    }
  } finally {
    db.close();
  }

  const positionsName = findBySuffix('/positions10.xml');
  if (positionsName) for (const [k, v] of parsePrefsXml(text(await zip.file(positionsName)!.async('uint8array')))) data.positions.set(k.toLowerCase(), v);
  const stateName = findBySuffix('/state_filter.xml');
  if (stateName) {
    for (const [k, v] of parsePrefsXml(text(await zip.file(stateName)!.async('uint8array')))) {
      const s = Number(v);
      if (s === 1 || s === 2 || s === 3) data.readStates.set(k.toLowerCase(), s);
    }
  }
  const historyName = findBySuffix('/history.txt');
  if (historyName) data.history = lines(text(await zip.file(historyName)!.async('uint8array')));
  const topName = findBySuffix('/shelf_top_books');
  if (topName) data.top = lines(text(await zip.file(topName)!.async('uint8array')));
  data.hasOptions = !!findBySuffix('/options1002.xml');

  // 带进来的书籍与封面（? / * 开头的绝对路径）
  for (const [orig, zn] of mapping) {
    if (!/^[?*]/.test(orig) || !zip.file(zn)) continue;
    const abs = orig.slice(1);
    // 封面缓存全是 .png（_1/_2/_3.png 与网络封面）；其余带进来的都是书
    if (/\.png$/i.test(abs)) data.coverFiles.set(baseName(abs), bytesOf(zn));
    else data.bookFiles.set(abs, bytesOf(zn));
  }
  return data;
}

/** 原 app 的封面缓存文件：`<书文件名>_3.png`（用户编辑）> `_2.png`（原图）> `_1.png`（缩略图）> `<书文件名>.png`（网络封面） */
export function pickLegacyCover(data: MrproData, fileName: string): (() => Promise<Uint8Array>) | undefined {
  for (const suffix of ['_3.png', '_2.png', '_1.png', '.png']) {
    const hit = data.coverFiles.get(`${fileName}${suffix}`);
    if (hit) return hit;
  }
  return undefined;
}
