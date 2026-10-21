// 开发用 vite 配置：隔离别的模块施工期间的报错，只在我自己的开发服务器上用（vite --config 指定），不影响正式构建与 vitest。
//  - `@/library`（书库总出口）换成 dev/library-stub.ts：阅读页只用 openBookInfo/getAdjacentBook/syncToCloud/syncFromCloud；
//  - STUB_FEATURES=1 时 `@/features` 换成 dev/features-stub.tsx（把 bus 命令记到 window.__busLog）。
import { fileURLToPath } from 'node:url';
import { mergeConfig, type ConfigEnv, type Plugin, type UserConfig } from 'vite';
import base from '../../../../vite.config';

/** 别的模块的源码里偶尔混进裸的 U+2028/2029（正则字面量里会让解析器报错）：开发服务器上先转义，不改别人的文件 */
function escapeLineSeparators(): Plugin {
  return {
    name: 'reader-ui-dev-escape-line-separators',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\u2028\u2029]/.test(code) || !/\.tsx?$/.test(id.split('?')[0])) return null;
      return { code: code.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'), map: null };
    },
  };
}

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

export default (env: ConfigEnv): UserConfig => {
  const root = typeof base === 'function' ? (base(env) as UserConfig) : (base as UserConfig);
  const alias = [{ find: /^@\/library$/, replacement: here('./library-stub.ts') }];
  if (process.env.STUB_FEATURES === '1') alias.push({ find: /^@\/features$/, replacement: here('./features-stub.tsx') });
  // 覆盖项的 alias 排在前面，先于 '@' 通配生效
  return mergeConfig(root, { plugins: [escapeLineSeparators()], resolve: { alias } });
};
