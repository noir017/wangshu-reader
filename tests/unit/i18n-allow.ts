// 中文界面里允许出现的拉丁字母词：品牌/产品名、格式扩展名、协议与技术缩写、单位、按键名。
// 这些本来就该是英文；其余英文词出现在 zh 文案或 JSX 里就算漏翻。
export const ALLOWED_LATIN: string[] = [
  // 品牌、产品、服务
  'Wangshu Reader', 'Moon+ Reader Pro', 'Moon+ Reader', 'Moon+', 'Web', 'Readwise', 'Dropbox', 'Google Drive', 'Google Books', 'Google', 'Open Library',
  'Project Gutenberg', 'Gutenberg', 'Feedbooks', 'Wikipedia', 'Wiktionary', 'Microsoft Edge', 'Edge', 'eSpeak', 'espeak-ng', 'DeepL', 'Bing', 'Baidu', 'Youdao',
  'Calibre', 'Stanza', 'Android', 'iOS', 'Windows', 'Chrome', 'Chromium', 'Safari', 'Firefox', 'Unicode', 'Zdic', 'Dict.cn', 'MyMemory', 'LibreTranslate', 'Lingva',
  'Apple', 'Web Speech', 'OAuth',
  // 语言自称（语言选择里「English」按惯例写原文）
  'English',
  // 字体族通用名（括注在中文后面）
  'Serif', 'Sans-serif', 'Monospace',
  // 原 app 原文就带的 CSS 术语
  'px/pt/em/in', 'margin/padding',
  // 格式与扩展名
  'EPUB', 'EPUB3', 'PDF', 'MOBI', 'AZW3', 'AZW', 'KF8', 'FB2', 'TXT', 'HTML', 'HTM', 'DOCX', 'ODT', 'CHM', 'UMD', 'CBZ', 'CBR', 'CB7', 'ZIP', 'RAR', '7z', '7Z',
  'DjVu', 'DJVU', 'Markdown', 'MD', 'RTF', 'CSV', 'JSON', 'XML', 'CSS', 'OPF', 'NCX', 'PNG', 'JPG', 'JPEG', 'GIF', 'SVG', 'WebP', 'TTF', 'OTF', 'TTC', 'WOFF',
  'mrexpt', 'mrweb', 'mrpro', 'mrstd', 'ttc', 'po', 'an', 'json', 'txt', 'html', 'csv', 'zip', 'ttf', 'otf', 'epub', 'pdf',
  // 协议与技术缩写
  'OPDS', 'WebDAV', 'WebDav', 'HTTP', 'HTTPS', 'http', 'https', 'URL', 'URI', 'API', 'ID', 'IP', 'DRM', 'TTS', 'UTF', 'GBK', 'GB2312', 'GB18030', 'Big5', 'BIG5',
  'ISO', 'ASCII', 'PWA', 'CDN', 'CORS', 'WiFi', 'Wi-Fi', 'LED', 'OCR', 'RTL', 'LTR', 'SSML', 'JS', 'localhost', 'WASM', 'RSVP',
  // 单位
  'KB', 'MB', 'GB', 'px', 'pt', 'em', 'ms', 'dpi', 'DPI', 'x',
  // 按键名
  'Ctrl', 'Alt', 'Shift', 'Esc', 'Enter', 'Tab', 'Space', 'PageUp', 'PageDown', 'Home', 'End',
  // 示例字母
  'A', 'Aa', 'B', 'C', 'Q',
];

const sorted = [...ALLOWED_LATIN].sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const allowRe = new RegExp(`(?<![A-Za-z])(?:${sorted.map(esc).join('|')})(?![A-Za-z])`, 'g');

/** 去掉占位符、URL、白名单词之后剩下的英文词；没有则返回空串 */
export function latinLeftover(text: string): string {
  const s = text
    .replace(/\{\w+\}/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\b(?:https?|file):\/\/\S*/g, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|cn)\b/g, ' ')
    .replace(/%[sd]/g, ' ')
    // 环境变量名（MR_LIBRARY_DIR）、服务端路径（/dav、/api/...）
    .replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, ' ')
    .replace(/(?<![\w.])\/[a-z][\w./-]*/g, ' ')
    .replace(allowRe, ' ');
  const words = s.match(/[A-Za-z]{2,}/g);
  return words ? [...new Set(words)].join(' ') : '';
}
