// 侧滑抽屉：左侧滑出 85% 宽（TOC-001），点遮罩/Esc 关闭。header 内容由调用方给（标签页、按钮）。
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import css from './drawer.module.css';

export function Drawer(props: { onClose: () => void; header: ReactNode; children: ReactNode; footer?: ReactNode; testId?: string; side?: 'left' | 'right' }) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className={css.backdrop} data-side={props.side ?? 'left'} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.drawer} role="dialog" aria-modal="true" data-testid={props.testId}>
        <div className={css.header}>{props.header}</div>
        <div className={css.body}>{props.children}</div>
        {props.footer && <div className={css.footer}>{props.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
