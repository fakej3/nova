import { CapabilityRegistry } from './capabilities.js';
import { WulanWorldModel } from './world.js';
import { createObservationIngestor } from './observation.js';

describe('CapabilityRegistry world integration', () => {
  test('records a capability result as an observation', async () => {
    const world = new WulanWorldModel({ now: () => '2026-08-22T10:00:00.000Z' });
    const observationIngestor = createObservationIngestor({ world });
    const registry = new CapabilityRegistry({ observationIngestor });

    registry.register({
      id: 'sentinel.inspect',
      name: 'Inspect Sentinel',
      execute: async () => ({ branch: { sha: 'abc123' } })
    });

    const result = await registry.invoke('sentinel.inspect', { subject: 'sentinel' });
    expect(result.branch.sha).toBe('abc123');
    expect(world.snapshot().observations[0]).toMatchObject({
      source: 'sentinel.inspect',
      subject: 'sentinel',
      kind: 'capability-result'
    });
  });
});
