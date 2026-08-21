# Wulan Architecture Contract

This document defines the canonical direction for the Wulan foundation branch. It is intentionally small: implementation follows the contracts below; legacy modules remain isolated until explicitly migrated or retired.

## Canonical runtime

```text
UI
  -> browser Wulan core
  -> /api/agent for agent execution
  -> /api/ai for model access
  -> capability registry for external actions
  -> world for observable state
  -> memory / learning / consolidation / knowledge / neural for local cognition
```

## Authorities

- **World**: canonical runtime state for entities, relations, capabilities, observations and activities.
- **Memory**: durable local experiences and retrieved context in the browser runtime.
- **Learning**: explicit feedback records.
- **Consolidation**: converts repeated feedback into candidate patterns.
- **Knowledge graph**: validated relationships/facts derived from evidence.
- **Neural layer**: local adaptive prediction/routing; it is not a foundation language model.
- **Agents**: specialists with roles and preferred model providers.
- **AI gateway**: the only model boundary exposed to browser code.
- **Capabilities**: the only approved mechanism for external actions.

## Execution contract

```text
request
 -> recall
 -> predict
 -> plan
 -> validate capability + input
 -> execute
 -> verify result
 -> synthesize answer
 -> learn only from verified outcome
```

A successful HTTP/API return is **not** automatically a successful task outcome. Capabilities should provide `verify(result, expected)` whenever correctness can be checked.

## Capability contract

Every capability must declare:

- `id`, `name`, `description`
- `risk`
- `permissions`
- optional `inputSchema`
- `execute(input, context)`
- optional `verify(result, expected)`

Write/destructive capabilities remain blocked until explicit approval and policy infrastructure exists.

## Persistence rule

Browser persistence is currently the durable learning store for the prototype. Vercel server functions are treated as ephemeral execution boundaries. Server-created cores must not be considered persistent memory. A shared/server database will be introduced only when an explicit persistence backend is selected.

## Provider rule

Core code remains vendor-neutral. Gemini is the initial/default provider for free-first development. Additional providers may be configured without changing the world, agents or capability contracts.

## Legacy code

The repository contains earlier Nova modules. They are not automatically authoritative. New Wulan foundation code must not import legacy runtime state directly. Migration/retirement will be handled as a separate audit task so we do not break the working UI while stabilizing the foundation.
