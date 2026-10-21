// 格式解析抛出的可识别错误。界面按 code / instanceof 分支（弹密码框、提示 DRM、提示配置服务端…），message 为中文可直接展示。
import { defineMessages } from '@/core/i18n';

export const fmtMsg = defineMessages({
  zh: {
    unsupported: '不支持此文件',
    unsupportedNamed: '不支持此文件格式：{name}',
    drm: '本书已被DRM数字技术加密, 请先在电脑去除DRM加密信息',
    passwordNeed: '此文件需要密码',
    passwordWrong: '密码不正确',
    server: '打开 {fmt} 需要服务端支持：{why}',
    serverNone: '请先在设置中配置服务端地址',
    serverFail: '服务端转换失败：{why}',
    serverFeature: '服务端没有启用「{feature}」功能（{why}）',
    pdfWorker: 'PDF 解析线程启动失败：{why}',
    corrupt: '文件已损坏或格式不正确：{why}',
    multiple: '压缩包里有多本书，请指定要打开的一本',
    emptyArchive: '压缩包里没有可阅读的文件',
    badEncoding: '不支持的文字编码：{enc}',
    notTextUmd: '不是文本类 UMD（暂不支持漫画 UMD）',
    footnotes: '脚注',
    cover: '封面',
  },
  en: {
    unsupported: 'Failed to load file.',
    unsupportedNamed: 'Unsupported file format: {name}',
    drm: 'This book is protected by DRM. Please remove the DRM on a computer first.',
    passwordNeed: 'This file needs a password',
    passwordWrong: 'Invalid password',
    server: 'Opening {fmt} requires the server: {why}',
    serverNone: 'Please configure the server address in settings first',
    serverFail: 'Server conversion failed: {why}',
    serverFeature: 'The server does not have "{feature}" enabled ({why})',
    pdfWorker: 'Failed to start the PDF worker: {why}',
    corrupt: 'The file is damaged or malformed: {why}',
    multiple: 'The archive contains several books; please pick one',
    emptyArchive: 'No readable file in the archive',
    badEncoding: 'Unsupported text encoding: {enc}',
    notTextUmd: 'Not a text UMD (comic UMD is not supported)',
    footnotes: 'Footnotes',
    cover: 'Cover',
  },
});

export type BookErrorCode = 'unsupported' | 'drm' | 'password' | 'server' | 'corrupt' | 'encoding' | 'multiple';

export class BookOpenError extends Error {
  readonly code: BookErrorCode;
  constructor(code: BookErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BookOpenError';
    this.code = code;
  }
}

export class UnsupportedFormatError extends BookOpenError {
  constructor(message = fmtMsg('unsupported')) {
    super('unsupported', message);
    this.name = 'UnsupportedFormatError';
  }
}

/** 带 DRM 的书（FMT-001 drm_hint） */
export class DrmError extends BookOpenError {
  constructor() {
    super('drm', fmtMsg('drm'));
    this.name = 'DrmError';
  }
}

/** PDF 需要密码（PDF-001）：reason='need' 首次需要，'incorrect' 给了密码但不对。阅读页据此弹密码框，重试时放进 opts.extra.password */
export class PasswordRequiredError extends BookOpenError {
  readonly reason: 'need' | 'incorrect';
  constructor(reason: 'need' | 'incorrect') {
    super('password', reason === 'need' ? fmtMsg('passwordNeed') : fmtMsg('passwordWrong'));
    this.name = 'PasswordRequiredError';
    this.reason = reason;
  }
}

/** 需要服务端（CHM/CBR/DJVU…），但没配置或不可用 */
export class ServerRequiredError extends BookOpenError {
  constructor(fmt: string, why = fmtMsg('serverNone'), cause?: unknown) {
    super('server', fmtMsg('server', { fmt, why }), { cause });
    this.name = 'ServerRequiredError';
  }
}

/** 压缩包里有多本书：entries 供界面让用户选，选中后用 opts.extra.entry 重试 */
export class ArchiveChoiceError extends BookOpenError {
  readonly entries: string[];
  constructor(entries: string[]) {
    super('multiple', fmtMsg('multiple'));
    this.name = 'ArchiveChoiceError';
    this.entries = entries;
  }
}

export function corrupt(why: unknown): BookOpenError {
  const text = why instanceof Error ? why.message : String(why);
  return new BookOpenError('corrupt', fmtMsg('corrupt', { why: text }), { cause: why });
}

export function isPasswordError(e: unknown): e is PasswordRequiredError {
  return e instanceof PasswordRequiredError;
}
