// 应用级设置（与阅读排版无关的全局项）。各业务模块的设置在各自目录里 defineSettings。
import { nativeHost } from './host';
import { defineSettings } from './settings';

export type Lang = 'zh' | 'en';

/** 同源 http(s) 部署时默认用同源服务端；file:// 打开单文件版、Android app（页面源是壳虚拟的）时默认无服务端（需在设置里填地址） */
function defaultServerUrl(): string {
  const loc = globalThis.location;
  return loc && !nativeHost && (loc.protocol === 'http:' || loc.protocol === 'https:') ? loc.origin : '';
}

export const appSettings = defineSettings('app', {
  /** 界面语言：一律默认简体中文，不看浏览器语言；英文只在设置里手动选。
   *  设置只持久化改过的字段（见 settings.ts），所以没手动改过语言的老用户也会回到中文 */
  language: 'zh' as Lang,
  /** 服务端地址（无尾斜杠）；空 = 不使用服务端，依赖服务端的功能置灰 */
  serverUrl: defaultServerUrl(),
  /** 服务端访问令牌（服务端开启鉴权时用），放在请求头 Authorization: Bearer */
  serverToken: '',
});
