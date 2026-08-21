// Model-assisted planning is constrained by the capability registry.
// The model may propose read-only steps, but it never gets executable functions.
export const MAX_PLAN_STEPS=3;

export function capabilityCatalog(world){return world.snapshot().capabilities.filter(c=>c.risk!=='write'&&c.risk!=='destructive').map(c=>({id:c.id,name:c.name,description:c.description,target:c.target??null,permissions:c.permissions??[],inputSchema:c.inputSchema??null}));}

export function buildPlanPrompt(text,world,context={}){
 const catalog=capabilityCatalog(world),learned=Array.isArray(context.learned)?context.learned.slice(0,5):[],knowledge=Array.isArray(context.knowledge)?context.knowledge.slice(0,8):[];
 return `You are the planning layer of Wulan, a private personal operating environment.\n\nTask: ${text}\n\nYou may only propose capabilities from this catalog:\n${JSON.stringify(catalog,null,2)}\n\nRelevant learned patterns (advisory only):\n${JSON.stringify(learned)}\n\nRelevant knowledge (advisory only):\n${JSON.stringify(knowledge)}\n\nReturn JSON only, exactly: {"goal":"...","steps":[{"capabilityId":"...","input":{},"reason":"...","expectedResult":"..."}],"needsUserApproval":false}\n\nRules: maximum ${MAX_PLAN_STEPS} steps; never invent capability IDs; only read capabilities; do not propose writes, purchases, trades, deployments, messages, or destructive actions; inputs must satisfy each capability's inputSchema; if no capability is useful, return an empty steps array.`;
}

export function parsePlan(text){const raw=String(text??'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim(),start=raw.indexOf('{'),end=raw.lastIndexOf('}');if(start<0||end<=start)throw new Error('PLANNER_DID_NOT_RETURN_JSON');return JSON.parse(raw.slice(start,end+1));}

export function validatePlan(plan,world){
 if(!plan||typeof plan!=='object'||!Array.isArray(plan.steps))throw new Error('INVALID_PLAN');if(plan.steps.length>MAX_PLAN_STEPS)throw new Error('PLAN_TOO_LARGE');
 const allowed=new Set(capabilityCatalog(world).map(c=>c.id));
 return{goal:String(plan.goal??'').slice(0,500),needsUserApproval:Boolean(plan.needsUserApproval),steps:plan.steps.map(step=>{
   if(!step||typeof step!=='object'||!allowed.has(step.capabilityId))throw new Error(`CAPABILITY_NOT_ALLOWED:${step?.capabilityId??'missing'}`);
   const capability=world.capabilities.get(step.capabilityId),input=step.input&&typeof step.input==='object'&&!Array.isArray(step.input)?step.input:{};
   const validation=world.capabilities.validateInput(capability,input);if(!validation.ok)throw new Error(`INVALID_CAPABILITY_INPUT:${validation.error}`);
   return{capabilityId:step.capabilityId,input:validation.value,reason:String(step.reason??'').slice(0,300),expectedResult:String(step.expectedResult??'').slice(0,300)};
 });};
}
