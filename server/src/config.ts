// 服务端配置：全部来自环境变量，便于容器部署。
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  /** 前端静态文件目录（vite build 的 dist）；不存在则不托管 */
  staticDir?: string;
  /** 服务端持久数据根目录（同步数据、上传的书、缓存等） */
  dataDir: string;
  /** 服务端书库目录（模拟手机上的本地文件夹浏览）；未设则功能关闭 */
  libraryDir?: string;
  /** 访问令牌；空 = 不鉴权（只应在内网/本机使用） */
  token: string;
  version: string;
  /** 运行时探测到的可选能力（例如外部命令是否存在），由各路由模块写入，/api/health 回报 */
  features: Record<string, boolean>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = process.cwd();
  const dataDir = path.resolve(env.MR_DATA_DIR ?? path.join(root, 'server', 'data'));
  mkdirSync(dataDir, { recursive: true });
  const staticCandidate = path.resolve(env.MR_STATIC_DIR ?? path.join(root, 'dist'));
  return {
    host: env.MR_HOST ?? '127.0.0.1',
    port: Number(env.MR_PORT ?? 8090),
    staticDir: existsSync(staticCandidate) ? staticCandidate : undefined,
    dataDir,
    libraryDir: env.MR_LIBRARY_DIR ? path.resolve(env.MR_LIBRARY_DIR) : undefined,
    token: env.MR_TOKEN ?? '',
    version: env.npm_package_version ?? '0.1.0',
    features: {},
  };
}
