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

  const rawPort = env.PORT;
  if (rawPort === undefined || !/^\d+$/.test(rawPort)) {
    throw new Error('AutoOffice requires a valid PORT injected by PolarPort');
  }

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isSafeInteger(port) || port !== expectedPort) {
    throw new Error(`AutoOffice requires PolarPort allocation ${expectedPort}; received ${rawPort}`);
  }

  return { port, direct: false };
}

