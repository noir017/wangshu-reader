// 健康提醒对话框（VIEW-019）：60 秒倒计时自动关闭
import { useEffect, useState } from 'react';
import { Button, Sheet, openOverlay } from '@/ui';
import { t } from '../messages';

export function openRemindDialog(text: string, onClosed: () => void): void {
  openOverlay((close) => <Remind text={text} close={() => (close(), onClosed())} />);
}

function Remind({ text, close }: { text: string; close: () => void }) {
  const [left, setLeft] = useState(60);
  useEffect(() => {
    const id = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left <= 0) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);
  return (
    <Sheet open position="center" title={t('remind_dialog_title')} onClose={close} actions={<Button primary onClick={close}>{`${t('ok')} (${Math.max(left, 0)})`}</Button>}>
      <div style={{ padding: '12px 16px', lineHeight: 1.7 }}>{text}</div>
    </Sheet>
  );
}
