import { createWulanCore } from './index.js';

describe('world-change cognition bridge', () => {
  test('relevant changes trigger planning without executing capabilities', async () => {
    const core = createWulanCore();
    const calls = [];
    core.cognize = async (input, options) => { calls.push({ input, options }); return { status: 'planned' }; };

    core.events.emit('world.change_assessed', {
      level: 'relevant',
      shouldReason: true,
      source: 'sentinel.inspect',
      subject: 'sentinel',
      totalChanges: 1,
      fields: ['branch.sha'],
    });

    await new Promise(resolve => setImmediate(resolve));
    expect(calls).toHaveLength(1);
    expect(calls[0].options.execute).toBe(false);
    expect(calls[0].options.context).toMatchObject({ trigger: 'world-change', severity: 'relevant', subject: 'sentinel' });
  });

  test('insignificant changes do not trigger cognition', async () => {
    const core = createWulanCore();
    const calls = [];
    core.cognize = async (...args) => { calls.push(args); };
    core.events.emit('world.change_assessed', { level: 'insignificant', shouldReason: false, totalChanges: 0, fields: [] });
    await new Promise(resolve => setImmediate(resolve));
    expect(calls).toHaveLength(0);
  });
});
