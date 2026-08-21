import { createWulanCore } from './index.js';

const core=createWulanCore();
core.ai.registerProvider({id:'test',name:'test',generate:async()=>JSON.stringify({intent:'test',answer:'done',actions:[{capabilityId:'echo',input:{value:'hello'}}],learningSignal:'accepted'})});
core.capabilities.register({id:'echo',name:'Echo',description:'Returns its input',execute:async input=>({ok:true,value:input.value})});
core.ai.setDefaultProvider('test');
const run=await core.cognize('say hello',{execute:true});
if(run.status!=='completed')throw new Error(`Cognition smoke failed: ${run.status}`);
if(run.results?.[0]?.result?.value!=='hello')throw new Error('Capability was not executed');
if(core.learning.recent(1)[0]?.outcome!=='accepted')throw new Error('Learning signal was not recorded');
console.log(JSON.stringify({ok:true,status:run.status,steps:run.steps.length,learning:core.learning.recent(1)[0].outcome}));
