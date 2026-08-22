import { createWorldReconciler } from './reconciliation.js';

export function connectWorldReconciliation({ world, events } = {}) {
  if (!world) throw new TypeError('World model is required');
  if (!events?.on || !events?.emit) throw new TypeError('Event bus is required');

  const reconciler = createWorldReconciler({ world });
  const unsubscribe = events.on('world.observed', observation => {
    const result = reconciler.reconcile(observation.payload);
    if (result.diff.changed) {
      events.emit('world.changed', result, {
        source: 'wulan-reconciliation',
        correlationId: observation.correlationId
      });
    }
  });

  return { reconciler, disconnect: unsubscribe };
}
