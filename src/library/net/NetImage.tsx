import { useState } from 'react';
import { proxyUrl } from '@/storage/http';
import { hasServer } from '@/core/server';

/** 目录里的封面图：https/data 直接显示，失败或 http（混合内容）时改走服务端代理 */
export function NetImage(props: { src?: string; alt?: string; className?: string; style?: React.CSSProperties }) {
  const [viaProxy, setViaProxy] = useState(() => !!props.src && /^http:/i.test(props.src) && hasServer());
  const [failed, setFailed] = useState(false);
  if (!props.src || failed) return null;
  const src = viaProxy && !props.src.startsWith('data:') ? proxyUrl(props.src) : props.src;
  return (
    <img
      src={src}
      alt={props.alt ?? ''}
      className={props.className}
      style={props.style}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => (viaProxy || !hasServer() ? setFailed(true) : setViaProxy(true))}
    />
  );
}
