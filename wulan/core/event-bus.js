// Wulan Core — event bus foundation.
// Runtime-agnostic contract: any future UI, server, native client, or language adapter
// can publish/subscribe to the same conceptual event envelope.

export class WulanEventBus {
  constructor() {
    this.listeners = new Map();
    this.history = [];
    this.maxHistory = 500;
  }

  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type, payload = {}, meta = {}) {
    const event = {
      id: crypto.randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      source: meta.source ?? 'wulan-core',
      correlationId: meta.correlationId ?? null,
      payload,
    };

    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history.shift();

    for (const handler of this.listeners.get(type) ?? []) {
      try { handler(event); } catch (error) {
        console.error(`[WulanEventBus] ${type} handler failed`, error);
      }
    }

    for (const handler of this.listeners.get('*') ?? []) {
      try { handler(event); } catch (error) {
        console.error('[WulanEventBus] wildcard handler failed', error);
      }
    }

    return event;
  }

  recent(limit = 50) {
    return this.history.slice(-limit);
  }
}

export const WULAN_EVENTS = Object.freeze({
  SYSTEM_READY: 'system.ready',
  USER_MESSAGE: 'user.message',
  AGENT_STARTED: 'agent.started',
  AGENT_FINISHED: 'agent.finished',
  AGENT_FAILED: 'agent.failed',
  TOOL_CALLED: 'tool.called',
  TOOL_FINISHED: 'tool.finished',
  MEMORY_RETRIEVED: 'memory.retrieved',
  MEMORY_CREATED: 'memory.created',
  LEARNING_FEEDBACK: 'learning.feedback',
  INTEGRATION_CONNECTED: 'integration.connected',
  INTEGRATION_DISCONNECTED: 'integration.disconnected',
});
