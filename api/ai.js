import { getGeminiStats } from '../services/gemini.js';
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const stats=getGeminiStats();
 const configured=Boolean(process.env.GEMINI_API_KEY);
 return res.status(200).json({providers:[{id:'gemini-free',name:'Gemini 2.5 Flash',configured,available:configured&&(!stats.lastStatus||stats.lastStatus<500),capabilities:['text','chat','embeddings'],model:stats.model,lastStatus:stats.lastStatus,lastSuccessAt:stats.lastSuccessAt,lastFailAt:stats.lastFailAt,lastFailMsg:stats.lastFailMsg}]});
}
