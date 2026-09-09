import { describe, expect, it } from 'vitest';
import { SessionRequestQueue } from '../src/app/createCoreServices.js';

describe('session request queue', () => {
  it('runs session operations in submission order', async () => {
    const queue = new SessionRequestQueue();
    const events = [];
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });

    const firstResult = queue.enqueue(async () => {
      events.push('first:start');
      await first;
      events.push('first:end');
      return 1;
    });
    const secondResult = queue.enqueue(async () => {
      events.push('second');
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await expect(firstResult).resolves.toBe(1);
    await expect(secondResult).resolves.toBe(2);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('continues the queue after a failed operation', async () => {
    const queue = new SessionRequestQueue();
    const next = queue.enqueue(async () => { throw new Error('expected'); });
    const after = queue.enqueue(async () => 'ok');

    await expect(next).rejects.toThrow('expected');
    await expect(after).resolves.toBe('ok');
  });
});
