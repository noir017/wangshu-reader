import { describe, expect, it } from 'vitest';
import { canReset, countdownView, formatTimes, pitchOf, rateOf, sliderToPitch, sliderToSpeed, speedToSlider, volumeOf } from './params';

describe('朗读参数映射', () => {
  it('语速滑块：≤30 线性，>30 步长 2，最高 5×', () => {
    expect(sliderToSpeed(0)).toBe(1);
    expect(sliderToSpeed(10)).toBe(10);
    expect(sliderToSpeed(30)).toBe(30);
    expect(sliderToSpeed(31)).toBe(32);
    expect(sliderToSpeed(40)).toBe(50);
    expect(sliderToSpeed(99)).toBe(50);
  });
  it('反向映射可往返', () => {
    for (let p = 1; p <= 40; p++) expect(speedToSlider(sliderToSpeed(p))).toBe(p);
    expect(speedToSlider(50)).toBe(40);
    expect(speedToSlider(0)).toBe(1);
  });
  it('倍率与钳位', () => {
    expect(rateOf(10)).toBe(1);
    expect(rateOf(50)).toBe(5);
    expect(rateOf(0)).toBe(0.1);
    expect(pitchOf(20)).toBe(2);
    expect(pitchOf(0)).toBe(0.1);
    expect(sliderToPitch(0)).toBe(1);
    expect(sliderToPitch(25)).toBe(20);
    expect(volumeOf(50)).toBe(0.5);
    expect(volumeOf(500)).toBe(1);
    expect(formatTimes(15)).toBe('1.5×');
  });
  it('重置按钮、倒计时显示', () => {
    expect(canReset(10, 10)).toBe(false);
    expect(canReset(12, 10)).toBe(true);
    expect(canReset(10, 9)).toBe(true);
    expect(countdownView(125)).toEqual({ text: '02:05', urgent: false });
    expect(countdownView(10)).toEqual({ text: '10', urgent: true });
    expect(countdownView(0.2)).toEqual({ text: '1', urgent: true });
  });
});
