const STYLE = `
#wulan-neural-field{position:absolute;inset:0;z-index:8;pointer-events:none;opacity:0;transition:opacity .28s ease}
#wulan-neural-field.open{opacity:1;pointer-events:auto}
.nf-backdrop{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(4,18,32,.48),rgba(1,5,10,.82));backdrop-filter:blur(4px)}
.nf-canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
.nf-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,72vw);height:min(620px,68vh);border:1px solid rgba(121,232,255,.16);border-radius:24px;background:rgba(3,9,16,.64);box-shadow:0 40px 120px rgba(0,0,0,.52),inset 0 1px rgba(255,255,255,.04);overflow:hidden}
.nf-head{position:absolute;z-index:3;left:20px;right:20px;top:18px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}.nf-head h2{margin:6px 0 3px;font-size:22px;font-weight:330;color:#e7f5ff}.nf-head p{margin:0;font:500 6px ui-monospace,monospace;letter-spacing:.13em;color:#62768c}.nf-kicker{font:500 6px ui-monospace,monospace;letter-spacing:.22em;color:#79e8ff}.nf-close{pointer-events:auto;width:34px;height:34px;border:1px solid rgba(160,205,235,.14);border-radius:10px;background:rgba(3,9,16,.6);color:#a6bdd1;cursor:pointer}
.nf-stats{position:absolute;z-index:3;left:20px;bottom:18px;display:flex;gap:7px;pointer-events:none}.nf-stat{padding:8px 10px;border:1px solid rgba(160,205,235,.1);border-radius:10px;background:rgba(3,9,16,.58);min-width:76px}.nf-stat b{display:block;font-size:14px;font-weight:380;color:#e5f2fc}.nf-stat span{font:500 5px ui-monospace,monospace;color:#586d84;letter-spacing:.12em}
.nf-inspect{position:absolute;z-index:4;right:18px;bottom:18px;width:220px;padding:12px;border:1px solid rgba(160,205,235,.1);border-radius:12px;background:rgba(3,9,16,.74);display:none;pointer-events:none}.nf-inspect.show{display:block}.nf-inspect b{font-size:9px;color:#e6f3ff}.nf-inspect small{display:block;margin-top:5px;font:500 6px/1.5 ui-monospace,monospace;color:#63778d}
.nf-help{position:absolute;z-index:3;right:18px;bottom:18px;font:500 5px ui-monospace,monospace;letter-spacing:.1em;color:#42566d;pointer-events:none}
@media(max-width:760px){.nf-panel{width:calc(100% - 24px);height:calc(100% - 150px);top:46%;}.nf-inspect{left:12px;right:12px;bottom:58px;width:auto}.nf-help{display:none}}
`;

(() => {
  const boot = () => {
    const core = globalThis.WULAN_CORE;
    const canvasBase = document.getElementById('nova-canvas');
    if (!core || !canvasBase || document.getElementById('wulan-neural-field')) return;
    const style=document.createElement('style');style.textContent=STYLE;document.head.appendChild(style);
    const root=document.createElement('section');root.id='wulan-neural-field';root.innerHTML=`<div class="nf-backdrop"></div><div class="nf-panel"><div class="nf-head"><div><div class="nf-kicker">LIVE ASSOCIATIVE SUBSTRATE</div><h2>Neural field</h2><p>Real neurons · real synapses · real activation</p></div><button class="nf-close" aria-label="Close neural field">×</button></div><canvas class="nf-canvas"></canvas><div class="nf-stats"><div class="nf-stat"><b id="nf-neurons">0</b><span>NEURONS</span></div><div class="nf-stat"><b id="nf-synapses">0</b><span>SYNAPSES</span></div><div class="nf-stat"><b id="nf-active">0</b><span>ACTIVE</span></div><div class="nf-stat"><b id="nf-updates">0</b><span>UPDATES</span></div></div><div class="nf-inspect" id="nf-inspect"></div><div class="nf-help">DRAG · SELECT · CLICK OUTSIDE TO CLOSE</div></div>`;
    const stage=document.querySelector('.w-stage'); if(stage) stage.appendChild(root); else document.querySelector('.wulan-world')?.appendChild(root);
    const canvas=root.querySelector('.nf-canvas'),ctx=canvas.getContext('2d'),panel=root.querySelector('.nf-panel'),inspect=root.querySelector('#nf-inspect');
    const nodes=[];let edges=[],selected=null,dragging=null,w=0,h=0,dpr=1,t=0;
    const pointer={x:0,y:0,active:false};
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const color=n=>n.type==='agent'?'#e7c36c':n.type==='memory'?'#70e5b4':n.type==='concept'?'#79e8ff':'#a98bff';
    function resize(){const r=panel.getBoundingClientRect();dpr=Math.min(devicePixelRatio||1,2);w=r.width;h=r.height;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);layout();}
    function layout(){const snap=core.neural.snapshot({limit:140});const old=new Map(nodes.map(n=>[n.id,n]));nodes.length=0;const groups={agent:[],memory:[],concept:[],other:[]};for(const n of snap.neurons){const k=groups[n.type]?n.type:'other';groups[k].push(n);}const center={x:w/2,y:h/2};const rings=[['agent',.20],['memory',.30],['concept',.41],['other',.48]];for(const [type,rad] of rings){const arr=groups[type];arr.forEach((n,i)=>{const prior=old.get(n.id);const angle=(i/Math.max(1,arr.length))*Math.PI*2+({agent:-.3,memory:.7,concept:.15,other:1.2}[type]);const rr=Math.min(w,h)*rad;nodes.push({...n,x:prior?.x??center.x+Math.cos(angle)*rr,y:prior?.y??center.y+Math.sin(angle)*rr*.72,vx:0,vy:0});});}const map=new Map(nodes.map(n=>[n.id,n]));edges=snap.synapses.map(e=>({...e,a:map.get(e.source),b:map.get(e.target)})).filter(e=>e.a&&e.b);updateStats(snap);}
    function updateStats(snap){const s=core.neural.stats();root.querySelector('#nf-neurons').textContent=s.neurons;root.querySelector('#nf-synapses').textContent=s.synapses;root.querySelector('#nf-active').textContent=s.active;root.querySelector('#nf-updates').textContent=s.updates;}
    function relax(){for(let pass=0;pass<2;pass++){for(const n of nodes){n.vx*=.82;n.vy*=.82;}for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;if(d<38){const f=(38-d)/38*.55;a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f;}}for(const e of edges){const a=e.a,b=e.b,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,target=72+(1-e.weight)*110,f=(d-target)/target*.012;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}for(const n of nodes){n.x=Math.max(24,Math.min(w-24,n.x+n.vx));n.y=Math.max(55,Math.min(h-30,n.y+n.vy));}}}
    function draw(){ctx.clearRect(0,0,w,h);const g=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.min(w,h)*.56);g.addColorStop(0,'rgba(65,145,190,.10)');g.addColorStop(.5,'rgba(49,74,130,.035)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);relax();for(const e of edges){const active=e.a.activation>.12||e.b.activation>.12||selected&&(e.a.id===selected.id||e.b.id===selected.id);ctx.beginPath();ctx.moveTo(e.a.x,e.a.y);ctx.lineTo(e.b.x,e.b.y);ctx.strokeStyle=active?`rgba(121,232,255,${.20+e.weight*.55})`:`rgba(125,170,205,${.035+e.weight*.08})`;ctx.lineWidth=active?1.5:Math.max(.35,e.weight*.8);ctx.stroke();}for(const n of nodes){const active=n.activation>.10||selected?.id===n.id;const r=4+n.strength*6+(active?n.activation*8:0),c=color(n);if(active){ctx.beginPath();ctx.arc(n.x,n.y,r*3.4,0,Math.PI*2);ctx.fillStyle=n.type==='agent'?'rgba(231,195,108,.07)':n.type==='memory'?'rgba(112,229,180,.07)':'rgba(121,232,255,.07)';ctx.fill();}ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fillStyle='#06101a';ctx.fill();ctx.strokeStyle=c;ctx.lineWidth=1.1;ctx.stroke();if(active||n.type==='agent'||n.type==='memory'){ctx.font='9px ui-monospace,monospace';ctx.textAlign='center';ctx.fillStyle='rgba(220,236,255,.72)';ctx.fillText(n.label.slice(0,22),n.x,n.y+r+13);}}if(pointer.active){ctx.beginPath();ctx.arc(pointer.x,pointer.y,14+Math.sin(t)*3,0,Math.PI*2);ctx.strokeStyle='rgba(121,232,255,.12)';ctx.stroke();}t+=.035;requestAnimationFrame(draw);}
    function nearest(x,y){let best=null,dest=Infinity;for(const n of nodes){const d=Math.hypot(n.x-x,n.y-y);if(d<dest){dest=d;best=n;}}return dest<26?best:null;}
    function inspectNode(n){selected=n;const links=edges.filter(e=>e.a.id===n.id||e.b.id===n.id);inspect.classList.add('show');inspect.innerHTML=`<b>${esc(n.label)}</b><small>${esc(n.type)} · strength ${Math.round(n.strength*100)}% · activation ${Math.round(n.activation*100)}% · visits ${n.visits}<br>${links.length} connected synapses · ${(n.tags||[]).map(esc).join(' · ')||'no tags'}</small>`;}
    function open(){root.classList.add('open');layout();}
    function close(){root.classList.remove('open');selected=null;inspect.classList.remove('show');}
    root.querySelector('.nf-close').onclick=close;root.querySelector('.nf-backdrop').onclick=close;
    canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;if(dragging){dragging.x=pointer.x;dragging.y=pointer.y;dragging.vx=dragging.vy=0;}canvas.style.cursor=nearest(pointer.x,pointer.y)?'pointer':'crosshair';});
    canvas.addEventListener('pointerleave',()=>pointer.active=false);
    canvas.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect(),n=nearest(e.clientX-r.left,e.clientY-r.top);if(n){dragging=n;inspectNode(n);canvas.setPointerCapture(e.pointerId);}});
    canvas.addEventListener('pointerup',e=>{dragging=null;try{canvas.releasePointerCapture(e.pointerId);}catch{}});
    canvas.addEventListener('dblclick',e=>{const r=canvas.getBoundingClientRect(),n=nearest(e.clientX-r.left,e.clientY-r.top);if(n){core.neural.activate(n.label);layout();inspectNode(n);}});
    core.events.on('memory.created',()=>{if(root.classList.contains('open'))layout();});
    core.events.on('neural.updated',()=>{if(root.classList.contains('open'))layout();});
    core.events.on('neural.activated',()=>{if(root.classList.contains('open'))layout();});
    canvasBase.style.cursor='pointer';canvasBase.addEventListener('click',open);
    const neuralLink=document.querySelector('.w-neural');if(neuralLink){neuralLink.addEventListener('click',e=>{e.preventDefault();open();});neuralLink.title='Open the live neural substrate';}
    window.WULAN_NEURAL_FIELD={open,close,refresh:layout};
    window.addEventListener('resize',resize);resize();draw();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
