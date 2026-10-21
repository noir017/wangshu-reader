// 最小 ZIP 写入器：按顺序一个个写入文件（STORE 或 DEFLATE），内存里只放当前这一个条目。
// 用于 → cbz（图片本身已压缩，用 STORE）和 → epub（mimetype 必须第一个且不压缩）。
import { createWriteStream, type WriteStream } from 'node:fs';
import { once } from 'node:events';
import { crc32, deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const deflateRawAsync = promisify(deflateRaw);

interface CentralRecord {
  name: Buffer;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  csize: number;
  size: number;
  offset: number;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private out: WriteStream;
  private records: CentralRecord[] = [];
  private offset = 0;
  private failed: Error | null = null;

  constructor(file: string) {
    this.out = createWriteStream(file);
    this.out.on('error', (e) => (this.failed = e));
  }

  private async write(buf: Buffer): Promise<void> {
    if (this.failed) throw this.failed;
    this.offset += buf.length;
    if (!this.out.write(buf)) await once(this.out, 'drain');
  }

  /** 添加一个条目。name 用 / 分隔、不以 / 开头；compress=false 为 STORE */
  async add(name: string, data: Buffer, opts: { compress?: boolean; mtime?: Date } = {}): Promise<void> {
    const nameBuf = Buffer.from(name, 'utf8');
    const ascii = /^[\x20-\x7e]*$/.test(name);
    const flags = ascii ? 0 : 0x0800; // bit 11：文件名是 UTF-8
    let method = 0;
    let payload = data;
    if (opts.compress && data.length > 64) {
      const c = await deflateRawAsync(data);
      if (c.length < data.length) {
        method = 8;
        payload = c;
      }
    }
    if (this.offset + payload.length > 0xfff00000 || this.records.length >= 0xfffe) {
      throw new Error('zip 过大（不支持 zip64）');
    }
    const { time, date } = dosDateTime(opts.mtime ?? new Date());
    const rec: CentralRecord = {
      name: nameBuf,
      flags,
      method,
      time,
      date,
      crc: crc32(data) >>> 0,
      csize: payload.length,
      size: data.length,
      offset: this.offset,
    };
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(flags, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(rec.crc, 14);
    h.writeUInt32LE(rec.csize, 18);
    h.writeUInt32LE(rec.size, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    await this.write(h);
    await this.write(nameBuf);
    if (payload.length) await this.write(payload);
    this.records.push(rec);
  }

  async finish(): Promise<void> {
    const cdStart = this.offset;
    for (const r of this.records) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(r.flags, 8);
      h.writeUInt16LE(r.method, 10);
      h.writeUInt16LE(r.time, 12);
      h.writeUInt16LE(r.date, 14);
      h.writeUInt32LE(r.crc, 16);
      h.writeUInt32LE(r.csize, 20);
      h.writeUInt32LE(r.size, 24);
      h.writeUInt16LE(r.name.length, 28);
      h.writeUInt32LE(0, 34); // 属性等
      h.writeUInt32LE(r.offset, 42);
      await this.write(h);
      await this.write(r.name);
    }
    const cdSize = this.offset - cdStart;
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0);
    e.writeUInt16LE(this.records.length, 8);
    e.writeUInt16LE(this.records.length, 10);
    e.writeUInt32LE(cdSize, 12);
    e.writeUInt32LE(cdStart, 16);
    await this.write(e);
    await new Promise<void>((resolve, reject) => {
      this.out.once('error', reject);
      this.out.end(resolve);
    });
  }

  abort(): void {
    this.out.destroy();
  }
}
