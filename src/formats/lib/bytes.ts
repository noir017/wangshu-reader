// 二进制小工具
export async function readHead(file: Blob, n = 4096): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** 从 offset 起的 ASCII 字符串（不可见字节用 \0 表示即可，仅用于魔数比较） */
export function ascii(b: Uint8Array, offset: number, length: number): string {
  let s = '';
  const end = Math.min(b.length, offset + length);
  for (let i = offset; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function startsWithAscii(b: Uint8Array, s: string, offset = 0): boolean {
  if (b.length < offset + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[offset + i] !== s.charCodeAt(i)) return false;
  return true;
}

export function isZip(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
}

export function toBase64(u8: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode(...u8.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 让出事件循环，长循环里每隔一阵调用一次避免界面卡死 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 供长任务使用：距上次让出超过 ms 毫秒才真正 yield */
export function makeYielder(ms = 16): () => Promise<void> {
  let last = Date.now();
  return async () => {
    const now = Date.now();
    if (now - last >= ms) {
      await yieldToUi();
      last = Date.now();
    }
  };
}
