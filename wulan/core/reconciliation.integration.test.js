import { WulanWorldModel } from './world.js';
import { createObservationIngestor } from './observation.js';
import { createWorldReconciler } from './reconciliation.js';

describe('reconciliation observation flow', () => {
  test('preserves observations while reconciling latest state', () => {
    const world = new WulanWorldModel({ now: () => '2026-08-22T12:00:00.000Z' });
    const ingestor = createObservationIngestor({ world });
    const reconciler = createWorldReconciler({ world });

    const first = ingestor.ingest({ source: 'sentinel.inspect', subject: 'sentinel', data: { branch: { sha: 'AAA' } } });
    const second = ingestor.ingest({ source: 'sentinel.inspect', subject: 'sentinel', data: { branch: { sha: 'BBB' } } });
    reconciler.reconcile(first);
    const result = reconciler.reconcile(second);

    expect(world.snapshot().observations).toHaveLength(2);
    expect(result.diff.changedFields['branch.sha']).toEqual({ from: 'AAA', to: 'BBB' });
  });
});
