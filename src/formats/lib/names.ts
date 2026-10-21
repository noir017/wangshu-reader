// 文件名小工具：识别格式用的候选扩展名、压缩包里要忽略的条目
/** 文件名里的候选扩展名，长的在前：a.fb2.zip → ['fb2.zip', 'zip']；带 '?' 的压缩包内路径取 '?' 之后（a.zip?inner/b.epub → ['epub']） */
export function candidateExts(fileName: string): string[] {
  const base = (fileName.split('?').pop() ?? fileName).split(/[\\/]/).pop()!.toLowerCase();
  const parts = base.split('.');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(i).join('.'));
  return out.slice(0, 2);
}

/** 压缩包里的隐藏文件、macOS 资源叉、Windows 缩略图缓存 */
export function isHiddenEntry(path: string): boolean {
  return path.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX') || /(^|\/)thumbs\.db$/i.test(path);
}
