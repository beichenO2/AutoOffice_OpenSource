import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, execFileAsyncMock, spawnSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileAsyncMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const execFile = Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock,
  });
  return {
    execFile,
    spawnSync: spawnSyncMock,
  };
});

import {
  KNOWLEVERAGE_DIR_ENV,
  findPythonForKnowLeverage,
  knowleveragePythonImportProbeScript,
  queryRAG,
} from '../src/integrations/knowleverage.js';

afterEach(() => {
  delete process.env[KNOWLEVERAGE_DIR_ENV];
  vi.clearAllMocks();
});

describe('knowleverage configuration', () => {
  it('uses the configured KnowLeverage directory for subprocess calls', async () => {
    const configuredDir = '/tmp/custom-knowleverage';
    process.env[KNOWLEVERAGE_DIR_ENV] = configuredDir;
    spawnSyncMock
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 });

    execFileAsyncMock.mockResolvedValue({
      stdout: 'retrieved context\n',
      stderr: '',
    });

    const result = await queryRAG('portable setup', 4);

    expect(result).toEqual({
      context: 'retrieved context',
      query: 'portable setup',
      success: true,
    });

    const [cmd, args, options] = execFileAsyncMock.mock.calls[0] ?? [];
    expect(cmd).toBe('python3');
    const probe = ['-c', knowleveragePythonImportProbeScript(), configuredDir];
    expect(spawnSyncMock).toHaveBeenNthCalledWith(1, '/opt/homebrew/bin/python3', probe, {
      stdio: 'pipe',
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(2, 'python3', probe, { stdio: 'pipe' });
    expect(args[2]).toBe(configuredDir);
    expect(JSON.parse(args[3])).toEqual({ query: 'portable setup', top_k: 4 });
    expect(options).toMatchObject({
      timeout: 15000,
      cwd: configuredDir,
    });
  });

  it('prefers the Homebrew python when PATH does not expose python3', () => {
    const configuredDir = '/tmp/custom-knowleverage';
    spawnSyncMock.mockReturnValueOnce({ status: 0 });

    const python = findPythonForKnowLeverage(configuredDir);

    expect(python).toBe('/opt/homebrew/bin/python3');
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      '/opt/homebrew/bin/python3',
      ['-c', knowleveragePythonImportProbeScript(), configuredDir],
      { stdio: 'pipe' },
    );
  });

  it('falls back to a generic python probe when the import check fails', () => {
    const configuredDir = '/tmp/custom-knowleverage';
    spawnSyncMock
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 });

    const python = findPythonForKnowLeverage(configuredDir);

    expect(python).toBe('/opt/homebrew/bin/python3');
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      '/opt/homebrew/bin/python3',
      ['--version'],
      { stdio: 'pipe' },
    );
  });
});
