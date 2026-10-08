import { describe, expect, it } from 'vitest';
import {
  isPrivateHostname,
  isSafeHttpUrl,
  nextRedirectUrl,
} from '../src/net/safe-url.js';

describe('isPrivateHostname', () => {
  it('识别常见私网与保留地址', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
    expect(isPrivateHostname('10.0.0.5')).toBe(true);
    expect(isPrivateHostname('192.168.1.1')).toBe(true);
    expect(isPrivateHostname('172.16.0.1')).toBe(true);
    expect(isPrivateHostname('172.32.0.1')).toBe(false);
    expect(isPrivateHostname('example.com')).toBe(false);
    expect(isPrivateHostname('media3.tadu.com')).toBe(false);
  });
});

describe('isSafeHttpUrl', () => {
  it('只允许 http(s) 且非私网', () => {
    expect(isSafeHttpUrl('https://novel.example.com/book/1')).toBe(true);
    expect(isSafeHttpUrl('http://127.0.0.1:8080/x')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeHttpUrl('ftp://example.com/x')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
  });
});

describe('nextRedirectUrl', () => {
  it('放行同域 https 跳转', () => {
    expect(
      nextRedirectUrl(302, '/next', 'https://a.example.com/book/1'),
    ).toEqual({ ok: true, url: 'https://a.example.com/next' });
  });

  it('阻止跳转到私网或非 http(s)', () => {
    const toPrivate = nextRedirectUrl(
      301,
      'http://169.254.169.254/latest/meta-data',
      'https://a.example.com/',
    );
    expect(toPrivate.ok).toBe(false);
    const toFile = nextRedirectUrl(302, 'file:///etc/passwd', 'https://a.example.com/');
    expect(toFile.ok).toBe(false);
  });

  it('非 3xx 或缺少 Location 时不算重定向', () => {
    expect(nextRedirectUrl(200, '/x', 'https://a.example.com/').ok).toBe(false);
    expect(nextRedirectUrl(302, null, 'https://a.example.com/').ok).toBe(false);
    expect(nextRedirectUrl(301, 'http://', 'https://a.example.com/').ok).toBe(
      false,
    );
  });
});
