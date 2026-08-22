import { WulanEventBus } from './event-bus.js';
import { WulanWorldModel } from './world.js';
import { createObservationIngestor } from './observation.js';
import { connectWorldReconciliation } from './reconciliation-events.js';

describe('world reconciliation events', () => {
  test('first observation establishes a baseline without emitting world.changed', () => {
    const events = new WulanEventBus();
    const world = new WulanWorldModel();
    const ingestor = createObservationIngestor({ world, events });
    connectWorldReconciliation({ world, events });
    const changes = [];
    events.on('world.changed', event => changes.push(event));

    ingestor.ingest({ source: 'sentinel.inspect', subject: 'sentinel', data: { sha: 'AAA' } });

    expect(changes).toHaveLength(0);
  });

  test('a changed observation emits world.changed with the reconciliation diff', () => {
    const events = new WulanEventBus();
    const world = new WulanWorldModel();
    const ingestor = createObservationIngestor({ world, events });
    connectWorldReconciliation({ world, events });
    const changes = [];
    events.on('world.changed', event => changes.push(event));

    ingestor.ingest({ source: 'sentinel.inspect', subject: 'sentinel', data: { branch: { sha: 'AAA' } } });
    ingestor.ingest({ source: 'sentinel.inspect', subject: 'sentinel', data: { branch: { sha: 'BBB' } } });

    expect(changes).toHaveLength(1);
    expect(changes[0].payload.diff.changedFields['branch.sha']).toEqual({ from: 'AAA', to: 'BBB' });
    expect(changes[0].source).toBe('wulan-reconciliation');
  });

  test('core exposes the reconciler without changing existing world observations', async () => {
    const { createWulanCore } = await import('./index.js');
    const core = createWulanCore();
    expect(core.reconciliation).toBeTruthy();
    expect(core.world.snapshot().observations).toHaveLength(0);
    core.observationIngestor.ingest({ source: 'strategy-lab.inspect', subject: 'strategy-lab', data: { sha: 'AAA' } });
    expect(core.world.snapshot().observations).toHaveLength(1);
  });
});
