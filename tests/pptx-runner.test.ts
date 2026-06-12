import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PptxDeckPayload } from '../src/ppt/types.js';

const { spawnMock, spawnSyncMock, readFileMock, unlinkMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  readFileMock: vi.fn(),
  unlinkMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  unlink: unlinkMock,
}));

import { findPythonForPptx, renderPptxWithPython } from '../src/ppt/run-python-pptx.js';

function createPayload(): PptxDeckPayload {
  return {
    theme: 'minimal',
    locale: 'zh-CN',
    title: '测试演示',
    slides: [{ title: '概览', bullets: ['第一点', '第二点'] }],
  };
}

function createFakeChildProcess(options: {
  closeOnEnd?: boolean;
  closeCode?: number | null;
  stderrChunks?: string[];
} = {}) {
  const closeListeners: Array<(code: number | null) => void> = [];
  const errorListeners: Array<(error: Error) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];

  const emitClose = (code: number | null = options.closeCode ?? 0) => {
    for (const listener of closeListeners) {
      listener(code);
    }
  };

  const emitStderr = () => {
    for (const chunk of options.stderrChunks ?? []) {
      for (const listener of stderrListeners) {
        listener(Buffer.from(chunk, 'utf-8'));
      }
    }
  };

  const child: any = {
    stderr: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === 'data') {
          stderrListeners.push(listener);
        }
        return child.stderr;
      }),
    },
    stdin: {
      write: vi.fn(),
      end: vi.fn(() => {
        if (options.closeOnEnd === false) {
          return;
        }
        queueMicrotask(() => {
          emitStderr();
          emitClose(options.closeCode ?? 0);
        });
      }),
    },
    on: vi.fn((event: string, listener: ((value: number | null) => void) | ((error: Error) => void)) => {
      if (event === 'close') {
        closeListeners.push(listener as (code: number | null) => void);
      }
      if (event === 'error') {
        errorListeners.push(listener as (error: Error) => void);
      }
      return child;
    }),
    kill: vi.fn((_signal?: string) => {
      queueMicrotask(() => emitClose(null));
      return true;
    }),
  };

  return {
    child,
    emitError(error: Error) {
      for (const listener of errorListeners) {
        listener(error);
      }
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('renderPptxWithPython', () => {
  it('prefers a python interpreter that can import pptx', async () => {
    readFileMock.mockResolvedValue(Buffer.from('PK-test-pptx'));
    unlinkMock.mockResolvedValue(undefined);
    spawnSyncMock
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 });
    spawnMock.mockReturnValue(createFakeChildProcess().child);

    const result = await renderPptxWithPython(createPayload());

    expect(result.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      '/opt/homebrew/bin/python3',
      ['-c', 'import pptx'],
      { stdio: 'pipe' },
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      'python3',
      ['-c', 'import pptx'],
      { stdio: 'pipe' },
    );
    const [cmd, args, options] = spawnMock.mock.calls[0] ?? [];
    expect(cmd).toBe('python3');
    expect(args[0]).toContain('tools/pptgen/build_pptx.py');
    expect(args[1]).toContain('autooffice-');
    expect(args[1]).toContain('.pptx');
    expect(options).toEqual({ stdio: ['pipe', 'pipe', 'pipe'] });
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first working python binary when pptx import is unavailable', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 });

    const python = findPythonForPptx();

    expect(python).toBe('/opt/homebrew/bin/python3');
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      '/opt/homebrew/bin/python3',
      ['--version'],
      { stdio: 'pipe' },
    );
  });

  it('times out hung python-pptx processes and still cleans up the temp file', async () => {
    vi.useFakeTimers();
    unlinkMock.mockResolvedValue(undefined);
    spawnSyncMock.mockReturnValueOnce({ status: 0 });
    const fakeChild = createFakeChildProcess({ closeOnEnd: false });
    spawnMock.mockReturnValue(fakeChild.child);

    const pending = renderPptxWithPython(createPayload());
    const rejection = expect(pending).rejects.toThrow('python-pptx timed out after 60000ms');

    await vi.advanceTimersByTimeAsync(60_000);

    await rejection;
    expect(fakeChild.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(readFileMock).not.toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up the temp file when python-pptx fails to spawn', async () => {
    unlinkMock.mockResolvedValue(undefined);
    spawnSyncMock.mockReturnValueOnce({ status: 0 });
    const fakeChild = createFakeChildProcess({ closeOnEnd: false });
    spawnMock.mockReturnValue(fakeChild.child);

    const pending = renderPptxWithPython(createPayload());
    fakeChild.emitError(new Error('spawn failed'));

    await expect(pending).rejects.toThrow('spawn failed');
    expect(readFileMock).not.toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });
});
