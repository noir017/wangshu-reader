// 开发用：真实引擎 + 真实格式解析 的集成冒烟（在容器里跑）。
// node src/reader/ui/dev/real.mjs <baseURL> <输出目录> [steps...]
// 在浏览器里程序化生成一本 TXT（60 章）和一本 EPUB（8 章），经 library/import 导入 IndexedDB，再打开阅读页逐项操作并截图。
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5237';
const out = process.argv[3] ?? '/work/moonreader-web/out/ui-shots';
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/chromium' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN', deviceScaleFactor: 1, hasTouch: false });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 7).join('\n')}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url()}`));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const log = (...a) => console.log(...a);

await page.goto(`${base}/src/reader/ui/dev/dev.html`);
await page.waitForTimeout(800);

const ids = await page.evaluate(async () => {
  // 不经 library/import（书库模块施工中，依赖图不稳定）：用 formats + storage 直接入库
  const { probeBook } = await import('/src/formats/index.ts');
  const { buildEpub } = await import('/src/formats/testing/builders.ts');
  const { fileFingerprint } = await import('/src/storage/fingerprint.ts');
  const { putBook, putBookFile } = await import('/src/storage/db.ts');
  async function importFile(file) {
    const id = await fileFingerprint(file);
    const probe = await probeBook(file, { fileName: file.name });
    await putBookFile(id, file);
    const meta = probe.metadata;
    const book = {
      id,
      fileName: file.name,
      format: probe.format,
      size: file.size,
      title: meta.title?.trim() || file.name.replace(/\.[^.]+$/, ''),
      authors: meta.authors ?? [],
      language: meta.language,
      tags: [],
      addedAt: Date.now(),
      onShelf: true,
      hasCover: false,
      chars: probe.size?.chars,
      pages: probe.size?.pages,
    };
    await putBook(book);
    return { book };
  }
  const para = (i) =>
    `　　山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。苔痕上阶绿，草色入帘青。第${i}段：谈笑有鸿儒，往来无白丁。可以调素琴，阅金经。无丝竹之乱耳，无案牍之劳形。南阳诸葛庐，西蜀子云亭。孔子云：何陋之有？The quick brown fox jumps over the lazy dog, again and again.`;
  let txt = '';
  for (let c = 1; c <= 60; c++) {
    txt += `第${c}章 测试章节${c}\n\n`;
    for (let p = 1; p <= 14; p++) txt += para(p) + '\n\n';
  }
  const t = await importFile(new File([txt], '界面集成测试.txt', { type: 'text/plain' }));
  const chapters = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i + 1}`,
    file: `c${i + 1}.xhtml`,
    title: `第 ${i + 1} 章`,
    body: `<h2>第 ${i + 1} 章</h2>` + Array.from({ length: 16 }, (_, p) => `<p>${para(p + 1)}</p>`).join(''),
  }));
  const nav = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${chapters.map((c) => `<li><a href="${c.file}">${c.title}</a></li>`).join('')}</ol></nav></body></html>`;
  const epub = await buildEpub({ title: '集成测试 EPUB', authors: ['测试员'], language: 'zh', chapters, nav });
  const e = await importFile(new File([epub], '集成测试.epub'));
  return { txt: t.book.id, epub: e.book.id };
});
log('ids', JSON.stringify(ids));

async function open(id) {
  await page.goto(`${base}/src/reader/ui/dev/dev.html#/read/${id}`);
  await page.reload();
  await page.waitForTimeout(1500);
}

const steps = process.argv.slice(4);
const run = steps.length ? steps : ['basic'];
for (const s of run) {
  const mod = await import(`./real-steps/${s}.mjs`);
  try {
    await mod.default({ page, ids, open, shot, log, base, errors });
  } catch (e) {
    log(`STEP ${s} FAILED:`, String(e.message).split('\n')[0]);
    await shot(`crash-${s}`).catch(() => {});
  }
}

log(JSON.stringify({ errors: errors.slice(0, 20) }, null, 2));
await browser.close();
