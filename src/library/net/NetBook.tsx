// 网络书籍详情（NBI，NET-004）：封面、书名、作者、简介、可下载格式与大小、下载/阅读
import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { BookOpen, Download, ExternalLink } from 'lucide-react';
import { Button, openOverlay } from '@/ui';
import { FullDialog } from '../ui-kit';
import { NetImage } from './NetImage';
import { formatSize } from '../format';
import { probeSize } from '../opds-client';
import { downloadName, resolveHref, type OpdsDownload, type OpdsEntry } from '../opds';
import { enqueueDownload, useDownloads } from '../downloads';
import { goRead } from '../actions';
import { catalogTitle, type Catalog } from '../catalogs';
import { present } from '../dialogs';
import { Sheet, Row } from '@/ui';
import { t } from '../i18n';
import s from '../library.module.css';

export function openNetBook(entry: OpdsEntry, base: string, catalog?: Catalog): void {
  openOverlay((close) => <NetBook entry={entry} base={base} catalog={catalog} onClose={close} />);
}

/** 简介清洗：只留基本排版标签；链接改成绝对地址并在新标签页打开 */
export function sanitizeSummary(html: string, base: string): string {
  const hook = (node: Element) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href');
      if (href) node.setAttribute('href', resolveHref(base, href) || href);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  };
  DOMPurify.addHook('afterSanitizeAttributes', hook);
  try {
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'ul', 'ol', 'li', 'a', 'div', 'span', 'blockquote', 'h1', 'h2', 'h3', 'h4'], ALLOWED_ATTR: ['href', 'target', 'rel'] });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}

/** 默认格式：epub，没有就第一个（原行为） */
export function defaultDownload(list: OpdsDownload[]): OpdsDownload | undefined {
  return list.find((d) => d.ext === 'epub') ?? list[0];
}

function NetBook(props: { entry: OpdsEntry; base: string; catalog?: Catalog; onClose: () => void }) {
  const { entry, catalog } = props;
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const items = useDownloads((st) => st.items);
  const auth = useMemo(() => ({ userAgent: catalog?.userAgent, username: catalog?.username, password: catalog?.password }), [catalog]);
  const html = useMemo(() => sanitizeSummary(entry.summaryHtml, props.base), [entry.summaryHtml, props.base]);

  useEffect(() => {
    let live = true;
    for (const d of entry.downloads) {
      if (d.size) continue;
      void probeSize(d.href, auth).then((n) => n && live && setSizes((p) => ({ ...p, [d.href]: n })));
    }
    return () => {
      live = false;
    };
  }, [entry, auth]);

  const sizeOf = (d: OpdsDownload) => d.size ?? sizes[d.href];
  const label = (d: OpdsDownload) => `${d.ext}${sizeOf(d) ? ` (${formatSize(sizeOf(d)!)})` : ''}${d.title ? ` · ${d.title}` : ''}`;
  const author = entry.authors.join(', ');
  const done = entry.downloads.map((d) => items.find((x) => x.url === d.href && x.status === 'done')).find(Boolean);
  const running = entry.downloads.some((d) => items.some((x) => x.url === d.href && (x.status === 'running' || x.status === 'queued')));

  const start = (d: OpdsDownload) => {
    enqueueDownload({ title: entry.title, author, url: d.href, ext: d.ext, size: sizeOf(d), coverUrl: entry.cover ?? entry.thumb, catalog: catalog && catalogTitle(catalog), auth });
  };
  const download = async () => {
    if (entry.downloads.length === 1) return start(entry.downloads[0]);
    const def = defaultDownload(entry.downloads);
    const chosen = await present<OpdsDownload>((d) => (
      <Sheet open position="center" title={t('netDownload')} onClose={() => d(null)}>
        {entry.downloads.map((x, i) => (
          <Row key={x.href} title={t('netDownloadN', { n: i + 1, ext: label(x) })} subtitle={x === def ? '★' : undefined} onClick={() => d(x)} />
        ))}
      </Sheet>
    ));
    if (chosen) start(chosen);
  };

  return (
    <FullDialog title={catalog ? catalogTitle(catalog) : t('netTitle')} onClose={props.onClose} width={640}>
      <div style={{ display: 'flex', gap: 14, padding: 16 }}>
        <div style={{ width: 110, flex: 'none' }}>
          <span className={s.cover}>
            <NetImage src={entry.cover ?? entry.thumb} />
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{entry.title}</div>
          {author && <div className={s.dim} style={{ marginTop: 4 }}>{author}</div>}
          {entry.downloads.length > 0 && (
            <div className={s.dim} style={{ fontSize: 13, marginTop: 10 }}>
              {t('netAvailableFormats')} {entry.downloads.map((d) => `${d.ext}${sizeOf(d) ? ` (${formatSize(sizeOf(d)!)})` : ''}`).join(', ')}
            </div>
          )}
        </div>
      </div>
      <div className={s.btnRow}>
        <Button primary disabled={!entry.downloads.length || running} onClick={() => void download()}>
          <Download size={15} style={{ verticalAlign: -3 }} /> {running ? t('netDownloading') : t('netDownload')}
        </Button>
        <Button disabled={!done?.bookId} onClick={() => done?.bookId && (props.onClose(), goRead(done.bookId))}>
          <BookOpen size={15} style={{ verticalAlign: -3 }} /> {t('netRead')}
        </Button>
        {entry.alternate && (
          <Button onClick={() => window.open(entry.alternate, '_blank', 'noopener')}>
            <ExternalLink size={15} style={{ verticalAlign: -3 }} /> {t('netOpenBrowser')}
          </Button>
        )}
      </div>
      {html && (
        <div
          className={s.pad}
          style={{ lineHeight: 1.65, fontSize: 14.5, wordBreak: 'break-word' }}
          // 已经过 DOMPurify 清洗（只留基本排版标签与 a[href]）
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {entry.downloads.length > 0 && (
        <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 12, wordBreak: 'break-all' }}>
          {t('netDownload')}: {entry.downloads.map((d) => downloadName(entry.title, author, d.ext)).join(' / ')}
        </div>
      )}
    </FullDialog>
  );
}
