const DEFAULT_MODEL='gemini-2.5-flash';
const DEFAULT_EMBED_MODEL='gemini-embedding-001';
const endpoint=(model,key)=>`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
const embedEndpoint=(model,key)=>`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(key)}`;
const textOf=response=>response?.candidates?.[0]?.content?.parts?.map(p=>p.text??'').join('')??'';
const jsonOrText=response=>{const text=textOf(response);if(!text)return'';try{return JSON.parse(text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{return text;}};

export class GeminiProvider{
 constructor({apiKey=globalThis?.process?.env?.GEMINI_API_KEY,model=DEFAULT_MODEL,embeddingModel=DEFAULT_EMBED_MODEL,fetchImpl=globalThis.fetch,systemInstruction='You are Wulan, an autonomous personal AI system. Be accurate, useful, concise and honest about what you actually did.'}={}){
  this.id='gemini';this.name='Google Gemini';this.apiKey=apiKey?.trim?.()??'';this.model=model;this.embeddingModel=embeddingModel;this.fetch=fetchImpl;this.systemInstruction=systemInstruction;
 }
 capabilities(){return ['generation','embeddings','health'];}
 configured(){return Boolean(this.apiKey)&&typeof this.fetch==='function';}
 async generate(request={}){
  if(!this.configured())throw new Error('Gemini provider is not configured: set GEMINI_API_KEY');
  const prompt=typeof request==='string'?request:request.prompt??request.input??'';
  if(!prompt.trim())throw new Error('Gemini request is empty');
  const body={contents:[{role:'user',parts:[{text:prompt}]}],systemInstruction:{parts:[{text:this.systemInstruction}]},generationConfig:{temperature:request.temperature??.7,maxOutputTokens:request.maxOutputTokens??2048}};
  const response=await this.fetch(endpoint(request.model??this.model,this.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`Gemini generation failed (${response.status}): ${payload?.error?.message??'unknown provider error'}`);
  const text=textOf(payload);if(!text)throw new Error('Gemini returned no answer');
  return {text,model:request.model??this.model,provider:this.id,raw:payload};
 }
 async embed(input){
  if(!this.configured())throw new Error('Gemini provider is not configured: set GEMINI_API_KEY');
  const text=typeof input==='string'?input:input?.text??input?.content??'';if(!text.trim())throw new Error('Gemini embedding input is empty');
  const response=await this.fetch(embedEndpoint(this.embeddingModel,this.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:`models/${this.embeddingModel}`,content:{parts:[{text}]}})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`Gemini embedding failed (${response.status}): ${payload?.error?.message??'unknown provider error'}`);
  const values=payload?.embedding?.values;if(!Array.isArray(values)||!values.length)throw new Error('Gemini returned no embedding');
  return {values,model:this.embeddingModel,provider:this.id};
 }
 async health(){
  if(!this.configured())return {ok:false,configured:false,provider:this.id,model:this.model,error:'GEMINI_API_KEY is missing'};
  try{const result=await this.generate({prompt:'Reply with exactly OK.',maxOutputTokens:8,temperature:0});return {ok:result.text.trim().toUpperCase()==='OK',configured:true,provider:this.id,model:this.model};}
  catch(error){return {ok:false,configured:true,provider:this.id,model:this.model,error:error instanceof Error?error.message:String(error)};}
 }
}

export function createGeminiProvider(options={}){return new GeminiProvider(options);}
