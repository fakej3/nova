export { GeminiProvider, createGeminiProvider } from './gemini.js';

export function registerProvider(core, provider){
  if(!core?.ai)throw new TypeError('Wulan core AI gateway is required');
  if(!provider?.id||typeof provider.generate!=='function')throw new TypeError('Provider must expose id and generate()');
  return core.ai.registerProvider({id:provider.id,name:provider.name??provider.id,generate:provider.generate.bind(provider),embed:provider.embed?.bind(provider),capabilities:provider.capabilities?.()??[]});
}
