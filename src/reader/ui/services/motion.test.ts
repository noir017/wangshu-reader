import { describe, expect, it, vi } from 'vitest';
import { MotionDetector, tiltPageAction, tiltSensToSlider, tiltSliderToSens } from './motion';

function det(over: Partial<ConstructorParameters<typeof MotionDetector>[0]> = {}) {
  const h = { onShake: vi.fn(), onTilt: vi.fn() };
  const d = new MotionDetector({ shakeEnabled: true, tiltEnabled: true, forwardSens: 1.0, backwardSens: 1.2, ...over }, h);
  return { d, h };
}

describe('摇一摇（MyShakeSensorListener）', () => {
  it('先后两次反向的大幅摇动 → 触发一次；2 秒内不重复', () => {
    const { d, h } = det({ tiltEnabled: false });
    let t = 1000;
    d.feed(0, 0, 9.8, t); // 基准
    d.feed(15, 0, 9.8, (t += 70)); // 第一下：+15
    expect(h.onShake).not.toHaveBeenCalled();
    d.feed(0, 0, 9.8, (t += 70)); // 反向 −15
    expect(h.onShake).toHaveBeenCalledOnce();
    // 立即再摇一次：间隔 < 2s，忽略
    d.feed(15, 0, 9.8, (t += 70));
    d.feed(0, 0, 9.8, (t += 70));
    expect(h.onShake).toHaveBeenCalledOnce();
    // 2 秒后可再次触发（先喂一个平稳样本，避免间隔过长把速度摊薄）
    t += 2100;
    d.feed(0, 0, 9.8, t);
    d.feed(15, 0, 9.8, (t += 70));
    d.feed(0, 0, 9.8, (t += 70));
    expect(h.onShake).toHaveBeenCalledTimes(2);
  });

  it('小幅晃动不触发；只有单向大幅也不触发', () => {
    const { d, h } = det({ tiltEnabled: false });
    let t = 1000;
    d.feed(0, 0, 9.8, t);
    for (let i = 0; i < 20; i++) d.feed(i % 2 ? 3 : -3, 0, 9.8, (t += 70));
    d.feed(0, 0, 9.8, (t += 70));
    d.feed(20, 0, 9.8, (t += 70));
    d.feed(20, 0, 9.8, (t += 70));
    expect(h.onShake).not.toHaveBeenCalled();
  });

  it('采样间隔 ≤ 60ms 的样本被抽稀；关闭后不检测', () => {
    const { d, h } = det({ shakeEnabled: false, tiltEnabled: false });
    let t = 1000;
    d.feed(0, 0, 9.8, t);
    d.feed(15, 0, 9.8, (t += 70));
    d.feed(0, 0, 9.8, (t += 70));
    expect(h.onShake).not.toHaveBeenCalled();
  });
});

describe('倾斜翻页（tilt）', () => {
  /** 静止 6 次（建立基准 z）→ 前倾一下再回正 */
  function settle(d: MotionDetector, t: { v: number }, z = 9.0) {
    for (let i = 0; i < 6; i++) d.feed(0, 5, z, (t.v += 70));
  }

  it('前倾（z 增大超过灵敏度）后在 1 秒内回正 → onTilt(forward)', () => {
    const { d, h } = det({ shakeEnabled: false });
    const t = { v: 1000 };
    settle(d, t);
    d.feed(0, 5, 11.5, (t.v += 70)); // dz = +2.5 > 1.0
    expect(h.onTilt).not.toHaveBeenCalled();
    d.feed(0, 5, 9.0, (t.v += 70)); // 回正
    expect(h.onTilt).toHaveBeenCalledWith('forward');
  });

  it('后倾 → onTilt(backward)', () => {
    const { d, h } = det({ shakeEnabled: false });
    const t = { v: 1000 };
    settle(d, t);
    d.feed(0, 5, 6.0, (t.v += 70)); // dz = −3 < −1.2
    d.feed(0, 5, 9.0, (t.v += 70));
    expect(h.onTilt).toHaveBeenCalledWith('backward');
  });

  it('倾斜幅度刚过阈值、回落后停在半途超过 1 秒 → 作废，之后回正也不触发', () => {
    const { d, h } = det({ shakeEnabled: false });
    const t = { v: 1000 };
    settle(d, t);
    d.feed(0, 5, 10.1, (t.v += 70)); // dz = +1.1，刚过 1.0
    for (let i = 0; i < 20; i++) d.feed(0, 5, 9.9, (t.v += 70)); // dz = 0.9：不低于峰值一半，也没回到中心
    d.feed(0, 5, 9.0, (t.v += 70));
    expect(h.onTilt).not.toHaveBeenCalled();
  });

  it('灵敏度阈值更小（滑条更灵敏）时，小幅度倾斜也触发', () => {
    const sensitive = det({ shakeEnabled: false, forwardSens: 0.3 });
    const t2 = { v: 1000 };
    settle(sensitive.d, t2);
    sensitive.d.feed(0, 5, 9.6, (t2.v += 70));
    sensitive.d.feed(0, 5, 9.0, (t2.v += 70));
    expect(sensitive.h.onTilt).toHaveBeenCalledWith('forward');
  });

  it('大幅晃动（|Δx|>4）会重置基准，不触发', () => {
    const { d, h } = det({ shakeEnabled: false });
    const t = { v: 1000 };
    settle(d, t);
    d.feed(8, 5, 11.5, (t.v += 70));
    d.feed(0, 5, 9.0, (t.v += 70));
    expect(h.onTilt).not.toHaveBeenCalled();
  });
});

describe('倾斜设置换算', () => {
  it('灵敏度滑条 0..40 ↔ 阈值 4.3−p/10', () => {
    expect(tiltSensToSlider(1.0)).toBe(33);
    expect(tiltSensToSlider(1.2)).toBe(31);
    expect(tiltSliderToSens(33)).toBe(1);
    expect(tiltSliderToSens(0)).toBe(4.3);
    expect(tiltSliderToSens(40)).toBe(0.3);
  });
  it('倾斜动作取值：0 = 下一页、1 = 上一页', () => {
    expect(tiltPageAction(0)).toBe('next');
    expect(tiltPageAction(1)).toBe('prev');
  });
});
