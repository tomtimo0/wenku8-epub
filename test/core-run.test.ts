import { describe, expect, it } from 'vitest';
import { RunController } from '../src/core/run.js';

describe('RunController.exitCode', () => {
  it('无成功章节时返回 3', () => {
    expect(
      RunController.exitCode(
        { ok: 0, restricted: 2, failed: 0, suspect: 0 },
        false,
      ),
    ).toBe(3);
  });

  it('部分成功时返回 2', () => {
    expect(
      RunController.exitCode(
        { ok: 5, restricted: 1, failed: 0, suspect: 0 },
        false,
      ),
    ).toBe(2);
  });

  it('全部成功时返回 0', () => {
    expect(
      RunController.exitCode({ ok: 10, restricted: 0, failed: 0, suspect: 0 }, false),
    ).toBe(0);
  });
});
