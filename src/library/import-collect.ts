// 收集待导入的文件：文件选择框、整个文件夹（webkitdirectory）、拖放（含文件夹）。
import type { ImportItem } from './import';

/** 弹出系统文件选择框。取消返回空数组（取消事件在老浏览器不触发，所以用 focus 回来后的延迟判断兜底） */
export function pickFiles(opts: { accept?: string[]; multiple?: boolean; directory?: boolean } = {}): Promise<ImportItem[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    if (opts.multiple !== false) input.multiple = true;
    if (opts.directory) input.setAttribute('webkitdirectory', '');
    if (opts.accept?.length) input.accept = opts.accept.map((e) => `.${e}`).join(',');
    let done = false;
    const finish = (items: ImportItem[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(items);
    };
    input.addEventListener('change', () => finish(itemsFromFileList(input.files)));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export function itemsFromFileList(list: FileList | null | undefined): ImportItem[] {
  if (!list) return [];
  return [...list].map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const i = rel.lastIndexOf('/');
    return { file, dir: i > 0 ? rel.slice(0, i) : undefined };
  });
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

async function walkEntry(entry: FsEntry, dir: string, out: ImportItem[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, err) => entry.file!(ok, err));
    out.push({ file, dir: dir || undefined });
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const sub = dir ? `${dir}/${entry.name}` : entry.name;
    // readEntries 每次最多返回 100 条，要循环到空为止
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (!batch.length) break;
      for (const e of batch) await walkEntry(e, sub, out);
    }
  }
}

/** 拖放：展开文件夹，返回所有文件 */
export async function itemsFromDrop(dt: DataTransfer): Promise<ImportItem[]> {
  const out: ImportItem[] = [];
  const entries: FsEntry[] = [];
  for (const it of [...dt.items]) {
    const e = (it as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  if (entries.length) {
    for (const e of entries) await walkEntry(e, '', out);
    return out;
  }
  return [...dt.files].map((file) => ({ file }));
}
