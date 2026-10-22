// 守护测试：界面文案字典不能回退成英文。
// 遍历所有 defineMessages 字典，断言：① en 的 key 在 zh 里都有；② zh 的值不是英文（品牌名、格式名、协议名等白名单除外）。
// 还检查动态拼出来的 key（t(`flip_${v}`) 这类）在字典里都存在，否则界面会直接显示 key 名。
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { registeredMessages } from '@/core/i18n';
import { ALLOWED_LATIN, latinLeftover } from './i18n-allow';

const root = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|d)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// 只拿来念、不显示的文案（朗读试听句，中英各一句，方便试英文语音）
const SPOKEN_ONLY = new Set(['previewText']);

const loaders = import.meta.glob('/src/**/*.{ts,tsx}');
const CALL = /=\s*defineMessages\(/g;
const sources = walk(join(root, 'src'))
  .map((f) => ({ file: '/' + relative(root, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }))
  .filter((s) => s.file !== '/src/core/i18n.ts' && CALL.test(s.text));

describe('i18n 字典', () => {
  it('所有 defineMessages 字典都已加载', async () => {
    for (const s of sources) await loaders[s.file]!();
    const expected = sources.reduce((n, s) => n + (s.text.match(CALL)?.length ?? 0), 0);
    expect(expected).toBeGreaterThan(10);
    expect(registeredMessages().length).toBe(expected);
  });

  it('en 有的 key，zh 都有', async () => {
    for (const s of sources) await loaders[s.file]!();
    const bad: string[] = [];
    for (const d of registeredMessages()) for (const k of Object.keys(d.en ?? {})) if (!(k in d.zh)) bad.push(k);
    expect(bad).toEqual([]);
  });

  it('zh 的值不是英文（白名单：品牌/格式/协议名等）', async () => {
    for (const s of sources) await loaders[s.file]!();
    const bad: string[] = [];
    for (const d of registeredMessages()) {
      for (const [k, v] of Object.entries(d.zh)) {
        if (SPOKEN_ONLY.has(k)) continue;
        const left = latinLeftover(v);
        if (left) bad.push(`${k}: ${JSON.stringify(v)} → ${left}`);
      }
    }
    expect(bad).toEqual([]);
    expect(ALLOWED_LATIN.length).toBeGreaterThan(0);
  });

  it('动态拼的 key 都在字典里', async () => {
    const { t: rt } = await import('@/reader/ui/messages');
    const { ALL_ACTIONS, actionLabel } = await import('@/reader/ui/actions/actions');
    const { AutoScrollMode } = await import('@/reader/settings');
    const keys = [
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((v) => `flip_${v}`),
      ...[0, 1, 2, 3, 4, AutoScrollMode.SpeedRead].map((v) => `scroll_mode_${v}`),
    ];
    const missing = keys.filter((k) => rt(k as 'flip_0') === k);
    for (const id of ALL_ACTIONS) if (/^a\d+$/.test(actionLabel(id))) missing.push(`a${id}`);
    expect(missing).toEqual([]);
  });
});
