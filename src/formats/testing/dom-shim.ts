// 仅测试用：happy-dom 的 Node.prototype.nodeName getter 对元素返回空串，而 DOMPurify 3.x 为防 clobbering
// 缓存的正是这个基类 getter，结果所有元素都被判成「不在白名单」。在 DOMPurify 初始化前（测试文件第一行 import）补上。
// 真实浏览器里不需要，也不会被生产代码引用。
const G = globalThis as unknown as { Node?: { prototype: object }; Element?: { prototype: object } };
const nodeProto = G.Node?.prototype;
const elDesc = G.Element ? Object.getOwnPropertyDescriptor(G.Element.prototype, 'nodeName') : undefined;
const orig = nodeProto ? Object.getOwnPropertyDescriptor(nodeProto, 'nodeName') : undefined;
if (nodeProto && orig?.get && elDesc?.get && (document.createElement('div') as { nodeName: string }).nodeName !== '') {
  const probe = Object.getOwnPropertyDescriptor(nodeProto, 'nodeName')!.get!.call(document.createElement('div'));
  if (probe === '') {
    Object.defineProperty(nodeProto, 'nodeName', {
      configurable: true,
      get(this: { nodeType: number }) {
        switch (this.nodeType) {
          case 1:
            return elDesc.get!.call(this);
          case 3:
            return '#text';
          case 4:
            return '#cdata-section';
          case 8:
            return '#comment';
          case 9:
            return '#document';
          case 11:
            return '#document-fragment';
          default:
            return orig.get!.call(this);
        }
      },
    });
  }
}
export {};
