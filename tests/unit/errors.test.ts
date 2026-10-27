import { describe, expect, it } from 'vitest';
import { toCommandError } from '../../src/core/types';

/**
 * The renderer must never surface a raw, opaque rejection to the user.
 * These tests pin the normalization contract used by every error path.
 */
describe('toCommandError', () => {
  /** Structured backend errors keep their code and message verbatim. */
  it('preserves a structured command error', () => {
    const error = toCommandError({ code: 'incorrect_pin', message: 'That PIN is not correct.' });
    expect(error.code).toBe('incorrect_pin');
    expect(error.message).toBe('That PIN is not correct.');
  });

  /** Detail payloads carry lockout/attempt counters the UI renders. */
  it('keeps optional details such as attempt counters', () => {
    const error = toCommandError({
      code: 'locked_out',
      message: 'Too many attempts.',
      details: { attemptsRemaining: 2 },
    });
    expect(error.details).toEqual({ attemptsRemaining: 2 });
  });

  /** Plain Error objects are converted into the stable shape. */
  it('normalizes native Error instances', () => {
    const error = toCommandError(new Error('boom'));
    expect(error).toEqual({ code: 'unexpected_error', message: 'boom' });
  });

  /** String rejections (e.g. from invoke) still produce a usable message. */
  it('normalizes string rejections', () => {
    expect(toCommandError('network down')).toEqual({
      code: 'unexpected_error',
      message: 'network down',
    });
  });

  /** Unknown garbage must never throw inside an error handler. */
  it('falls back for completely unknown values', () => {
    expect(toCommandError(undefined).code).toBe('unexpected_error');
    expect(toCommandError(null).code).toBe('unexpected_error');
    expect(toCommandError(42).code).toBe('unexpected_error');
    expect(toCommandError({}).code).toBe('unexpected_error');
  });
});
