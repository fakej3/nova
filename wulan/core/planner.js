// Model-assisted planning is constrained by the capability registry.
// The model may propose read-only steps, but it never gets executable functions.

export const MAX_PLAN_STEPS = 3;

export function capabilityCatalog(world) {
  return world.snapshot().capabilities
    .filter(c => c.risk !== 'write' && c.risk !== 'destructive')
    .map(c => ({ id:c.id, name:c.name, description:c.description, target:c.target ?? null, permissions:c.permissions ?? [] }));
}

export function buildPlanPrompt(text, world) {
  const catalog = capabilityCatalog(world);
  return `You are the planning layer of Wulan, a private personal operating environment.\n\nTask: ${text}\n\nYou may only propose capabilities from this catalog:\n${JSON.stringify(catalog, null, 2)}\n\nReturn JSON only, exactly: {"goal":"...","steps":[{"capabilityId":"...","input":{},"reason":"..."}],"needsUserApproval":false}\nRules: maximum ${MAX_PLAN_STEPS} steps; never invent capability IDs; only read capabilities; do not propose writes, purchases, trades, deployments, messages, or destructive actions; if no capability is useful, return an empty steps array.`;
}

export function parsePlan(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('PLANNER_DID_NOT_RETURN_JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

export function validatePlan(plan, world) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) throw new Error('INVALID_PLAN');
  if (plan.steps.length > MAX_PLAN_STEPS) throw new Error('PLAN_TOO_LARGE');
  const allowed = new Set(capabilityCatalog(world).map(c => c.id));
  return {
    goal: String(plan.goal ?? '').slice(0, 500),
    needsUserApproval: Boolean(plan.needsUserApproval),
    steps: plan.steps.map(step => {
      if (!step || typeof step !== 'object' || !allowed.has(step.capabilityId)) throw new Error(`CAPABILITY_NOT_ALLOWED:${step?.capabilityId ?? 'missing'}`);
      return { capabilityId:step.capabilityId, input:step.input && typeof step.input === 'object' ? step.input : {}, reason:String(step.reason ?? '').slice(0, 300) };
    }),
  };
}
