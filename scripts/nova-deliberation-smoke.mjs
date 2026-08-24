import assert from 'node:assert/strict';
import { createWulanCore } from '../wulan/core/index.js';

const core=createWulanCore();
core.registerAgent({id:'atlas',name:'ATLAS',role:'research',capabilities:['memory.remember']});
core.registerAgent({id:'oracle',name:'ORACLE',role:'verification',capabilities:['memory.search']});
core.boot();

const plan=core.agentDeliberator.deliberate({
  objective:'Collect a fact and then verify it',
  name:'Deliberation smoke',
  steps:[
    {id:'research',capabilityId:'memory.remember',purpose:'store research fact',input:{content:'Deliberation smoke fact',type:'fact'},publish:['facts']},
    {id:'verify',capabilityId:'memory.search',purpose:'search the research fact',dependsOn:['research'],input:{$result:'research'},publish:['artifacts']}
  ]
});
assert.equal(plan.tasks.length,2);
assert.equal(plan.tasks[0].agentId,'atlas');
assert.equal(plan.tasks[1].agentId,'oracle');
assert.deepEqual(plan.tasks[1].dependsOn,['research']);
assert.equal(plan.reasoning.strategy,'capability_match_dependency_graph');

const run=await core.agentDeliberator.execute({
  objective:'Run a tiny coordinated verification',
  steps:[
    {id:'remember',capabilityId:'memory.remember',purpose:'remember evidence',input:{content:'Coordinated evidence',type:'fact'},publish:['facts']},
    {id:'search',capabilityId:'memory.search',purpose:'verify evidence',dependsOn:['remember'],input:{query:'Coordinated evidence'},publish:['artifacts']}
  ]
});
assert.equal(run.plan.tasks.length,2);
assert.equal(run.run.status,'completed');
assert.equal(run.run.tasks.every(task=>task.status==='success'),true);
assert.ok(core.teamContext.summarize(run.run.id).facts.length>=1);
assert.ok(core.teamContext.summarize(run.run.id).artifacts.length>=1);

assert.throws(()=>core.agentDeliberator.deliberate({objective:'cycle',steps:[{id:'a',capabilityId:'memory.remember',dependsOn:['b']},{id:'b',capabilityId:'memory.search',dependsOn:['a']}]}),/DELIBERATION_CYCLE_DETECTED/);
assert.throws(()=>core.agentDeliberator.deliberate({objective:'missing',steps:[{id:'a',capabilityId:'does.not.exist'}]}),/NO_AGENT_FOR_DELIBERATION_CAPABILITY/);

console.log(JSON.stringify({ok:true,planId:plan.id,teamId:run.run.id,status:run.run.status,agents:run.plan.tasks.map(task=>({id:task.id,agentId:task.agentId}))},null,2));
