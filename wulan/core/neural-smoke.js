import { WulanNeuralSubstrate } from './neural.js';

const brain=new WulanNeuralSubstrate({maxNeurons:100,maxSynapses:300});
brain.ensureNeuron({id:'agent:atlas',label:'ATLAS',type:'agent'});
brain.ingestMemory({id:'smoke-memory',content:'research and evidence',type:'experience',importance:.8,confidence:.9,tags:['research']});
brain.ingestFeedback({context:'research evidence',candidatePreference:'atlas',outcome:'accepted'});
const prediction=brain.predict('research evidence');
if(!prediction.trace.length)throw new Error('Neural smoke test produced no activation trace');
if(!brain.stats().synapses)throw new Error('Neural smoke test produced no synapses');
if(prediction.agent!=='ATLAS')throw new Error(`Expected ATLAS routing, got ${prediction.agent}`);
console.log(JSON.stringify({ok:true,prediction:prediction.agent,confidence:prediction.confidence,stats:brain.stats()}));
