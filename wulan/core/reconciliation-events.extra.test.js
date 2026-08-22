import { WulanEventBus, WULAN_EVENTS } from './event-bus.js';
import { createReconciliationEventBridge } from './reconciliation-events.js';

describe('reconciliation event bridge details', () => {
  test('emits a structured world.changed event for a real diff', () => {
    const events = new WulanEventBus();
    const changes = [];
    events.on(WULAN_EVENTS.WORLD_CHANGED, event => changes.push(event));
    const bridge = createReconciliationEventBridge({ events });

    bridge.handle({
      observation: { source: 'sentinel.inspect', subject: 'sentinel' },
      previous: { data: { sha: 'AAA' } },
      diff: { changed: true, counts: { added: 0, removed: 0, changed: 1 }, changedFields: { sha: { from: 'AAA', to: 'BBB' } } }
    });

    expect(changes).toHaveLength(1);
    expect(changes[0].payload.diff.changedFields.sha).toEqual({ from: 'AAA', to: 'BBB' });
    expect(changes[0].source).toBe('wulan-reconciliation');
  });
});
