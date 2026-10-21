// @vitest-environment node
import type { ServerFont } from '@shared/api';
import { mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fcWeightToCss, nameFromFile, parseNameTable, readFontNames } from '../lib/fonts';
import { j, makeApp, put, tmp } from '../test-utils';

const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const u32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const utf16be = (s: string) => {
  const b = Buffer.from(s, 'utf16le');
  b.swap16();
  return b;
};

/** 构造 name 表：records = [nameID, 文本, platform(3=Windows UTF-16BE，1=Mac Roman), lang] */
function nameTable(records: [number, string, number?, number?][]): Buffer {
  const strs = records.map(([, text, platform = 3]) => (platform === 3 ? utf16be(text) : Buffer.from(text, 'latin1')));
  const headLen = 6 + records.length * 12;
  let off = 0;
  const recs = records.map(([id, , platform = 3, lang = 0x409], i) => {
    const r = Buffer.concat([u16(platform), u16(platform === 3 ? 1 : 0), u16(lang), u16(id), u16(strs[i].length), u16(off)]);
    off += strs[i].length;
    return r;
  });
  return Buffer.concat([u16(0), u16(records.length), u16(headLen), ...recs, ...strs]);
}

/** 最小的 sfnt（TrueType）：只含 name 与 OS/2 两张表，够 readFontNames 解析 */
function fakeTtf(family: string, style: string, weight = 400, extra: [number, string, number?, number?][] = []): Buffer {
  const name = nameTable([[1, family], [2, style], ...extra]);
  const os2 = Buffer.concat([u16(3), u16(0), u16(weight), Buffer.alloc(20)]);
  const dirLen = 12 + 2 * 16;
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const dir = (tag: string, off: number, len: number) => Buffer.concat([Buffer.from(tag, 'latin1'), u32(0), u32(off), u32(len)]);
  const nameOff = dirLen;
  const os2Off = nameOff + pad(name).length;
  return Buffer.concat([u32(0x00010000), u16(2), u16(32), u16(1), u16(0), dir('OS/2', os2Off, os2.length), dir('name', nameOff, name.length), pad(name), pad(os2)]);
}

describe('字体名解析', () => {
  it('name 表：Windows 英文名优先，Typographic Family(16) 优先于 Family(1)', () => {
    const t = nameTable([[1, 'Fallback', 1], [1, 'Win 中文', 3, 0x804], [1, 'Win English', 3, 0x409], [2, 'Regular'], [16, 'Typo Family'], [17, 'Typo Style']]);
    expect(parseNameTable(t)).toEqual({ family: 'Typo Family', style: 'Typo Style' });
    expect(parseNameTable(nameTable([[1, 'Win 中文', 3, 0x804], [1, 'Win English', 3, 0x409], [2, 'Bold']]))).toEqual({ family: 'Win English', style: 'Bold' });
    expect(parseNameTable(Buffer.alloc(3))).toEqual({});
  });

  it('readFontNames：读 ttf 的 family / style / 权重；损坏文件返回 null', async () => {
    const dir = tmp();
    const f = put(dir, 'x.ttf', fakeTtf('思源黑体 Test', 'Bold', 700));
    expect(await readFontNames(f)).toEqual({ family: '思源黑体 Test', style: 'Bold', weight: '700' });
    expect(await readFontNames(put(dir, 'bad.ttf', 'not a font at all, just text'))).toBeNull();
    expect(await readFontNames(put(dir, 'tiny.ttf', 'x'))).toBeNull();
  });

  it('nameFromFile：从文件名猜；fcWeightToCss：fontconfig 权重 → CSS', () => {
    expect(nameFromFile('/a/NotoSansCJK-Regular.ttc')).toEqual({ family: 'NotoSansCJK', style: 'Regular' });
    expect(nameFromFile('/a/My_Font.otf')).toEqual({ family: 'My Font' });
    expect([0, 80, 180, 200, 210].map(fcWeightToCss)).toEqual(['100', '400', '600', '700', '900']);
  });
});

describe('/api/fonts', () => {
  function fontsDir(): string {
    const d = tmp('mr-fonts-');
    put(d, 'Alpha.ttf', fakeTtf('Alpha Sans', 'Regular', 400));
    put(d, 'sub/Alpha-Bold.ttf', fakeTtf('Alpha Sans', 'Bold', 700));
    put(d, 'sub/deeper/Beta.otf', fakeTtf('Beta Serif', 'Italic', 400));
    put(d, 'Broken.ttf', 'garbage');
    put(d, 'readme.txt', 'not a font');
    put(d, '.hidden/Ghost.ttf', fakeTtf('Ghost', 'Regular'));
    return d;
  }

  it('递归列出字体，family/style/weight 来自 name 表；非字体与隐藏目录跳过；损坏的用文件名兜底', async () => {
    const { app, config } = makeApp({ MR_FONTS_DIR: fontsDir(), MR_FONTS_SYSTEM: '0' });
    expect(config.features.fonts).toBe(true);
    const { fonts } = await j<{ fonts: ServerFont[] }>(await app.request('/api/fonts'));
    expect(fonts.map((f) => [f.family, f.file, f.style, f.weight])).toEqual([
      ['Alpha Sans', 'u0/Alpha.ttf', 'Regular', '400'],
      ['Alpha Sans', 'u0/sub/Alpha-Bold.ttf', 'Bold', '700'],
      ['Beta Serif', 'u0/sub/deeper/Beta.otf', 'Italic', '400'],
      ['Broken', 'u0/Broken.ttf', undefined, undefined],
    ]);
  });

  it('没有任何字体目录：features.fonts = false，列表为空', async () => {
    const { app, config } = makeApp({ MR_FONTS_SYSTEM: '0' });
    expect(config.features.fonts).toBe(false);
    expect(await j(await app.request('/api/fonts'))).toEqual({ fonts: [] });
  });

  it('系统字体目录（容器里的 DejaVu / Noto）也会列出，每个 file 都能取回', async () => {
    const { app, config } = makeApp({ MR_FONTS_DIR: fontsDir() });
    if (!config.features.fonts) return;
    const { fonts } = await j<{ fonts: ServerFont[] }>(await app.request('/api/fonts?refresh=1'));
    expect(fonts.filter((f) => f.file.startsWith('u0/')).length).toBe(4);
    const sys = fonts.find((f) => f.file.startsWith('s'));
    if (sys) {
      const res = await app.request(`/api/fonts/file?file=${encodeURIComponent(sys.file)}`);
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }
  });

  it('取字体文件：Content-Type、缓存头、Range；只认「根编号/相对路径」且必须是字体扩展名', async () => {
    const dir = fontsDir();
    const { app } = makeApp({ MR_FONTS_DIR: dir, MR_FONTS_SYSTEM: '0' });
    const ok = await app.request('/api/fonts/file?file=u0/sub/Alpha-Bold.ttf');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('font/ttf');
    expect(ok.headers.get('Cache-Control')).toMatch(/max-age/);
    expect(ok.headers.get('Content-Disposition')).toBeNull();
    expect((await app.request('/api/fonts/file?file=u0/Alpha.ttf', { headers: { Range: 'bytes=0-3' } })).status).toBe(206);
    for (const f of ['u0/readme.txt', 'u1/Alpha.ttf', 'Alpha.ttf', '/etc/passwd', 'u0/../../etc/passwd.ttf', 'u0//Alpha.ttf', 'u0/nope.ttf', '']) {
      const res = await app.request(`/api/fonts/file?file=${encodeURIComponent(f)}`);
      expect(res.status, f).toBeGreaterThanOrEqual(400);
    }
  });

  it('字体目录里指向目录外的符号链接取不到', async () => {
    const outer = tmp();
    put(outer, 'Secret.ttf', fakeTtf('Secret', 'Regular'));
    const dir = tmp('mr-fonts-');
    mkdirSync(path.join(dir, 'sub'));
    symlinkSync(path.join(outer, 'Secret.ttf'), path.join(dir, 'sub', 'Link.ttf'));
    const { app } = makeApp({ MR_FONTS_DIR: dir, MR_FONTS_SYSTEM: '0' });
    expect((await app.request('/api/fonts/file?file=u0/sub/Link.ttf')).status).toBe(403);
  });

  it('多个字体目录用冒号分隔，编号 u0、u1…', async () => {
    const a = tmp('mr-fa-');
    const b = tmp('mr-fb-');
    put(a, 'A.ttf', fakeTtf('Aaa', 'Regular'));
    put(b, 'B.ttf', fakeTtf('Bbb', 'Regular'));
    const { app } = makeApp({ MR_FONTS_DIR: `${a}:${b}`, MR_FONTS_SYSTEM: '0' });
    const { fonts } = await j<{ fonts: ServerFont[] }>(await app.request('/api/fonts'));
    expect(fonts.map((f) => f.file)).toEqual(['u0/A.ttf', 'u1/B.ttf']);
  });
});
