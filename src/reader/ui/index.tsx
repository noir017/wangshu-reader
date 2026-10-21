// 阅读页对外入口（src/reader/ui 负责实现）：路由 #/read/<bookId> 渲染它。
export function ReaderPage(props: { bookId: string }) {
  return <div style={{ padding: 16 }}>reader: {props.bookId}</div>;
}
