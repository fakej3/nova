import { createDefaultWulanCore } from '../wulan/core/manifest.js';
import { buildPlanPrompt, parsePlan, validatePlan } from '../wulan/core/planner.js';
import { generateGemini } from '../services/server-ai.js';

function errorResponse(res,status,error,details=null){return res.status(status).json({ok:false,error,details});}

async function executePlan(core, plan, correlationId) {
  const results=[];
  for (const step of plan.steps) {
    const capability=core.world.capabilities.get(step.capabilityId);
    if (!capability) throw new Error(`CAPABILITY_NOT_ALLOWED:${step.capabilityId}`);
    if (capability.risk==='write'||capability.risk==='destructive') throw new Error(`WRITE_CAPABILITY_BLOCKED:${step.capabilityId}`);
    const result=await core.world.invoke(step.capabilityId,step.input,{correlationId,source:'agent-loop'});
    results.push({capabilityId:step.capabilityId,result});
  }
  return results;
}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return errorResponse(res,405,'METHOD_NOT_ALLOWED');}
  const body=req.body||{};
  const text=typeof body.text==='string'?body.text.trim():'';
  if(!text)return errorResponse(res,400,'TEXT_REQUIRED');
  const core=createDefaultWulanCore();
  const correlationId=`run_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  core.world.observe('agent-loop',{type:'run.started',correlationId,text});
  try{
    let plan;
    try{
      const planning=await generateGemini({system:buildPlanPrompt(text,core.world),messages:[{role:'user',content:text}],maxOutputTokens:700});
      plan=validatePlan(parsePlan(planning.text),core.world);
    }catch(plannerError){
      // Deterministic routing remains the safe fallback when Gemini is unavailable
      // or returns malformed output.
      const route=core.orchestrator.classify(text);
      plan=validatePlan({goal:text,needsUserApproval:false,steps:route.capability?[{capabilityId:route.capability,input:body.input||{},reason:'deterministic fallback'}]:[]},core.world);
    }
    if(plan.needsUserApproval)return res.status(200).json({ok:true,requiresApproval:true,correlationId,plan,results:[],activities:core.world.activities.slice(-20)});
    const results=await executePlan(core,plan,correlationId);
    const evidence=results.map(r=>`${r.capabilityId}: ${JSON.stringify(r.result)}`).join('\n');
    let answer;
    try{
      const synthesis=await generateGemini({system:'You are Wulan. Answer naturally using only the supplied live evidence. Do not claim actions that are not in the evidence. Do not mention internal planning unless useful.',messages:[{role:'user',content:`Task: ${text}\n\nLive evidence:\n${evidence}`}],maxOutputTokens:900});
      answer=synthesis.text;
    }catch{answer=results.length?`I checked it. ${results.map(r=>`${r.capabilityId} completed successfully.`).join(' ')}`:'I could not identify a safe action for that request yet.';}
    core.world.observe('agent-loop',{type:'run.completed',correlationId,stepCount:plan.steps.length,success:true});
    core.remember({type:'experience',content:`Task: ${text}\nPlan: ${plan.steps.map(s=>s.capabilityId).join(', ')||'none'}\nOutcome: completed`,source:'agent-loop',importance:.3,confidence:.7,tags:['agent-run','tool-use']});
    return res.status(200).json({ok:true,correlationId,plan,results,answer,activities:core.world.activities.slice(-20),observations:core.world.observations.slice(-20)});
  }catch(error){
    core.world.observe('agent-loop',{type:'run.failed',correlationId,error:error instanceof Error?error.message:String(error)});
    return errorResponse(res,502,'AGENT_RUN_FAILED',error instanceof Error?error.message:String(error));
  }
}
