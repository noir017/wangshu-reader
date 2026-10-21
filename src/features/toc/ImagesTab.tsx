// 图片标签页（TOC-006）：缩略图网格；点击定位到图片所在位置，长按打开看图器。
import { useEffect, useMemo, useState } from 'react';
import type { ReaderSession } from '@/core/reader-session';
import { offsetOfPoint } from '@/core/text';
import { useLongPress } from '../common/hooks';
import feat from '../common/features.module.css';
import css from './toc.module.css';
import { scanBookImages, type BookImage } from './images';
import { tt } from './messages';

async function jumpToImage(session: ReaderSession, img: BookImage): Promise<void> {
  const { book, controller } = session;
  if (book.kind !== 'reflowable') return;
  try {
    const content = await book.sections[img.section].load();
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${content.bodyHtml}</body></html>`, 'text/html');
    const el = [...doc.querySelectorAll('img, image')][img.index];
    if (el) {
      await controller.goTo({ section: img.section, offset: offsetOfPoint(doc.body, el, 0) });
      return;
    }
  } catch {
    /* 退回到章首 */
  }
  await controller.goTo({ section: img.section, offset: 0 });
}

function Thumb({ img, session, onClose, n }: { img: BookImage; session: ReaderSession; onClose: () => void; n: number }) {
  const lp = useLongPress(() => {
    onClose();
    session.bus.emit('image.open', { src: img.src });
  });
  return (
    <button
      type="button"
      className={css.thumb}
      data-testid="image-thumb"
      {...lp.bind}
      onClick={() => {
        if (lp.consumed()) return;
        onClose();
        void jumpToImage(session, img);
      }}
    >
      <img src={img.src} loading="lazy" alt="" draggable={false} />
      <span className={css.thumbLabel}>{tt('imageAt', { n })}</span>
    </button>
  );
}

export function ImagesTab({ session, reversed, onClose }: { session: ReaderSession; reversed: boolean; onClose: () => void }) {
  const [list, setList] = useState<BookImage[] | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 1]);
  useEffect(() => {
    const ac = new AbortController();
    scanBookImages(session.book, { signal: ac.signal, onProgress: (d, t) => setProgress([d, t]) })
      .then(setList)
      .catch(() => undefined);
    return () => ac.abort();
  }, [session.book]);
  const shown = useMemo(() => {
    if (!list) return [];
    const withN = list.map((img, i) => ({ img, n: i + 1 }));
    return reversed ? withN.reverse() : withN;
  }, [list, reversed]);

  if (!list) return <div className={feat.empty}>{tt('scanning', { n: progress[0], total: progress[1] })}</div>;
  if (!list.length) return <div className={feat.empty}>{tt('imagesEmpty')}</div>;
  return (
    <div className={css.grid} data-testid="image-grid">
      {shown.map(({ img, n }) => (
        <Thumb key={`${img.section}-${img.index}`} img={img} n={n} session={session} onClose={onClose} />
      ))}
    </div>
  );
}
