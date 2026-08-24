import { BadRequestException } from '@nestjs/common';
import { assertPublicWebhookUrl } from './webhook-url';

describe('assertPublicWebhookUrl', () => {
  it('accepts a public https URL', () => {
    const parsed = assertPublicWebhookUrl('https://example.com/hooks/invoicefi');
    expect(parsed.hostname).toBe('example.com');
  });

  it('accepts a public http URL', () => {
    expect(() => assertPublicWebhookUrl('http://example.com/hook')).not.toThrow();
  });

  it('rejects a missing url', () => {
    expect(() => assertPublicWebhookUrl('')).toThrow(BadRequestException);
  });

  it('rejects a malformed url', () => {
    expect(() => assertPublicWebhookUrl('not-a-url')).toThrow(BadRequestException);
  });

  it('rejects a non-http(s) protocol', () => {
    expect(() => assertPublicWebhookUrl('ftp://example.com/hook')).toThrow(BadRequestException);
    expect(() => assertPublicWebhookUrl('file:///etc/passwd')).toThrow(BadRequestException);
  });

  it.each([
    'http://localhost/hook',
    'http://127.0.0.1/hook',
    'http://127.0.0.1:8080/hook',
    'http://0.0.0.0/hook',
    'http://10.0.0.5/hook',
    'http://172.16.0.1/hook',
    'http://172.31.255.255/hook',
    'http://192.168.1.1/hook',
    'http://169.254.169.254/latest/meta-data', // cloud metadata endpoint
    'http://[::1]/hook',
    'http://foo.localhost/hook',
  ])('rejects loopback/private/link-local target %s', (url) => {
    expect(() => assertPublicWebhookUrl(url)).toThrow(BadRequestException);
  });

  it('does not reject a public address that merely starts with a private-looking octet', () => {
    // 172.32.x.x is outside the RFC1918 172.16/12 block and is publicly routable.
    expect(() => assertPublicWebhookUrl('http://172.32.0.1/hook')).not.toThrow();
  });
});
