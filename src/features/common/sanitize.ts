// 脚注、词典卡片里的 HTML 一律过一遍 DOMPurify：来源是书内容或服务端抓取，都不可信。
import DOMPurify from 'dompurify';

let purify: ReturnType<typeof DOMPurify> | undefined;

function instance() {
  if (!purify) {
    purify = DOMPurify(window);
    // 链接统一新标签打开、不带 opener；书内 #锚点 在气泡里没有意义，保留文字去掉 href 以免点了跳走
    purify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? '';
        if (/^https?:/i.test(href)) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        } else {
          node.removeAttribute('href');
        }
      }
    });
  }
  return purify;
}

export function sanitizeHtml(html: string): string {
  return instance().sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
}
