// 标注导出/分享/导入入口（ANNO-010）：文本、Markdown、HTML、.mrexpt；分享用 Web Share API，不支持时复制/下载。
import { appSettings } from '@/core/app-settings';
import type { AnnotationRecord } from '@/core/library';
import type { ReaderSession } from '@/core/reader-session';
import { getCover } from '@/storage/db';
import { chooseDialog, confirmDialog, toast } from '@/ui';
import { copyText, downloadText, shareFile, shareText } from '../common/clipboard';
import { tc } from '../common/messages';
import { annoSettings } from '../annotations/settings';
import { currentAnnotations } from '../annotations/store';
import { importMrexpt, sizeMatches } from './import';
import { te } from './messages';
import { annotationsToMrexpt, encodeMrexpt, MrexptError, parseMrexpt } from './mrexpt';
import { buildShareText, countKinds, SHARE_TEXT_LIMIT, selectForShare, type ExportFormat } from './text-export';

type Action = 'share' | 'copy' | 'cover' | 'markdown' | 'html' | 'mrexpt' | 'import';

function shareCtx(session: ReaderSession) {
  return {
    title: session.record.title,
    author: session.record.authors.join(', '),
    withChapter: annoSettings.get().shareWithChapter,
    lang: appSettings.get().language,
  };
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'book';
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    // 用户取消选择时部分浏览器不触发 change；cancel 事件（较新浏览器）兜底
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * items：文本类导出的内容（列表里勾选了就是勾选项，否则当前筛选结果）；selectedCount 仅用于提示。
 * allItems：.mrexpt 导出的内容（没有勾选时导出全部标注含书签，方便当备份）。
 */
export async function openExportMenu(session: ReaderSession, items: AnnotationRecord[], selectedCount = 0, allItems: AnnotationRecord[] = items): Promise<void> {
  const title = te('title') + (selectedCount ? ' ' + te('exportSelected', { n: selectedCount }) : '');
  const action = await chooseDialog<Action>(title, [
    { value: 'share', label: te('shareText') },
    { value: 'copy', label: te('copyText') },
    { value: 'cover', label: te('shareCover') },
    { value: 'markdown', label: te('markdown') },
    { value: 'html', label: te('html') },
    { value: 'mrexpt', label: te('toFile') },
    { value: 'import', label: te('fromFile') },
  ]);
  if (!action) return;
  if (action === 'import') return importFromFile(session);

  const ctx = shareCtx(session);
  const kinds = countKinds(selectForShare(items, false));
  if (action !== 'mrexpt' && kinds.highlights + kinds.notes === 0) {
    toast(te('nothing'));
    return;
  }
  const base = safeName(session.record.title);
  const asText = (fmt: ExportFormat) => buildShareText(items, ctx, fmt);

  switch (action) {
    case 'share':
    case 'cover': {
      const text = asText('text');
      if (text.length > SHARE_TEXT_LIMIT) {
        const copy = await confirmDialog(te('tooLong'), { title: te('tooLongTitle'), okText: te('copyBtn'), cancelText: te('saveBtn') });
        if (copy) toast((await copyText(text)) ? te('copied') : tc('copyFailed'));
        else downloadText(`${base}.txt`, text);
        return;
      }
      if (action === 'cover') {
        const cover = (await getCover(session.bookId, 'cover')) ?? (await getCover(session.bookId, 'thumb'));
        if (cover && (await shareFile(new File([cover], `${base}.jpg`, { type: cover.type || 'image/jpeg' }), ctx.title))) return;
      }
      const r = await shareText(text, ctx.title);
      if (r === 'copied') toast(te('copied'));
      else if (r === 'failed') downloadText(`${base}.txt`, text);
      return;
    }
    case 'copy': {
      toast((await copyText(asText('text'))) ? te('copied') : tc('copyFailed'));
      return;
    }
    case 'markdown':
      downloadText(`${base}.md`, asText('markdown'), 'text/markdown');
      toast(te('saved'));
      return;
    case 'html':
      downloadText(`${base}.html`, asText('html'), 'text/html');
      toast(te('saved'));
      return;
    case 'mrexpt': {
      const rows = selectedCount ? items : allItems;
      if (!rows.length) {
        toast(te('nothing'));
        return;
      }
      const file = annotationsToMrexpt(rows, {
        title: session.record.title,
        fileName: session.record.fileName,
        size: session.record.size,
        defaultHighlightColor: annoSettings.get().highlightColor,
      });
      downloadText(`${base}.mrexpt`, encodeMrexpt(file));
      toast(te('saved'));
    }
  }
}

async function importFromFile(session: ReaderSession): Promise<void> {
  const f = await pickFile('.mrexpt,.txt,text/plain');
  if (!f) return;
  let parsed;
  try {
    parsed = parseMrexpt(await f.text());
  } catch (e) {
    toast(e instanceof MrexptError ? te('importFailedNotMrexpt') : (e as Error).message);
    return;
  }
  if (!parsed.records.length) {
    toast(te('importNothing'));
    return;
  }
  if (!sizeMatches(parsed, session.record.size)) {
    const ok = await confirmDialog(te('importNotSameFile', { a: parsed.size, b: session.record.size }), { title: te('importNotSameTitle') });
    if (!ok) return;
  }
  toast(te('importProgress', { i: 0, n: parsed.records.length }), 1500);
  const sum = await importMrexpt(session, parsed, currentAnnotations());
  toast(te('importDone', sum as unknown as Record<string, number>), 4000);
}
