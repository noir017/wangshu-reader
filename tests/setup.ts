// vitest 全局准备
// 1) 给 happy-dom 补上 IndexedDB
// 2) 用 Node 原生 Blob/File 替换 happy-dom 的实现：fake-indexeddb 用 structuredClone 存取，
//    只认 Node 的 Blob；happy-dom 的 Blob 存进去再取出来会变成没有方法的普通对象
import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile });
