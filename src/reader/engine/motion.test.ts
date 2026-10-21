import { describe, expect, it } from 'vitest';
import { ShakeDetector, TiltDetector } from './motion';

/** 以 20ms 间隔喂入 z 序列（x/y 不变），返回触发结果列表 */
function feed(d: TiltDetector, zs: number[], t0 = 0): Array<string | null> {
  return zs.map((z, i) => d.push(t0 + i * 20, 0.1, 0.2, z));
}

describe('倾斜翻页判定（§4.10）', () => {
  const still = Array(6).fill(9.8);
  it('静止 → 前倾超过灵敏度再回正 → 触发 forward', () => {
    const d = new TiltDetector(1, 1.2);
    const r = feed(d, [...still, 10.5, 11.2, 11.8, 10.5, 9.9]);
    expect(r.filter(Boolean)).toEqual(['forward']);
  });
  it('后倾超过 back 灵敏度再回正 → backward', () => {
    const d = new TiltDetector(1, 1.2);
    const r = feed(d, [...still, 9.0, 8.4, 7.9, 9.0, 9.8]);
    expect(r.filter(Boolean)).toEqual(['backward']);
  });
  it('幅度不够不触发；灵敏度越大越难触发；横屏阈值 ×1.4', () => {
    expect(feed(new TiltDetector(1, 1.2), [...still, 10.4, 10.6, 10.3, 9.8]).filter(Boolean)).toEqual([]);
    expect(feed(new TiltDetector(3, 3), [...still, 11.2, 11.8, 10.5, 9.9]).filter(Boolean)).toEqual([]);
    // dz=1.3：竖屏 >1 触发，横屏需要 >1.4
    const seq = [...still, 11.1, 9.9];
    expect(feed(new TiltDetector(1, 1.2, false), seq).filter(Boolean)).toEqual(['forward']);
    expect(feed(new TiltDetector(1, 1.2, true), seq).filter(Boolean)).toEqual([]);
  });
  it('没有静止基准时不触发；晃动（|Δx|>4）重置基准', () => {
    const d = new TiltDetector(1, 1.2);
    expect(feed(d, [10.5, 11.2, 11.8, 10.5, 9.9]).filter(Boolean)).toEqual([]);
    const d2 = new TiltDetector(1, 1.2);
    feed(d2, still);
    expect(d2.push(500, 6, 0.2, 9.8)).toBeNull(); // 晃动
    expect(feed(d2, [10.5, 11.2, 11.8, 10.5, 9.9], 520).filter(Boolean)).toEqual([]); // 基准被清掉，要重新静止
  });
  it('峰值到回中超过 1 秒不算；两次触发要隔 300ms', () => {
    const d = new TiltDetector(1, 1.2);
    feed(d, still);
    d.push(200, 0.1, 0.2, 11.2); // 峰值
    expect(d.push(1400, 0.1, 0.2, 9.9)).toBeNull(); // 1.2s 后才回中
  });
});

describe('摇一摇判定（CTRL-008）', () => {
  it('第一次快速一甩 + 500ms 内反向一甩 → 触发', () => {
    const d = new ShakeDetector();
    expect(d.push(0, 0, 0, 9.8)).toBe(false);
    expect(d.push(100, 12, 0, 9.8)).toBe(false);
    expect(d.push(200, -2, 0, 9.8)).toBe(true);
  });
  it('同方向、超过 500ms、幅度不够都不触发', () => {
    let d = new ShakeDetector();
    d.push(0, 0, 0, 9.8);
    d.push(100, 12, 0, 9.8);
    expect(d.push(200, 24, 0, 9.8)).toBe(false); // 同方向
    d = new ShakeDetector();
    d.push(0, 0, 0, 9.8);
    d.push(100, 12, 0, 9.8);
    expect(d.push(700, -2, 0, 9.8)).toBe(false); // 超时
    d = new ShakeDetector();
    d.push(0, 0, 0, 9.8);
    d.push(100, 12, 0, 9.8);
    expect(d.push(200, 6, 0, 9.8)).toBe(false); // 反向但分量 6 ≤ 8
  });
  it('采样间隔 ≤60ms 的样本被忽略；两次触发间隔 ≥2000ms', () => {
    const d = new ShakeDetector();
    d.push(0, 0, 0, 9.8);
    expect(d.push(40, 20, 0, 9.8)).toBe(false);
    d.push(100, 12, 0, 9.8);
    expect(d.push(200, -2, 0, 9.8)).toBe(true);
    d.push(300, 12, 0, 9.8);
    expect(d.push(400, -2, 0, 9.8)).toBe(false); // 2 秒内
    d.push(2400, -2, 0, 9.8); // 隔了很久的第一个样本：加权加速度按 Δt 折算，不算一甩
    d.push(2500, 12, 0, 9.8);
    expect(d.push(2600, -2, 0, 9.8)).toBe(true);
  });
});
