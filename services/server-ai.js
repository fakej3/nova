function providerError(status,message){const error=new Error(message);error.status=status;return error;}
function normalize(messages=[]){return messages.map(m=>({role:m.role==='assistant'||m.role==='model'?'assistant':'user',text:String(m.content??m.text??'').trim()})).filter(m=>m.text);}

export async function generateGemini({messages=[],system='',maxOutputTokens=1200}={}){
 const key=process.env.GEMINI_API_KEY;if(!key)throw providerError(503,'AI_PROVIDER_NOT_CONFIGURED');const model=process.env.GEMINI_MODEL||'gemini-3.7-flash';
 const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;const contents=normalize(messages).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.text}]}));
 const response=await fetch(`${endpoint}?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig:{maxOutputTokens}})});const data=await response.json().catch(()=>({}));
 if(!response.ok)throw providerError(response.status,data?.error?.message||`GEMINI_${response.status}`);const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim();if(!text)throw providerError(502,'EMPTY_MODEL_RESPONSE');return{text,model,usage:data?.usageMetadata??null};
}

export async function generateOpenAI({messages=[],system='',maxOutputTokens=1200}={}){
 const key=process.env.OPENAI_API_KEY;if(!key)throw providerError(503,'AI_PROVIDER_NOT_CONFIGURED');const model=process.env.OPENAI_MODEL||'gpt-5.4';
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,instructions:system,input:normalize(messages).map(m=>({role:m.role,content:[{type:'input_text',text:m.text}]})),max_output_tokens:maxOutputTokens})});const data=await response.json().catch(()=>({}));
 if(!response.ok)throw providerError(response.status,data?.error?.message||`OPENAI_${response.status}`);const text=data?.output_text?.trim();if(!text)throw providerError(502,'EMPTY_MODEL_RESPONSE');return{text,model,usage:data?.usage??null};
}

export async function generateAnthropic({messages=[],system='',maxOutputTokens=1200}={}){
 const key=process.env.ANTHROPIC_API_KEY;if(!key)throw providerError(503,'AI_PROVIDER_NOT_CONFIGURED');const model=process.env.ANTHROPIC_MODEL||'claude-sonnet-5';
 const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:maxOutputTokens,system,messages:normalize(messages).map(m=>({role:m.role,content:m.text}))})});const data=await response.json().catch(()=>({}));
 if(!response.ok)throw providerError(response.status,data?.error?.message||`ANTHROPIC_${response.status}`);const text=data?.content?.filter(p=>p.type==='text').map(p=>p.text).join('').trim();if(!text)throw providerError(502,'EMPTY_MODEL_RESPONSE');return{text,model,usage:data?.usage??null};
}
