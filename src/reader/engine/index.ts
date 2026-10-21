// 阅读引擎对外入口（src/reader/engine 负责实现）。接口定义见 src/core/reader.ts。
import type { CreateReader } from '@/core/reader';

export const createReader: CreateReader = () => {
  throw new Error('reader engine 尚未实现');
};
