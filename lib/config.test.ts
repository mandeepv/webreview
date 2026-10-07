import { describe, expect, it } from 'vitest';
import { portalUrlFrom } from './config';

describe('portalUrlFrom — where kinderwell.app/manage sends subscribers (B-10)', () => {
  it('uses the live portal unless the build says test, explicitly', () => {
    for (const dodoEnv of ['live', undefined, '', 'LIVE', 'prod']) {
      expect(portalUrlFrom({ businessId: 'bus_123', dodoEnv }), String(dodoEnv)).toBe(
        'https://customer.dodopayments.com/login/bus_123'
      );
    }
    expect(portalUrlFrom({ businessId: 'bus_123', dodoEnv: 'test' })).toBe(
      'https://test.customer.dodopayments.com/login/bus_123'
    );
  });

  it('an explicit portal URL wins; no business id means the unified portal', () => {
    expect(portalUrlFrom({ portalUrl: 'https://example.test/p', businessId: 'bus_123', dodoEnv: 'test' })).toBe(
      'https://example.test/p'
    );
    expect(portalUrlFrom({ dodoEnv: 'test' })).toBe('https://customer.dodopayments.com');
  });
});
