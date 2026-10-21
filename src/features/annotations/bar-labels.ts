import { currentLang } from '@/core/i18n';
import { ta } from './messages';
import type { SelectItemId } from './toolbar-config';

/** 选择条按钮文案；「网络搜索」在中文界面叫网络搜索，其余叫 Google */
export function barItemLabel(id: SelectItemId): string {
  switch (id) {
    case 'copy': return ta('copy');
    case 'highlight': return ta('highlight');
    case 'note': return ta('annotation');
    case 'dict': return ta('dictionary');
    case 'speak': return ta('speak');
    case 'share': return ta('share');
    case 'search': return ta('search');
    case 'translate': return ta('translate');
    case 'wiki': return ta('wikipedia');
    case 'websearch': return currentLang() === 'zh' ? ta('webSearchCn') : ta('webSearch');
    case 'history': return ta('history');
  }
}
