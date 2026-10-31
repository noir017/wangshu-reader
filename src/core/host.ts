// 原生壳（Android app，见 android/）注入的宿主信息。浏览器、单文件版里没有，一切照旧。
// 壳在页面脚本运行前注入 window.__WANGSHU_HOST__（只注入 app 自己的源），并提供 WangshuAndroid 跟原生互发消息。
// 两种服务端模式共用同一个页面源（https://localhost），书架数据（IndexedDB）不随模式切换而分家。

export type ServerMode = 'local' | 'remote';

export interface NativeHost {
  platform: 'android';
  /** local = app 内置服务端；remote = 用设置里填的远程服务端 */
  mode: ServerMode;
  /** 内置服务端（mode=local 时有）；ok=false 表示没起来，error 是原因 */
  local?: { url: string; token: string; ok: boolean; error?: string };
  /** 系统状态栏高度（CSS px，含刘海）。阅读页铺满全屏，顶部按它留出一条，状态栏显隐时正文高度不变 */
  statusBarHeight?: number;
}

declare global {
  interface Window {
    __WANGSHU_HOST__?: NativeHost;
    WangshuAndroid?: {
      postMessage(msg: string): void;
      addEventListener(type: 'message', fn: (e: MessageEvent<string>) => void): void;
    };
  }
}

export const nativeHost: NativeHost | undefined = typeof window !== 'undefined' ? window.__WANGSHU_HOST__ : undefined;

/** 内置服务端在用时的地址与令牌，优先于设置里的 serverUrl/serverToken */
export function hostServer(): { url: string; token: string } | undefined {
  return nativeHost?.mode === 'local' ? nativeHost.local : undefined;
}

function post(msg: Record<string, unknown>): void {
  window.WangshuAndroid?.postMessage(JSON.stringify(msg));
}

/** 切换服务端模式：原生端保存、启停内置服务端，然后重新加载页面 */
export function setServerMode(mode: ServerMode): void {
  post({ type: 'setMode', mode });
}

/**
 * 阅读页的系统栏（WebView 不给网页用 Fullscreen API，由原生代办）：on = 阅读页布局（铺满全屏、状态栏透明浮在页面上）；
 * hideStatus / hideNav = 隐藏状态栏 / 导航栏（边缘划入可临时呼出）
 */
export function setHostReader(state: { on: boolean; hideStatus: boolean; hideNav: boolean }): void {
  post({ type: 'reader', ...state });
}

/** 状态栏底色 #rrggbb；light = 浅色底、深色图标 */
export function setHostStatusBar(color: string, light: boolean): void {
  post({ type: 'statusBar', color, light });
}

/**
 * 别的 app「用望舒打开」的文件：原生把每个文件挂在本页面源的一个地址上（响应头 X-File-Name 是 URI 编码的文件名）。
 * 调用后原生才开始投递，页面起来前收到的会先攒着
 */
export function onHostOpenFiles(fn: (urls: string[]) => void): void {
  const bridge = typeof window !== 'undefined' ? window.WangshuAndroid : undefined;
  if (!bridge) return;
  bridge.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data) as { type?: string; urls?: string[] };
    if (msg.type === 'openFiles' && msg.urls?.length) fn(msg.urls);
  });
  post({ type: 'ready' });
}
