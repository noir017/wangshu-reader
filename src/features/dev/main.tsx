// features 开发页：vite dev 直接打开 /src/features/dev/index.html
// 参数：?engine=real（用真引擎）、?late=1（open 之后才挂 features）、?long=2（长章数）、?server=1（不拦截，用真服务端；默认没有服务端）、?handles=on（强制画选择手柄）
// 通过 window.__f 暴露会话与引擎，供 Playwright 驱动。
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { appSettings } from '@/core/app-settings';
import { ReaderSessionContext } from '@/core/reader-session';
import { OverlayHost } from '@/ui';
import '@/styles/global.css';
import { ReaderFeatures } from '../index';
import { annoSettings } from '../annotations/settings';
import { useLinkBack } from '../common/linkback';
import * as ttsService from '../tts/service';
import { ttsSettings } from '../tts/settings';
import { dictSettings } from '../dict/settings';
import { openNamesDialog } from '../names/NamesDialog';
import { nameSettings } from '@/reader/engine/transforms';
import { makeDevSession } from './session';

const q = new URLSearchParams(location.search);

// 默认当作没有服务端（http 同源时 app 设置会指向 vite 自己，请求只会 404）
if (q.get('server') !== '1') appSettings.set({ serverUrl: '' });
if (q.get('handles')) annoSettings.set({ selectionHandles: q.get('handles') as 'on' | 'off' | 'auto' });
// 书里文字很短，测翻页时可以把窗口压矮：?h=300
// ?engine=real：换成真引擎（src/reader/engine），用来核对假引擎没有偏离真实语义
const realEngine = q.get('engine') === 'real' ? await import('@/reader/engine') : null;
const dev = makeDevSession({
  longChapters: q.has('long') ? Number(q.get('long')) : 2,
  bookId: q.get('book') ?? 'dev-book',
  createController: realEngine ? (book) => realEngine.createReader(book) : undefined,
});
const w = window as unknown as { __f: Record<string, unknown> };
/** 当前交给引擎画的装饰（features 的出口，假引擎/真引擎都能取）：测试断言「该画什么」，不依赖具体怎么画 */
function decoList(layer: string): { id: string; style: string; range: { section: number; start: number; end: number } }[] {
  const c = dev.controller as unknown as { decos?: Map<string, never[]>; decorations?: { layers?: Map<string, never[]> } };
  const m = c.decos ?? c.decorations?.layers;
  return ((m?.get(layer) ?? []) as { id: string; style: string; range: { section: number; start: number; end: number } }[]).map((d) => ({ id: d.id, style: d.style, range: d.range }));
}

w.__f = { ...dev, ready: false, decoList, linkback: useLinkBack, ttsService, ttsSettings, dictSettings, annoSettings, nameSettings, openNames: () => openNamesDialog(dev.session) };

let opened: Promise<void> | undefined;

function DevReader() {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // 子组件（ReaderFeatures）的 effect 先于这里执行 → features 先订阅事件，再打开书（与 reader/ui 的顺序一致）
  useEffect(() => {
    let cancelled = false;
    // StrictMode 会把 effect 跑两遍，打开只能一次
    opened ??= dev.controller.open(box.current!).then(() => {
      w.__f.ready = true;
    });
    void opened.then(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);
  // ?late=1：open() 之后才挂 features（新版 reader/ui 的做法），用来验证 features 不依赖错过的 sectionReady
  const late = q.get('late') === '1';
  return (
    <ReaderSessionContext.Provider value={dev.session}>
      <div style={{ position: 'absolute', inset: 0, height: q.has('h') ? `${q.get('h')}px` : undefined }} ref={box} data-testid="reader" data-ready={ready ? '1' : '0'} />
      {(!late || ready) && <ReaderFeatures />}
    </ReaderSessionContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevReader />
    <OverlayHost />
  </StrictMode>,
);
