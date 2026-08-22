const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function flatten(value, prefix = '', output = {}) {
  if (!isObject(value)) {
    if (prefix) output[prefix] = value;
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(child)) flatten(child, path, output);
    else output[path] = child;
  }
  return output;
}

export function reconcileObservations(previous, current) {
  const before = flatten(previous?.data ?? previous ?? {});
  const after = flatten(current?.data ?? current ?? {});
  const added = {};
  const removed = {};
  const changed = {};

  for (const [key, value] of Object.entries(after)) {
    if (!(key in before)) added[key] = value;
    else if (JSON.stringify(before[key]) !== JSON.stringify(value)) {
      changed[key] = { from: before[key], to: value };
    }
  }
  for (const [key, value] of Object.entries(before)) {
    if (!(key in after)) removed[key] = value;
  }

  const counts = {
    added: Object.keys(added).length,
    removed: Object.keys(removed).length,
    changed: Object.keys(changed).length
  };

  return {
    changed: counts.added > 0 || counts.removed > 0 || counts.changed > 0,
    added,
    removed,
    changedFields: changed,
    counts
  };
}

export function createWorldReconciler({ world } = {}) {
  if (!world) throw new TypeError('World model is required');
  const latest = new Map();

  return {
    reconcile(observation) {
      if (!observation?.source) throw new TypeError('Observation source is required');
      const key = `${observation.source}:${observation.subject ?? ''}`;
      const previous = latest.get(key) ?? null;
      const baseline = flatten(observation.data ?? {});
      const diff = previous ? reconcileObservations(previous, observation) : {
        changed: false,
        added: baseline,
        removed: {},
        changedFields: {},
        counts: { added: Object.keys(baseline).length, removed: 0, changed: 0 }
      };
      latest.set(key, observation);
      return { observation, previous, diff };
    },
    latest(source, subject = null) {
      return latest.get(`${source}:${subject ?? ''}`) ?? null;
    }
  };
}
