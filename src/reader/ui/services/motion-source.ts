// DeviceMotion 接线：加速度（含重力）采样 → MotionDetector。仅手机浏览器有效；iOS 需要手势里 requestPermission。
export type MotionPermission = 'granted' | 'denied' | 'unsupported';

interface DeviceMotionCtor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function motionSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
}

/** 必须在用户手势（点击）里调用 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (!motionSupported()) return 'unsupported';
  const ctor = (window as unknown as { DeviceMotionEvent: DeviceMotionCtor }).DeviceMotionEvent;
  if (typeof ctor.requestPermission === 'function') {
    try {
      return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  return 'granted';
}

const isIOS = (): boolean => /iP(hone|ad|od)/.test(globalThis.navigator?.userAgent ?? '');

/** 监听采样，返回取消函数。iOS 的符号与 Android 相反，这里统一成 Android 坐标系 */
export function listenMotion(onSample: (x: number, y: number, z: number, nowMs: number) => void): () => void {
  if (!motionSupported()) return () => {};
  const sign = isIOS() ? -1 : 1;
  const fn = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    onSample(sign * a.x, sign * a.y, sign * a.z, performance.now());
  };
  window.addEventListener('devicemotion', fn);
  return () => window.removeEventListener('devicemotion', fn);
}
