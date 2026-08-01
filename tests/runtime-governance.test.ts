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

  it('lets an auxiliary managed service pin its own PolarPort allocation', () => {
    expect(
      resolveServePort(
        { POLAR_RUNTIME_MANAGED: '1', AUTOOFFICE_MANAGED_PORT: '3901', PORT: '3901' },
        3900,
      ),
    ).toEqual({ port: 3901, direct: false });
  });

  it('still rejects drift and invalid values when a managed port is declared', () => {
    expect(() =>
      resolveServePort(
        { POLAR_RUNTIME_MANAGED: '1', AUTOOFFICE_MANAGED_PORT: '3901', PORT: '3902' },
        3900,
      ),
    ).toThrow(/3901/);
    expect(() =>
      resolveServePort(
        { POLAR_RUNTIME_MANAGED: '1', AUTOOFFICE_MANAGED_PORT: 'nope', PORT: '3901' },
        3900,
      ),
    ).toThrow(/AUTOOFFICE_MANAGED_PORT/);
    expect(() =>
      resolveServePort(
        { POLAR_RUNTIME_MANAGED: '1', AUTOOFFICE_MANAGED_PORT: '70000', PORT: '70000' },
        3900,
      ),
    ).toThrow(/1-65535/);
  });

  it('keeps the direct test hatch unaffected by a declared managed port', () => {
    expect(
      resolveServePort(
        { NODE_ENV: 'test', AUTOOFFICE_DIRECT_PORT: '1', AUTOOFFICE_MANAGED_PORT: '3901' },
        39880,
      ),
    ).toEqual({ port: 39880, direct: true });
  });
});
