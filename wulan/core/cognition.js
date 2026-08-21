/**
 * Wulan cognition loop.
 *
 * This is the orchestration layer between perception, memory, reasoning and
 * action. The model proposes a plan; Wulan validates and executes only
 * registered capabilities, then records the outcome for future learning.
 */
const safeJson=text=>{try{return JSON.parse(text)}catch{const match=String(text??'').match(/\{[\s\S]*\}/);if(!match)return null;try{return JSON.parse(match[0])}catch{return null}}};
const id=()=>`cog_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

export class WulanCognitionLoop{
 constructor(core,{maxMemoryHits=8,maxSemanticHits=5,maxSteps=6,providerId}={}){if(!core)throw new TypeError('Cognition loop requires Wulan core');this.core=core;this.maxMemoryHits=maxMemoryHits;this.maxSemanticHits=maxSemanticHits;this.maxSteps=maxSteps;this.providerId=providerId;this.runs=[];this.maxRuns=100;}
 async run(input,{execute=true,providerId=this.providerId,context={}}={}){
  const run={id:id(),input:String(input??'').trim(),startedAt:new Date().toISOString(),status:'running',steps:[],context:{...context}};
  if(!run.input)throw new TypeError('Cognition input is required');this.runs.push(run);if(this.runs.length>this.maxRuns)this.runs.shift();
  const emit=(type,payload)=>this.core.events.emit(type,{runId:run.id,...payload},{correlationId:run.id});
  emit('cognition.started',{input:run.input});
  try{
   const memory=this.core.searchMemory(run.input,{limit:this.maxMemoryHits});
   let semantic=[];
   try{semantic=await this.core.searchSemanticMemory(run.input,{limit:this.maxSemanticHits,providerId});}catch{}
   const neural=this.core.neural.predict(run.input);
   const contextBlock=this.#context(memory,semantic,neural);
   run.steps.push({stage:'perceive',memory:memory.length,semantic:semantic.length,neural:neural.trace.length});emit('cognition.perceived',{memory:memory.length,semantic:semantic.length,neural:neural.trace.length});

   const plan=await this.#plan(run.input,contextBlock,providerId);
   run.plan=plan;run.steps.push({stage:'plan',plan});emit('cognition.planned',{plan});
   if(!execute||!plan.actions.length){run.status='planned';run.finishedAt=new Date().toISOString();emit('cognition.completed',{status:run.status,answer:plan.answer??null});return run;}

   const results=[];
   for(const action of plan.actions.slice(0,this.maxSteps)){
    if(!action?.capabilityId)continue;
    const capability=this.core.capabilities.get(action.capabilityId);
    if(!capability){results.push({capabilityId:action.capabilityId,status:'blocked',error:'CAPABILITY_NOT_REGISTERED'});continue;}
    if(capability.requiresApproval&&!context.approvedCapabilities?.includes(action.capabilityId)){results.push({capabilityId:action.capabilityId,status:'blocked',error:'APPROVAL_REQUIRED'});continue;}
    emit('cognition.action_started',{capabilityId:action.capabilityId,input:action.input??{}});
    try{const result=await this.core.invokeCapability(action.capabilityId,action.input??{}, {correlationId:run.id,cognitionRun:run.id});results.push({capabilityId:action.capabilityId,status:'success',result});emit('cognition.action_finished',{capabilityId:action.capabilityId,status:'success'});}catch(error){results.push({capabilityId:action.capabilityId,status:'failed',error:String(error?.message||error)});emit('cognition.action_finished',{capabilityId:action.capabilityId,status:'failed',error:String(error?.message||error)});}
   }
   run.results=results;run.answer=plan.answer??null;run.status=results.some(r=>r.status==='failed')?'partial':'completed';
   await this.#learn(run);run.finishedAt=new Date().toISOString();emit('cognition.completed',{status:run.status,results:results.map(({capabilityId,status,error})=>({capabilityId,status,error}))});return run;
  }catch(error){run.status='failed';run.error=String(error?.message||error);run.finishedAt=new Date().toISOString();emit('cognition.failed',{error:run.error});return run;}
 }
 #context(memory,semantic,neural){const lexical=memory.map(({memory:entry,score})=>({id:entry.id,content:entry.content,type:entry.type,score,source:'lexical'}));const semanticHits=semantic.map(hit=>({id:hit.memory?.id,content:hit.memory?.content,type:hit.memory?.type,score:hit.score,source:'semantic'}));const merged=[...semanticHits,...lexical].filter(x=>x.content);const unique=new Map();for(const item of merged){const previous=unique.get(item.id);if(!previous||item.score>previous.score)unique.set(item.id,item);}return JSON.stringify({memories:[...unique.values()].sort((a,b)=>b.score-a.score).slice(0,10),neural:neural.trace.slice(0,14)});}
 async #plan(input,context,providerId){const system=`You are the planning layer inside Wulan. Do not claim actions were executed. Return ONLY valid JSON. Wulan has registered capabilities supplied below. Select zero or more capabilities. Never invent capability IDs. Keep actions minimal and safe. Schema: {"intent":string,"answer":string,"actions":[{"capabilityId":string,"input":object}],"learningSignal":"accepted|corrected|rejected|none"}.\nRegistered capabilities: ${JSON.stringify(this.core.capabilities.list())}`;const text=await this.core.ai.generate({messages:[{role:'user',content:`User request:\n${input}\n\nRetrieved context:\n${context}` }],system,source:'cognition-plan'},{providerId});const parsed=safeJson(text);if(!parsed)return{intent:'respond',answer:text,actions:[],learningSignal:'none'};const allowed=new Set(this.core.capabilities.list().map(c=>c.id));const actions=Array.isArray(parsed.actions)?parsed.actions.filter(a=>allowed.has(a?.capabilityId)).slice(0,this.maxSteps).map(a=>({capabilityId:a.capabilityId,input:a.input&&typeof a.input==='object'?a.input:{}})):[];return{intent:String(parsed.intent??'respond'),answer:String(parsed.answer??''),actions,learningSignal:['accepted','corrected','rejected','none'].includes(parsed.learningSignal)?parsed.learningSignal:'none'};}
 async #learn(run){const signal=run.plan?.learningSignal;if(signal&&signal!=='none'){try{this.core.recordFeedback({context:run.input,outcome:signal,candidatePreference:run.plan?.actions?.[0]?.capabilityId??'general',source:'cognition'});}catch{}}}
 recent(limit=20){return this.runs.slice(-limit).reverse();}
 stats(){return{runs:this.runs.length,completed:this.runs.filter(r=>r.status==='completed').length,partial:this.runs.filter(r=>r.status==='partial').length,failed:this.runs.filter(r=>r.status==='failed').length};}
}
