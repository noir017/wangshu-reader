// 命令式弹层：toast()、confirmDialog()、promptDialog()、chooseDialog()、popupMenu()。
// App 根部挂一次 <OverlayHost />，任何模块都能直接调用这些函数（不需要自己管理 open 状态）。
import { useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Button, Row, Sheet, TextInput } from './components';
import { defineMessages } from '@/core/i18n';
import s from './ui.module.css';

const t = defineMessages({
  zh: { ok: '确定', cancel: '取消' },
  en: { ok: 'OK', cancel: 'Cancel' },
});

interface Toast {
  id: number;
  text: string;
}
type Overlay = { id: number; render: (close: () => void) => ReactNode };

const useOverlay = create<{ toasts: Toast[]; overlays: Overlay[] }>(() => ({ toasts: [], overlays: [] }));
let seq = 0;

export function toast(text: string, ms = 2200): void {
  const id = ++seq;
  useOverlay.setState((st) => ({ toasts: [...st.toasts, { id, text }] }));
  setTimeout(() => useOverlay.setState((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) })), ms);
}

/** 打开任意自定义弹层，返回关闭函数 */
export function openOverlay(render: (close: () => void) => ReactNode): () => void {
  const id = ++seq;
  const close = () => useOverlay.setState((st) => ({ overlays: st.overlays.filter((o) => o.id !== id) }));
  useOverlay.setState((st) => ({ overlays: [...st.overlays, { id, render }] }));
  return close;
}

export function confirmDialog(message: ReactNode, opts: { title?: string; okText?: string; cancelText?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    openOverlay((close) => {
      const done = (v: boolean) => {
        close();
        resolve(v);
      };
      return (
        <Sheet
          open
          position="center"
          title={opts.title ?? ''}
          onClose={() => done(false)}
          actions={
            <>
              <Button onClick={() => done(false)}>{opts.cancelText ?? t('cancel')}</Button>
              <Button primary onClick={() => done(true)}>
                {opts.okText ?? t('ok')}
              </Button>
            </>
          }
        >
          <div style={{ padding: '12px 16px', lineHeight: 1.6 }}>{message}</div>
        </Sheet>
      );
    });
  });
}

function PromptBody(props: { initial: string; placeholder?: string; type?: string; onDone: (v: string | null) => void; title: string }) {
  const [v, setV] = useState(props.initial);
  return (
    <Sheet
      open
      position="center"
      title={props.title}
      onClose={() => props.onDone(null)}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('cancel')}</Button>
          <Button primary onClick={() => props.onDone(v)}>
            {t('ok')}
          </Button>
        </>
      }
    >
      <div style={{ padding: '12px 16px' }}>
        <TextInput value={v} onChange={setV} placeholder={props.placeholder} type={props.type} autoFocus onEnter={() => props.onDone(v)} />
      </div>
    </Sheet>
  );
}

export function promptDialog(title: string, initial = '', opts: { placeholder?: string; type?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    openOverlay((close) => (
      <PromptBody
        title={title}
        initial={initial}
        placeholder={opts.placeholder}
        type={opts.type}
        onDone={(v) => {
          close();
          resolve(v);
        }}
      />
    ));
  });
}

/** 单选列表对话框，返回选中项的 value；取消返回 null */
export function chooseDialog<T>(title: string, items: { value: T; label: ReactNode; subtitle?: ReactNode; icon?: ReactNode }[]): Promise<T | null> {
  return new Promise((resolve) => {
    openOverlay((close) => {
      const done = (v: T | null) => {
        close();
        resolve(v);
      };
      return (
        <Sheet open position="center" title={title} onClose={() => done(null)}>
          {items.map((it, i) => (
            <Row key={i} title={it.label} subtitle={it.subtitle} icon={it.icon} onClick={() => done(it.value)} />
          ))}
        </Sheet>
      );
    });
  });
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

/** 在 (x, y) 处弹出菜单（长按菜单、溢出菜单） */
export function popupMenu(x: number, y: number, items: MenuItem[]): void {
  openOverlay((close) => <PopupMenu x={x} y={y} items={items} close={close} />);
}

function PopupMenu(props: { x: number; y: number; items: MenuItem[]; close: () => void }) {
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useEffect(() => {
    const w = 220;
    const h = Math.min(props.items.length * 42 + 8, window.innerHeight * 0.7);
    setPos({
      left: Math.max(4, Math.min(props.x, window.innerWidth - w - 4)),
      top: Math.max(4, Math.min(props.y, window.innerHeight - h - 4)),
    });
  }, [props.x, props.y, props.items.length]);
  return (
    <div className={s.backdrop} style={{ background: 'transparent' }} onPointerDown={(e) => e.target === e.currentTarget && props.close()}>
      <div className={s.menu} style={pos} role="menu">
        {props.items.map((it, i) => (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={s.menuItem}
            disabled={it.disabled}
            onClick={() => {
              props.close();
              it.onSelect();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OverlayHost() {
  const { toasts, overlays } = useOverlay();
  return (
    <>
      {overlays.map((o) => (
        <OverlaySlot key={o.id} overlay={o} />
      ))}
      <div className={s.toastHost}>
        {toasts.map((x) => (
          <div key={x.id} className={s.toast}>
            {x.text}
          </div>
        ))}
      </div>
    </>
  );
}

function OverlaySlot({ overlay }: { overlay: Overlay }) {
  const close = () => useOverlay.setState((st) => ({ overlays: st.overlays.filter((o) => o.id !== overlay.id) }));
  return <>{overlay.render(close)}</>;
}
