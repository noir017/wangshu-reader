// 阅读引擎对外入口。接口定义见 src/core/reader.ts。
import type { CreateReader } from '@/core/reader';
import { Engine } from './controller';
import { FixedEngine } from './fixed';

export const createReader: CreateReader = (book) => (book.kind === 'fixed' ? new FixedEngine(book) : new Engine(book));

export { TEXTURES, textureById, resolveBackground } from './textures';
export type { Texture } from './textures';
export { nameSettings } from './transforms';
export type { NameRule } from './transforms';
