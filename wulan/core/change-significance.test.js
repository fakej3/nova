import { assessWorldChange, connectChangeSignificance } from './change-significance.js';

function event(diff, source = 'sentinel.inspect', subject = 'sentinel') {
  return { id: 'evt-1', correlationId: 'corr-1', payload: { observation: { source, subject }, diff } };
}

describe('world-change significance', () => {
  test('classifies a normal single-field change as relevant', () => {
    expect(assessWorldChange(event({ counts: { added: 0, removed: 0, changed: 1 }, changedFields: { 'branch.sha': { from: 'A', to: 'B' } } }))).toMatchObject({ level: 'relevant', shouldReason: true, totalChanges: 1 });
  });

  test('classifies critical fields as critical', () => {
    expect(assessWorldChange(event({ counts: { added: 0, removed: 0, changed: 1 }, changedFields: { status: { from: 'ready', to: 'failed' } } }))).toMatchObject({ level: 'critical', shouldReason: true });
  });

  test('does not reason about an unchanged observation', () => {
    expect(assessWorldChange(event({ counts: { added: 0, removed: 0, changed: 0 }, changedFields: {} }))).toMatchObject({ level: 'insignificant', shouldReason: false, totalChanges: 0 });
  });

  test('emits a deterministic assessment from world.changed', () => {
    const listeners = new Map();
    const events = {
      on(type, handler) { listeners.set(type, handler); return () => listeners.delete(type); },
      emit(type, payload) { this.last = { type, payload }; return this.last; },
    };
    connectChangeSignificance({ events });
    listeners.get('world.changed')(event({ counts: { added: 0, removed: 0, changed: 1 }, changedFields: { 'branch.sha': { from: 'A', to: 'B' } } }));
    expect(events.last).toMatchObject({ type: 'world.change_assessed', payload: { level: 'relevant', shouldReason: true } });
  });
});
