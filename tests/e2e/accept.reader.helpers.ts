// 阅读侧验收（阶段 4）的公共辅助：真页面、真引擎、真 formats、真样书。
// 用法：先起 vite dev（见 engine.basic.spec.ts 开头），再
//   npx playwright test tests/e2e/accept.reader.*.spec.ts
// 截图一律放 out/reader-accept/（test-results 每次运行会被清空）。
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const SAMPLES = process.env.MR_SAMPLES_DIR ?? path.resolve('samples/books');
export const SHOTS = 'out/reader-accept';
export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

/** 页面错误与 console.error 收集（每个用例结束时断言为空；已知的无害噪声在 IGNORED 里） */
const IGNORED = [/Failed to load resource/i, /favicon/i, /\/api\//];

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.stack ?? e}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORED.some((re) => re.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  (page as any).__errors = errors;
  return errors;
}

export const errorsOf = (page: Page): string[] => (page as any).__errors ?? [];

/** 首次进阅读页会弹点击区示意蒙层：除非用例要测它，否则标记为已看过 */
export async function skipClickTip(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const k = 'mr.settings.v1';
    const cur = JSON.parse(localStorage.getItem(k) || '{}');
    if (!sessionStorage.getItem('__acc_init')) {
      cur['reader.ui'] = { ...cur['reader.ui'], showedReaderClickTip: true };
      localStorage.setItem(k, JSON.stringify(cur));
      sessionStorage.setItem('__acc_init', '1');
    }
  });
}

/** 书架导入一个本地文件（走真实的「导入书籍 → 选择文件」对话框） */
/** 应用入口：默认走 baseURL；单文件构建验收时指向 file:///…/index.html */
export const APP_URL = process.env.E2E_APP_URL ?? '/';

export async function importFile(page: Page, file: string): Promise<void> {
  await page.goto(APP_URL);
  await page.getByText('导入书籍').first().click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('选择文件').click()]);
  await chooser.setFiles(file.startsWith('/') ? file : `${SAMPLES}/${file}`);
  await expect(page.getByText(/已导入 \d+ 本/)).toBeVisible({ timeout: 40000 });
}

/** 从书架点开某本书，等引擎排版完成 */
export async function openFromShelf(page: Page, title?: string | RegExp): Promise<void> {
  // 不给标题：点书架上的第一本（每个用例都是全新的浏览器上下文，书架上只有刚导入的那本）
  if (title) await page.getByText(title).first().click();
  else {
    // 导入完成后会弹「新导入的 N 本书」对话框，点其中的第一行；没有就回书架点第一张卡片（带 data-id）
    const row = page.locator('[role=dialog] [class*=groupRow]').first();
    if (await row.count()) await row.click();
    else {
      // 首页的「最近阅读」卡片（data-book-id，异步出来，稍等）；没有就点书架卡片（data-id）
      const recent = page.locator('[data-book-id]').first();
      if (await recent.waitFor({ timeout: 3000 }).then(() => true, () => false)) await recent.click();
      else await page.locator('[data-id]').first().click();
    }
  }
  await expect.poll(() => page.url(), { timeout: 10000 }).toContain('/read/');
  await waitReaderReady(page);
}

/** 阅读页就绪：正文容器出现内容。文本类是 section iframe，固定版式是 canvas */
export async function waitReaderReady(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const iframes = [...document.querySelectorAll('iframe[title^="section-"]')] as HTMLIFrameElement[];
          if (iframes.some((f) => f.getBoundingClientRect().height > 200)) return 'text';
          if (document.querySelector('canvas')) return 'fixed';
          return '';
        }),
      { timeout: 40000 },
    )
    .not.toBe('');
  await page.waitForTimeout(700);
}

/** 点页面中央呼出/收起菜单栏 */
export async function tapCenter(page: Page): Promise<void> {
  const vp = page.viewportSize()!;
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(450);
}

export async function menuVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-show="true"]');
    return !!el;
  });
}

/** 假的 Web Speech（headless chromium 没有语音引擎）：speak 记录下来，delay 毫秒后触发 onend */
export const FAKE_SPEECH = `(() => {
  const st = { spoken: [], cancelled: 0, delay: 40, timer: 0,
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
    cancel() { st.cancelled++; clearTimeout(st.timer); },
    speak(u) {
      st.spoken.push({ text: u.text, rate: u.rate, pitch: u.pitch, voice: u.voice && u.voice.voiceURI });
      st.timer = setTimeout(() => u.onend && u.onend({}), st.delay);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
})();`;

/** 状态栏右侧的进度百分比（0..100） */
export async function progressPct(page: Page): Promise<number> {
  const t = (await page.getByTestId('status-progress').textContent()) ?? '';
  return parseFloat(t.replace('%', '')) || 0;
}

export async function statusChapter(page: Page): Promise<string> {
  return ((await page.getByTestId('status-chapter').textContent()) ?? '').trim();
}

/** 翻页键：PageDown / PageUp（window 兜底监听，不依赖焦点） */
export async function turn(page: Page, dir: 1 | -1 = 1, wait = 650): Promise<void> {
  await page.keyboard.press(dir > 0 ? 'PageDown' : 'PageUp');
  await page.waitForTimeout(wait);
}

/**
 * 屏内第一处可选的文字（页面坐标）。章节 iframe 里找词；必须确认该点在页面上最上层的就是这个 iframe，
 * 且 iframe 里该点的 caret 落在这个文本节点上（引擎会同时挂着相邻章的 iframe，不核对会点到别处的空白）
 */
export async function findTextPoint(page: Page, minY = 10, nth = 0): Promise<{ x: number; y: number } | null> {
  const vp = page.viewportSize()!;
  const frames = page.locator('iframe[title^="section-"]');
  const n = await frames.count();
  for (let i = 0; i < n; i++) {
    const box = await frames.nth(i).boundingBox();
    if (!box) continue;
    const handle = await frames.nth(i).elementHandle();
    const frame = await handle?.contentFrame();
    if (!frame) continue;
    const pt = await frame
      .evaluate(
        ({ ox, oy, vw, vh, minY, nth }) => {
          let seen = 0;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const text = node.nodeValue ?? '';
            const m = /\p{Script=Han}{2,}|\p{L}{3,}/u.exec(text); // 小样书的末章可能只有「尾声」两个汉字
            if (!m) continue;
            const r = document.createRange();
            r.setStart(node, m.index + 1);
            r.setEnd(node, m.index + 2);
            const b = r.getBoundingClientRect();
            if (!b.width || !b.height) continue;
            const lx = b.left + b.width / 2;
            const ly = b.top + b.height / 2;
            const x = ox + lx;
            const y = oy + ly;
            if (!(x > 8 && x < vw - 8 && y > minY + 8 && y < vh - 40)) continue;
            // 页面上这一点最上层必须是本 iframe，iframe 内这一点的 caret 必须落在这个文本节点
            if (window.parent.document.elementFromPoint(x, y) !== window.frameElement) continue;
            const c = document.caretRangeFromPoint(lx, ly);
            if (c?.startContainer !== node) continue;
            if (seen++ < nth) continue;
            return { x, y };
          }
          return null;
        },
        { ox: box.x, oy: box.y, vw: vp.width, vh: vp.height, minY, nth },
      )
      .catch(() => null);
    if (pt) return pt;
  }
  return null;
}

/** 双击屏内第一处文字：原生选词 → 引擎 selection 事件 → 选择条 */
export async function selectWord(page: Page, nth = 0): Promise<void> {
  let pt = await findTextPoint(page, 10, nth);
  for (let i = 0; !pt && i < 5; i++) {
    await turn(page, 1);
    pt = await findTextPoint(page, 10, nth);
  }
  if (!pt) throw new Error('屏内找不到可选的文字');
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId('selection-toolbar')).toBeVisible({ timeout: 8000 });
}

/** IndexedDB 里某个 store 的全部记录 */
export const idbAll = (page: Page, store: string) =>
  page.evaluate(
    (name) =>
      new Promise<any[]>((resolve, reject) => {
        const req = indexedDB.open('moonreader');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(name)) return resolve([]);
          const all = db.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
    store,
  );

/** 打开 ⋮ 菜单里的某项（先确保菜单栏已显示） */
export async function openOptionsMenuItem(page: Page, label: string): Promise<void> {
  if (!(await menuVisible(page))) await tapCenter(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(350);
}

/** 退出阅读页回书架（顶栏返回键），再从书架重新打开 */
export async function leaveAndReopen(page: Page, title?: string | RegExp): Promise<void> {
  if (!(await menuVisible(page))) await tapCenter(page);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.waitForTimeout(500);
  await openFromShelf(page, title);
}
