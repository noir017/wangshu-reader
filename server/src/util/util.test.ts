// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { splitPath } from '../lib/library-fs';
import { isInside, realInside, uniqueName } from '../lib/safe-path';
import { extractTokens } from './auth';
import { contentDisposition, parseRange, sanitizeFileName } from './http';
import { chunkText, naturalCompare, sanitizeHtml } from './text';
import { put, tmp } from '../test-utils';
import { mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';

describe('http 工具', () => {
  it('parseRange：区间、后缀、越界', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=-0', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ start: 0, end: 1 }); // 多区间只取第一个
  });

  it('contentDisposition：非 ASCII 文件名带 filename*，引号被替换', () => {
    const h = contentDisposition('attachment', '三体"1".epub');
    expect(h).toContain(`filename*=UTF-8''%E4%B8%89%E4%BD%93%221%22.epub`);
    expect(h.split('filename="')[1].split('"')[0]).not.toContain('"');
    expect(Buffer.from(h, 'latin1').toString('latin1')).toBe(h); // 只含 latin1，可以放进响应头
  });

  it('sanitizeFileName：去路径分隔符与控制字符、拒绝 . 与 ..', () => {
    expect(sanitizeFileName('a/b\\c.txt')).toBe('a_b_c.txt');
    expect(sanitizeFileName('..')).toBe('');
    expect(sanitizeFileName(' x\u0000y ')).toBe('xy');
    expect(Buffer.byteLength(sanitizeFileName('长'.repeat(200)))).toBeLessThanOrEqual(255);
  });
});

describe('text 工具', () => {
  it('naturalCompare：10 在 2 之后', () => {
    expect(['p10', 'p2', 'p1'].sort(naturalCompare)).toEqual(['p1', 'p2', 'p10']);
  });

  it('sanitizeHtml：只留白名单标签，去属性、脚本、链接', () => {
    const out = sanitizeHtml('<p onclick="x()" class="mr-a evil">hi <a href="javascript:alert(1)">link</a><script>alert(1)</script><img src=x onerror=y></p><iframe src=z></iframe>');
    expect(out).toBe('<p class="mr-a">hi link</p>');
    expect(sanitizeHtml('a < b && c > d')).toBe('a &lt; b && c &gt; d');
    expect(sanitizeHtml('<b>未闭合<i>嵌套')).toBe('<b>未闭合<i>嵌套</i></b>');
    expect(sanitizeHtml('<svg><script>1</script></svg>ok')).toBe('ok');
  });

  it('chunkText：拼回等于原文，每块不超长', () => {
    const text = '第一句。第二句！'.repeat(300) + '\n\n' + 'word '.repeat(500);
    const parts = chunkText(text, 400);
    expect(parts.join('')).toBe(text);
    expect(parts.every((p) => p.length <= 400)).toBe(true);
  });
});

describe('鉴权令牌提取', () => {
  const ctx = (headers: Record<string, string>, query: Record<string, string> = {}) =>
    ({ req: { header: (n: string) => headers[n], query: (n: string) => query[n] } }) as never;
  it('Bearer / Basic（密码即令牌）/ ?token=', () => {
    expect(extractTokens(ctx({ Authorization: 'Bearer abc' }))).toEqual(['abc']);
    expect(extractTokens(ctx({ Authorization: `Basic ${Buffer.from('anyone:s3:cret').toString('base64')}` }))).toEqual(['s3:cret']);
    expect(extractTokens(ctx({}, { token: 'q' }))).toEqual(['q']);
  });
});

describe('路径安全', () => {
  it('splitPath：拒绝 .. 与 NUL，忽略空段', () => {
    expect(splitPath('/a//b/./c/')).toEqual(['a', 'b', 'c']);
    expect(splitPath('a\\b')).toEqual(['a', 'b']);
    expect(() => splitPath('a/../b')).toThrow();
    expect(() => splitPath('a\0b')).toThrow();
  });

  it('isInside：不把同前缀的兄弟目录当作内部', () => {
    expect(isInside('/lib', '/lib/a')).toBe(true);
    expect(isInside('/lib', '/lib')).toBe(true);
    expect(isInside('/lib', '/library')).toBe(false);
    expect(isInside('/lib', '/lib/../etc')).toBe(false);
  });

  it('realInside：符号链接逃逸被拒绝，新建目标取最近祖先判断', async () => {
    const root = tmp();
    const outside = tmp();
    put(outside, 'secret.txt', 's');
    mkdirSync(path.join(root, 'd'));
    symlinkSync(outside, path.join(root, 'd', 'link'));
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'file-link'));
    const real = await import('node:fs/promises').then((m) => m.realpath(root));
    await expect(realInside(real, path.join(root, 'd', 'link', 'secret.txt'))).rejects.toMatchObject({ status: 403 });
    await expect(realInside(real, path.join(root, 'file-link'))).rejects.toMatchObject({ status: 403 });
    await expect(realInside(real, path.join(root, 'd', 'link', 'new', 'x'))).rejects.toMatchObject({ status: 403 });
    await expect(realInside(real, path.join(root, 'd', 'new', 'x.txt'))).resolves.toBe(path.join(real, 'd', 'new', 'x.txt'));
  });

  it('uniqueName：加 (1)、(2)，扩展名保留', async () => {
    const dir = tmp();
    put(dir, 'a.txt');
    put(dir, 'a (1).txt');
    put(dir, '.hidden');
    expect(await uniqueName(dir, 'b.txt')).toBe('b.txt');
    expect(await uniqueName(dir, 'a.txt')).toBe('a (2).txt');
    expect(await uniqueName(dir, '.hidden')).toBe('.hidden (1)');
  });
});
