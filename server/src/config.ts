// 服务端配置：全部来自环境变量，便于容器部署。环境变量清单见 server/README.md。
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export interface LibraryRoot {
  /** 对外的第一段路径名（单根时也有名字，但路径里不出现） */
  name: string;
  /** 绝对路径（未解析符号链接） */
  dir: string;
  /** realpath，越界判断用它 */
  real: string;
}

export interface ProxyConfig {
  /** auto：设了 MR_TOKEN 或请求来自本机才可用；on：一律可用；off：关闭 */
  mode: 'auto' | 'on' | 'off';
  /** 非空时只允许这些主机（'example.com' 含子域；'*.example.com' 只含子域） */
  allowHosts: string[];
  /** 禁止访问内网/回环地址（链路本地 169.254/16 永远禁止） */
  blockPrivate: boolean;
  /** 空闲超时（连接 + 等响应头 + 数据间隔），毫秒 */
  timeoutMs: number;
  maxRedirects: number;
  /** 不校验目标站点的 HTTPS 证书（自签名的 Calibre/NAS；原 app 也是全部信任） */
  insecureTls: boolean;
  /** 默认 User-Agent（前端可用 X-Proxy-User-Agent 覆盖） */
  userAgent: string;
}

export interface TranslateConfig {
  deeplKey: string;
  /** 默认按 key 是否以 :fx 结尾自动选免费/付费端点 */
  deeplUrl?: string;
  libreUrl?: string;
  libreKey: string;
  /** 默认翻译引擎，缺省 google */
  defaultProvider: string;
}

export interface ServerConfig {
  host: string;
  port: number;
  /** 前端静态文件目录（vite build 的 dist）；不存在则不托管 */
  staticDir?: string;
  /** 服务端持久数据根目录（同步数据、上传的书、缓存等） */
  dataDir: string;
  /** 临时文件目录（转换/解包用），默认 <dataDir>/tmp */
  tmpDir: string;
  /** 服务端书库目录（第一个根；兼容旧字段）；未设则功能关闭 */
  libraryDir?: string;
  /** 书库的全部根（MR_LIBRARY_DIR 以 ':' 分隔） */
  libraryRoots: LibraryRoot[];
  /** 书库只读：禁用上传/新建/改名/拷贝/移动/删除 */
  libraryReadonly: boolean;
  /** 用户字体目录（MR_FONTS_DIR，':' 分隔） */
  fontsDirs: string[];
  /** 是否同时列出系统字体目录（/usr/share/fonts 等） */
  systemFonts: boolean;
  /** 访问令牌；空 = 不鉴权（只应在内网/本机使用） */
  token: string;
  version: string;
  proxy: ProxyConfig;
  /** /api/convert、/api/archive 接收的原文件大小上限（字节） */
  maxConvertBytes: number;
  /** 上传（书库 upload、DAV PUT）大小上限（字节），0 = 不限 */
  maxUploadBytes: number;
  /** 解包后总大小上限（防压缩炸弹），字节 */
  maxExtractBytes: number;
  davEnabled: boolean;
  /** 朗读：edge = 微软 Edge 在线朗读；auto 同 edge；off 关闭在线朗读（仍可用本机 espeak-ng） */
  ttsEngine: 'auto' | 'edge' | 'off';
  ttsCacheBytes: number;
  translate: TranslateConfig;
  /** 运行时探测到的可选能力（例如外部命令是否存在），由各路由模块写入，/api/health 回报 */
  features: Record<string, boolean>;
}

const truthy = (v: string | undefined, dflt: boolean): boolean => {
  if (v === undefined || v === '') return dflt;
  return !/^(0|false|off|no)$/i.test(v.trim());
};

const mb = (v: string | undefined, dflt: number): number => {
  if (v === undefined || v === '') return dflt * 1024 * 1024;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n * 1024 * 1024) : dflt * 1024 * 1024;
};

const splitList = (v: string | undefined, sep: RegExp = /[:]/): string[] =>
  (v ?? '')
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);

function loadLibraryRoots(spec: string | undefined): LibraryRoot[] {
  const roots: LibraryRoot[] = [];
  const used = new Set<string>();
  for (const raw of splitList(spec)) {
    const dir = path.resolve(raw);
    let real: string;
    try {
      real = realpathSync(dir);
      if (!statSync(real).isDirectory()) throw new Error('not a directory');
    } catch {
      console.warn(`[server] MR_LIBRARY_DIR 里的目录不存在或不是目录，已忽略：${dir}`);
      continue;
    }
    let name = path.basename(dir) || 'library';
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${path.basename(dir) || 'library'}-${i}`;
    used.add(name.toLowerCase());
    roots.push({ name, dir, real });
  }
  return roots;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = process.cwd();
  const dataDir = path.resolve(env.MR_DATA_DIR ?? path.join(root, 'server', 'data'));
  mkdirSync(dataDir, { recursive: true });
  const tmpDir = path.resolve(env.MR_TMP_DIR ?? path.join(dataDir, 'tmp'));
  mkdirSync(tmpDir, { recursive: true });
  const staticCandidate = path.resolve(env.MR_STATIC_DIR ?? path.join(root, 'dist'));
  const libraryRoots = loadLibraryRoots(env.MR_LIBRARY_DIR);
  const proxyMode = (env.MR_PROXY ?? 'auto').toLowerCase();
  const tts = (env.MR_TTS ?? 'auto').toLowerCase();
  return {
    host: env.MR_HOST ?? '127.0.0.1',
    port: Number(env.MR_PORT ?? 8090),
    staticDir: existsSync(staticCandidate) ? staticCandidate : undefined,
    dataDir,
    tmpDir,
    libraryDir: libraryRoots[0]?.dir,
    libraryRoots,
    libraryReadonly: truthy(env.MR_LIBRARY_READONLY, false),
    fontsDirs: splitList(env.MR_FONTS_DIR)
      .map((d) => path.resolve(d))
      .filter((d) => existsSync(d)),
    systemFonts: truthy(env.MR_FONTS_SYSTEM, true),
    token: env.MR_TOKEN ?? '',
    version: env.npm_package_version ?? '0.1.0',
    proxy: {
      mode: proxyMode === 'on' || proxyMode === 'off' ? proxyMode : 'auto',
      allowHosts: splitList(env.MR_PROXY_ALLOW_HOSTS, /[,\s]+/).map((h) => h.toLowerCase()),
      blockPrivate: truthy(env.MR_PROXY_BLOCK_PRIVATE, false),
      timeoutMs: Number(env.MR_PROXY_TIMEOUT_MS ?? 30_000),
      maxRedirects: Number(env.MR_PROXY_MAX_REDIRECTS ?? 10),
      insecureTls: truthy(env.MR_PROXY_INSECURE_TLS, false),
      userAgent: env.MR_PROXY_USER_AGENT ?? 'Mozilla/5.0 (compatible; WangshuReader/0.1; +opds)',
    },
    maxConvertBytes: mb(env.MR_MAX_CONVERT_MB, 1024),
    maxUploadBytes: mb(env.MR_MAX_UPLOAD_MB, 4096),
    maxExtractBytes: mb(env.MR_MAX_EXTRACT_MB, 4096),
    davEnabled: truthy(env.MR_DAV, true),
    ttsEngine: tts === 'off' || tts === 'edge' ? tts : 'auto',
    ttsCacheBytes: mb(env.MR_TTS_CACHE_MB, 256),
    translate: {
      deeplKey: env.MR_DEEPL_KEY ?? '',
      deeplUrl: env.MR_DEEPL_URL || undefined,
      libreUrl: env.MR_LIBRETRANSLATE_URL || undefined,
      libreKey: env.MR_LIBRETRANSLATE_KEY ?? '',
      defaultProvider: env.MR_TRANSLATE_PROVIDER ?? 'google',
    },
    features: {},
  };
}
