// 词典与翻译设置（spec 03 §3.5）。
import { appSettings } from '@/core/app-settings';
import { defineSettings } from '@/core/settings';
import { DEFAULT_CUSTOM_URL, defaultDestLang } from './sources';

const zh = appSettings.get().language === 'zh';

export const dictSettings = defineSettings('features.dict', {
  /** 词典 1（单击词典按键）/ 词典 2（长按）：来源 id，见 sources.ts；原版默认词典 2 = 翻译 */
  dict1: 'inline',
  dict2: 'translate',
  /** 自定义在线词典模板，%s 代替查询词 */
  myDictUrl: DEFAULT_CUSTOM_URL,
  /** 翻译源 / 目标语言（auto 或语言代码） */
  sourceLanguage: 'auto',
  destLanguage: defaultDestLang(appSettings.get().language),
  /** 选词后立即打开词典（引擎选择结束后由本模块触发查词） */
  openDictDirect: false,
  /** 单字查词：点中汉字/假名只选一个字（引擎长按选词时读取） */
  oneCharDict: zh,
  /** 服务端内联词典的来源 id；空 = 服务端默认 */
  inlineSource: '',
  /** 服务端翻译引擎 id；空 = 服务端默认 */
  translateProvider: '',
});
