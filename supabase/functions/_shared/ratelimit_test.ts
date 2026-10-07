// deno test
import { assertEquals } from 'jsr:@std/assert@1';
import { ipBucket } from './ratelimit.ts';

Deno.test('IPv6 addresses share a bucket per /64 (IN-7)', () => {
  assertEquals(ipBucket('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd:12::/64');
  assertEquals(ipBucket('2001:db8:abcd:12:ffff:ffff:ffff:ffff'), '2001:db8:abcd:12::/64');
  assertEquals(ipBucket('2001:0DB8:0000:0012::5'), '2001:db8:0:12::/64');
  assertEquals(ipBucket('2001:db8::1'), '2001:db8:0:0::/64');
  assertEquals(ipBucket('::1'), '0:0:0:0::/64');
});

Deno.test('IPv4, v4-mapped and anything unparseable are kept as they are', () => {
  assertEquals(ipBucket('203.0.113.9'), '203.0.113.9');
  assertEquals(ipBucket('::ffff:203.0.113.9'), '::ffff:203.0.113.9');
  assertEquals(ipBucket(''), '');
  assertEquals(ipBucket(undefined), '');
  assertEquals(ipBucket('not:an:address'), 'not:an:address');
  assertEquals(ipBucket('1::2::3'), '1::2::3');
});
