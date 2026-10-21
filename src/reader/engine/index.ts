// 阅读引擎对外入口。接口定义见 src/core/reader.ts。
import type { CreateReader } from '@/core/reader';
import { Engine } from './controller';

export const createReader: CreateReader = (book) => {
  if (book.kind === 'fixed') throw new Error('固定版式引擎尚未实现');
  return new Engine(book);
};

export { TEXTURES, textureById, resolveBackground } from './textures';
export type { Texture } from './textures';
export { nameSettings } from './transforms';
export type { NameRule } from './transforms';
