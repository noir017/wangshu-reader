// 应用级设置（与阅读排版无关的全局项）。各业务模块的设置在各自目录里 defineSettings。
import { defineSettings } from './settings';

export type Lang = 'zh' | 'en';

function defaultLang(): Lang {
  const nav = globalThis.navigator?.language ?? 'zh-CN';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 同源 http(s) 部署时默认用同源服务端；file:// 打开单文件版时默认无服务端（需在设置里填地址） */
function defaultServerUrl(): string {
  const loc = globalThis.location;
  return loc && (loc.protocol === 'http:' || loc.protocol === 'https:') ? loc.origin : '';
}

export const appSettings = defineSettings('app', {
  language: defaultLang() as Lang,
  /** 服务端地址（无尾斜杠）；空 = 不使用服务端，依赖服务端的功能置灰 */
  serverUrl: defaultServerUrl(),
  /** 服务端访问令牌（服务端开启鉴权时用），放在请求头 Authorization: Bearer */
  serverToken: '',
});
