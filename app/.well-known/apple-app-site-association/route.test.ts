// @vitest-environment node
// Apple's association file (SPEC-21): without it, tapping a sign-in link
// opens Safari instead of the app.
import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('/.well-known/apple-app-site-association', () => {
  it('lets the store app and the dev build (team 8B52Q4QNLH) open /k/* links, as JSON', async () => {
    const res = GET();
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    const [detail] = body.applinks.details;
    expect(detail.appIDs).toEqual(['8B52Q4QNLH.com.kinderwell.app', '8B52Q4QNLH.com.kinderwell.app.dev']);
    expect(detail.components).toEqual([{ '/': '/k/*', comment: expect.any(String) }]);
  });
});
