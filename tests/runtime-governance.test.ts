import { describe, expect, it } from 'vitest';
import { resolveServePort } from '../src/runtime-governance.js';

describe('resolveServePort', () => {
  it('allows explicit direct binding only for terminating tests', () => {
    expect(resolveServePort({ NODE_ENV: 'test', AUTOOFFICE_DIRECT_PORT: '1' }, 39880))
      .toEqual({ port: 39880, direct: true });
  });

  it('rejects the direct-port bypass outside tests', () => {
    expect(() => resolveServePort({ AUTOOFFICE_DIRECT_PORT: '1' }, 3900)).toThrow(/tests/);
  });

  it('rejects persistent startup outside PolarProcess', () => {
    expect(() => resolveServePort({ PORT: '3900' }, 3900)).toThrow(/PolarProcess/);
  });

  it('rejects missing, invalid and drifting injected ports', () => {
    expect(() => resolveServePort({ POLAR_RUNTIME_MANAGED: '1' }, 3900)).toThrow(/PORT/);
    expect(() => resolveServePort({ POLAR_RUNTIME_MANAGED: '1', PORT: 'nope' }, 3900)).toThrow(/PORT/);
    expect(() => resolveServePort({ POLAR_RUNTIME_MANAGED: '1', PORT: '8000' }, 3900)).toThrow(/3900/);
  });

  it('accepts exactly the managed health port', () => {
    expect(resolveServePort({ POLAR_RUNTIME_MANAGED: '1', PORT: '3900' }, 8000))
      .toEqual({ port: 3900, direct: false });
  });
});
