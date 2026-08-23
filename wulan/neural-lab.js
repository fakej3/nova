let core=null;
let bootError=null;
try{
  const {createDefaultWulanCore}=await import('./core/manifest.js');
  core=typeof window!=='undefined'&&window.WULAN_CORE?window.WULAN_CORE:createDefaultWulanCore();
  if(!core?.neural)throw new Error('Wulan core initialized without a neural substrate');
}catch(error){bootError=error;}
const persistence=core?.persistence??null;

const canvas=document.querySelector('#neural');
const ctx=canvas?.getContext('2d');
const query=document.querySelector('#query');
const input=document.querySelector('#queryInput');
const traceEl=document.querySelector('#trace');
const detail=document.querySelector('#detail');
const detailType=document.querySelector('#detailType');
const detailTitle=document.querySelector('#detailTitle');
const detailBody=document.querySelector('#detailBody');
const footer=document.querySelector('#footer');
const stats={neurons:document.querySelector('#neurons'),synapses:document.querySelector('#synapses'),updates:document.querySelector('#updates')};
let width=0,height=0,dpr=1,nodes=[],edges=[],selected=null,dragging=null,pulse=0;
const pointer={x:0,y:0,active:false};

function showBootError(error){
  const message=String(error?.message||error||'Unknown neural runtime error');
  if(traceEl)traceEl.innerHTML=`<b>Neural runtime unavailable.</b><br>${escapeHtml(message)}<br><small>Open DevTools → Console for the full error.</small>`;
  if(footer)footer.textContent='NEURAL RUNTIME ERROR';
  if(query?.querySelector('button'))query.querySelector('button').disabled=true;
  if(input)input.disabled=true;
}
function seedBaseline(){
  if(!core?.neural)return;
  core.neural.ensureNeuron({id:'system:wulan-core',label:'WULAN CORE',type:'system',strength:.7,tags:['system','routing','core']});
  for(const agent of core.state?.agents?.values?.()??[]){
    const id=`agent:${agent.id}`;
    core.neural.ensureNeuron({id,label:agent.name,type:'agent',strength:.5,tags:['agent',agent.role??'general']});
    const forward=`system:wulan-core>${id}`;
    const reverse=`${id}>system:wulan-core`;
    if(!core.neural.synapses?.has(forward))core.neural.connect('system:wulan-core',id,.28,1);
    if(!core.neural.synapses?.has(reverse))core.neural.connect(id,'system:wulan-core',.2,1);
  }
}
function conceptTerms(text){
  const stop=new Set(['about','after','again','also','and','are','been','being','but','can','could','did','does','for','from','have','how','into','just','like','more','most','not','now','only','our','that','their','then','there','these','they','this','was','what','when','where','which','with','would','you','your','wulan']);
  return [...new Set(String(text??'').toLowerCase().replace(/[^a-z0-9_\- ]+/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(word=>word.length>=3&&!stop.has(word)))].slice(0,24);
}
function ensureQueryConcepts(text){
  const terms=conceptTerms(text);
  const neurons=terms.map(term=>core.neural.ensureNeuron({id:`concept:${term}`,label:term,type:'concept',strength:.4,tags:['activated']}));
  for(let i=0;i<neurons.length;i++)for(let j=i+1;j<neurons.length;j++){const edge=`${neurons[i].id}>${neurons[j].id}`;if(!core.neural.synapses?.has(edge))core.neural.connect(neurons[i].id,neurons[j].id,.2,.25);}
}
function resize(){if(!canvas||!ctx)return;dpr=Math.min(devicePixelRatio||1,2);const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);layout();}
function groupOf(type){return type==='agent'?0:type==='memory'?1:2;}
function layout(){if(!core?.neural)return;const snap=core.neural.snapshot({limit:100});nodes=snap.neurons.map(n=>{const group=groupOf(n.type),groupNodes=snap.neurons.filter(x=>groupOf(x.type)===group),localIndex=groupNodes.findIndex(x=>x.id===n.id),radius=Math.min(width,height)*([.23,.31,.39][group]);const angle=(localIndex/Math.max(1,groupNodes.length))*Math.PI*2+group*.55;return{...n,x:width/2+Math.cos(angle)*radius,y:height/2+Math.sin(angle)*radius*.62,vx:0,vy:0};});const map=new Map(nodes.map(n=>[n.id,n]));edges=snap.synapses.map(e=>({...e,a:map.get(e.source),b:map.get(e.target)})).filter(e=>e.a&&e.b);renderStats(snap);}
function renderStats(snap){const s=core.neural.stats();if(stats.neurons)stats.neurons.textContent=s.neurons;if(stats.synapses)stats.synapses.textContent=s.synapses;if(stats.updates)stats.updates.textContent=s.updates;if(footer)footer.textContent=`${snap.trace.length} active pathways · ${s.concepts} concepts · ${s.memories} memories`;if(traceEl)traceEl.innerHTML=snap.trace.length?snap.trace.slice(0,8).map(n=>`<b>${escapeHtml(n.label)}</b> · ${n.type} · ${Math.round(n.activation*100)}%`).join('<br>'):'No activation yet.';}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function color(n){return n.type==='agent'?'#e5c36d':n.type==='memory'?'#6df0b2':'#72e8ff';}
function relax(){for(let i=0;i<10;i++){for(const a of nodes){a.vx*=.88;a.vy*=.88;}for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;if(d<55){const f=(55-d)/55*.35;a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f;}}for(const e of edges){const a=e.a,b=e.b,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,target=110+(1-e.weight)*100,f=(d-target)/target*.012;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}for(const n of nodes){n.x=Math.max(40,Math.min(width-40,n.x+n.vx));n.y=Math.max(40,Math.min(height-40,n.y+n.vy));}}}
function render(){if(!ctx)return;ctx.clearRect(0,0,width,height);const bg=ctx.createRadialGradient(width/2,height/2,0,width/2,height/2,Math.min(width,height)*.55);bg.addColorStop(0,'rgba(56,129,184,.12)');bg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);relax();for(const e of edges){const active=(e.a.activation>.15&&e.b.activation>.1)||(selected&&(e.a.id===selected.id||e.b.id===selected.id));ctx.beginPath();ctx.moveTo(e.a.x,e.a.y);ctx.lineTo(e.b.x,e.b.y);ctx.strokeStyle=active?`rgba(114,232,255,${.22+e.weight*.45})`:`rgba(120,160,200,${.035+e.weight*.09})`;ctx.lineWidth=active?1.4:Math.max(.35,e.weight*.8);ctx.stroke();}for(const n of nodes){const active=n.activation>.12,r=5+n.strength*7+(active?n.activation*7:0),c=color(n);if(active||selected?.id===n.id){ctx.beginPath();ctx.arc(n.x,n.y,r*3.1,0,Math.PI*2);ctx.fillStyle=n.type==='agent'?'rgba(229,195,109,.07)':n.type==='memory'?'rgba(109,240,178,.07)':'rgba(114,232,255,.07)';ctx.fill();}ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fillStyle='#07101b';ctx.fill();ctx.strokeStyle=c;ctx.globalAlpha=.55+Math.min(1,n.strength)*.45;ctx.lineWidth=1.2;ctx.stroke();ctx.globalAlpha=1;if(active||selected?.id===n.id||n.type==='agent'){ctx.font='10px ui-monospace,monospace';ctx.fillStyle='rgba(220,236,255,.72)';ctx.textAlign='center';ctx.fillText(n.label.slice(0,24),n.x,n.y+r+14);}}if(pointer.active){ctx.beginPath();ctx.arc(pointer.x,pointer.y,18+Math.sin(pulse)*4,0,Math.PI*2);ctx.strokeStyle='rgba(114,232,255,.12)';ctx.stroke();}pulse+=.05;requestAnimationFrame(render);}
function nearest(x,y){let best=null,dist=Infinity;for(const n of nodes){const d=Math.hypot(n.x-x,n.y-y);if(d<dist){dist=d;best=n;}}return dist<28?best:null;}
function inspect(n){selected=n;const connections=edges.filter(e=>e.a.id===n.id||e.b.id===n.id);detail.classList.add('show');detailType.textContent=n.type.toUpperCase();detailTitle.textContent=n.label;detailBody.innerHTML=`strength ${Math.round(n.strength*100)}% · activation ${Math.round(n.activation*100)}% · visits ${n.visits}<br>${connections.length} connected synapses · ${escapeHtml((n.tags||[]).join(' · ')||'no tags')}`;}
canvas?.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;if(dragging){dragging.x=pointer.x;dragging.y=pointer.y;dragging.vx=dragging.vy=0;}canvas.style.cursor=nearest(pointer.x,pointer.y)?'pointer':'default';});
canvas?.addEventListener('pointerleave',()=>{pointer.active=false;});
canvas?.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect(),n=nearest(e.clientX-r.left,e.clientY-r.top);if(n){dragging=n;inspect(n);canvas.setPointerCapture(e.pointerId);}});
canvas?.addEventListener('pointerup',e=>{dragging=null;try{canvas.releasePointerCapture(e.pointerId);}catch{}});
query?.addEventListener('submit',e=>{e.preventDefault();if(!core){showBootError(bootError);return;}const text=input.value.trim();if(!text)return;try{ensureQueryConcepts(text);core.neural.activate(text);persistence?.saveCore?.(core);layout();input.value='';}catch(error){showBootError(error);}});
if(core){
  seedBaseline();
  persistence?.saveCore?.(core);
  layout();
  resize();
  render();
} else showBootError(bootError);
window.addEventListener('resize',resize);
window.addEventListener('beforeunload',()=>{try{persistence?.saveCore?.(core);}catch{}});
