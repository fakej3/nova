export const LEARNING_OUTCOMES=Object.freeze({ACCEPTED:'accepted',CORRECTED:'corrected',REJECTED:'rejected',EXPLICIT_PREFERENCE:'explicit_preference'});
export class WulanLearningStore{
 constructor({maxRecords=5000}={}){this.records=[];this.maxRecords=maxRecords;}
 record(input){if(!input?.outcome||!input?.context)throw new TypeError('Learning feedback requires outcome and context');const record={id:input.id??crypto.randomUUID(),outcome:input.outcome,context:input.context,correction:input.correction??null,candidatePreference:input.candidatePreference??null,source:input.source??'user',confidence:Math.min(1,Math.max(0,input.confidence??.5)),createdAt:input.createdAt??new Date().toISOString(),reviewed:false};this.records.push(record);if(this.records.length>this.maxRecords)this.records.shift();return record;}
 recent(limit=50){return this.records.slice(-limit).reverse();}
 candidates({minimumEvidence=2}={}){const grouped=new Map();for(const record of this.records){const key=record.candidatePreference;if(!key)continue;const bucket=grouped.get(key)??{preference:key,evidence:0,score:0};bucket.evidence+=1;bucket.score+=record.outcome===LEARNING_OUTCOMES.CORRECTED?1:record.outcome===LEARNING_OUTCOMES.REJECTED?-1:.5;grouped.set(key,bucket);}return [...grouped.values()].filter(candidate=>candidate.evidence>=minimumEvidence).sort((a,b)=>b.score-a.score);}
}
