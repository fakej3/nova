import { createWulanCore } from './index.js';

describe('Wulan change trail integration', () => {
  test('assessed world changes become durable trail records', async () => {
    const core = createWulanCore();
    const assessments = [];
    core.events.on('world.change_assessed', event => assessments.push(event));

    core.events.emit('world.change_assessed', {
      level: 'relevant',
      source: 'strategy-lab.inspect',
      subject: 'strategy-lab',
      totalChanges: 1,
      counts: { added: 0, removed: 0, changed: 1 },
      fields: ['branch.sha'],
    }, { correlationId: 'integration-1' });

    await Promise.resolve();
    expect(assessments).toHaveLength(1);
    expect(core.changeTrail.list()).toHaveLength(1);
    expect(core.changeTrail.list()[0].metadata).toMatchObject({
      source: 'strategy-lab.inspect',
      subject: 'strategy-lab',
      correlationId: 'integration-1'
    });
  });
});
