// features 端到端的公共辅助：打开开发页（src/features/dev）、取引擎/会话、驱动选择。
// 先起 vite dev（见 engine.basic.spec.ts 开头），再：npx playwright test tests/e2e/features.*.spec.ts
import { expect, type Page } from '@playwright/test';

/** 截图放 out/features-shots（test-results 每次运行会被清空） */
export const shot = (page: Page, name: string) => page.screenshot({ path: `out/features-shots/${name}.png` });

export const DEV_URL = '/src/features/dev/index.html';

export async function openDev(page: Page, query = ''): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // E2E_ENGINE=real：同一套用例改跑真引擎（假引擎只是替身，这样能看出两者的差异）
  const engine = process.env.E2E_ENGINE === 'real' ? 'engine=real' : '';
  const late = process.env.E2E_LATE === '1' ? 'late=1' : ''; // open() 之后才挂 features
  await page.goto(`${DEV_URL}?${[query, engine, late].filter(Boolean).join('&')}`);
  await page.waitForFunction(() => (window as any).__f?.ready === true, null, { timeout: 20000 });
  // 等第一章排版完成
  await page.waitForFunction(() => !!(window as any).__f.controller.getLocation(), null, { timeout: 10000 });
  (page as any).__errors = errors;
}

export function pageErrors(page: Page): string[] {
  return (page as any).__errors ?? [];
}

/** 在页面里执行 __f 上的表达式。f 是控制器等的集合：controller / session / book */
export function f<T>(page: Page, expr: string): Promise<T> {
  return page.evaluate(`(async () => { const f = window.__f; return (${expr}); })()`) as Promise<T>;
}

/** 选中第 section 章里 [start,end) 的文字（经引擎 setSelection，会派发 selection 事件） */
export async function select(page: Page, section: number, start: number, end: number): Promise<void> {
  await f(page, `f.controller.setSelection({ section: ${section}, start: ${start}, end: ${end} })`);
}

/** 章节纯文本里 needle 的位置 */
export async function indexOfText(page: Page, section: number, needle: string): Promise<number> {
  const i = await f<number>(page, `f.book.chapterTexts[${section}].indexOf(${JSON.stringify(needle)})`);
  expect(i, `章节 ${section} 里找不到 ${needle}`).toBeGreaterThanOrEqual(0);
  return i;
}

/** features 交给引擎的某图层装饰列表 */
export const decoList = (page: Page, layer: string) => f<{ id: string; style: string; range: { section: number; start: number; end: number } }[]>(page, `f.decoList(${JSON.stringify(layer)})`);

/** 章节 iframe 里的元素（真引擎会同时挂着相邻章的 iframe，按 title 选） */
export const inSection = (page: Page, section: number, sel: string) => page.frameLocator(`iframe[title="section-${section}"]`).locator(sel);

/** 点击某段文字（取它在屏上第一个矩形的中心） */
export async function clickRange(page: Page, section: number, start: number, end: number): Promise<void> {
  const r = await f<{ x: number; y: number; width: number; height: number } | undefined>(page, `(() => { const r = f.controller.getRangeRects({ section: ${section}, start: ${start}, end: ${end} })[0]; return r && { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  expect(r, '这段文字不在屏内').toBeTruthy();
  await page.mouse.click(r!.x + r!.width / 2, r!.y + r!.height / 2);
}

export const idbAnnotations = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const req = indexedDB.open('moonreader');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('annotations');
          const all = tx.objectStore('annotations').getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );

/** 假的 Web Speech：speak 记录下来，auto=true 时 delay 毫秒后触发 onend；auto=false 时停住，等测试手动 finish() */
export const FAKE_SPEECH = `(() => {
  const st = { spoken: [], cancelled: 0, auto: true, delay: 30, pending: null, timer: 0,
    voices: [
      { voiceURI: 'zh-1', name: 'Fake 中文', lang: 'zh-CN', default: true, localService: true },
      { voiceURI: 'en-1', name: 'Fake English', lang: 'en-US', default: false, localService: true },
    ] };
  window.__tts = st;
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; this.lang = ''; } };
  const synth = {
    speaking: false,
    getVoices: () => st.voices,
    addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
    cancel() { st.cancelled++; clearTimeout(st.timer); st.pending = null; },
    speak(u) {
      st.spoken.push({ text: u.text, rate: u.rate, pitch: u.pitch, volume: u.volume, voice: u.voice && u.voice.voiceURI, lang: u.lang });
      if (st.auto) st.timer = setTimeout(() => u.onend && u.onend({}), st.delay);
      else st.pending = u;
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  st.finish = () => { const u = st.pending; st.pending = null; u && u.onend && u.onend({}); };
})();`;
