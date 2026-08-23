const taskId=()=>`task_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

export class WulanTaskOrchestrator{
 constructor(core,{maxTasks=100,maxSteps=12,maxRetries=1}={}){if(!core)throw new TypeError('Task orchestrator requires Wulan core');this.core=core;this.maxTasks=maxTasks;this.maxSteps=maxSteps;this.maxRetries=maxRetries;this.history=[];}
 validate(definition){
  if(!definition||typeof definition!=='object')throw new TypeError('Task definition is required');
  const tasks=Array.isArray(definition.tasks)?definition.tasks:[];if(!tasks.length)throw new TypeError('Task graph requires at least one task');if(tasks.length>this.maxSteps)throw new Error(`TASK_LIMIT_EXCEEDED: maximum ${this.maxSteps} steps`);
  const ids=new Set();for(const task of tasks){if(!task?.id||ids.has(task.id))throw new Error(`INVALID_TASK_ID: ${task?.id??'missing'}`);ids.add(task.id);if(!task.capabilityId)throw new Error(`TASK_CAPABILITY_REQUIRED: ${task.id}`);if(!this.core.capabilities.get(task.capabilityId))throw new Error(`CAPABILITY_NOT_REGISTERED: ${task.capabilityId}`);for(const dependency of task.dependsOn??[]){if(dependency===task.id||!tasks.some(candidate=>candidate.id===dependency))throw new Error(`INVALID_TASK_DEPENDENCY: ${task.id} -> ${dependency}`);}}
  this.#assertAcyclic(tasks);return tasks;
 }
 async run(definition,{approvedCapabilities=[],signal}={}){
  const tasks=this.validate(definition);const run={id:taskId(),name:String(definition.name??'Wulan task'),status:'running',startedAt:new Date().toISOString(),tasks:tasks.map(task=>({id:task.id,capabilityId:task.capabilityId,status:'pending',attempts:0}))};this.history.push(run);if(this.history.length>this.maxTasks)this.history.shift();
  const byId=new Map(run.tasks.map(task=>[task.id,task]));const results={};let completed=0;
  while(completed<tasks.length){
   if(signal?.aborted){run.status='cancelled';break;}
   const ready=tasks.filter(task=>{const state=byId.get(task.id);return state.status==='pending'&&(task.dependsOn??[]).every(id=>byId.get(id)?.status==='success'||byId.get(id)?.status==='skipped');});
   if(!ready.length){const blocked=tasks.some(task=>byId.get(task.id).status==='pending');if(blocked)run.status='blocked';break;}
   let progressed=false;
   for(const task of ready){
    const state=byId.get(task.id);const capability=this.core.capabilities.get(task.capabilityId);if(capability.requiresApproval&&!approvedCapabilities.includes(task.capabilityId)){state.status='blocked';state.error='APPROVAL_REQUIRED';run.status='partial';continue;}
    state.status='running';state.startedAt=new Date().toISOString();let success=false;let lastError=null;
    for(let attempt=0;attempt<=this.maxRetries;attempt++){state.attempts=attempt+1;try{const input=typeof task.input==='function'?await task.input(results):{...(task.input??{})};const context={taskId:task.id,orchestrationId:run.id,results};const result=await this.core.invokeCapability(task.capabilityId,input,context);const verification=task.verify?await this.#verify(task,result,context):{verified:true,method:'none'};if(!verification.verified)throw new Error('TASK_VERIFICATION_FAILED');results[task.id]={status:'success',result,verification};state.status='success';state.result=result;state.verification=verification;success=true;break;}catch(error){lastError=String(error?.message??error);state.error=lastError;}}
    state.finishedAt=new Date().toISOString();if(!success){state.status='failed';run.status='partial';results[task.id]={status:'failed',error:lastError};if(task.required!==false){for(const future of tasks){const futureState=byId.get(future.id);if(futureState.status==='pending'&&(future.dependsOn??[]).includes(task.id))futureState.status='skipped';}completed=tasks.filter(item=>['success','failed','skipped','blocked'].includes(byId.get(item.id).status)).length;break;}}
    completed++;progressed=true;this.core.events.emit('task.step.completed',{orchestrationId:run.id,taskId:task.id,status:state.status,capabilityId:task.capabilityId});
   }
   if(!progressed)break;
  }
  const states=[...byId.values()];if(run.status==='running')run.status=states.every(state=>state.status==='success')?'completed':'partial';run.results=results;run.finishedAt=new Date().toISOString();this.core.events.emit('task.completed',{orchestrationId:run.id,status:run.status,tasks:states.map(({id,status,attempts,error})=>({id,status,attempts,error}))});this.#remember(run);return run;
 }
 async #verify(task,result,context){if(typeof task.verify==='function')return{verified:Boolean(await task.verify(result,context)),method:'task'};if(task.expected!==undefined)return this.core.capabilities.verify(task.capabilityId,result,task.expected,context);return{verified:true,method:'none'};}
 #assertAcyclic(tasks){const map=new Map(tasks.map(task=>[task.id,task]));const visiting=new Set(),visited=new Set();const visit=id=>{if(visiting.has(id))throw new Error(`TASK_CYCLE_DETECTED: ${id}`);if(visited.has(id))return;visiting.add(id);for(const dep of map.get(id).dependsOn??[])visit(dep);visiting.delete(id);visited.add(id);};for(const task of tasks)visit(task.id);}
 #remember(run){try{this.core.remember({type:'task',content:`Wulan task “${run.name}” finished with status ${run.status}. Steps: ${run.tasks.map(task=>`${task.id}:${task.status}`).join(', ')}`,importance:.55,confidence:.9,tags:['task-orchestration',run.status],source:'orchestrator'});}catch{}}
 recent(limit=20){return this.history.slice(-limit).reverse();}
 stats(){return{runs:this.history.length,completed:this.history.filter(run=>run.status==='completed').length,partial:this.history.filter(run=>run.status==='partial').length,blocked:this.history.filter(run=>run.status==='blocked').length,cancelled:this.history.filter(run=>run.status==='cancelled').length};}
}