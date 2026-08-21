import { createDefaultWulanCore } from '../wulan/core/manifest.js';
import { buildPlanPrompt, parsePlan, validatePlan } from '../wulan/core/planner.js';
import { generateGemini, generateOpenAI, generateAnthropic } from '../services/server-ai.js';
import { verifyCapabilityResult, summarizeVerification } from '../wulan/core/verification.js';

function errorResponse(res,status,error,details=null){return res.status(status).json({ok:false,error,details});}

function installServerProviders(core){
  core.ai.providers.clear();core.ai.defaultProvider=null;
  core.ai.registerProvider({id:'gemini',name:'Google Gemini',capabilities:['chat','vision','reasoning','planning','tools'],priority:10,generate:generateGemini});
  core.ai.registerProvider({id:'openai',name:'OpenAI / ChatGPT',capabilities:['chat','reasoning','planning','tools'],priority:20,generate:generateOpenAI});
  core.ai.registerProvider({id:'anthropic',name:'Anthropic / Claude',capabilities:['chat','reasoning','coding','planning','tools'],priority:30,generate:generateAnthropic});
  core.ai.setDefaultProvider('gemini');
}

async function modelGenerate(core,request,{providerId=null,capability='chat'}={}){
  try{return await core.ai.generate(request,{providerId,capability});}
  catch(error){if(error?.status===503&&providerId)return core.ai.generate(request,{capability});throw error;}
}

async function executePlan(core,plan,correlationId){
  const results=[];
  for(const step of plan.steps){
    const capability=core.world.capabilities.get(step.capabilityId);if(!capability)throw new Error(`CAPABILITY_NOT_ALLOWED:${step.capabilityId}`);
    if(capability.risk==='write'||capability.risk==='destructive')throw new Error(`WRITE_CAPABILITY_BLOCKED:${step.capabilityId}`);
    const validation=core.capabilities.validateInput(capability,step.input);if(!validation.ok)throw new Error(validation.error);
    const result=await core.world.invoke(step.capabilityId,validation.value,{correlationId,source:'agent-loop'});
    const verification=verifyCapabilityResult({capability,result,expected:step.expectedResult});
    results.push({capabilityId:step.capabilityId,result,verification});
  }
  return results;
}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return errorResponse(res,405,'METHOD_NOT_ALLOWED');}
  const body=req.body||{},text=typeof body.text==='string'?body.text.trim():'';if(!text)return errorResponse(res,400,'TEXT_REQUIRED');
  const core=createDefaultWulanCore();installServerProviders(core);const correlationId=`run_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  core.world.observe('agent-loop',{type:'run.started',correlationId,text});
  try{
    const predicted=core.neural?.predict(text)||{agent:null,confidence:0};
    const learned=core.consolidation?.retrieve(text,{agent:predicted.agent,limit:5})||[];
    const knowledge=core.knowledge?.query(text,{limit:8,minConfidence:.25})||[];
    let plan;
    try{
      const planning=await modelGenerate(core,{system:buildPlanPrompt(text,core.world, {learned,knowledge}),messages:[{role:'user',content:text}],maxOutputTokens:700},{capability:'planning'});
      plan=validatePlan(parsePlan(planning.text),core.world);
    }catch{
      const route=core.orchestrator.classify(text);plan=validatePlan({goal:text,needsUserApproval:false,steps:route.capability?[{capabilityId:route.capability,input:body.input||{},reason:'deterministic fallback'}]:[]},core.world);
    }
    if(plan.needsUserApproval)return res.status(200).json({ok:true,requiresApproval:true,correlationId,plan,results:[],activities:core.world.activities.slice(-20)});
    const results=await executePlan(core,plan,correlationId),verification=summarizeVerification(results);
    const evidence=results.map(r=>`${r.capabilityId}: ${JSON.stringify(r.result)}\nVerification: ${JSON.stringify(r.verification)}`).join('\n');
    let answer;
    try{const synthesis=await modelGenerate(core,{system:'You are Wulan. Answer naturally using only supplied live evidence, verified learning and knowledge. Distinguish verified, failed and inconclusive results. Never claim a problem was solved unless verification supports it.',messages:[{role:'user',content:`Task: ${text}\n\nRelevant learned context:\n${JSON.stringify(learned)}\n\nKnowledge:\n${JSON.stringify(knowledge)}\n\nLive evidence:\n${evidence}`}],maxOutputTokens:900},{providerId:core.state.agents.get(predicted.agent)?.providerId||null,capability:'chat'});answer=synthesis.text;}
    catch{answer=results.length?`I checked it. Verification: ${verification.outcome}.`:'I could not identify a safe action for that request yet.';}
    const learningOutcome=verification.outcome==='verified'?'accepted':verification.outcome==='failed'?'rejected':'inconclusive';
    core.world.observe('agent-loop',{type:'run.completed',correlationId,stepCount:plan.steps.length,success:verification.outcome==='verified',verification});
    const learning=learningOutcome==='inconclusive'?{outcome:'inconclusive',confidence:verification.confidence}:{outcome:learningOutcome,confidence:verification.confidence};
    return res.status(200).json({ok:true,correlationId,plan,results,verification,learning,agent:predicted.agent,neuralPrediction:predicted,learnedContext:learned,knowledge,answer,activities:core.world.activities.slice(-20),observations:core.world.observations.slice(-20)});
  }catch(error){core.world.observe('agent-loop',{type:'run.failed',correlationId,error:error instanceof Error?error.message:String(error)});return errorResponse(res,502,'AGENT_RUN_FAILED',error instanceof Error?error.message:String(error));}
}
