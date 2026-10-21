// 设置项行组件：直接绑定 defineSettings 产生的 slice，写设置面板时一行一个。
//   <PrefSwitch slice={visual} k="justify" title="两端对齐" />
import type { ReactNode } from 'react';
import type { SettingsSlice } from '@/core/settings';
import { ColorPicker, Row, Select, Slider, Switch } from './components';
import { openOverlay } from './overlay';
import { Sheet } from './components';

type Values = Record<string, unknown>;
type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T] & string;

export function PrefSwitch<T extends Values>(p: {
  slice: SettingsSlice<T>;
  k: KeysOfType<T, boolean>;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const v = p.slice.use((s) => s[p.k] as boolean);
  const set = (nv: boolean) => p.slice.set({ [p.k]: nv } as Partial<T>);
  return (
    <Row
      title={p.title}
      subtitle={p.subtitle}
      icon={p.icon}
      disabled={p.disabled}
      onClick={() => set(!v)}
      right={<Switch checked={v} onChange={set} disabled={p.disabled} />}
    />
  );
}

export function PrefSlider<T extends Values>(p: {
  slice: SettingsSlice<T>;
  k: KeysOfType<T, number>;
  title: ReactNode;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const v = p.slice.use((s) => s[p.k] as number);
  return (
    <Slider
      label={p.title}
      value={v}
      min={p.min}
      max={p.max}
      step={p.step}
      format={p.format}
      disabled={p.disabled}
      onChange={(nv) => p.slice.set({ [p.k]: nv } as Partial<T>)}
    />
  );
}

export function PrefSelect<T extends Values, V extends string | number>(p: {
  slice: SettingsSlice<T>;
  k: KeysOfType<T, V>;
  title: ReactNode;
  subtitle?: ReactNode;
  options: { value: V; label: string }[];
  disabled?: boolean;
}) {
  const v = p.slice.use((s) => s[p.k] as V);
  return (
    <Row
      title={p.title}
      subtitle={p.subtitle}
      disabled={p.disabled}
      right={<Select value={v} options={p.options} onChange={(nv) => p.slice.set({ [p.k]: nv } as Partial<T>)} />}
    />
  );
}

export function PrefColor<T extends Values>(p: { slice: SettingsSlice<T>; k: KeysOfType<T, string>; title: ReactNode; presets?: string[] }) {
  const v = p.slice.use((s) => s[p.k] as string);
  return (
    <Row
      title={p.title}
      right={<span style={{ width: 24, height: 24, borderRadius: 4, background: v, border: '1px solid var(--mr-border)' }} />}
      onClick={() => openOverlay((close) => <ColorSheet {...p} close={close} />)}
    />
  );
}

// 弹层内自己订阅设置，取色时实时回显（不能用打开时闭包里的旧值）
function ColorSheet<T extends Values>(p: { slice: SettingsSlice<T>; k: KeysOfType<T, string>; title: ReactNode; presets?: string[]; close: () => void }) {
  const v = p.slice.use((s) => s[p.k] as string);
  return (
    <Sheet open position="center" title={p.title} onClose={p.close}>
      <ColorPicker value={v} presets={p.presets} onChange={(nv) => p.slice.set({ [p.k]: nv } as Partial<T>)} />
    </Sheet>
  );
}
