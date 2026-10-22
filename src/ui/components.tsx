// 通用界面组件。业务模块直接 import { Sheet, Row, ... } from '@/ui'。
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { defineMessages } from '@/core/i18n';
import s from './ui.module.css';

const t = defineMessages({
  zh: { close: '关闭' },
  en: { close: 'Close' },
});

export { s as uiStyles };

/** 弹层：底部抽屉 / 居中对话框 / 侧边栏。点遮罩或按 Esc 关闭 */
export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  position?: 'bottom' | 'center' | 'left' | 'right';
  headerRight?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** 遮罩透明（阅读页上的设置面板要能看见正文效果） */
  transparentBackdrop?: boolean;
  className?: string;
}) {
  const { open, onClose } = props;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      className={s.backdrop}
      data-pos={props.position ?? 'bottom'}
      style={props.transparentBackdrop ? { background: 'transparent' } : undefined}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${s.sheet} ${props.className ?? ''}`} role="dialog" aria-modal="true">
        {props.title !== undefined && (
          <div className={s.sheetHeader}>
            <div className={s.sheetTitle}>{props.title}</div>
            {props.headerRight}
            <IconButton label={t('close')} onClick={onClose}>
              <X size={20} />
            </IconButton>
          </div>
        )}
        <div className={s.sheetBody}>{props.children}</div>
        {props.actions && <div className={s.sheetActions}>{props.actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={props.type ?? 'button'}
      className={`${s.btn} ${props.primary ? s.btnPrimary : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function IconButton(props: {
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      className={s.iconBtn}
      aria-label={props.label}
      title={props.label}
      data-active={props.active ? 'true' : undefined}
      disabled={props.disabled}
      onClick={props.onClick}
      style={props.style}
    >
      {props.children}
    </button>
  );
}

/** 列表行：设置项、菜单项、书籍信息行通用 */
export function Row(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={s.row}
      data-clickable={props.onClick ? 'true' : undefined}
      data-disabled={props.disabled ? 'true' : undefined}
      onClick={props.disabled ? undefined : props.onClick}
      role={props.onClick ? 'button' : undefined}
    >
      {props.icon && <span className={s.rowIcon}>{props.icon}</span>}
      <div className={s.rowText}>
        <div className={s.rowTitle}>{props.title}</div>
        {props.subtitle && <div className={s.rowSub}>{props.subtitle}</div>}
      </div>
      {props.right !== undefined && <div className={s.rowRight}>{props.right}</div>}
    </div>
  );
}

export function GroupTitle({ children }: { children: ReactNode }) {
  return <div className={s.groupTitle}>{children}</div>;
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-label={props.label}
      className={s.switch}
      checked={props.checked}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function Slider(props: {
  label?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** 拖动结束（松手）时回调，用于开销大的重排 */
  onCommit?: (v: number) => void;
  format?: (v: number) => string;
  left?: ReactNode;
  right?: ReactNode;
  disabled?: boolean;
}) {
  const input = (
    <input
      type="range"
      className={s.slider}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(Number(e.target.value))}
      onPointerUp={(e) => props.onCommit?.(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => props.onCommit?.(Number((e.target as HTMLInputElement).value))}
    />
  );
  return (
    <div className={s.sliderRow}>
      {props.label !== undefined && (
        <div className={s.sliderHead}>
          <span>{props.label}</span>
          <span className={s.sliderValue}>{props.format ? props.format(props.value) : props.value}</span>
        </div>
      )}
      <div className={s.sliderLine}>
        {props.left}
        {input}
        {props.right}
      </div>
    </div>
  );
}

export function Select<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className={s.select}
      value={String(props.value)}
      disabled={props.disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const opt = props.options.find((o) => String(o.value) === e.target.value);
        if (opt) props.onChange(opt.value);
      }}
    >
      {props.options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={s.segmented} role="radiogroup">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          data-active={o.value === props.value ? 'true' : undefined}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, [props.autoFocus]);
  return (
    <input
      ref={ref}
      className={s.input}
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onEnter?.();
      }}
    />
  );
}

/** 颜色选择：预设色块 + 原生取色器 + 十六进制输入 */
export function ColorPicker(props: { value: string; onChange: (v: string) => void; presets?: string[] }) {
  const presets = props.presets ?? [
    '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff', '#f4ecd8', '#cce8cf',
    '#fff2e2', '#e3edcd', '#dce2f1', '#1e1e1e', '#ffeb3b', '#4caf50', '#2196f3', '#f44336',
  ];
  return (
    <div>
      <div className={s.swatches}>
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            className={s.swatch}
            style={{ background: c }}
            aria-label={c}
            data-active={c.toLowerCase() === props.value.toLowerCase() ? 'true' : undefined}
            onClick={() => props.onChange(c)}
          />
        ))}
      </div>
      <div className={s.row}>
        <input type="color" value={toHex6(props.value)} onChange={(e) => props.onChange(e.target.value)} />
        <TextInput value={props.value} onChange={props.onChange} />
      </div>
    </div>
  );
}

function toHex6(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : '#000000';
}
