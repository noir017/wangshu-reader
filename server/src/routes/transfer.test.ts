// @vitest-environment node
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeApp, tmp } from '../test-utils';

function cfgOf(html: string): Record<string, unknown> {
  const m = /<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/.exec(html);
  expect(m).toBeTruthy();
  return JSON.parse(m![1]) as Record<string, unknown>;
}

describe('/transfer 网页传书', () => {
  it('自包含 HTML：不依赖外部资源，页面脚本语法正确', async () => {
    const { app } = makeApp({ MR_LIBRARY_DIR: tmp() });
    const res = await app.request('/transfer');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const html = await res.text();
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import|url\(http/i);
    const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    expect(code.length).toBeGreaterThan(1000);
    expect(() => new Function(code)).not.toThrow(); // 只编译不执行
    expect((await app.request('/transfer/')).status).toBe(200);
  });

  it('配置：单书库上传到 Upload；多书库带根名；没有书库/只读时页面据此提示', async () => {
    const one = cfgOf(await (await makeApp({ MR_LIBRARY_DIR: tmp() }).app.request('/transfer')).text());
    expect(one).toMatchObject({ uploadPath: 'Upload', enabled: true, readonly: false, tokenRequired: false });
    const a = tmp('mr-a-');
    const b = tmp('mr-b-');
    const multi = cfgOf(await (await makeApp({ MR_LIBRARY_DIR: `${a}:${b}` }).app.request('/transfer')).text());
    expect(multi.uploadPath).toBe(`${path.basename(a)}/Upload`);
    expect(cfgOf(await (await makeApp().app.request('/transfer')).text())).toMatchObject({ enabled: false });
    expect(cfgOf(await (await makeApp({ MR_LIBRARY_DIR: tmp(), MR_LIBRARY_READONLY: '1', MR_TOKEN: 't' }).app.request('/transfer')).text())).toMatchObject({ readonly: true, tokenRequired: true });
  });

  it('书库目录名里的 < 不能破坏内嵌 JSON 所在的 script（<!--<script> 会让浏览器吞掉结束标签）', async () => {
    const evil = path.join(tmp(), 'a<!--<script>b<img src=x onerror=alert(1)>');
    mkdirSync(evil);
    const other = tmp('mr-b-');
    const { app } = makeApp({ MR_LIBRARY_DIR: `${evil}:${other}` });
    const html = await (await app.request('/transfer')).text();
    const block = /<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(block).not.toContain('<');
    expect(cfgOf(html).uploadPath).toBe(`${path.basename(evil)}/Upload`);
  });

  it('不需要令牌就能打开页面（页面里自己要令牌），但它调用的接口需要', async () => {
    const { app } = makeApp({ MR_LIBRARY_DIR: tmp(), MR_TOKEN: 'secret' });
    expect((await app.request('/transfer')).status).toBe(200);
    expect((await app.request('/api/library/list?path=Upload')).status).toBe(401);
    expect((await app.request('/api/library/list?path=Upload', { headers: { Authorization: 'Bearer secret' } })).status).toBe(404); // 鉴权通过，Upload 目录还不存在
  });
});
