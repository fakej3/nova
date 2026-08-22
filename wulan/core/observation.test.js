import { WulanWorldModel } from './world.js';
import { createObservationIngestor } from './observation.js';

describe('createObservationIngestor', () => {
  test('turns capability results into world observations', () => {
    const world = new WulanWorldModel({ now: () => '2026-08-22T10:00:00.000Z' });
    const ingestor = createObservationIngestor({ world });

    const observation = ingestor.ingestCapabilityResult({
      capability: 'sentinel.inspect',
      subject: 'sentinel',
      result: { branch: { sha: 'abc123' } },
      confidence: 0.95
    });

    expect(observation.source).toBe('sentinel.inspect');
    expect(observation.subject).toBe('sentinel');
    expect(observation.kind).toBe('capability-result');
    expect(world.snapshot().observations).toHaveLength(1);
  });

  test('rejects observations without a source', () => {
    const world = new WulanWorldModel();
    const ingestor = createObservationIngestor({ world });
    expect(() => ingestor.ingest({ data: 'bad' })).toThrow('Observation source is required');
  });
});
