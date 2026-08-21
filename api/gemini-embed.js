const MODEL='gemini-embedding-001';
const ENDPOINT=`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const key=process.env.GEMINI_API_KEY;if(!key)return res.status(503).json({error:'GEMINI_NOT_CONFIGURED'});
 try{const text=String(req.body?.text??'').trim();if(!text)return res.status(400).json({error:'EMPTY_TEXT'});
  const upstream=await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:`models/${MODEL}`,content:{parts:[{text}]}})});
  const data=await upstream.json().catch(()=>({}));if(!upstream.ok)return res.status(upstream.status).json({error:data?.error?.message||`GEMINI_HTTP_${upstream.status}`});
  const values=data?.embedding?.values;if(!Array.isArray(values)||!values.length)return res.status(502).json({error:'EMPTY_GEMINI_EMBEDDING'});
  return res.status(200).json({values,model:MODEL});
 }catch(error){console.error('[Wulan Gemini Embed]',error);return res.status(500).json({error:'GEMINI_EMBED_PROXY_ERROR'});}
}
