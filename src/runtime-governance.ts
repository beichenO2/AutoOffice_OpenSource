export type RuntimeEnvironment = Partial<Record<string, string | undefined>>;

export interface ServePortResolution {
  port: number;
  direct: boolean;
}

export function resolveServePort(
  env: RuntimeEnvironment,
  requestedPort: number,
  expectedPort = 3900,
): ServePortResolution {
  if (env.AUTOOFFICE_DIRECT_PORT === '1') {
    if (env.NODE_ENV !== 'test') {
      throw new Error('AUTOOFFICE_DIRECT_PORT is reserved for terminating tests');
    }
    if (!Number.isSafeInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
      throw new Error('Tests require a valid direct port');
    }
    return { port: requestedPort, direct: true };
  }

  if (env.POLAR_RUNTIME_MANAGED !== '1') {
    throw new Error('AutoOffice serve lifecycle must be managed by PolarProcess');
  }

  // Auxiliary managed services (e.g. the Agent preview) may pin their own
  // PolarPort-reserved port via AUTOOFFICE_MANAGED_PORT. Production stays pinned
  // to expectedPort (3900). The port is still fully gated: POLAR_RUNTIME_MANAGED=1
  // is only ever set by PolarProcess, and `serve` still claims the port through
  // PolarPort, so this cannot be used to escape governance.
  let effectiveExpected = expectedPort;
  const managedOverride = env.AUTOOFFICE_MANAGED_PORT;
  if (managedOverride !== undefined) {
    if (!/^\d+$/.test(managedOverride)) {
      throw new Error('AUTOOFFICE_MANAGED_PORT must be a numeric PolarPort allocation');
    }
    const overridePort = Number.parseInt(managedOverride, 10);
    if (!Number.isSafeInteger(overridePort) || overridePort < 1 || overridePort > 65535) {
      throw new Error('AUTOOFFICE_MANAGED_PORT must be within 1-65535');
    }
    effectiveExpected = overridePort;
  }

  const rawPort = env.PORT;
  if (rawPort === undefined || !/^\d+$/.test(rawPort)) {
    throw new Error('AutoOffice requires a valid PORT injected by PolarPort');
  }

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isSafeInteger(port) || port !== effectiveExpected) {
    throw new Error(`AutoOffice requires PolarPort allocation ${effectiveExpected}; received ${rawPort}`);
  }

  return { port, direct: false };
}

