// 书架模块自用的小组件（对话框外壳、表单控件、空状态）。通用基础组件在 @/ui，这里只放本模块专用的。
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '@/ui';
import s from './library.module.css';
import { t } from './i18n';

/** 全屏对话框（原 app 的「选项」「导入书籍」「书籍信息」都是全屏）。宽屏下居中成卡片 */
export function FullDialog(props: {
  title: ReactNode;
  onClose: () => void;
  right?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** 宽屏下卡片宽度 */
  width?: number;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className={s.fullBackdrop} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.fullDialog} style={props.width ? { maxWidth: props.width } : undefined} role="dialog" aria-modal="true">
        <div className={s.fullHeader}>
          <IconButton label={t('back')} onClick={onClose}>
            <ArrowLeft size={22} />
          </IconButton>
          <div className={s.fullTitle}>{props.title}</div>
          {props.right}
        </div>
        <div className={s.fullBody}>{props.children}</div>
        {props.actions && <div className={s.fullActions}>{props.actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Field(props: { label?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={s.field}>
      {props.label && <span className={s.fieldLabel}>{props.label}</span>}
      {props.children}
      {props.hint && <span className={s.fieldHint}>{props.hint}</span>}
    </label>
  );
}

export function TextField(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  rows?: number;
  autoFocus?: boolean;
  onEnter?: () => void;
  disabled?: boolean;
  inputMode?: 'text' | 'numeric' | 'url';
}) {
  if (props.rows && props.rows > 1) {
    return (
      <textarea
        className={s.textField}
        rows={props.rows}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      className={s.textField}
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      disabled={props.disabled}
      inputMode={props.inputMode}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && props.onEnter?.()}
    />
  );
}

export function CheckBox(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={s.check} data-disabled={props.disabled ? 'true' : undefined}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Empty(props: { icon?: ReactNode; text: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      {props.icon}
      <div>{props.text}</div>
      {props.children}
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <span className={s.spinner} style={{ width: size, height: size }} aria-label={t('loading')} />;
}

export function ProgressLine({ value }: { value: number }) {
  return (
    <div className={s.progressLine}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}
