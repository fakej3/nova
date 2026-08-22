export function createObservationIngestor({ world, events = null } = {}) {
  if (!world) throw new TypeError('World model is required');

  const ingest = observation => {
    if (!observation?.source) throw new TypeError('Observation source is required');
    const value = world.observe({
      source: observation.source,
      subject: observation.subject ?? null,
      kind: observation.kind ?? 'state',
      status: observation.status ?? null,
      data: observation.data ?? null,
      confidence: observation.confidence ?? 1
    });

    events?.emit?.('world.observed', value, { source: 'wulan-observation' });
    return value;
  };

  return {
    ingest,
    ingestCapabilityResult({ capability, result, subject = null, confidence = 1 }) {
      return ingest({
        source: capability,
        subject,
        kind: 'capability-result',
        data: result,
        confidence
      });
    }
  };
}
