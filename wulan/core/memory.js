export const MEMORY_TYPES=Object.freeze({FACT:'fact',PREFERENCE:'preference',PROJECT:'project',DECISION:'decision',EXPERIENCE:'experience',FEEDBACK:'feedback'});
export class WulanMemoryStore{
 constructor({maxEntries=5000}={}){this.entries=new Map();this.maxEntries=maxEntries;}
 add(input){if(!input?.content||!input?.type)throw new TypeError('Memory requires content and type');const now=new Date().toISOString();const memory={id:input.id??crypto.randomUUID(),type:input.type,content:input.content,source:input.source??'user',confidence:Math.min(1,Math.max(0,input.confidence??.8)),importance:Math.min(1,Math.max(0,input.importance??.5)),createdAt:input.createdAt??now,updatedAt:now,tags:[...new Set(input.tags??[])],evidence:[...(input.evidence??[])],permissions:[...(input.permissions??['private'])]};this.entries.set(memory.id,memory);this.#trim();return memory;}
 get(id){return this.entries.get(id)??null;}
 list({type,tag,limit=100}={}){return [...this.entries.values()].filter(memory=>!type||memory.type===type).filter(memory=>!tag||memory.tags.includes(tag)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,limit);}
 search(query,{limit=20}={}){const terms=String(query).toLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return[];return [...this.entries.values()].map(memory=>{const haystack=`${memory.content} ${memory.tags.join(' ')}`.toLowerCase();const matches=terms.filter(term=>haystack.includes(term)).length;return{memory,score:matches/terms.length};}).filter(result=>result.score>0).sort((a,b)=>b.score-a.score||b.memory.importance-a.memory.importance).slice(0,limit);}
 update(id,patch){const existing=this.get(id);if(!existing)throw new Error(`Unknown memory: ${id}`);const updated={...existing,...patch,id,updatedAt:new Date().toISOString()};this.entries.set(id,updated);return updated;}
 remove(id){return this.entries.delete(id);}
 #trim(){while(this.entries.size>this.maxEntries){const oldest=[...this.entries.values()].sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))[0];this.entries.delete(oldest.id);}}
}
