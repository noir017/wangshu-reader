// 朗读设置（spec 03 §3.4）。
import { defineSettings } from '@/core/settings';
import { DEFAULT_FILTERS, type TtsFilter } from './filter';
import type { DivideMode } from './split';

export const ttsSettings = defineSettings('features.tts', {
  /** 内容划分：0 逗号 / 1 句号 / 2 整段 / 3 整页 */
  divide: 1 as DivideMode,
  /** 语速/音调：值/10 = 倍率（默认 10 = 1×） */
  speed: 10,
  pitch: 10,
  /** 音量 0..100（原 app 调系统媒体音量，web 用 utterance.volume / audio.volume） */
  volume: 100,
  stopEnable: false,
  /** 定时停止（分钟） */
  stopTime: 10,
  intervalEnable: false,
  /** 句间间隔（毫秒） */
  intervalTime: 500,
  /** 朗读前先弹选项对话框 */
  askForTts: true,
  /** 引擎：浏览器 Web Speech / 服务端 /api/tts */
  engine: 'web' as 'web' | 'server',
  /** Web Speech 声音（SpeechSynthesisVoice.voiceURI）；空 = 按书籍语言自动选 */
  voiceURI: '',
  /** 服务端声音 id；空 = 服务端默认 */
  serverVoice: '',
  /** 过滤规则按正则 */
  filterRegex: false,
  filters: DEFAULT_FILTERS as TtsFilter[],
  /** 朗读期间保持屏幕常亮 */
  keepAwake: true,
});
