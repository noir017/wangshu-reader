// Android app：系统状态栏跟页面顶边同色。不让各页面自己报颜色（书架标题栏、多选栏、夜间、阅读页纸色、菜单栏、
// 对话框遮罩各不相同），而是取屏幕顶边中点实际画出来的背景色（自上而下叠加半透明层），变了才通知原生。
import { nativeHost, setHostStatusBar } from './host';

type Rgba = [number, number, number, number];

/** getComputedStyle 的 backgroundColor：rgb()/rgba()；color-mix() 之类会是 color(srgb r g b / a)，分量 0~1 */
export function parseCssColor(css: string): Rgba | null {
  const m = /^(rgba?|color)\((.*)\)$/.exec(css.trim());
  if (!m) return null;
  let body = m[2];
  const srgb = m[1] === 'color';
  if (srgb) {
    if (!body.startsWith('srgb ')) return null;
    body = body.slice(5);
  }
  const n = body.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (n.length < 3 || n.some(Number.isNaN)) return null;
  const k = srgb ? 255 : 1;
  return [n[0] * k, n[1] * k, n[2] * k, n[3] ?? 1];
}

/** 自上而下的各层叠出最终颜色，最底下垫白（WebView 的默认底色） */
export function compositeLayers(layers: Rgba[]): [number, number, number] {
  let rgb: [number, number, number] = [255, 255, 255];
  for (let i = layers.length - 1; i >= 0; i--) {
    const [r, g, b, a] = layers[i];
    rgb = [r * a + rgb[0] * (1 - a), g * a + rgb[1] * (1 - a), b * a + rgb[2] * (1 - a)];
  }
  return rgb;
}

export function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

/** 浅色底配深色图标（YIQ 亮度） */
export function isLightColor([r, g, b]: [number, number, number]): boolean {
  return r * 0.299 + g * 0.587 + b * 0.114 >= 128;
}

function topColor(): [number, number, number] {
  // elementsFromPoint 自上而下列出该点下的所有元素（含祖先）；pointer-events:none 的层（亮度遮罩等）不在其中
  const layers: Rgba[] = [];
  for (const el of document.elementsFromPoint(window.innerWidth / 2, 0)) {
    const c = parseCssColor(getComputedStyle(el).backgroundColor);
    if (!c || c[3] <= 0) continue;
    layers.push(c);
    if (c[3] >= 1) break;
  }
  return compositeLayers(layers);
}

export function startStatusBarSync(): void {
  if (!nativeHost || typeof MutationObserver === 'undefined') return;
  let last = '';
  let timer = 0;
  const run = () => {
    timer = 0;
    const rgb = topColor();
    const hex = toHex(rgb);
    if (hex === last) return;
    last = hex;
    setHostStatusBar(hex, isLightColor(rgb));
  };
  // 节流：翻页动画、自动滚屏期间 DOM 一直在变，100ms 最多取一次色
  const schedule = () => {
    if (!timer) timer = window.setTimeout(run, 100);
  };
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  window.addEventListener('hashchange', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  schedule();
}
