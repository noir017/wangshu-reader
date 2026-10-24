// 原生壳（Android app，见 android/）注入的宿主信息。浏览器、单文件版里没有，一切照旧。
// 壳在页面脚本运行前注入 window.__WANGSHU_HOST__（只注入 app 自己的源），并提供 WangshuAndroid.postMessage 回调原生。
// 两种服务端模式共用同一个页面源（https://localhost），书架数据（IndexedDB）不随模式切换而分家。

export type ServerMode = 'local' | 'remote';

export interface NativeHost {
  platform: 'android';
  /** local = app 内置服务端；remote = 用设置里填的远程服务端 */
  mode: ServerMode;
  /** 内置服务端（mode=local 时有）；ok=false 表示没起来，error 是原因 */
  local?: { url: string; token: string; ok: boolean; error?: string };
}

declare global {
  interface Window {
    __WANGSHU_HOST__?: NativeHost;
    WangshuAndroid?: { postMessage(msg: string): void };
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

/** 全屏阅读：原生隐藏状态栏和导航栏（WebView 不给网页用 Fullscreen API） */
export function setHostFullscreen(on: boolean): void {
  post({ type: 'fullscreen', on });
}

/** 状态栏底色 #rrggbb；light = 浅色底、深色图标 */
export function setHostStatusBar(color: string, light: boolean): void {
  post({ type: 'statusBar', color, light });
}
