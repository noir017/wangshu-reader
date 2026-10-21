import { describe, expect, it } from 'vitest';
import { controlSettings } from '@/reader/settings';
import { isTypingTarget, keyAction, keyName } from './keys';

describe('键盘映射（CTRL-005）', () => {
  const map = controlSettings.defaults.keyMap;

  it('keyName：Ctrl+f / 空格 / 普通键', () => {
    expect(keyName({ key: 'f', ctrlKey: true })).toBe('Ctrl+f');
    expect(keyName({ key: 'F', metaKey: true })).toBe('Ctrl+f');
    expect(keyName({ key: ' ' })).toBe(' ');
    expect(keyName({ key: 'PageDown' })).toBe('PageDown');
    expect(keyName({ key: 'x', altKey: true })).toBe('Alt+x');
  });

  it('默认映射：翻页键、方向键、空格、Enter、Ctrl+F', () => {
    expect(keyAction(map, { key: 'PageUp' })).toBe(0);
    expect(keyAction(map, { key: 'PageDown' })).toBe(1);
    expect(keyAction(map, { key: 'ArrowLeft' })).toBe(0);
    expect(keyAction(map, { key: 'ArrowRight' })).toBe(1);
    expect(keyAction(map, { key: ' ' })).toBe(1);
    expect(keyAction(map, { key: 'Enter' })).toBe(8);
    expect(keyAction(map, { key: 'f', ctrlKey: true })).toBe(4);
  });

  it('Shift+空格 = PageUp 的动作', () => {
    expect(keyAction(map, { key: ' ', shiftKey: true })).toBe(0);
  });

  it('没有绑定的键返回 undefined', () => {
    expect(keyAction(map, { key: 'q' })).toBeUndefined();
    expect(keyAction(map, { key: 'f' })).toBeUndefined();
  });

  it('输入控件里的按键不处理', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
