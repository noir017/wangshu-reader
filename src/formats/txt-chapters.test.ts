import { describe, expect, it } from 'vitest';
import { chapterLengthOk, chineseChapterTagOk, detectChapters, profileText, trimChapterTitle1, trimChapterTitle2 } from './txt-chapters';

const para = (n: number) => '这是一段用来填充章节内容的文字，它不包含任何会被误认为标题的特征。'.repeat(n);

function novel(titles: string[], body = para(8)): string {
  return titles.map((t) => `${t}\n${body}\n\n`).join('');
}

describe('TXT 分章：关键字法（中文）', () => {
  it('第X章 / 第X回 / 卷', () => {
    const titles = ['第一章 初入江湖', '第二章 风起云涌', '第三章 暗流', '第四章 决战', '第五章 尾声'];
    const text = novel(titles);
    const ch = detectChapters(text, { mode: 'auto' });
    expect(ch.map((c) => c.title)).toEqual(titles);
    expect(ch[0].pos).toBe(0);
    expect(text.slice(ch[1].pos).startsWith('第二章')).toBe(true);
  });
  it('章回体与缩进标题', () => {
    const titles = ['　　第一回 甄士隐梦幻识通灵', '　　第二回 贾夫人仙逝扬州城', '　　第三回 托内兄如海荐西宾'];
    const ch = detectChapters(novel(titles), { mode: 'auto' });
    expect(ch.map((c) => c.title)).toEqual(titles.map((t) => t.trim()));
  });
  it('正文行内提到「第三章」不算章节', () => {
    const text = novel(['第一章 开始', '第二章 继续', '第三章 结束']) + '他在笔记里写道 第四章 还没有写完。\n';
    expect(detectChapters(text, { mode: 'auto' })).toHaveLength(3);
  });
  it('目录页里挨着的章节名（间距 <100）只保留最后一个', () => {
    const toc = '目录\n第一章 甲\n第二章 乙\n第三章 丙\n';
    const text = `${toc}\n${novel(['第一章 甲', '第二章 乙', '第三章 丙'])}`;
    const ch = detectChapters(text, { mode: 'auto' });
    expect(ch).toHaveLength(3);
    expect(ch[0].pos).toBeGreaterThan(toc.length - 20);
  });
  it('标题过长或不含章回标记的不算', () => {
    expect(chapterLengthOk('第一章')).toBe(true);
    expect(chapterLengthOk('第')).toBe(false);
    expect(chapterLengthOk('第' + '一'.repeat(60))).toBe(false);
    expect(chineseChapterTagOk('第一章 开始')).toBe(true);
    expect(chineseChapterTagOk('第一次见面')).toBe(false);
    expect(chineseChapterTagOk('第十二卷 某某传')).toBe(true);
  });
  it('trimChapterTitle', () => {
    expect(trimChapterTitle1('　　第一章\t开头 ')).toBe('第一章 开头');
    expect(trimChapterTitle2('第一章 开头（这里是一段很长的注释内容）')).toBe('第一章 开头');
    expect(trimChapterTitle2('第一章 (a)')).toBe('第一章 (a)');
  });
});

describe('TXT 分章：英文', () => {
  const body = 'It was a bright cold day in April, and the clocks were striking thirteen.\n'.repeat(10);
  it('CHAPTER N.', () => {
    const text = ['CHAPTER I.', 'CHAPTER II.', 'CHAPTER III.', 'Chapter 4'].map((t) => `${t}\n\n${body}\n`).join('');
    const prof = profileText(text);
    expect(prof.cjk).toBe(false);
    expect(detectChapters(text, { mode: 'auto' }).map((c) => c.title)).toEqual(['CHAPTER I.', 'CHAPTER II.', 'CHAPTER III.', 'Chapter 4']);
  });
  it('行内提到 chapter 不算', () => {
    const text = `CHAPTER I.\n${body}\nAs I said in chapter one, nothing happens here at all really.\n${body}CHAPTER II.\n${body}`;
    expect(detectChapters(text, { mode: 'auto' })).toHaveLength(2);
  });
});

describe('TXT 分章：行特征法', () => {
  it('「一、」「二、」前缀标题', () => {
    const titles = ['一、少年', '二、离家', '三、远行', '四、重逢', '五、结局'];
    const text = titles.map((t) => `${t}\n　　${para(6)}\n　　${para(3)}\n`).join('');
    const ch = detectChapters(text, { mode: 'auto' });
    expect(ch.map((c) => c.title)).toEqual(titles);
  });
  it('数字序号递增 001 002 …', () => {
    const titles = ['001 开端', '002 发展', '003 转折', '004 高潮', '005 结束'];
    const text = titles.map((t) => `${t}\n${para(5)}\n`).join('');
    expect(detectChapters(text, { mode: 'auto' }).map((c) => c.title)).toEqual(titles);
  });
  it('孤立短行标题（前后空行）', () => {
    const titles = ['楔子', '山中奇遇', '师门旧事', '风雪夜归人', '江湖再见', '尾声'];
    const text = titles.map((t) => `\n${t}\n\n${para(12)}\n`).join('');
    const ch = detectChapters(text, { mode: 'auto' });
    expect(ch.map((c) => c.title)).toEqual(titles);
  });
  it('## 标记行', () => {
    const titles = Array.from({ length: 25 }, (_, i) => `##${i + 1}##`);
    const text = titles.map((t) => `${t}\n${para(3)}\n`).join('');
    expect(detectChapters(text, { mode: 'auto' })).toHaveLength(25);
  });
  it('普通小说段落（含对话）不应被误判', () => {
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) lines.push(`　　“你好吗？”他问道。`, `　　“还不错，”她说，“你呢？”`, `　　今天天气很好，两个人沿着河边慢慢地走着。`);
    expect(detectChapters(lines.join('\n'), { mode: 'auto' })).toEqual([]);
  });
  it('少于 4 条视为无章节', () => {
    expect(detectChapters(novel(['一、甲', '二、乙', '三、丙']), { mode: 'line' })).toEqual([]);
  });
});

describe('TXT 分章：模式开关与自定义正则', () => {
  it('off 不分章', () => {
    expect(detectChapters(novel(['第一章 甲', '第二章 乙']), { mode: 'off' })).toEqual([]);
  });
  it('自定义正则', () => {
    const text = ['Part A', 'x'.repeat(50), 'Part B', 'y'.repeat(50), 'Part C', 'z'].join('\n');
    expect(detectChapters(text, { mode: 'regex', regex: '^part\\s+\\w+$' }).map((c) => c.title)).toEqual(['Part A', 'Part B', 'Part C']);
    expect(detectChapters(text, { mode: 'regex', regex: '/^PART [AB]$/' }).map((c) => c.title)).toEqual([]);
    expect(detectChapters(text, { mode: 'regex', regex: '/^PART [AB]$/i' })).toHaveLength(2);
  });
  it('只用关键字法 / 只用行特征法', () => {
    const t = novel(['第一章 甲', '第二章 乙', '第三章 丙', '第四章 丁']);
    expect(detectChapters(t, { mode: 'keyword' })).toHaveLength(4);
    expect(detectChapters(t, { mode: 'line' }).length).not.toBe(5);
  });
});
