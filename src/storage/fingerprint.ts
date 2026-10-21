// 书籍文件指纹 → BookRecord.id。
// 不用 crypto.subtle：http 局域网地址不是安全上下文，subtle 不可用，而 id 必须在任何环境下算出同一个值。
// 取 文件大小 + 头/中/尾各 64KB 做两路 53 位哈希，碰撞概率对个人书库足够低，且大 PDF 也很快。

const CHUNK = 64 * 1024;

function cyrb53(data: Uint8Array, seed: number, h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed): [number, number] {
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return [h1, h2];
}

function finish(h1: number, h2: number): string {
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

export async function fileFingerprint(blob: Blob): Promise<string> {
  const size = blob.size;
  const parts: Blob[] = [blob.slice(0, CHUNK)];
  if (size > CHUNK * 3) parts.push(blob.slice(Math.floor(size / 2) - CHUNK / 2, Math.floor(size / 2) + CHUNK / 2));
  if (size > CHUNK) parts.push(blob.slice(Math.max(CHUNK, size - CHUNK)));
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  const sizeBytes = new TextEncoder().encode(String(size));
  let [a1, a2] = cyrb53(sizeBytes, 1);
  [a1, a2] = cyrb53(bytes, 1, a1, a2);
  let [b1, b2] = cyrb53(sizeBytes, 7);
  [b1, b2] = cyrb53(bytes, 7, b1, b2);
  return finish(a1, a2) + finish(b1, b2);
}
