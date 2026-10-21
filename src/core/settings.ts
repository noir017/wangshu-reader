// 设置注册表：各模块用 defineSettings 声明自己的命名空间与默认值，统一存进 localStorage。
// 备份/恢复、重置都走这里（exportAll / importAll / resetNamespace），模块之间互不改对方的文件。
import { create } from 'zustand';

type Values = Record<string, unknown>;

const STORAGE_KEY = 'mr.settings.v1';
const registry = new Map<string, Values>();

function loadPersisted(): Record<string, Values> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Values>) : {};
  } catch {
    return {};
  }
}

interface SettingsState {
  values: Record<string, Values>;
}

const useStore = create<SettingsState>(() => ({ values: loadPersisted() }));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s.values));
    } catch {
      /* 配额满或隐私模式：忽略，内存里的值照常可用 */
    }
  }, 200);
});

export interface SettingsSlice<T extends Values> {
  readonly ns: string;
  readonly defaults: Readonly<T>;
  /** 当前值（已用默认值补齐缺省字段） */
  get(): T;
  set(patch: Partial<T>): void;
  reset(): void;
  /** React hook：按选择器订阅 */
  use<S>(selector: (s: T) => S): S;
  subscribe(listener: (next: T, prev: T) => void): () => void;
}

function merged<T extends Values>(ns: string, defaults: T, values: Record<string, Values>): T {
  return { ...defaults, ...(values[ns] as Partial<T> | undefined) };
}

/** 声明一个设置命名空间。ns 用 `模块.子块`，如 `reader.typography`。重复声明同一 ns 会抛错。 */
export function defineSettings<T extends Values>(ns: string, defaults: T): SettingsSlice<T> {
  if (registry.has(ns)) throw new Error(`settings namespace 重复声明: ${ns}`);
  registry.set(ns, defaults);
  // 选择器结果按 ns 的值对象缓存，避免每次渲染新建对象导致 React 无限重渲染
  let cacheSrc: Values | undefined;
  let cacheVal: T = merged(ns, defaults, useStore.getState().values);
  const current = (values: Record<string, Values>): T => {
    const src = values[ns];
    if (src !== cacheSrc) {
      cacheSrc = src;
      cacheVal = merged(ns, defaults, values);
    }
    return cacheVal;
  };
  return {
    ns,
    defaults,
    get: () => current(useStore.getState().values),
    set: (patch) =>
      useStore.setState((s) => ({
        values: { ...s.values, [ns]: { ...(s.values[ns] ?? {}), ...patch } },
      })),
    reset: () =>
      useStore.setState((s) => {
        const { [ns]: _drop, ...rest } = s.values;
        return { values: rest };
      }),
    use: (selector) => useStore((s) => selector(current(s.values))),
    subscribe: (listener) =>
      useStore.subscribe((s, prev) => {
        if (s.values[ns] !== prev.values[ns]) listener(current(s.values), current(prev.values));
      }),
  };
}

/** 导出全部设置（含未改动的默认值），用于备份 */
export function exportAllSettings(): Record<string, Values> {
  const values = useStore.getState().values;
  const out: Record<string, Values> = {};
  for (const [ns, defaults] of registry) out[ns] = merged(ns, defaults, values);
  return out;
}

/** 从备份恢复；未知命名空间原样保留（兼容将来的模块） */
export function importAllSettings(data: Record<string, Values>, mode: 'replace' | 'merge' = 'replace'): void {
  useStore.setState((s) => ({ values: mode === 'replace' ? { ...data } : { ...s.values, ...data } }));
}

export function listSettingNamespaces(): string[] {
  return [...registry.keys()];
}
