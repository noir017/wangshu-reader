// 服务端朗读引擎（/api/tts，假服务端）：连续朗读、预取、Media Session；服务端不可用时只隐藏该选项。
import { expect, test, type Page } from '@playwright/test';
import { f, FAKE_SPEECH, openDev, pageErrors } from './features.helpers';

test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

/** 8kHz 16bit 单声道静音 WAV */
function wav(ms = 250): Buffer {
  const sr = 8000;
  const n = (sr * ms) / 1000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}

async function fakeTtsServer(page: Page, features: Record<string, boolean>) {
  const posts: any[] = [];
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, name: 'moonreader-web-server', version: 't', features } }));
  await page.route('**/api/tts/voices', (r) => r.fulfill({ json: { voices: [{ id: 'zh-XiaoxiaoNeural', name: '晓晓', lang: 'zh-CN', engine: 'edge' }] } }));
  await page.route('**/api/tts', async (r) => {
    posts.push(r.request().postDataJSON());
    await r.fulfill({ body: wav(), contentType: 'audio/wav' });
  });
  return posts;
}

test('服务端引擎：逐句请求音频并连续播放，带 Media Session 元数据', async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH); // 浏览器引擎不该被用到
  const posts = await fakeTtsServer(page, { tts: true });
  await openDev(page, 'server=1');
  await f(page, "f.ttsSettings.set({ engine: 'server', serverVoice: 'zh-XiaoxiaoNeural', askForTts: false })");
  await f(page, "f.session.bus.emit('tts.toggle', {})");
  await expect(page.getByTestId('tts-panel')).toBeVisible();
  // 第一句 + 预取的后两句；每句播完（0.25s）再取下一句
  await expect.poll(() => posts.length, { timeout: 10000 }).toBeGreaterThanOrEqual(3);
  expect(posts[0]).toMatchObject({ text: '第一章 起点', voice: 'zh-XiaoxiaoNeural', rate: 1 });
  expect(await page.evaluate(() => (window as any).__tts.spoken.length)).toBe(0);
  const meta = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, state: navigator.mediaSession.playbackState }));
  expect(meta.title).toBe('开发样书');
  expect(meta.state).toBe('playing');
  // 后续句子确实在推进（音频播完 → 下一句）
  await expect.poll(() => f<number>(page, 'f.ttsService.getRunner().state.index'), { timeout: 10000 }).toBeGreaterThanOrEqual(2);
});

test('声音对话框：服务端可用时列出服务端声音；不可用时没有「服务端」选项', async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
  await fakeTtsServer(page, { tts: true });
  await openDev(page, 'server=1');
  await f(page, "f.ttsSettings.set({ askForTts: false })");
  await f(page, "f.session.bus.emit('tts.toggle', {})");
  await page.getByTestId('tts-settings').click();
  const dlg = page.getByRole('dialog').filter({ hasText: '试听' });
  await expect(dlg.locator('select').first().locator('option')).toHaveCount(2);
  await dlg.locator('select').first().selectOption('server');
  await expect(dlg.locator('select').nth(1)).toContainText('晓晓');
});

test('服务端没有朗读能力：声音对话框只剩浏览器引擎，选了 server 也自动回退', async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
  await fakeTtsServer(page, { tts: false });
  await openDev(page, 'server=1');
  await f(page, "f.ttsSettings.set({ engine: 'server', askForTts: false })");
  await f(page, "f.session.bus.emit('tts.toggle', {})");
  await expect(page.getByText('服务端没有启用朗读，已改用浏览器朗读')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__tts.spoken.length)).toBeGreaterThan(0);
});
