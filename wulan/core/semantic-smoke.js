import { WulanSemanticMemory } from './semantic-memory.js';

const index=new WulanSemanticMemory();
index.upsert('a','research',[1,0,0],{kind:'test'});
index.upsert('b','music',[0,1,0],{kind:'test'});
const hit=index.search([.98,.02,0],{limit:2,minScore:.5});
if(hit[0]?.id!=='a')throw new Error(`Expected semantic hit a, got ${hit[0]?.id??'none'}`);
console.log(JSON.stringify({ok:true,top:hit[0].id,score:hit[0].score,stats:index.stats()}));
