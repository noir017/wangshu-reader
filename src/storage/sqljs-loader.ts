// sql.js（SQLite 的 wasm 版）的懒加载：只有导入原版 .mrpro 备份时才会加载/初始化，不拖慢首屏。
// 用 sql.js 自带的 inline 版本（wasm 以 base64 嵌在 js 里）：标准构建里是一个按需加载的 chunk，
// 单文件构建里直接并进 index.html，所以 file:// 打开也不需要再去取任何外部的 .wasm。
import type { SqlJsStatic } from 'sql.js';

let loading: Promise<SqlJsStatic> | undefined;

export function loadSqlJs(): Promise<SqlJsStatic> {
  loading ??= import('sql.js/dist/sql-wasm-inline.js')
    .then((m) => {
      // UMD 包在不同打包器下的默认导出层数不一样
      const mod = m as unknown as { default?: unknown };
      const init = ((mod.default as { default?: unknown } | undefined)?.default ?? mod.default ?? m) as (config?: object) => Promise<SqlJsStatic>;
      return init();
    })
    .catch((e) => {
      loading = undefined; // 失败后允许重试
      throw e;
    });
  return loading;
}
