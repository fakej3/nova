const $ = (selector) => document.querySelector(selector);

const worldSpace = $('#world-space');
const agentLabel = $('#agents-label');
const worldLabel = $('#memory-label');

const palette = { system:'#79e8ff', agent:'#aa8cff', project:'#70e5b4', integration:'#9aaec5', 'ai-provider':'#e8c76f' };
const state = { world:null, selected:null, hovered:null, scale:1, panX:0, panY:0, dragging:false, startX:0, startY:0, startPanX:0, startPanY:0, startedAt:performance.now(), capabilities:[] };
let svg = null;
let viewport = null;
let inspector = null;

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function colorFor(entity){return palette[entity?.kind]||palette.integration;}
function labelFor(entity){return String(entity?.name||entity?.id||'').toUpperCase();}
function statusFor(entity){return String(entity?.status||'unknown').replaceAll('_',' ');}
function graphSize(){const r=worldSpace?.getBoundingClientRect();return{width:Math.max(r?.width||800,320),height:Math.max(r?.height||600,320)};}
function project(p,s){return{x:s.width/2+p.x*state.scale+state.panX,y:s.height/2+p.y*state.scale+state.panY};}

function buildLayout(world){
  const entities=world?.entities||[], relations=world?.relations||[], byId=new Map(entities.map(e=>[e.id,e])), layout=new Map();
  const groups={system:entities.filter(e=>e.kind==='system'),agent:entities.filter(e=>e.kind==='agent'),provider:entities.filter(e=>e.kind==='ai-provider'),project:entities.filter(e=>e.kind==='project'),integration:entities.filter(e=>e.kind==='integration')};
  const wulan=byId.get('wulan'); if(wulan) layout.set(wulan.id,{x:0,y:0});
  const ring=(items,radius,phase=0,v=.72)=>items.filter(i=>i.id!=='wulan').forEach((item,index)=>{const a=phase+index/Math.max(items.length,1)*Math.PI*2;layout.set(item.id,{x:Math.cos(a)*radius,y:Math.sin(a)*radius*v});});
  ring(groups.agent,250,-Math.PI/2); ring(groups.provider,205,0,.78); ring(groups.project,360,Math.PI/4); ring(groups.integration,405,-Math.PI/5); ring(groups.system.filter(i=>i.id!=='wulan'),145,Math.PI/4,.9);
  const positions=new Map([...layout].map(([id,p])=>[id,{...p}]));
  for(let iteration=0;iteration<28;iteration++){
    const delta=new Map([...positions.keys()].map(id=>[id,{x:0,y:0}]));
    for(const a of positions.keys())for(const b of positions.keys()){if(a>=b)continue;const pa=positions.get(a),pb=positions.get(b);let dx=pa.x-pb.x,dy=pa.y-pb.y;const d=Math.max(45,Math.hypot(dx,dy)),push=Math.max(0,105-d)/d*2.1;dx*=push;dy*=push;delta.get(a).x+=dx;delta.get(a).y+=dy;delta.get(b).x-=dx;delta.get(b).y-=dy;}
    for(const r of relations){const a=positions.get(r.from),b=positions.get(r.to);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,desired=r.type==='orchestrates'?220:170,pull=(d-desired)*.004;delta.get(r.from).x+=dx/d*pull*20;delta.get(r.from).y+=dy/d*pull*20;delta.get(r.to).x-=dx/d*pull*20;delta.get(r.to).y-=dy/d*pull*20;}
    for(const [id,p] of positions){if(id==='wulan')continue;p.x+=delta.get(id).x;p.y+=delta.get(id).y;const d=Math.hypot(p.x,p.y);if(d>460){p.x=p.x/d*460;p.y=p.y/d*460;}}
  }
  return positions;
}

function entityConnections(entity){
  const map=new Map((state.world?.entities||[]).map(e=>[e.id,e]));
  return (state.world?.relations||[]).filter(r=>r.from===entity.id||r.to===entity.id).slice(0,8).map(r=>({relation:r,other:map.get(r.from===entity.id?r.to:r.from)}));
}

function availableCapabilities(entity){
  return state.capabilities.filter(c=>c.target===entity.id||c.target===entity.kind||c.target==='wulan');
}

function renderInspector(entity,point){
  if(!worldSpace)return;
  if(!inspector){inspector=document.createElement('aside');inspector.className='world-inspector';worldSpace.appendChild(inspector);}
  if(!entity){inspector.hidden=true;return;}
  const rect=worldSpace.getBoundingClientRect();inspector.style.left=`${Math.max(12,Math.min(point.x+18,rect.width-282))}px`;inspector.style.top=`${Math.max(12,Math.min(point.y+18,rect.height-300))}px`;
  const connections=entityConnections(entity).map(({relation,other})=>`<div class="world-inspector__relation"><span>${escapeHtml(relation.type.replaceAll('_',' '))}</span><b>${escapeHtml(labelFor(other)||relation.to)}</b></div>`).join('');
  const caps=availableCapabilities(entity).map(c=>`<button type="button" class="capability-button" data-capability="${escapeHtml(c.id)}"><span>${escapeHtml(c.name)}</span><small>READ · ${escapeHtml(c.description||'')}</small></button>`).join('');
  inspector.innerHTML=`<div class="world-inspector__eyebrow">${escapeHtml(entity.kind||'entity')}</div><strong>${escapeHtml(labelFor(entity))}</strong><span class="world-inspector__status"><i></i>${escapeHtml(statusFor(entity))}</span>${connections?`<div class="world-inspector__section">${connections}</div>`:''}${caps?`<div class="world-inspector__section"><div class="world-inspector__section-title">AVAILABLE CAPABILITIES</div>${caps}</div>`:''}<div class="world-inspector__hint">READ-ONLY ACTIONS · RESULT BECOMES WORLD STATE</div>`;
  inspector.hidden=false;
  inspector.querySelectorAll('[data-capability]').forEach(button=>button.addEventListener('click',async e=>{e.stopPropagation();await invokeCapability(button.dataset.capability,button,entity);}));
}

async function invokeCapability(capabilityId,button,entity){
  button.disabled=true;button.classList.add('is-running');button.querySelector('small').textContent='RUNNING · WORLD ACTIVITY CREATED';
  try{
    const response=await fetch('/api/capabilities',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({capabilityId,input:{repository:'fakej3/nova'}})});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
    button.classList.remove('is-running');button.classList.add('is-complete');button.querySelector('small').textContent='COMPLETE · RESULT RECEIVED';
    showResult(entity,payload.result);
    await syncWorld();
  }catch(error){
    button.classList.remove('is-running');button.classList.add('is-error');button.querySelector('small').textContent=`FAILED · ${error.message}`;
  }finally{setTimeout(()=>{button.disabled=false;},900);}
}

function showResult(entity,result){
  const preview=typeof result==='object'?JSON.stringify(result,null,2):String(result);
  let panel=document.querySelector('.world-result');if(!panel){panel=document.createElement('div');panel.className='world-result';worldSpace.appendChild(panel);}
  panel.innerHTML=`<div><span>CAPABILITY RESULT</span><b>${escapeHtml(labelFor(entity))}</b></div><pre>${escapeHtml(preview.slice(0,2400))}</pre><button type="button" data-close-result>×</button>`;panel.hidden=false;panel.querySelector('[data-close-result]').onclick=()=>{panel.hidden=true;};
}

function drawNode(entity,point,elapsed){
  const color=colorFor(entity),selected=state.selected===entity.id,connected=!state.selected||entity.id===state.selected||(state.world?.relations||[]).some(r=>(r.from===state.selected&&r.to===entity.id)||(r.to===state.selected&&r.from===entity.id)),active=['online','active','ready'].includes(entity.status),core=entity.id==='wulan',radius=core?40:entity.kind==='agent'?27:entity.kind==='ai-provider'?24:22,breathe=Math.sin(elapsed*(core?1.6:1.05)+entity.id.length)*(core?2.4:1.1),r=radius+breathe+(selected?4:0),opacity=state.selected&&!connected?.13:state.hovered===entity.id||selected?1:.82;
  const shape=entity.kind==='agent'?`<polygon points="0,-${r} ${r*.86},-${r*.48} ${r*.86},${r*.48} 0,${r} -${r*.86},${r*.48} -${r*.86},-${r*.48}" class="world-node__shape"/>`:entity.kind==='project'?`<path d="M 0,-${r} C ${r*.8},-${r*.8} ${r},-${r*.25} ${r*.75},0 C ${r},${r*.5} ${r*.55},${r*.9} 0,${r} C -${r*.65},${r*.9} -${r},${r*.45} -${r*.7},0 C -${r},-${r*.4} -${r*.55},-${r*.85} 0,-${r} Z" class="world-node__shape"/>`:`<circle r="${r}" class="world-node__shape"/>`;
  const inner=core?`<circle r="${r*.48}" class="world-node__core"/><circle r="${r*.18}" class="world-node__core-dot"/>`:`<circle r="${Math.max(3,r*.16)}" class="world-node__dot"/>`;
  return `<g class="world-node ${core?'world-node--core':''} ${active?'world-node--active':''} ${selected?'world-node--selected':''} ${state.hovered===entity.id?'world-node--hovered':''}" data-entity="${escapeHtml(entity.id)}" transform="translate(${point.x} ${point.y})" style="--node-color:${color};--node-opacity:${opacity}">${active?`<circle r="${r+9}" class="world-node__pulse"/>`:''}${selected?`<circle r="${r+15}" class="world-node__selection"/>`:''}<g class="world-node__visual">${shape}${inner}</g><text y="${r+18}" class="world-node__name">${escapeHtml(labelFor(entity))}</text><text y="${r+29}" class="world-node__status">${escapeHtml(statusFor(entity))}</text></g>`;
}

function drawRelations(layout,size){return(state.world?.relations||[]).map((r,index)=>{const a=layout.get(r.from),b=layout.get(r.to);if(!a||!b)return'';const A=project(a,size),B=project(b,size),focus=state.selected&&(r.from===state.selected||r.to===state.selected),dx=B.x-A.x,dy=B.y-A.y,d=Math.hypot(dx,dy)||1,bend=Math.min(85,d*.16),nx=-dy/d,ny=dx/d,cx=(A.x+B.x)/2+nx*bend*(index%2?-1:1),cy=(A.y+B.y)/2+ny*bend*(index%2?-1:1),opacity=state.selected&&!focus?.035:focus?.78:.18;return`<g class="world-link-group" style="--link-opacity:${opacity}"><path d="M ${A.x} ${A.y} Q ${cx} ${cy} ${B.x} ${B.y}" class="world-link"/>${focus?`<circle r="2.2" class="world-link__packet"><animateMotion dur="${2.4+(index%4)*.35}s" repeatCount="indefinite" path="M ${A.x} ${A.y} Q ${cx} ${cy} ${B.x} ${B.y}"/></circle><text x="${cx}" y="${cy-5}" class="world-link__label">${escapeHtml(r.type.replaceAll('_',' '))}</text>`:''}</g>`;}).join('');}

function render(){
  if(!worldSpace||!state.world)return;const size=graphSize(),layout=buildLayout(state.world),elapsed=(performance.now()-state.startedAt)/1000;
  worldSpace.innerHTML=`<div class="world-vignette"></div><div class="world-controls"><button type="button" data-world-action="zoom-out">−</button><button type="button" data-world-action="reset">◎</button><button type="button" data-world-action="zoom-in">+</button></div><svg class="world-map" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="Interactive Wulan world"><defs><radialGradient id="world-core-glow"><stop offset="0" stop-color="#79e8ff" stop-opacity=".24"/><stop offset=".55" stop-color="#79e8ff" stop-opacity=".05"/><stop offset="1" stop-color="#79e8ff" stop-opacity="0"/></radialGradient><filter id="world-blur"><feGaussianBlur stdDeviation="10"/></filter></defs><g class="world-grid" transform="translate(${state.panX} ${state.panY}) scale(${state.scale})"><circle cx="${size.width/2}" cy="${size.height/2}" r="230" class="world-aura"/><circle cx="${size.width/2}" cy="${size.height/2}" r="150" class="world-aura world-aura--inner"/>${drawRelations(layout,size)}<g>${[...state.world.entities].filter(e=>layout.has(e.id)).map(e=>drawNode(e,project(layout.get(e.id),size),elapsed)).join('')}</g></g></svg><div class="world-caption"><span>WULAN WORLD</span><b>${state.selected?'FOCUSED':'EXPLORE'}</b><small>scroll to zoom · drag to move · click a node</small></div>`;
  svg=$('.world-map');viewport=$('.world-grid');
  if(state.selected){const e=state.world.entities.find(x=>x.id===state.selected);if(e)renderInspector(e,project(layout.get(e.id),size));}
  wireWorldEvents();
  if(agentLabel)agentLabel.innerHTML=`AGENTS <b>${state.world.entities.filter(e=>e.kind==='agent').length}</b>`;
  if(worldLabel)worldLabel.innerHTML=`WORLD <b>${state.world.entities.length}</b>`;
}

function wireWorldEvents(){
  worldSpace.querySelectorAll('[data-world-action]').forEach(b=>b.onclick=e=>{e.stopPropagation();if(b.dataset.worldAction==='zoom-in')state.scale=Math.min(2.2,state.scale*1.16);if(b.dataset.worldAction==='zoom-out')state.scale=Math.max(.62,state.scale/1.16);if(b.dataset.worldAction==='reset'){state.scale=1;state.panX=0;state.panY=0;state.selected=null;}render();});
  worldSpace.querySelectorAll('[data-entity]').forEach(node=>{node.onmouseenter=()=>{state.hovered=node.dataset.entity;render();};node.onmouseleave=()=>{state.hovered=null;render();};node.onclick=e=>{e.stopPropagation();state.selected=state.selected===node.dataset.entity?null:node.dataset.entity;render();};});
  svg?.addEventListener('click',()=>{state.selected=null;render();});
  svg?.addEventListener('wheel',e=>{e.preventDefault();state.scale=Math.max(.62,Math.min(2.2,state.scale*(e.deltaY<0?1.09:.92)));render();},{passive:false});
  svg?.addEventListener('pointerdown',e=>{if(e.target.closest('[data-entity]'))return;state.dragging=true;state.startX=e.clientX;state.startY=e.clientY;state.startPanX=state.panX;state.startPanY=state.panY;svg.setPointerCapture?.(e.pointerId);});
  svg?.addEventListener('pointermove',e=>{if(!state.dragging)return;state.panX=state.startPanX+e.clientX-state.startX;state.panY=state.startPanY+e.clientY-state.startY;if(viewport)viewport.setAttribute('transform',`translate(${state.panX} ${state.panY}) scale(${state.scale})`);});
  svg?.addEventListener('pointerup',()=>state.dragging=false);svg?.addEventListener('pointercancel',()=>state.dragging=false);
}

async function syncCapabilities(){try{const r=await fetch('/api/capabilities',{headers:{Accept:'application/json'},cache:'no-store'});if(r.ok){const data=await r.json();state.capabilities=data.capabilities||[];}}catch(e){console.warn('[Wulan capabilities]',e?.message||e);}}
async function syncWorld(){try{const r=await fetch('/api/world',{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error(`world ${r.status}`);state.world=await r.json();render();}catch(e){console.warn('[Wulan World]',e?.message||e);}}

Promise.all([syncCapabilities(),syncWorld()]);
setInterval(syncWorld,5000);
setInterval(syncCapabilities,15000);
