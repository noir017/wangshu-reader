import { Check, Pin } from 'lucide-react';
import type { BookRecord } from '@/core/library';
import { useCoverUrl } from './covers';
import s from './library.module.css';

/** 书封面：真实封面或程序生成的占位图；可叠加置顶图钉、进度圆环、选中蒙层 */
export function BookCover(props: {
  book: BookRecord;
  gauge?: boolean;
  selected?: boolean;
  className?: string;
  draggable?: boolean;
}) {
  const { book } = props;
  const { url } = useCoverUrl(book);
  const pct = book.progress === undefined ? undefined : Math.round(book.progress * 100);
  return (
    <span className={`${s.cover} ${props.className ?? ''}`}>
      <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />
      {book.pinnedAt ? (
        <span className={s.pin}>
          <Pin size={12} />
        </span>
      ) : null}
      {props.gauge && pct !== undefined && (
        <span className={s.coverGauge} style={{ ['--p' as string]: pct }}>
          <span>{pct}</span>
        </span>
      )}
      {props.selected && (
        <span className={s.tick}>
          <Check size={20} />
        </span>
      )}
    </span>
  );
}
