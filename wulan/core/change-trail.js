export function createChangeTrail({ memory, events } = {}) {
  if (!memory?.add || !events?.on) throw new TypeError('Memory store and event bus are required');

  const records = new Map();

  const unsubscribe = events.on('world.change_assessed', event => {
    const assessment = event?.payload ?? event;
    const record = memory.add({
      type: 'world-change',
      content: `World change on ${assessment.subject ?? 'unknown'} assessed as ${assessment.level}.`,
      importance: assessment.level === 'critical' ? 0.95 : assessment.level === 'relevant' ? 0.75 : 0.4,
      confidence: 1,
      tags: ['world-change', assessment.level, assessment.source ?? 'unknown'],
      source: 'wulan-change-trail',
      metadata: {
        level: assessment.level,
        source: assessment.source,
        subject: assessment.subject,
        totalChanges: assessment.totalChanges,
        counts: assessment.counts,
        fields: assessment.fields,
        correlationId: event?.correlationId ?? event?.id ?? null,
      },
    });

    records.set(record.id, record);
    events.emit('world.change_recorded', { record, assessment }, {
      source: 'wulan-change-trail',
      correlationId: event?.correlationId ?? event?.id,
    });
    return record;
  });

  return {
    list() { return [...records.values()]; },
    get(id) { return records.get(id) ?? null; },
    dispose() { unsubscribe?.(); },
  };
}
