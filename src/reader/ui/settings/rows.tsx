// 设置项行组件：绑定 defineSettings 的 slice；比通用 PrefXxx 多了「齿轮」入口、自定义写入与提示。
import { useRef, useState, type ReactNode } from 'react';
import { RotateCcw, Settings } from 'lucide-react';
import type { SettingsSlice } from '@/core/settings';
import { ColorPicker, GroupTitle, Row, Select, Sheet, Slider, Switch, openOverlay } from '@/ui';
import s from '../reader-ui.module.css';
import { t } from '../messages';

type Values = Record<string, unknown>;
type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T] & string;

export const Section = GroupTitle;

export function GearButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className={s.rowGear}
      aria-label={label ?? t('settings_gear')}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Settings size={18} />
    </button>
  );
}

/** 开关行；onSet 覆盖默认写入（需要联动时用）；onGear 显示右侧齿轮 */
export function SwitchRow<T extends Values>(p: {
  slice: SettingsSlice<T>;
  k: KeysOfType<T, boolean>;
  title: ReactNode;
  subtitle?: ReactNode;
  onSet?: (v: boolean) => void;
  onGear?: () => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  const v = p.slice.use((st) => st[p.k] as boolean);
  const set = (nv: boolean) => (p.onSet ? p.onSet(nv) : p.slice.set({ [p.k]: nv } as Partial<T>));
  return (
    <div className={p.indent ? s.sub : undefined}>
      <Row
        title={p.title}
        subtitle={p.subtitle}
        disabled={p.disabled}
        onClick={() => set(!v)}
        right={
          <>
            {p.onGear && <GearButton onClick={p.onGear} />}
            <Switch checked={v} onChange={set} disabled={p.disabled} />
          </>
        }
      />
    </div>
  );
}

export function SelectRow<T extends Values, K extends keyof T & string>(p: {
  slice: SettingsSlice<T>;
  k: K;
  title: ReactNode;
  subtitle?: ReactNode;
  options: { value: Extract<T[K], string | number>; label: string }[];
  onSet?: (v: Extract<T[K], string | number>) => void;
  disabled?: boolean;
}) {
  type V = Extract<T[K], string | number>;
  const v = p.slice.use((st) => st[p.k] as V);
  return (
    <Row
      title={p.title}
      subtitle={p.subtitle}
      disabled={p.disabled}
      right={<Select value={v} options={p.options} onChange={(nv) => (p.onSet ? p.onSet(nv) : p.slice.set({ [p.k]: nv } as unknown as Partial<T>))} />}
    />
  );
}

/** 不绑 slice 的下拉（如 keyMap 的某一项） */
export function PlainSelectRow<V extends string | number>(p: { title: ReactNode; subtitle?: ReactNode; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return <Row title={p.title} subtitle={p.subtitle} right={<Select value={p.value} options={p.options} onChange={p.onChange} />} />;
}

export function SliderRow<T extends Values>(p: {
  slice: SettingsSlice<T>;
  k: KeysOfType<T, number>;
  title: ReactNode;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  /** 存储值 → 滑条值 / 滑条值 → 存储值（段距显示 ×10 之类） */
  toSlider?: (v: number) => number;
  fromSlider?: (v: number) => number;
  onSet?: (v: number) => void;
  disabled?: boolean;
}) {
  const stored = p.slice.use((st) => st[p.k] as number);
  const to = p.toSlider ?? ((v: number) => v);
  const from = p.fromSlider ?? ((v: number) => v);
  return (
    <Slider
      label={p.title}
      value={to(stored)}
      min={p.min}
      max={p.max}
      step={p.step}
      disabled={p.disabled}
      format={p.format}
      onChange={(sv) => (p.onSet ? p.onSet(from(sv)) : p.slice.set({ [p.k]: from(sv) } as Partial<T>))}
    />
  );
}

export function ResetRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className={s.resetRow}>
      <span>{label}</span>
      <button type="button" className={s.rowGear} aria-label={label} onClick={onClick}>
        <RotateCcw size={18} />
      </button>
    </div>
  );
}

export function NoteText({ children }: { children: ReactNode }) {
  return <div className={s.noteText}>{children}</div>;
}

/** 颜色行：点开取色器；onChange 额外回调（选背景色后自动调字色等） */
export function ColorRow<T extends Values>(p: {
  slice: SettingsSlice<T>;
  k: KeysOfType<T, string>;
  title: string;
  presets?: string[];
  onSet?: (v: string) => void;
  right?: ReactNode;
}) {
  const v = p.slice.use((st) => st[p.k] as string);
  return (
    <Row
      title={p.title}
      right={
        <>
          {p.right}
          <span className={s.swatch} style={{ background: v }} />
        </>
      }
      onClick={() => openOverlay((close) => <ColorSheet {...p} close={close} />)}
    />
  );
}

function ColorSheet<T extends Values>(p: { slice: SettingsSlice<T>; k: KeysOfType<T, string>; title: string; presets?: string[]; onSet?: (v: string) => void; close: () => void }) {
  const v = p.slice.use((st) => st[p.k] as string);
  return (
    <Sheet open position="center" title={p.title} onClose={p.close}>
      <ColorPicker value={v} presets={p.presets} onChange={(nv) => (p.onSet ? p.onSet(nv) : p.slice.set({ [p.k]: nv } as Partial<T>))} />
    </Sheet>
  );
}

/** 带本地草稿的滑条：拖动时只更新本地值，去抖后才写设置（重排开销大的字号等用） */
export function useDebouncedCommit<V>(commit: (v: V) => void, ms = 200): { run: (v: V) => void; flush: (v: V) => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return {
    run: (v: V) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(v), ms);
    },
    flush: (v: V) => {
      clearTimeout(timer.current);
      commit(v);
    },
  };
}

export function useLocalDraft<V>(external: V): [V, (v: V) => void] {
  const [draft, setDraft] = useState<V | undefined>(undefined);
  return [draft === undefined ? external : draft, (v) => setDraft(v)];
}
