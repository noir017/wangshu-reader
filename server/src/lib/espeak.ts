// 本机 espeak-ng 后备朗读：没有网络/不想用在线服务时可用。音质机械但完全离线。
import type { TtsVoice } from '@shared/api';
import { findCommand, run } from '../util/exec';

export const espeakAvailable = (): boolean => !!findCommand('espeak-ng') || !!findCommand('espeak');

const bin = (): string => findCommand('espeak-ng') ?? findCommand('espeak')!;

/** 解析 `espeak-ng --voices` 的表格输出 */
export function parseEspeakVoices(text: string): TtsVoice[] {
  const voices: TtsVoice[] = [];
  for (const line of text.split('\n').slice(1)) {
    const m = /^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);
    if (!m) continue;
    const [, , lang, ageGender, name] = m;
    const g = /\/([MF])/.exec(ageGender)?.[1];
    voices.push({ id: `espeak:${lang}`, name: name.replace(/_/g, ' '), lang, ...(g ? { gender: g === 'M' ? ('male' as const) : ('female' as const) } : {}), engine: 'espeak' });
  }
  return voices;
}

export async function listEspeakVoices(): Promise<TtsVoice[]> {
  if (!espeakAvailable()) return [];
  try {
    const { stdout } = await run(bin(), ['--voices'], { timeoutMs: 10_000 });
    return parseEspeakVoices(stdout.toString('utf8'));
  } catch {
    return [];
  }
}

export interface EspeakOptions {
  /** espeak 语言/声音名，如 zh、en-us */
  voice: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

/** 合成并返回 WAV */
export async function synthesizeEspeak(text: string, o: EspeakOptions): Promise<Buffer> {
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
  const args = [
    '-v', o.voice,
    '-s', String(clamp(175 * (o.rate ?? 1), 80, 450)),
    '-p', String(clamp(50 * (o.pitch ?? 1), 0, 99)),
    '-a', String(clamp(100 * (o.volume ?? 1), 0, 200)),
    '--stdout',
    '--stdin',
  ];
  const { stdout } = await run(bin(), args, { input: text, timeoutMs: 60_000, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}
