import { describe, expect, it } from 'vitest';
import { asTextItem, importFiles } from './import';

describe('导入：类型不受支持的文件（LIB-035）', () => {
  it('二进制的未知类型标成 unsupported（界面据此问「是否以纯文本模式打开」）；按纯文本重导入后入库', async () => {
    const bin = new File([new Uint8Array([0, 1, 2, 3, 0, 255, 254, 0, 9, 0, 0, 7])], '数据.dat');
    const res = await importFiles([{ file: bin }]);
    expect(res.added).toHaveLength(0);
    expect(res.failed).toEqual([expect.objectContaining({ name: '数据.dat', unsupported: true })]);
    const again = await importFiles([asTextItem({ file: bin })]);
    expect(again.failed).toEqual([]);
    expect(again.added[0]).toMatchObject({ format: 'txt', title: '数据.dat' });
  });
});
