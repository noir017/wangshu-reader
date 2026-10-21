import { describe, expect, it } from 'vitest';
import { clearLockPassword, hashPassword, isUnlocked, setLockPassword, sha256, verifyLockPassword } from './lock';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('启动密码', () => {
  it('SHA-256 与标准向量一致', () => {
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const long = new TextEncoder().encode('a'.repeat(1000));
    expect(hex(sha256(long))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
  it('设置、校验、关闭', () => {
    expect(hashPassword('x', 's1')).not.toBe(hashPassword('x', 's2'));
    setLockPassword('123456');
    expect(verifyLockPassword('123456')).toBe(true);
    expect(verifyLockPassword('1234567')).toBe(false);
    expect(isUnlocked()).toBe(true); // 刚设置完本会话视为已解锁
    sessionStorage.clear();
    expect(isUnlocked()).toBe(false);
    clearLockPassword();
    expect(isUnlocked()).toBe(true);
    expect(verifyLockPassword('123456')).toBe(false);
  });
});
