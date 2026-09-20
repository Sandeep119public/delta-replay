import { describe, expect, it } from 'vitest';
import { SessionMutationPipeline } from '../src/app/SessionMutationPipeline.js';

describe('session mutation pipeline', () => {
  it('runs serial session operations in submission order', async () => {
    const pipeline = new SessionMutationPipeline();
    const events = [];
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });

    const firstResult = pipeline.run(async () => {
      events.push('first:start');
      await first;
      events.push('first:end');
      return 1;
    });
    const secondResult = pipeline.run(async () => {
      events.push('second');
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await expect(firstResult).resolves.toMatchObject({ applied: true, response: 1 });
    await expect(secondResult).resolves.toMatchObject({ applied: true, response: 2 });
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('continues the pipeline after a failed operation', async () => {
    const pipeline = new SessionMutationPipeline();
    const next = pipeline.run(async () => { throw new Error('expected'); });
    const after = pipeline.run(async () => 'ok');

    await expect(next).rejects.toThrow('expected');
    await expect(after).resolves.toMatchObject({ applied: true, response: 'ok' });
  });

  it('marks an invalidated response stale without dropping the queued command', async () => {
    const pipeline = new SessionMutationPipeline();
    const generation = pipeline.generation();
    const applied = [];
    const stale = pipeline.run(async () => 'stale', { generation, apply: (value) => applied.push(value) });
    pipeline.invalidate();

    await expect(stale).resolves.toMatchObject({ applied: false, response: 'stale' });
    expect(applied).toEqual([]);
  });


  it('allows latest-only reads to complete independently while applying only the newest response', async () => {
    const pipeline = new SessionMutationPipeline();
    const applied = [];
    let resolveOld;
    let resolveNew;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    const newer = new Promise((resolve) => { resolveNew = resolve; });

    const first = pipeline.run(() => old, { mode: 'latest', scope: 'state', apply: (value) => applied.push(value) });
    const second = pipeline.run(() => newer, { mode: 'latest', scope: 'state', apply: (value) => applied.push(value) });

    resolveNew('new');
    await second;
    resolveOld('old');
    await first;

    expect(applied).toEqual(['new']);
  });

  it('rejects unknown mutation modes', () => {
    const pipeline = new SessionMutationPipeline();
    expect(() => pipeline.run(() => Promise.resolve(), { mode: 'parallel' })).toThrow(/serial or latest/);
  });

});
