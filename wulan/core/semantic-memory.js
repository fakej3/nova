/**
 * Provider-neutral semantic memory index.
 *
 * Wulan does not own an embedding model here. A provider supplies vectors;
 * this layer stores them, scores cosine similarity, and keeps the index
 * inspectable. If no embedding provider exists, callers can use neural/lexical
 * retrieval instead of pretending keywords are semantic understanding.
 */
const magnitude=vector=>Math.sqrt(vector.reduce((sum,value)=>sum+(Number(value)||0)**2,0));
const normalizeVector=vector=>{const values=Array.isArray(vector)?vector.map(Number):[];const norm=magnitude(values);return norm?values.map(value=>value/norm):[];};
const cosine=(a,b)=>{if(!a.length||a.length!==b.length)return 0;let score=0;for(let i=0;i<a.length;i++)score+=(a[i]||0)*(b[i]||0);return score;};

export class WulanSemanticMemory{
 constructor({maxEntries=5000}={}){this.entries=new Map();this.maxEntries=maxEntries;this.dimensions=null;}
 upsert(id,text,vector,metadata={}){if(!id||!Array.isArray(vector)||!vector.length)return false;const normalized=normalizeVector(vector);if(!normalized.length)return false;if(this.dimensions===null)this.dimensions=normalized.length;if(normalized.length!==this.dimensions)throw new Error(`Embedding dimension mismatch: expected ${this.dimensions}, got ${normalized.length}`);this.entries.set(id,{id,text:String(text??''),vector:normalized,metadata:{...metadata},updatedAt:new Date().toISOString()});this.#trim();return true;}
 remove(id){return this.entries.delete(id);}
 search(vector,{limit=10,minScore=0}={}){const query=normalizeVector(vector);if(!query.length||query.length!==this.dimensions)return[];return [...this.entries.values()].map(entry=>({id:entry.id,text:entry.text,metadata:entry.metadata,score:cosine(query,entry.vector)})).filter(result=>result.score>=minScore).sort((a,b)=>b.score-a.score).slice(0,limit);}
 stats(){return{entries:this.entries.size,dimensions:this.dimensions};}
 exportState(){return{version:1,dimensions:this.dimensions,entries:[...this.entries.values()]};}
 importState(state){this.entries.clear();this.dimensions=state?.dimensions??null;for(const entry of Array.isArray(state?.entries)?state.entries:[]){if(entry?.id&&Array.isArray(entry.vector))this.entries.set(entry.id,{...entry,vector:normalizeVector(entry.vector)});}this.#trim();return this.stats();}
 #trim(){while(this.entries.size>this.maxEntries){const oldest=[...this.entries.values()].sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))[0];if(!oldest)break;this.entries.delete(oldest.id);}}
}

export const cosineSimilarity=cosine;
