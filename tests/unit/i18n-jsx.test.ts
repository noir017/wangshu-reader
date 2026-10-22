// @vitest-environment node
// 守护测试：界面代码里不能有硬编码的英文文案（应走 defineMessages）。
// 静态扫 src/ 的 .ts/.tsx：JSX 文本、文案类属性（aria-label/title/placeholder/alt/label/hint/subtitle）里的字面量，
// 对象字面量里 label/title/text/message… 属性的字面量，以及 toast()/alert()/confirm()/confirmDialog()/promptDialog() 直接传入的字面量。品牌/格式/协议名等见 i18n-allow.ts 白名单。
// 只认字面量：t('key') 这类调用不检查（字典本身由 i18n-dicts.test.ts 把关）。
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseAst } from 'vite';
import { latinLeftover } from './i18n-allow';

const root = process.cwd();
// 开发调试页、测试夹具、样书生成器不是用户界面
const SKIP = /\/(dev|testing)\/|\/mock-[^/]*$|fixture/;
// 存的是原文/编码名、显示时另行本地化的数据表（对象属性检查对它们不适用；JSX 与 toast 仍照查）
const DATA_FILES = new Set([
  'src/library/catalogs.ts', // 内置书库：存原 app 英文原文，显示走 catalogTitle()/catalogSummary()
  'src/formats/encoding.ts', // 文字编码名（AUTO 显示时换成「自动检测」）
  'src/reader/ui/settings/options-data.ts', // 同上
  'src/library/shelf-model.ts', // 格式名
  'src/storage/readwise.ts', // 发给 Readwise 的测试高亮（原 app 同款内容），不在本 app 界面显示
]);
const MESSAGE_KEY = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const TEXT_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'hint', 'subtitle', 'aria-description', 'aria-valuetext']);
// 对象字面量里这些属性的值多半直接显示（菜单项、下拉选项、对话框参数）
const TEXT_PROPS = new Set(['label', 'title', 'text', 'message', 'hint', 'subtitle', 'placeholder', 'summary', 'desc', 'description']);
const MSG_CALLS = new Set(['toast', 'alert', 'confirm', 'prompt', 'confirmDialog', 'promptDialog', 'window.alert', 'window.confirm', 'window.prompt']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|d)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

type Node = { type: string; start: number; end: number; [k: string]: unknown };
const isNode = (x: unknown): x is Node => !!x && typeof x === 'object' && typeof (x as Node).type === 'string';

/** 表达式里「会原样显示」的字面量：字符串、模板字面量的固定部分、三元/逻辑运算的分支；不进函数调用和嵌套 JSX */
function displayedLiterals(x: unknown, out: string[] = []): string[] {
  if (!isNode(x)) return out;
  switch (x.type) {
    case 'Literal':
      if (typeof x.value === 'string') out.push(x.value);
      break;
    case 'TemplateLiteral':
      for (const q of x.quasis as { value: { cooked?: string; raw: string } }[]) out.push(q.value.cooked ?? q.value.raw);
      for (const e of x.expressions as unknown[]) displayedLiterals(e, out);
      break;
    case 'JSXExpressionContainer':
      displayedLiterals(x.expression, out);
      break;
    case 'ConditionalExpression':
      displayedLiterals(x.consequent, out);
      displayedLiterals(x.alternate, out);
      break;
    case 'LogicalExpression':
      displayedLiterals(x.right, out);
      break;
    case 'BinaryExpression':
      if (x.operator === '+') {
        displayedLiterals(x.left, out);
        displayedLiterals(x.right, out);
      }
      break;
    case 'TSAsExpression':
    case 'ParenthesizedExpression':
      displayedLiterals(x.expression, out);
      break;
  }
  return out;
}

function scan(file: string, src: string): string[] {
  const ast = parseAst(src, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }) as unknown as Node;
  const bad: string[] = [];
  const line = (pos: number) => src.slice(0, pos).split('\n').length;
  const report = (n: Node, what: string, texts: string[]) => {
    const left = texts.filter((x) => !MESSAGE_KEY.test(x)).map(latinLeftover).filter(Boolean).join(' ');
    if (left) bad.push(`${file}:${line(n.start)} ${what} ${JSON.stringify(texts.join('…').slice(0, 80))} → ${left}`);
  };
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!isNode(n)) return;
    if (n.type === 'JSXText') {
      const s = String(n.value).trim();
      if (s) report(n, 'JSX 文本', [s]);
    } else if (n.type === 'JSXAttribute') {
      const name = n.name as Node & { name: unknown };
      if (name.type === 'JSXIdentifier' && TEXT_ATTRS.has(String(name.name))) report(n, String(name.name), displayedLiterals(n.value));
    } else if (n.type === 'CallExpression' && src.slice((n.callee as Node).start, (n.callee as Node).end) === 'defineMessages') {
      return; // 字典由 i18n-dicts.test.ts 检查（en 字典本来就是英文）
    } else if (n.type === 'Property' && !n.computed && isNode(n.key) && !DATA_FILES.has(file)) {
      const key = n.key.type === 'Identifier' ? String(n.key.name) : n.key.type === 'Literal' ? String(n.key.value) : '';
      if (TEXT_PROPS.has(key)) report(n, `${key}:`, displayedLiterals(n.value));
    } else if (n.type === 'CallExpression') {
      const callee = src.slice((n.callee as Node).start, (n.callee as Node).end);
      const args = n.arguments as unknown[];
      if (MSG_CALLS.has(callee) && args.length) report(n, `${callee}()`, displayedLiterals(args[0]));
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'start' && k !== 'end' && v && typeof v === 'object') visit(v);
  };
  visit(ast);
  return bad;
}

describe('界面代码没有硬编码英文', () => {
  const files = walk(join(root, 'src'))
    .map((f) => relative(root, f).split('\\').join('/'))
    .filter((f) => !SKIP.test(f));

  it('扫描到了足够多的界面文件', () => {
    expect(files.filter((f) => f.endsWith('.tsx')).length).toBeGreaterThan(50);
  });

  it('JSX 文本、文案属性、toast/confirm 参数里没有英文字面量', () => {
    const bad = files.flatMap((f) => scan(f, readFileSync(join(root, f), 'utf8')));
    expect(bad).toEqual([]);
  });

  it('扫描器本身能抓到英文（防止规则失效）', () => {
    const sample = `const a = <div title="Close" aria-label={x ? 'menu' : '菜单'}>Hello {n} items<b>EPUB</b></div>; toast(\`Saved \${n}\`); toast(t('ok')); popupMenu(0, 0, [{ label: 'Rename', id: 'rename' }, { label: t('x') }]);`;
    expect(scan('sample.tsx', sample).map((s) => s.split(' → ')[1])).toEqual(['Close', 'menu', 'Hello', 'items', 'Saved', 'Rename']);
  });
});
