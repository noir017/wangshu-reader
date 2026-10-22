// 开发用的 features 占位：隔离别的模块施工期间的报错，只验证阅读页自己（STUB_FEATURES=1 时生效，见 vite.dev.config.ts）。
// 把 bus 上的命令记到 window.__busLog，方便截图脚本断言「动作确实发出了命令」。
import { useEffect } from 'react';
import { useReaderSession } from '@/core/reader-session';

export function ReaderFeatures() {
  const s = useReaderSession();
  useEffect(() => {
    const w = window as unknown as { __busLog: string[] };
    w.__busLog = [];
    const types = ['toc.open', 'bookmark.add', 'bookmarks.open', 'search.open', 'tts.toggle', 'tts.stop', 'selection.start', 'dict.lookup', 'translate.open', 'image.open', 'footnote.open'] as const;
    const offs = types.map((type) => s.bus.on(type, (p) => w.__busLog.push(`${type} ${JSON.stringify(p)}`)));
    return () => offs.forEach((off) => off());
  }, [s]);
  return null;
}

// 设置入口：reader/ui 的设置界面会调用，开发占位只记日志
const noop = (name: string) => (..._a: unknown[]) => {
  (window as unknown as { __busLog?: string[] }).__busLog?.push(`features.${name}`);
};
export const openDictSettings = noop('openDictSettings');
export const openDictHistory = noop('openDictHistory');
export const openNamesDialog = noop('openNamesDialog');
export const openTtsMoreDialog = noop('openTtsMoreDialog');
export const openTtsVoiceDialog = noop('openTtsVoiceDialog');
export const openTtsFilterDialog = noop('openTtsFilterDialog');
export const openSpeakMenu = noop('openSpeakMenu');
export const isTtsActive = () => false;
