// 固定版式（PDF/漫画）的缩略图条与滚动锁定按钮（PDF-008）。缩略图用 book.renderPage 懒渲染低分辨率页面。
import { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import type { FixedBook } from '@/core/book';
import { fixedSettings } from '@/reader/settings';
import { toast } from '@/ui';
import { useReaderUi } from '../store';
import { t } from '../messages';
import s from '../reader-ui.module.css';

const TW = 48;

function Thumb({ book, index, active, onGo }: { book: FixedBook; index: number; active: boolean; onGo: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setShown(true), undefined;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!shown) return;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const size = await book.getPageSize(index);
        const h = Math.round((TW * size.height) / size.width);
        const img = await book.renderPage(index, { width: TW, height: h, dpr: Math.min(2, window.devicePixelRatio || 1), signal: ctrl.signal });
        const c = canvas.current;
        if (!c || ctrl.signal.aborted) return;
        c.width = TW * 2;
        c.height = h * 2;
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      } catch {
        /* 取消或渲染失败：留白 */
      }
    })();
    return () => ctrl.abort();
  }, [shown, book, index]);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active]);

  return (
    <button ref={ref} type="button" className={s.thumbItem} data-active={active ? 'true' : undefined} onClick={onGo} aria-label={`${index + 1}`}>
      <canvas ref={canvas} />
      <span className={s.thumbNo}>{index + 1}</span>
    </button>
  );
}

export function ThumbStrip() {
  const session = useReaderUi((x) => x.session);
  const loc = useReaderUi((x) => x.loc);
  const show = fixedSettings.use((f) => f.pdfShowThumb);
  const book = session?.book;
  if (!show || !session || !book || book.kind !== 'fixed') return null;
  return (
    <div className={s.thumbStrip}>
      {Array.from({ length: book.pageCount }, (_, i) => (
        <Thumb key={i} book={book} index={i} active={loc?.section === i} onGo={() => void session.controller.goTo({ section: i })} />
      ))}
    </div>
  );
}

/** 右下角滚动锁定：锁住横向平移，防误触 */
export function ScrollLock() {
  const fixed = useReaderUi((x) => x.session?.book.kind === 'fixed');
  const menu = useReaderUi((x) => x.menu);
  const locked = fixedSettings.use((f) => f.pdfScrollLock);
  if (!fixed || menu) return null;
  return (
    <button
      type="button"
      className={s.lockBtn}
      aria-label={t('pdf_scroll_lock')}
      onClick={() => {
        fixedSettings.set({ pdfScrollLock: !locked });
        toast(locked ? t('pdf_horiz_unlock') : t('pdf_horiz_lock'));
      }}
    >
      {locked ? <Lock size={20} /> : <LockOpen size={20} />}
    </button>
  );
}
