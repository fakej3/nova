import { reconcileObservations, createWorldReconciler } from './reconciliation.js';

describe('world-state reconciliation', () => {
  test('detects added, removed and changed nested fields', () => {
    const result = reconcileObservations(
      { data: { branch: { sha: 'AAA' }, status: 'ready', old: true } },
      { data: { branch: { sha: 'BBB' }, status: 'ready', fresh: true } }
    );

    expect(result.changed).toBe(true);
    expect(result.changedFields['branch.sha']).toEqual({ from: 'AAA', to: 'BBB' });
    expect(result.added.fresh).toBe(true);
    expect(result.removed.old).toBe(true);
    expect(result.counts).toEqual({ added: 1, removed: 1, changed: 1 });
  });

  test('reports an added field as a world change', () => {
    const result = reconcileObservations({ data: { status: 'ready' } }, { data: { status: 'ready', version: 2 } });
    expect(result.changed).toBe(true);
    expect(result.counts).toEqual({ added: 1, removed: 0, changed: 0 });
  });

  test('reports a removed field as a world change', () => {
    const result = reconcileObservations({ data: { status: 'ready', version: 2 } }, { data: { status: 'ready' } });
    expect(result.changed).toBe(true);
    expect(result.counts).toEqual({ added: 0, removed: 1, changed: 0 });
  });

  test('first observation establishes baseline without reporting a change', () => {
    const reconciler = createWorldReconciler({ world: {} });
    const result = reconciler.reconcile({ source: 'sentinel.inspect', subject: 'sentinel', data: { sha: 'AAA' } });

    expect(result.previous).toBeNull();
    expect(result.diff.changed).toBe(false);
    expect(result.diff.added).toEqual({ sha: 'AAA' });
  });

  test('compares repeated observations for the same source and subject', () => {
    const reconciler = createWorldReconciler({ world: {} });
    reconciler.reconcile({ source: 'strategy-lab.inspect', subject: 'strategy-lab', data: { sha: 'AAA' } });
    const result = reconciler.reconcile({ source: 'strategy-lab.inspect', subject: 'strategy-lab', data: { sha: 'BBB' } });

    expect(result.previous.data.sha).toBe('AAA');
    expect(result.diff.changedFields.sha).toEqual({ from: 'AAA', to: 'BBB' });
    expect(reconciler.latest('strategy-lab.inspect', 'strategy-lab').data.sha).toBe('BBB');
  });
});
