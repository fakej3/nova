import { createDefaultWulanCore } from './core/manifest.js';
import { WulanLocalPersistence } from './core/living-state.js';

const core = createDefaultWulanCore();
const persistence = new WulanLocalPersistence();
persistence.load(core);
for (const record of core.learning.recent(5000)) core.neural.ingestFeedback(record);

const canvas = document.querySelector('#neural');
const ctx = canvas.getContext('2d');
const query = document.querySelector('#query');
const input = document.querySelector('#queryInput');
const traceEl = document.querySelector('#trace');
const detail = document.querySelector('#detail');
const detailType = document.querySelector('#detailType');
const detailTitle = document.querySelector('#detailTitle');
const detailBody = document.querySelector('#detailBody');
const footer = document.querySelector('#footer');
const stats = {
  neurons: document.querySelector('#neurons'),
  synapses: document.querySelector('#synapses'),
  updates: document.querySelector('#updates'),
};

let width = 0, height = 0, dpr = 1;
let nodes = [];
let edges = [];
let selected = null;
let dragging = null;
let hover = null;
let pulse = 0;
const pointer = { x: 0, y: 0, active: false };

function resize(){
  dpr = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  width = rect.width; height = rect.height;
  canvas.width = width * dpr; canvas.height = height * dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  layout();
}

function layout(){
  const snap = core.neural.snapshot({limit:100});
  nodes = snap.neurons.map((n,i)=>{
    const typeIndex = {agent:0,memory:1,concept:2}[n.type] ?? 3;
    const group = nodes.length || 1;
    const radius = Math.min(width,height) * (typeIndex === 0 ? .24 : typeIndex === 1 ? .31 : .38);
    const count = Math.max(1, snap.neurons.filter(x => ({agent:0,memory:1,concept:2}[x.type] ?? 3) === typeIndex).length);
    const localIndex = snap.neurons.slice(0,i).filter(x => ({agent:0,memory:1,concept:2}[x.type] ?? 3) === typeIndex).length;
    const angle = (localIndex / count) * Math.PI * 2 + typeIndex * .55;
    return {...n,x:width/2+Math.cos(angle)*radius,y:height/2+Math.sin(angle)*radius*.62,vx:0,vy:0};
  });
  const map = new Map(nodes.map(n=>[n.id,n]));
  edges = snap.synapses.map(e=>({...e,a:map.get(e.source),b:map.get(e.target)})).filter(e=>e.a&&e.b);
  renderStats(snap);
}

function renderStats(snap){
  const s = core.neural.stats();
  stats.neurons.textContent = s.neurons;
  stats.synapses.textContent = s.synapses;
  stats.updates.textContent = s.updates;
  footer.textContent = `${snap.trace.length} active pathways · ${s.concepts} concepts · ${s.memories} memories`;
  traceEl.innerHTML = snap.trace.length ? snap.trace.slice(0,8).map(n=>`<b>${escapeHtml(n.label)}</b> · ${n.type} · ${Math.round(n.activation*100)}%`).join('<br>') : 'No activation yet.';
}

function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function color(node){return node.type==='agent'?'#e5c36d':node.type==='memory'?'#6df0b2':'#72e8ff';}

function render(){
  ctx.clearRect(0,0,width,height);
  const bg=ctx.createRadialGradient(width/2,height/2,0,width/2,height/2,Math.min(width,height)*.55);
  bg.addColorStop(0,'rgba(56,129,184,.12)'); bg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);

  // Gentle force relaxation makes the network settle into a real, inspectable field.
  for(let i=0;i<18;i++){
    for(const a of nodes){a.vx*=.88;a.vy*=.88;}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
      const min=55;
      if(d<min){const f=(min-d)/min*.35;a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f;}
    }
    for(const e of edges){const a=e.a,b=e.b,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;const target=110+((1-e.weight)*100);const f=(d-target)/target*.012;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
    for(const n of nodes){n.x=Math.max(40,Math.min(width-40,n.x+n.vx));n.y=Math.max(40,Math.min(height-40,n.y+n.vy));}
  }

  for(const e of edges){
    const active=(e.a.activation>.15&&e.b.activation>.1)||(selected&&(e.a.id===selected.id||e.b.id===selected.id));
    ctx.beginPath();ctx.moveTo(e.a.x,e.a.y);ctx.lineTo(e.b.x,e.b.y);ctx.strokeStyle=active?`rgba(114,232,255,${.22+e.weight*.45})`:`rgba(120,160,200,${.035+e.weight*.09})`;ctx.lineWidth=active?1.4:Math.max(.35,e.weight*.8);ctx.stroke();
  }

  for(const n of nodes){
    const active=n.activation>.12;
    const r=5+n.strength*7+(active?n.activation*7:0);
    const c=color(n);
    if(active||selected?.id===n.id){ctx.beginPath();ctx.arc(n.x,n.y,r*3.1,0,Math.PI*2);ctx.fillStyle=c.replace(')',', .06)').replace('rgb','rgba');ctx.fillStyle=n.type==='agent'?'rgba(229,195,109,.07)':n.type==='memory'?'rgba(109,240,178,.07)':'rgba(114,232,255,.07)';ctx.fill();}
    ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fillStyle='#07101b';ctx.fill();ctx.strokeStyle=c;ctx.globalAlpha=.55+Math.min(1,n.strength)*.45;ctx.lineWidth=1.2;ctx.stroke();ctx.globalAlpha=1;
    if(active||selected?.id===n.id||n.type==='agent'){
      ctx.font='10px ui-monospace,monospace';ctx.fillStyle='rgba(220,236,255,.72)';ctx.textAlign='center';ctx.fillText(n.label.slice(0,24),n.x,n.y+r+14);
    }
  }
  if(pointer.active){ctx.beginPath();ctx.arc(pointer.x,pointer.y,18+Math.sin(pulse)*4,0,Math.PI*2);ctx.strokeStyle='rgba(114,232,255,.12)';ctx.stroke();}
  pulse+=.05;
  requestAnimationFrame(render);
}

function nearest(x,y){let best=null,dist=Infinity;for(const n of nodes){const d=Math.hypot(n.x-x,n.y-y);if(d<dist){dist=d;best=n;}}return dist<28?best:null;}
function inspect(n){
  selected=n;
  const connections=edges.filter(e=>e.a.id===n.id||e.b.id===n.id);
  detail.classList.add('show');
  detailType.textContent=n.type.toUpperCase();
  detailTitle.textContent=n.label;
  detailBody.innerHTML=`strength ${Math.round(n.strength*100)}% · activation ${Math.round(n.activation*100)}% · visits ${n.visits}<br>${connections.length} connected synapses · ${escapeHtml((n.tags||[]).join(' · ')||'no tags')}`;
}

canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;if(dragging){dragging.x=pointer.x;dragging.y=pointer.y;dragging.vx=dragging.vy=0;}hover=nearest(pointer.x,pointer.y);canvas.style.cursor=hover?'pointer':'default';});
canvas.addEventListener('pointerleave',()=>{pointer.active=false;hover=null;});
canvas.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect();const n=nearest(e.clientX-r.left,e.clientY-r.top);if(n){dragging=n;inspect(n);canvas.setPointerCapture(e.pointerId);}});
canvas.addEventListener('pointerup',e=>{dragging=null;try{canvas.releasePointerCapture(e.pointerId)}catch{}});

query.addEventListener('submit',e=>{e.preventDefault();const text=input.value.trim();if(!text)return;core.neural.activate(text);layout();const trace=core.neural.snapshot({limit:100}).trace;renderStats(core.neural.snapshot({limit:100}));input.value='';});
window.addEventListener('resize',resize);
resize();
render();
