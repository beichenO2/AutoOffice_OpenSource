import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocxReportPayload } from '../src/docx/types.js';

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

import { renderDocxWithPythonDocx } from '../src/docx/run-python-docx.js';

function createPayload(): DocxReportPayload {
  return {
    theme: 'business',
    locale: 'zh-CN',
    title: '测试报告',
    sections: [{ heading: '概览', body: '正文内容。' }],
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

describe('renderDocxWithPythonDocx', () => {
  it('times out hung python-docx processes and still cleans up the temp file', async () => {
    vi.useFakeTimers();
    unlinkMock.mockResolvedValue(undefined);
    spawnSyncMock.mockReturnValueOnce({ status: 0 });
    const fakeChild = createFakeChildProcess({ closeOnEnd: false });
    spawnMock.mockReturnValue(fakeChild.child);

    const pending = renderDocxWithPythonDocx(createPayload());
    const rejection = expect(pending).rejects.toThrow('python-docx timed out after 60000ms');

    await vi.advanceTimersByTimeAsync(60_000);

    await rejection;
    expect(fakeChild.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(readFileMock).not.toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up the temp file when python-docx fails to spawn', async () => {
    unlinkMock.mockResolvedValue(undefined);
    spawnSyncMock.mockReturnValueOnce({ status: 0 });
    const fakeChild = createFakeChildProcess({ closeOnEnd: false });
    spawnMock.mockReturnValue(fakeChild.child);

    const pending = renderDocxWithPythonDocx(createPayload());
    fakeChild.emitError(new Error('spawn failed'));

    await expect(pending).rejects.toThrow('spawn failed');
    expect(readFileMock).not.toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });
});
