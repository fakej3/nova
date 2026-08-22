import { createChangeTrail } from './change-trail.js';

function bus() {
  const listeners = new Map();
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    emit(type, payload, meta = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ id: `evt-${type}`, payload, ...meta });
    }
  };
}

describe('world change trail', () => {
  test('persists an assessed change with structured metadata and emits a record event', () => {
    const events = bus();
    const records = [];
    const memory = {
      add(input) {
        const record = { id: `memory-${records.length + 1}`, ...input };
        records.push(record);
        return record;
      }
    };
    const trail = createChangeTrail({ memory, events });
    const recorded = [];
    events.on('world.change_recorded', event => recorded.push(event));

    events.emit('world.change_assessed', {
      level: 'critical',
      source: 'sentinel.inspect',
      subject: 'sentinel',
      totalChanges: 1,
      counts: { added: 0, removed: 0, changed: 1 },
      fields: ['status'],
    }, { correlationId: 'corr-1' });

    expect(trail.list()).toHaveLength(1);
    expect(trail.list()[0]).toMatchObject({
      type: 'world-change',
      source: 'wulan-change-trail',
      importance: 0.95,
      metadata: expect.objectContaining({ subject: 'sentinel', level: 'critical', correlationId: 'corr-1' })
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload.record.id).toBe('memory-1');
  });

  test('disposes cleanly and stops recording new assessments', () => {
    const events = bus();
    const records = [];
    const trail = createChangeTrail({
      events,
      memory: { add(input) { const record = { id: 'memory-1', ...input }; records.push(record); return record; } }
    });
    trail.dispose();
    events.emit('world.change_assessed', { level: 'relevant', subject: 'strategy-lab' });
    expect(trail.list()).toEqual([]);
    expect(records).toEqual([]);
  });
});
