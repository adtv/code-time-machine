import { describe, expect, it } from 'vitest';
import { isExtensionMessage, parseWebviewMessage } from '../../src/shared/messages/protocol';

describe('parseWebviewMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseWebviewMessage({ type: 'loadMore' })).toEqual({ type: 'loadMore' });
    expect(parseWebviewMessage({ type: 'setActive', payload: { index: 3 } })).toEqual({
      type: 'setActive',
      payload: { index: 3 },
    });
    expect(parseWebviewMessage({ type: 'copy', payload: { text: 'abc', what: 'hash' } })).toEqual({
      type: 'copy',
      payload: { text: 'abc', what: 'hash' },
    });
    expect(parseWebviewMessage({ type: 'log', payload: { level: 'warn', message: 'x' } })).toEqual({
      type: 'log',
      payload: { level: 'warn', message: 'x' },
    });
  });

  it('rejects malformed or hostile messages', () => {
    expect(parseWebviewMessage(null)).toBeUndefined();
    expect(parseWebviewMessage('ready')).toBeUndefined();
    expect(parseWebviewMessage({ type: 'unknown' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'setActive' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'setActive', payload: { index: -1 } })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'setActive', payload: { index: 1.5 } })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'setActive', payload: { index: '1' } })).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'copy', payload: { text: 'x', what: 'evil' } }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'copy', payload: { text: 'x'.repeat(200_000), what: 'hash' } }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'log', payload: { level: 'fatal', message: 'x' } }),
    ).toBeUndefined();
  });

  it('strips unexpected extra fields', () => {
    const parsed = parseWebviewMessage({
      type: 'setActive',
      payload: { index: 2, extra: 'x' },
      more: 1,
    });
    expect(parsed).toEqual({ type: 'setActive', payload: { index: 2 } });
  });
});

describe('isExtensionMessage', () => {
  it('checks the discriminator', () => {
    expect(isExtensionMessage({ type: 'init', payload: {} })).toBe(true);
    expect(isExtensionMessage({ type: 'nope' })).toBe(false);
    expect(isExtensionMessage(undefined)).toBe(false);
  });
});
