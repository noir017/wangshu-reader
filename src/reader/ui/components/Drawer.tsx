// 设置抽屉：手机竖屏为底部半屏（上半屏留给正文预览），宽屏为右侧整高抽屉。
// 背景透明（原版 dimAmount=0），点抽屉外关闭；修改即时生效，关闭即保存（设置本身是即时落盘的）。
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from '@/ui';
import s from '../reader-ui.module.css';

export function Drawer(props: {
  title: ReactNode;
  onClose: () => void;
  /** 底部两个切换按钮（可视/控制/其它选项互跳） */
  footer?: { label: string; onClick: () => void }[];
  children: ReactNode;
  /** 抽屉里可能再开 openOverlay 弹层（z-index 1000）：Esc 交给最上层 */
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 取色器等 openOverlay 弹层在最上面时，它们自己处理 Esc
      if (document.querySelector('[role="dialog"]')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      className={s.drawerWrap}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={s.drawer} role="complementary">
        <div className={s.drawerHead}>
          <div className={s.drawerTitle}>{props.title}</div>
          <IconButton label="close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className={s.drawerBody}>{props.children}</div>
        {props.footer && (
          <div className={s.drawerFoot}>
            {props.footer.map((f) => (
              <button key={f.label} type="button" className={s.footBtn} onClick={f.onClick}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
