// 服务端 HTTP 接口契约：前端（src/core/server.ts 调用）与服务端（server/src/routes/*）共用。
// 约定：JSON 接口出错返回 { error: string } + 非 2xx；二进制接口直接返回文件流。
// 鉴权：服务端设了 MR_TOKEN 时，请求头带 Authorization: Bearer <token>（或 ?token=，供 <img>/<a> 直链用）。

/** GET /api/health */
export interface HealthResponse {
  ok: true;
  name: 'moonreader-web-server';
  version: string;
  /** 能力开关（外部命令是否可用等），前端据此置灰功能。键名见 ServerFeature */
  features: Partial<Record<ServerFeature, boolean>>;
}

export type ServerFeature =
  | 'proxy' // 跨域代理
  | 'convert' // 格式转换/解包（7z）
  | 'convert.djvu' // DJVU（需要 djvulibre）
  | 'dav' // 内置 WebDAV 存储（同步/备份）
  | 'tts' // 服务端朗读
  | 'translate'
  | 'dict'
  | 'library' // 服务端书库目录
  | 'upload' // 网页传书
  | 'fonts'; // 服务端字体目录

// ───────────────────────── 跨域代理 ─────────────────────────
/**
 * ANY /api/proxy?url=<编码后的目标 URL>
 * 方法、请求体原样转发（含 WebDAV 的 PROPFIND/MKCOL/MOVE/COPY）。
 * 转发的请求头：Accept、Content-Type、Depth、Destination、Overwrite、Range，
 * 以及 X-Proxy-Authorization → 目标的 Authorization（避免和服务端自身鉴权冲突）、X-Proxy-Cookie → Cookie。
 * 响应：目标的状态码与 body；响应头保留 Content-Type、Content-Length、Content-Disposition、Content-Range、ETag、Last-Modified，
 * 并额外给 X-Proxy-Final-Url（跟随重定向后的最终 URL，OPDS 解析相对链接要用）。
 */
export const PROXY_PATH = '/api/proxy';

// ───────────────────────── 格式转换 / 解包 ─────────────────────────
/**
 * POST /api/convert?to=cbz|epub|pdf  body: 原始文件（application/octet-stream），?name=<原文件名> 用于判断格式
 * - cbr / cb7 / rar / 7z（漫画或压缩包） → cbz
 * - chm → epub（按 .hhc 目录生成）
 * - djvu → pdf（需要 features['convert.djvu']）
 * 返回转换后的文件流，Content-Disposition 带新文件名。
 */
export const CONVERT_PATH = '/api/convert';

/** POST /api/archive/list?name=<文件名> body: 压缩包 → 列出条目（导入「压缩包内的书」用） */
export interface ArchiveListResponse {
  entries: { path: string; size: number; dir: boolean }[];
}
/** POST /api/archive/extract?name=<文件名>&entry=<条目路径> body: 压缩包 → 该条目文件流 */

// ───────────────────────── 内置 WebDAV ─────────────────────────
/**
 * /dav/*  一个最小 WebDAV 服务（OPTIONS、PROPFIND Depth 0/1、GET、HEAD、PUT、DELETE、MKCOL、MOVE、COPY），
 * 数据在服务端 dataDir/dav 下。云同步/备份的客户端只说 WebDAV：
 * 用户没有自己的 WebDAV 时就填 <服务端>/dav；有的话走 /api/proxy 访问外部 WebDAV。
 */
export const DAV_PATH = '/dav';

// ───────────────────────── 朗读 ─────────────────────────
/** GET /api/tts/voices */
export interface TtsVoice {
  id: string;
  name: string;
  lang: string;
  gender?: 'male' | 'female';
  engine: string;
}
export interface TtsVoicesResponse {
  voices: TtsVoice[];
}
/** POST /api/tts  → audio/mpeg（或 audio/wav，看 Content-Type） */
export interface TtsRequest {
  text: string;
  voice?: string;
  /** 语速倍率 0.25..4，1 为正常 */
  rate?: number;
  /** 音调倍率 0.5..2 */
  pitch?: number;
  volume?: number;
}

// ───────────────────────── 翻译 / 词典 ─────────────────────────
/** POST /api/translate */
export interface TranslateRequest {
  text: string;
  /** 'auto' 或语言代码 */
  from: string;
  to: string;
  provider?: string;
}
export interface TranslateResponse {
  text: string;
  detectedFrom?: string;
  provider: string;
}
/** GET /api/translate/providers → { providers: { id, name }[] } */

/** GET /api/dict?word=&from=&to=&source= */
export interface DictResponse {
  word: string;
  source: string;
  /** 释义 HTML（服务端已清洗）；查不到时为空串 */
  html: string;
  phonetic?: string;
  /** 发音音频 URL（经代理可直接播放） */
  audio?: string;
}
/** GET /api/dict/sources → { sources: { id, name, langs }[] } */

// ───────────────────────── 服务端书库 / 网页传书 ─────────────────────────
/** GET /api/library/list?path=<相对书库根的目录，默认根> */
export interface LibraryEntry {
  name: string;
  /** 相对书库根的路径，用 / 分隔 */
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
}
export interface LibraryListResponse {
  path: string;
  entries: LibraryEntry[];
}
/** GET /api/library/file?path=  → 文件流（支持 Range） */
/** POST /api/library/upload?path=<目标目录>  multipart/form-data，字段 file（可多个） → { saved: LibraryEntry[] } */
/** DELETE /api/library/file?path= → { ok: true } */
/** GET /transfer  → 给电脑浏览器用的传书网页（原 app 的 WiFi 传书） */

// ───────────────────────── 服务端字体 ─────────────────────────
/** GET /api/fonts → { fonts: { family, file, style?, weight? }[] } ；GET /api/fonts/file?file= → 字体文件 */
export interface ServerFont {
  family: string;
  file: string;
  style?: string;
  weight?: string;
}
