// 朗读对外入口（选择条「朗读」按钮、命令总线都经这里）。实现见 service.ts。
import type { ReaderSession } from '@/core/reader-session';
import { speakText as speak } from './service';

export function speakText(session: ReaderSession, text: string): void {
  void speak(session, text);
}
