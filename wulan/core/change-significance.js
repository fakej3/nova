const DEFAULT_RULES = Object.freeze({
  criticalCount: 5,
  relevantCount: 1,
  criticalFields: ['status', 'error', 'failed', 'production', 'deployment'],
});

function fieldName(path) {
  return String(path ?? '').split('.').at(-1)?.toLowerCase() ?? '';
}

export function assessWorldChange(changeEvent, rules = DEFAULT_RULES) {
  const diff = changeEvent?.payload?.diff ?? {};
  const counts = diff.counts ?? {
    added: Object.keys(diff.added ?? {}).length,
    removed: Object.keys(diff.removed ?? {}).length,
    changed: Object.keys(diff.changedFields ?? {}).length,
  };
  const fields = [
    ...Object.keys(diff.added ?? {}),
    ...Object.keys(diff.removed ?? {}),
    ...Object.keys(diff.changedFields ?? {}),
  ];
  const criticalField = fields.some(path => rules.criticalFields.some(token => fieldName(path).includes(token)));
  const totalChanges = counts.added + counts.removed + counts.changed;
  const level = criticalField || totalChanges >= rules.criticalCount
    ? 'critical'
    : totalChanges >= rules.relevantCount
      ? 'relevant'
      : 'insignificant';

  return {
    level,
    shouldReason: level !== 'insignificant',
    source: changeEvent?.payload?.observation?.source ?? null,
    subject: changeEvent?.payload?.observation?.subject ?? null,
    totalChanges,
    fields,
    counts,
  };
}

export function connectChangeSignificance({ events, rules = DEFAULT_RULES } = {}) {
  if (!events?.on || !events?.emit) throw new TypeError('Event bus is required');
  return events.on('world.changed', event => {
    const assessment = assessWorldChange(event, rules);
    events.emit('world.change_assessed', assessment, {
      source: 'wulan-change-significance',
      correlationId: event.correlationId ?? event.id,
    });
    return assessment;
  });
}

export { DEFAULT_RULES };
