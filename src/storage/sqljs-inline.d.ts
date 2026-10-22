// sql.js 的 inline 版本（wasm 内嵌）没有自带类型声明，这里补上
declare module 'sql.js/dist/sql-wasm-inline.js' {
  import type { SqlJsConfig, SqlJsStatic } from 'sql.js';
  const initSqlJs: (config?: SqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
