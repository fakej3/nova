(() => {
  const boot=()=>{
    const core=globalThis.WULAN_CORE,base=document.getElementById('nova-canvas');
    if(!core||!base||document.getElementById('wulan-neural-field-v4'))return;
    document.getElementById('wulan-neural-field')?.remove();
    document.getElementById('wulan-neural-field-v3')?.remove();

    const style=document.createElement('style');
    style.textContent=`
      #wulan-neural-field-v4{position:absolute;inset:0;z-index:95;pointer-events:none;opacity:0;transition:opacity .2s ease}
      #wulan-neural-field-v4.open{opacity:1;pointer-events:auto}
      #wulan-neural-field-v4 .nv4-bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 48%,rgba(8,22,38,.5),rgba(1,5,10,.94));backdrop-filter:blur(9px)}
      #wulan-neural-field-v4 .nv4-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1160px,92vw);height:min(760px,86vh);border:1px solid rgba(121,232,255,.15);border-radius:22px;background:rgba(2,8,15,.9);box-shadow:0 40px 140px rgba(0,0,0,.65),inset 0 1px rgba(255,255,255,.035);overflow:hidden}
      #wulan-neural-field-v4 canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
      #wulan-neural-field-v4 .nv4-head{position:absolute;z-index:3;left:24px;right:24px;top:20px;display:flex;justify-content:space-between;pointer-events:none}
      #wulan-neural-field-v4 .nv4-kicker{font:600 7px ui-monospace,monospace;letter-spacing:.24em;color:#79e8ff}
      #wulan-neural-field-v4 h2{margin:7px 0 3px;font-size:25px;font-weight:330;color:#edf8ff}
      #wulan-neural-field-v4 .nv4-head p{margin:0;font:500 7px ui-monospace,monospace;color:#61768c;letter-spacing:.1em}
      #wulan-neural-field-v4 button{pointer-events:auto;width:36px;height:36px;border:1px solid rgba(160,205,235,.16);border-radius:11px;background:rgba(3,9,16,.72);color:#a6bdd1;cursor:pointer;font-size:18px}
      #wulan-neural-field-v4 .nv4-legend{position:absolute;z-index:3;right:24px;top:74px;display:flex;gap:10px;font:600 5px ui-monospace,monospace;letter-spacing:.1em;color:#52677d;pointer-events:none}
      #wulan-neural-field-v4 .nv4-legend i{display:inline-flex;align-items:center;gap:4px;font-style:normal}.nv4-legend i:before{content:'';width:5px;height:5px;border-radius:50%;background:#79e8ff;box-shadow:0 0 8px currentColor}.nv4-legend .memory:before{background:#70e5b4}.nv4-legend .agent:before{background:#e8c36b}.nv4-legend .system:before{background:#b59cff}
      #wulan-neural-field-v4 .nv4-stats{position:absolute;z-index:3;left:22px;bottom:20px;display:flex;gap:7px;pointer-events:none}
      #wulan-neural-field-v4 .nv4-stat{min-width:78px;padding:8px 10px;border:1px solid rgba(160,205,235,.1);border-radius:10px;background:rgba(3,9,16,.76)}
      #wulan-neural-field-v4 .nv4-stat b{display:block;font-size:15px;font-weight:400;color:#e5f2fc}.nv4-stat span{font:600 5px ui-monospace,monospace;color:#586d84;letter-spacing:.12em}
      #wulan-neural-field-v4 .nv4-trace{position:absolute;z-index:3;right:20px;bottom:20px;width:310px;padding:12px;border:1px solid rgba(121,232,255,.11);border-radius:12px;background:rgba(3,9,16,.84);pointer-events:none}
      #wulan-neural-field-v4 .nv4-trace b{font-size:8px;color:#dceeff;letter-spacing:.08em}.nv4-trace small{display:block;margin-top:7px;font:500 6px/1.7 ui-monospace,monospace;color:#647b91;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nv4-trace em{font-style:normal;color:#79e8ff}
      #wulan-neural-field-v4 .nv4-inspect{position:absolute;z-index:4;left:20px;top:76px;width:250px;padding:12px;border:1px solid rgba(160,205,235,.1);border-radius:12px;background:rgba(3,9,16,.93);display:none;pointer-events:none}.nv4-inspect.show{display:block}.nv4-inspect b{font-size:9px;color:#e6f3ff}.nv4-inspect small{display:block;margin-top:6px;font:500 6px/1.55 ui-monospace,monospace;color:#63778d}
      #wulan-neural-field-v4 .nv4-help{position:absolute;z-index:3;left:50%;bottom:25px;transform:translateX(-50%);font:600 5px ui-monospace,monospace;letter-spacing:.12em;color:#40546a;pointer-events:none}
      @media(max-width:760px){#wulan-neural-field-v4 .nv4-panel{width:calc(100% - 18px);height:calc(100% - 90px)}#wulan-neural-field-v4 .nv4-trace{display:none}#wulan-neural-field-v4 .nv4-legend{display:none}#wulan-neural-field-v4 .nv4-stats{right:12px;left:12px}.nv4-stat{flex:1;min-width:0}.nv4-help{display:none}}
    `;
    document.head.appendChild(style);

    const root=document.createElement('section');
    root.id='wulan-neural-field-v4';
    root.innerHTML=`<div class="nv4-bg"></div><div class="nv4-panel"><div class="nv4-head"><div><div class="nv4-kicker">LIVE ASSOCIATIVE SUBSTRATE</div><h2>Neural field</h2><p>real neurons · weighted synapses · activation · learning</p></div><button aria-label="Close neural field">×</button></div><div class="nv4-legend"><i class="concept">CONCEPT</i><i class="memory">MEMORY</i><i class="agent">AGENT</i><i class="system">CORE</i></div><canvas></canvas><div class="nv4-inspect"></div><div class="nv4-trace"><b>ACTIVE THOUGHT PATH</b><small class="nv4-input">waiting for input</small><small class="nv4-path"></small></div><div class="nv4-stats"><div class="nv4-stat"><b class="n">0</b><span>NEURONS</span></div><div class="nv4-stat"><b class="s">0</b><span>SYNAPSES</span></div><div class="nv4-stat"><b class="a">0</b><span>ACTIVE</span></div><div class="nv4-stat"><b class="u">0</b><span>LEARNING UPDATES</span></div></div><div class="nv4-help">CLICK INSPECT · DOUBLE CLICK ACTIVATE · DRAG EXPLORE</div></div>`;
    document.body.appendChild(root);

    const panel=root.querySelector('.nv4-panel'),canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),inspect=root.querySelector('.nv4-inspect');
    let nodes=[],edges=[],trace=new Set(),selected=null,drag=null,w=0,h=0,dpr=1,t=0;
    const hash=x=>{let h=0;for(let i=0;i<x.length;i++)h=((h<<5)-h+x.charCodeAt(i))|0;return Math.abs(h)};
    const color=t=>({system:'#b59cff',agent:'#e8c36b',memory:'#70e5b4',concept:'#79e8ff'}[t]||'#8ea6bd');
    const group=t=>t==='concept'?'concept':t==='memory'?'memory':t==='agent'?'agent':t==='system'?'system':'other';
    const place=(arr,cx,cy,rx,ry,start)=>arr.forEach((n,i)=>{const a=start+i/Math.max(1,arr.length)*Math.PI*2+(hash(n.id)%19-9)/1000;n.x=cx+Math.cos(a)*rx;n.y=cy+Math.sin(a)*ry});

    function resize(){const r=panel.getBoundingClientRect();dpr=Math.min(devicePixelRatio||1,2);w=r.width;h=r.height;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);layout()}

    function layout(){
      const snap=core.neural.snapshot({limit:72});
      const g={system:[],concept:[],memory:[],agent:[],other:[]};
      const raw=[...snap.neurons].sort((a,b)=>(b.activation-a.activation)||(b.strength-a.strength));
      const keep=new Set();
      raw.filter(n=>n.type==='system').slice(0,2).forEach(n=>keep.add(n.id));
      raw.filter(n=>n.type==='agent').slice(0,6).forEach(n=>keep.add(n.id));
      raw.filter(n=>n.type!=='system'&&n.type!=='agent').slice(0,34).forEach(n=>keep.add(n.id));
      raw.filter(n=>n.activation>.08).slice(0,10).forEach(n=>keep.add(n.id));
      raw.filter(n=>n.type==='agent').slice(0,4).forEach(n=>keep.add(n.id));
      raw.filter(n=>n.type==='system').forEach(n=>keep.add(n.id));
      nodes=[];raw.filter(n=>keep.has(n.id)).forEach(n=>(g[group(n.type)]||g.other).push({...n}));
      const cx=w*.51,cy=h*.49,m=Math.min(w,h);
      g.system.forEach(n=>{n.x=cx;n.y=cy;nodes.push(n)});
      place(g.concept,cx,cy-m*.15,m*.38,m*.16,-Math.PI/2);
      place(g.memory,cx,cy+m*.18,m*.40,m*.16,Math.PI/2);
      place(g.agent,cx+m*.31,cy,m*.11,m*.27,-Math.PI/2);
      place(g.other,cx-m*.30,cy,m*.11,m*.24,-Math.PI/2);
      nodes.push(...g.concept,...g.memory,...g.agent,...g.other);
      const map=new Map(nodes.map(n=>[n.id,n]));
      trace=new Set((snap.trace||[]).map(x=>x.id));
      const candidates=snap.synapses.map(e=>({...e,a:map.get(e.source),b:map.get(e.target)})).filter(e=>e.a&&e.b&&e.a.id!==e.b.id);
      candidates.sort((a,b)=>{const at=trace.has(a.source)||trace.has(a.target),bt=trace.has(b.source)||trace.has(b.target);return (Number(bt)-Number(at))||(b.weight-a.weight)});
      const degree=new Map();edges=[];
      for(const e of candidates){const active=trace.has(e.source)||trace.has(e.target)||e.a.activation>.08||e.b.activation>.08;const maxDegree=active?4:2;const da=degree.get(e.source)||0,db=degree.get(e.target)||0;if(!active&&e.weight<.5)continue;if(da>=maxDegree||db>=maxDegree)continue;edges.push(e);degree.set(e.source,da+1);degree.set(e.target,db+1);if(edges.length>=30)break;}
      const s=core.neural.stats();root.querySelector('.n').textContent=s.neurons;root.querySelector('.s').textContent=s.synapses;root.querySelector('.a').textContent=s.active;root.querySelector('.u').textContent=s.updates;
      root.querySelector('.nv4-input').textContent=snap.lastInput?`input · ${snap.lastInput}`:'waiting for input';
      const path=(snap.trace||[]).slice(0,5).map(x=>x.label).join(' → ');root.querySelector('.nv4-path').innerHTML=path?`path · <em>${path}</em>`:'path · idle';
    }

    function nearest(x,y){let best=null,d=1e9;for(const n of nodes){const r=(n.type==='system'?13:n.type==='agent'?7:4)+n.strength*4+(n.activation>.08?n.activation*6:0);const q=Math.hypot(n.x-x,n.y-y);if(q<d){d=q;best=n}}return d<34?best:null}
    function inspectNode(n){selected=n;const links=edges.filter(e=>e.a.id===n.id||e.b.id===n.id);inspect.classList.add('show');inspect.innerHTML=`<b>${String(n.label)}</b><small>${n.type} · strength ${Math.round(n.strength*100)}% · activation ${Math.round(n.activation*100)}% · visits ${n.visits}<br>${links.length} visible synapses · ${(n.tags||[]).slice(0,6).join(' · ')||'no tags'}</small>`}

    function draw(){
      ctx.clearRect(0,0,w,h);const cx=w*.51,cy=h*.49,m=Math.min(w,h);
      const bg=ctx.createRadialGradient(cx,cy,0,cx,cy,m*.62);bg.addColorStop(0,'rgba(45,145,190,.11)');bg.addColorStop(.48,'rgba(65,86,160,.025)');bg.addColorStop(1,'transparent');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
      [[.24,.13],[.38,.21],[.52,.29]].forEach(r=>{ctx.beginPath();ctx.ellipse(cx,cy,m*r[0],m*r[1],0,0,Math.PI*2);ctx.strokeStyle='rgba(121,232,255,.028)';ctx.stroke()});
      edges.forEach((e,i)=>{const active=trace.has(e.source)||trace.has(e.target)||e.a.activation>.08||e.b.activation>.08||(selected&&(selected.id===e.source||selected.id===e.target));ctx.globalAlpha=active?1:.18;ctx.beginPath();ctx.moveTo(e.a.x,e.a.y);const bend=(hash(e.id)%17-8)*.7;ctx.quadraticCurveTo((e.a.x+e.b.x)/2,(e.a.y+e.b.y)/2+bend,e.b.x,e.b.y);ctx.strokeStyle=active?`rgba(121,232,255,${.22+e.weight*.58})`:`rgba(122,166,199,${.018+e.weight*.05})`;ctx.lineWidth=active?1.15:Math.max(.3,e.weight*.35);ctx.stroke();if(active){const q=(t*.32+i*.083)%1,px=e.a.x+(e.b.x-e.a.x)*q,py=e.a.y+(e.b.y-e.a.y)*q;ctx.beginPath();ctx.arc(px,py,1.25,0,6.28);ctx.fillStyle='rgba(215,249,255,.78)';ctx.shadowBlur=8;ctx.shadowColor='#79e8ff';ctx.fill();ctx.shadowBlur=0}ctx.globalAlpha=1});
      nodes.forEach(n=>{const active=n.activation>.08||trace.has(n.id)||selected?.id===n.id,c=color(n.type),r=(n.type==='system'?10:n.type==='agent'?6:3)+n.strength*3.8+(active?n.activation*6:0);if(active){ctx.beginPath();ctx.arc(n.x,n.y,r*3,0,6.28);ctx.fillStyle=n.type==='memory'?'rgba(112,229,180,.055)':n.type==='agent'?'rgba(232,195,107,.055)':n.type==='system'?'rgba(181,156,255,.07)':'rgba(121,232,255,.055)';ctx.fill()}ctx.beginPath();ctx.arc(n.x,n.y,r,0,6.28);ctx.fillStyle='#06101a';ctx.fill();ctx.strokeStyle=c;ctx.lineWidth=active?1.7:1;ctx.stroke();if(n.type==='system'||n.type==='agent'||active||selected?.id===n.id){ctx.font=n.type==='system'?'600 9px ui-monospace,monospace':'500 7px ui-monospace,monospace';ctx.textAlign='center';ctx.fillStyle=active?'#e5f5ff':'#657b91';ctx.fillText(n.type==='system'?'WULAN CORE':String(n.label).slice(0,20),n.x,n.y+r+12)}});
      t+=.025;requestAnimationFrame(draw);
    }

    const open=()=>{root.classList.add('open');layout();resize()};
    const close=()=>{root.classList.remove('open');selected=null;inspect.classList.remove('show')};
    root.querySelector('button').onclick=close;root.querySelector('.nv4-bg').onclick=close;
    canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,n=nearest(x,y);if(drag){drag.x=x;drag.y=y}canvas.style.cursor=n?'pointer':'crosshair'});
    canvas.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect(),n=nearest(e.clientX-r.left,e.clientY-r.top);if(n){drag=n;inspectNode(n);canvas.setPointerCapture(e.pointerId)}});
    canvas.addEventListener('pointerup',e=>{drag=null;try{canvas.releasePointerCapture(e.pointerId)}catch{}});
    canvas.addEventListener('dblclick',e=>{const r=canvas.getBoundingClientRect(),n=nearest(e.clientX-r.left,e.clientY-r.top);if(n){core.neural.activate(n.label,{limit:24,hops:3,reinforce:true});inspectNode(n);layout()}});
    core.events.on('neural.updated',()=>root.classList.contains('open')&&layout());core.events.on('neural.activated',()=>root.classList.contains('open')&&layout());core.events.on('memory.created',()=>root.classList.contains('open')&&layout());
    base.addEventListener('click',open);document.querySelector('.w-neural')?.addEventListener('click',e=>{e.preventDefault();open});globalThis.WULAN_NEURAL_FIELD={open,close,refresh:layout};window.addEventListener('resize',resize);resize();draw();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
