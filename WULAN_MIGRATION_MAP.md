# Wulan canonical architecture

This branch is the Wulan foundation. The goal is one authoritative runtime, not two competing systems.

## Canonical

- `wulan/core/` — world, memory, learning, neural layer, consolidation, knowledge, planner, verification, capabilities, orchestration and AI gateway.
- `wulan/tools/` — capability adapters for real integrations.
- `api/` — server execution boundaries and provider gateway.
- `wulan-os.js` — current browser runtime/renderer adapter.
- `services/server-ai.js` — server-side model adapters.

## Keep as compatibility surface for now

- `services/ai-gateway-client.js` — browser adapter to `/api/ai`; keep until the UI is fully migrated to the canonical gateway boundary.
- Existing visual shell files that are still imported by the deployed UI; remove only after import tracing confirms they are unused.

## Migration candidates

- Older `core/`, `modules/`, and `services/` runtime components that duplicate memory, agents, AI routing or state management.
- `wulan-living.js`, `nova2-shell.js`, `wulan2-shell.js` and related legacy shells should be treated as compatibility candidates, not new feature targets.

## Retire rule

A legacy file is retired only when:

1. no canonical runtime imports it;
2. no deployed entry point references it;
3. its tests have a canonical replacement or are explicitly obsolete;
4. the replacement behavior has an integration test.

## Authority rules

- World state: `WulanWorld`.
- Capabilities: `CapabilityRegistry`.
- Memory: `WulanMemoryStore`.
- Feedback: `WulanLearningStore`.
- Neural routing: `WulanNeuralLayer`.
- Learned patterns: `WulanConsolidationEngine`.
- Validated relationships: `WulanKnowledgeGraph`.
- Model access: `WulanAIGateway`.
- Real execution: capability adapters behind server/API boundaries.

## Persistence status

The browser currently provides durable prototype persistence through local storage. Vercel/server functions are intentionally treated as ephemeral. Server-side learning is returned as verified learning events and persisted by the browser runtime until a real shared persistence adapter is introduced.

Do not claim cross-device/shared learning until that adapter exists.
