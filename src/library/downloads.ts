// 下载队列（NET-004/007/008）：经 /api/proxy 取字节 → 魔数纠正扩展名 → zip 解包取第一本书 → 入库。
import { create } from 'zustand';
import { unzipSync } from 'fflate';
import { toast } from '@/ui';
import { putCover, updateBook } from '@/storage/db';
import { detectFormat } from '@/formats';
import { AuthRequiredError, correctExt, downloadFile, type CatalogAuth } from './opds-client';
import { downloadName } from './opds';
import { fetchImageBlob, makeThumb } from './covers';
import { extOf, importFile, stripExt } from './import';
import { safeFileName } from './format';
import { t } from './i18n';

export interface DlItem {
  id: string;
  title: string;
  author: string;
  url: string;
  ext?: string;
  size?: number;
  coverUrl?: string;
  catalog?: string;
  auth?: CatalogAuth;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  loaded: number;
  total: number;
  error?: string;
  bookId?: string;
  startedAt: number;
}

interface DlState {
  items: DlItem[];
}

export const useDownloads = create<DlState>(() => ({ items: [] }));
const controllers = new Map<string, AbortController>();
const MAX_PARALLEL = 2;
let seq = 0;

const patch = (id: string, p: Partial<DlItem>) => useDownloads.setState((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }));

export type DlRequest = Pick<DlItem, 'title' | 'url'> & Partial<Pick<DlItem, 'author' | 'ext' | 'size' | 'coverUrl' | 'catalog' | 'auth'>>;

export function enqueueDownload(req: DlRequest): string {
  const id = `dl${++seq}-${Date.now()}`;
  const item: DlItem = { id, author: '', status: 'queued', loaded: 0, total: req.size ?? 0, startedAt: Date.now(), ...req };
  useDownloads.setState((s) => ({ items: [item, ...s.items] }));
  pump();
  return id;
}

export function cancelDownload(id: string): void {
  controllers.get(id)?.abort();
  const it = useDownloads.getState().items.find((x) => x.id === id);
  if (it?.status === 'queued') patch(id, { status: 'cancelled' });
}

export function retryDownload(id: string): void {
  patch(id, { status: 'queued', error: undefined, loaded: 0 });
  pump();
}

export function clearFinishedDownloads(): void {
  useDownloads.setState((s) => ({ items: s.items.filter((x) => x.status === 'queued' || x.status === 'running') }));
}

function pump(): void {
  const { items } = useDownloads.getState();
  const running = items.filter((x) => x.status === 'running').length;
  const next = [...items].reverse().filter((x) => x.status === 'queued').slice(0, Math.max(0, MAX_PARALLEL - running));
  for (const it of next) void run(it);
}

/** 名字里的扩展名：优先响应头文件名，其次 URL 路径，最后请求里声明的 */
function pickName(it: DlItem, headerName: string | undefined, finalUrl: string): { name: string; ext: string } {
  let ext = it.ext ?? '';
  const fromHeader = headerName ? extOf(headerName) : '';
  const fromUrl = (() => {
    try {
      return extOf(decodeURIComponent(new URL(finalUrl).pathname));
    } catch {
      return '';
    }
  })();
  if (fromHeader) ext = fromHeader;
  else if (!ext && fromUrl) ext = fromUrl;
  const base = headerName && !it.title ? stripExt(headerName) : it.title || stripExt(headerName ?? fromUrl) || 'book';
  return { name: downloadName(safeFileName(base), it.author, ext || 'epub'), ext: ext || 'epub' };
}

async function run(it: DlItem): Promise<void> {
  const ctl = new AbortController();
  controllers.set(it.id, ctl);
  patch(it.id, { status: 'running' });
  try {
    const r = await downloadFile(it.url, {
      auth: it.auth,
      signal: ctl.signal,
      expectedSize: it.size,
      onProgress: (loaded, total) => patch(it.id, { loaded, total }),
    });
    if (/text\/html/i.test(r.contentType) && !/html?$/i.test(it.ext ?? '')) throw new Error('下载到的是网页而不是书籍文件');
    let { name, ext } = pickName(it, r.fileName, r.finalUrl);
    let blob = r.blob;
    const head = new Uint8Array(await blob.slice(0, 80).arrayBuffer());
    const fixed = correctExt(ext, head);
    if (fixed !== ext) {
      ext = fixed;
      name = name.replace(/\.[^.]+$/, '') + `.${fixed}`;
    }
    // zip/rar 压缩包：取第一本支持的书（getBookFromZip）
    if (ext === 'zip' && !detectFormat(name, head)) {
      const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (f) => !!detectFormat(f.name, undefined) });
      const first = Object.entries(files)[0];
      if (!first) throw new Error('压缩包里没有可识别的书籍文件');
      const inner = first[0].replace(/^.*\//, '');
      name = inner;
      blob = new Blob([first[1] as unknown as BlobPart]);
    }
    const file = new File([blob], name, { type: blob.type });
    const { book } = await importFile({ file }, { source: { kind: it.catalog ? 'opds' : 'url', url: it.url, catalog: it.catalog }, favorite: undefined });
    // 没有内置封面时用目录里的封面（NETCOVER）
    if (!book.hasCover && it.coverUrl) {
      try {
        const img = await fetchImageBlob(it.coverUrl);
        await putCover(book.id, 'net', await makeThumb(img));
        await updateBook(book.id, { hasCover: true });
      } catch {
        /* 封面可有可无 */
      }
    }
    patch(it.id, { status: 'done', bookId: book.id, loaded: file.size, total: file.size });
    toast(`${t('netDownloaded')} ${book.title}`, 3000);
  } catch (e) {
    if (ctl.signal.aborted) patch(it.id, { status: 'cancelled' });
    else {
      const msg = e instanceof AuthRequiredError ? '需要登录（请在书库设置里填写用户名密码）' : (e as Error).message;
      patch(it.id, { status: 'error', error: msg });
      toast(t('netDownloadFailed', { msg }), 3500);
    }
  } finally {
    controllers.delete(it.id);
    pump();
  }
}
