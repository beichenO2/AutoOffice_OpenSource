import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LatexReportPayload } from '../src/latex/types.js';

const { spawnMock, spawnSyncMock, copyFileMock, readFileMock, writeFileMock, rmMock, mkdtempMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  copyFileMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
  rmMock: vi.fn(),
  mkdtempMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  copyFile: copyFileMock,
  mkdtemp: mkdtempMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  rm: rmMock,
}));

import { renderLatexToPdf } from '../src/latex/run-xelatex.js';

function createPayload(): LatexReportPayload {
  return {
    theme: 'article',
    locale: 'en-US',
    title: 'Timeout Case',
    sections: [{ heading: 'Overview', body: 'Body content.' }],
  };
}

function createFakeChildProcess(options: {
  closeOnEnd?: boolean;
  closeCode?: number | null;
  stdoutChunks?: string[];
  stderrChunks?: string[];
} = {}) {
  const closeListeners: Array<(code: number | null) => void> = [];
  const errorListeners: Array<(error: Error) => void> = [];
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];

  const emitClose = (code: number | null = options.closeCode ?? 0) => {
    for (const listener of closeListeners) {
      listener(code);
    }
  };

  const emitStdout = () => {
    for (const chunk of options.stdoutChunks ?? []) {
      for (const listener of stdoutListeners) {
        listener(Buffer.from(chunk, 'utf-8'));
      }
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
    stdout: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === 'data') {
          stdoutListeners.push(listener);
        }
        return child.stdout;
      }),
    },
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
          emitStdout();
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

describe('renderLatexToPdf timeout handling', () => {
  it('uses mkdtemp-created work directories for isolated latex renders', async () => {
    mkdtempMock.mockResolvedValue('/tmp/autooffice-latex-unique');
    writeFileMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(Buffer.from('%PDF-1.7'));
    rmMock.mockResolvedValue(undefined);
    spawnSyncMock
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });

    const pythonChild = createFakeChildProcess({
      stdoutChunks: ['\\documentclass{article}\\begin{document}ok\\end{document}'],
    });
    const xelatexChild = createFakeChildProcess();

    spawnMock
      .mockReturnValueOnce(pythonChild.child)
      .mockReturnValueOnce(xelatexChild.child);

    const result = await renderLatexToPdf(createPayload());

    expect(result.toString('ascii')).toContain('%PDF');
    expect(mkdtempMock).toHaveBeenCalledWith(expect.stringContaining('autooffice-latex-'));
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/autooffice-latex-unique/output.tex', expect.any(String), 'utf-8');
    expect(readFileMock).toHaveBeenCalledWith('/tmp/autooffice-latex-unique/output.pdf');
    expect(rmMock).toHaveBeenCalledWith('/tmp/autooffice-latex-unique', { recursive: true, force: true });
    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it('times out hung xelatex compilations and cleans up the work directory', async () => {
    vi.useFakeTimers();
    mkdtempMock.mockResolvedValue('/tmp/autooffice-latex-timeout');
    writeFileMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    spawnSyncMock
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });

    const pythonChild = createFakeChildProcess({
      stdoutChunks: ['\\documentclass{article}\\begin{document}ok\\end{document}'],
    });
    const xelatexChild = createFakeChildProcess({ closeOnEnd: false });

    spawnMock
      .mockReturnValueOnce(pythonChild.child)
      .mockReturnValueOnce(xelatexChild.child);

    const pending = renderLatexToPdf(createPayload());
    const rejection = expect(pending).rejects.toThrow('xelatex timed out after 60000ms');

    await vi.advanceTimersByTimeAsync(60_000);

    await rejection;
    expect(xelatexChild.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(readFileMock).not.toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(mkdtempMock).toHaveBeenCalledWith(expect.stringContaining('autooffice-latex-'));
    expect(rmMock.mock.calls[0]?.[0]).toBe('/tmp/autooffice-latex-timeout');
    expect(rmMock.mock.calls[0]?.[1]).toEqual({ recursive: true, force: true });
    expect(copyFileMock).not.toHaveBeenCalled();
  });
});
