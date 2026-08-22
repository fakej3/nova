(() => {
  const boot = () => {
    const core = globalThis.WULAN_CORE;
    const base = document.getElementById('nova-canvas');
    if (!core || !base || document.getElementById('wulan-neural-field-v3')) return;

    document.getElementById('wulan-neural-field')?.remove();

    const style = document.createElement('style');
    style.textContent = `
      #wulan-neural-field-v3{position:absolute;inset:0;z-index:90;pointer-events:none;opacity:0;transition:opacity .22s ease}
      #wulan-neural-field-v3.open{opacity:1;pointer-events:auto}
      #wulan-neural-field-v3 .nv-backdrop{position:absolute;inset:0;background:radial-gradient(circle at 50% 48%,rgba(8,22,38,.56),rgba(1,5,10,.92));backdrop-filter:blur(10px)}
      #wulan-neural-field-v3 .nv-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1160px,92vw);height:min(760px,86vh);border:1px solid rgba(121,232,255,.15);border-radius:22px;background:rgba(2,8,15,.84);box-shadow:0 40px 140px rgba(0,0,0,.65),inset 0 1px rgba(255,255,255,.035);overflow:hidden}
      #wulan-neural-field-v3 .nv-canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
      #wulan-neural-field-v3 .nv-head{position:absolute;z-index:3;left:24px;right:24px;top:20px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}
      #wulan-neural-field-v3 .nv-kicker{font:600 7px ui-monospace,monospace;letter-spacing:.24em;color:#79e8ff}
      #wulan-neural-field-v3 h2{margin:7px 0 3px;font-size:25px;font-weight:330;color:#edf8ff}
      #wulan-neural-field-v3 .nv-head p{margin:0;font:500 7px ui-monospace,monospace;color:#61768c;letter-spacing:.1em}
      #wulan-neural-field-v3 .nv-close{pointer-events:auto;width:36px;height:36px;border:1px solid rgba(160,205,235,.16);border-radius:11px;background:rgba(3,9,16,.72);color:#a6bdd1;cursor:pointer;font-size:18px}
      #wulan-neural-field-v3 .nv-stats{position:absolute;z-index:3;left:22px;bottom:20px;display:flex;gap:7px;pointer-events:none}
      #wulan-neural-field-v3 .nv-stat{min-width:78px;padding:8px 10px;border:1px solid rgba(160,205,235,.1);border-radius:10px;background:rgba(3,9,16,.72)}
      #wulan-neural-field-v3 .nv-stat b{display:block;font-size:15px;font-weight:400;color:#e5f2fc}.nv-stat span{font:600 5px ui-monospace,monospace;color:#586d84;letter-spacing:.12em}
      #wulan-neural-field-v3 .nv-trace{position:absolute;z-index:3;right:20px;bottom:20px;width:300px;padding:12px;border:1px solid rgba(121,232,255,.11);border-radius:12px;background:rgba(3,9,16,.8);pointer-events:none}
      #wulan-neural-field-v3 .nv-trace b{font-size:8px;color:#dceeff;letter-spacing:.08em}.nv-trace small{display:block;margin-top:7px;font:500 6px/1.7 ui-monospace,monospace;color:#647b91;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nv-trace em{font-style:normal;color:#79e8ff}
      #wulan-neural-field-v3 .nv-inspect{position:absolute;z-index:4;left:20px;top:74px;width:245px;padding:12px;border:1px solid rgba(160,205,235,.1);border-radius:12px;background:rgba(3,9,16,.9);display:none;pointer-events:none}.nv-inspect.show{display:block}.nv-inspect b{font-size:9px;color:#e6f3ff}.nv-inspect small{display:block;margin-top:6px;font:500 6px/1.55 ui-monospace,monospace;color:#63778d}
      #wulan-neural-field-v3 .nv-help{position:absolute;z-index:3;left:50%;bottom:25px;transform:translateX(-50%);font:600 5px ui-monospace,monospace;letter-spacing:.12em;color:#40546a;pointer-events:none}
      @media(max-width:760px){#wulan-neural-field-v3 .nv-panel{width:calc(100% - 18px);height:calc(100% - 90px);top:46%}.nv-trace{display:none}.nv-stats{right:12px;left:12px;bottom:12px}.nv-stat{flex:1;min-width:0}.nv-help{display:none}}
    `;
    document.head.appendChild(style);

    const root = document.createElement('section');
    root.id = 'wulan-neural-field-v3';
    root.innerHTML = `<div class="nv-backdrop"></div><div class="nv-panel"><div class="nv-head"><div><div class="nv-kicker">LIVE ASSOCIATIVE SUBSTRATE</div><h2>Neural field</h2><p>real neurons · weighted synapses · activation · learning</p></div><button class="nv-close" aria-label="Close neural field">×</button></div><canvas class="nv-canvas"></canvas><div class="nv-inspect" id="nv-inspect"></div><div class="nv-trace"><b>ACTIVE THOUGHT PATH</b><small id="nv-input">waiting for input</small><small id="nv-path"></small></div><div class="nv-stats"><div class="nv-stat"><b id="nv-neurons">0</b><span>NEURONS</span></div><div class="nv-stat"><b id="nv-synapses">0</b><span>SYNAPSES</span></div><div class="nv-stat"><b id="nv-active">0</b><span>ACTIVE</span></div><div class="nv-stat"><b id="nv-updates">0</b><span>LEARNING UPDATES</span></div></div><div class="nv-help">CLICK INSPECT · DOUBLE CLICK ACTIVATE · DRAG EXPLORE</div></div>`;
    (document.querySelector('.w-stage') || document.querySelector('.wulan-world') || document.body).appendChild(root);

    const panel = root.querySelector('.nv-panel');
    const canvas = root.querySelector('.nv-canvas');
    const ctx = canvas.getContext('2d');
    const inspect = root.querySelector('#nv-inspect');
    const nodes = [];
    let edges = [];
    let traceIds = new Set();
    let selected = null;
    let dragging = null;
    let w = 0, h = 0, dpr = 1, t = 0;
    const pointer = { x: 0, y: 0, active: false };

    const hash = (value) => { let h = 0; for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0; return Math.abs(h); };
    const color = (type) => ({ system:'#b59cff', agent:'#e8c36b', memory:'#70e5b4', concept:'#79e8ff', integration:'#a98bff' }[type] || '#8ea6bd');
    const group = (type) => type === 'concept' ? 'concept' : type === 'memory' ? 'memory' : type === 'agent' ? 'agent' : type === 'system' ? 'system' : 'other';

    const place = (arr, cx, cy, rx, ry, start, phase = 0) => arr.forEach((n, i) => {
      const a = start + i / Math.max(1, arr.length) * Math.PI * 2;
      const j = (hash(n.id) % 19 - 9) / 1000 + phase;
      n.x = cx + Math.cos(a + j) * rx;
      n.y = cy + Math.sin(a + j) * ry;
    });

    function resize(){
      const r = panel.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2); w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr,0,0,dpr,0,0); layout();
    }

    function layout(){
      const snap = core.neural.snapshot({limit:90});
      const groups = {system:[],concept:[],memory:[],agent:[],other:[]};
      nodes.length = 0;
      snap.neurons.forEach(n => (groups[group(n.type)] || groups.other).push({...n}));
      const cx=w*.5, cy=h*.49, m=Math.min(w,h);
      groups.system.forEach(n=>{n.x=cx;n.y=cy;nodes.push(n)});
      place(groups.concept,cx,cy-m*.19,m*.36,m*.17,-Math.PI/2);
      place(groups.memory,cx-m*.10,cy+m*.08,m*.31,m*.18,.15,.03);
      place(groups.agent,cx+m*.30,cy-m*.01,m*.15,m*.25,-Math.PI/2,.06);
      place(groups.other,cx,cy+m*.26,m*.30,m*.10,Math.PI,.08);
      nodes.push(...groups.concept,...groups.memory,...groups.agent,...groups.other);
      const map = new Map(nodes.map(n=>[n.id,n]));
      traceIds = new Set((snap.trace||[]).map(x=>x.id));
      const rawEdges = snap.synapses.map(e=>({...e,a:map.get(e.source),b:map.get(e.target)})).filter(e=>e.a&&e.b);
      rawEdges.sort((a,b)=>((traceIds.has(a.source)||traceIds.has(a.target)?1:0)-(traceIds.has(b.source)||traceIds.has(b.target)?1:0)) || (b.weight-a.weight));
      edges = rawEdges.slice(0,55);
      const s=core.neural.stats();
      root.querySelector('#nv-neurons').textContent=s.neurons;root.querySelector('#nv-synapses').textContent=s.synapses;root.querySelector('#nv-active').textContent=s.active;root.querySelector('#nv-updates').textContent=s.updates;
      root.querySelector('#nv-input').textContent=snap.lastInput?`input · ${snap.lastInput}`:'waiting for input';
      const path=(snap.trace||[]).slice(0,7).map(x=>x.label).join(' → ');root.querySelector('#nv-path').innerHTML=path?`path · <em>${path}</em>`:'path · idle';
    }

    function nearest(x,y){
      let best=null,dist=Infinity;
      for(const n of nodes){const radius=(n.type==='system'?12:4)+n.strength*5+(n.activation>.1?n.activation*8:0);const d=Math.hypot(n.x-x,n.y-y);if(d<dist){dist=d;best=n}}
      return dist<34?best:null;
    }

    function draw(){
      ctx.clearRect(0,0,w,h);const cx=w*.5,cy=h*.49,m=Math.min(w,h);
      const bg=ctx.createRadialGradient(cx,cy,0,cx,cy,m*.58);bg.addColorStop(0,'rgba(45,145,190,.10)');bg.addColorStop(.48,'rgba(65,86,160,.025)');bg.addColorStop(1,'transparent');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
      for(const ring of [[.25,.14],[.39,.22],[.51,.30]]){ctx.beginPath();ctx.ellipse(cx,cy,m*ring[0],m*ring[1],0,0,Math.PI*2);ctx.strokeStyle='rgba(121,232,255,.028)';ctx.lineWidth=.6;ctx.stroke()}
      edges.forEach((e,i)=>{
        const active=traceIds.has(e.source)||traceIds.has(e.target)||e.a.activation>.08||e.b.activation>.08||(selected&&(selected.id===e.source||selected.id===e.target));
        ctx.globalAlpha=active?1:(selected?.id&& !active?.12:0.24);
        ctx.beginPath();ctx.moveTo(e.a.x,e.a.y);ctx.quadraticCurveTo((e.a.x+e.b.x)/2,(e.a.y+e.b.y)/2-((e.b.x-e.a.x)*.05),e.b.x,e.b.y);
        ctx.strokeStyle=active?`rgba(121,232,255,${.28+e.weight*.55})`:`rgba(122,166,199,${.018+e.weight*.06})`;ctx.lineWidth=active?1.35:Math.max(.3,e.weight*.5);ctx.stroke();
        if(active){const q=(t*.35+i*.071)%1,px=e.a.x+(e.b.x-e.a.x)*q,py=e.a.y+(e.b.y-e.a.y)*q;ctx.beginPath();ctx.arc(px,py,1.35,0,6.28);ctx.fillStyle='rgba(215,249,255,.82)';ctx.shadowBlur=8;ctx.shadowColor='#79e8ff';ctx.fill();ctx.shadowBlur=0}
        ctx.globalAlpha=1;
      });
      nodes.forEach(n=>{
        const active=n.activation>.08||traceIds.has(n.id)||selected?.id===n.id;const c=color(n.type);const r=(n.type==='system'?10:3.3)+n.strength*4.6+(active?n.activation*8:0);
        if(active){ctx.beginPath();ctx.arc(n.x,n.y,r*3.1,0,6.28);ctx.fillStyle=n.type==='memory'?'rgba(112,229,180,.055)':n.type==='agent'?'rgba(232,195,107,.055)':'rgba(121,232,255,.06)';ctx.fill()}
        ctx.beginPath();ctx.arc(n.x,n.y,r,0,6.28);ctx.fillStyle='#06101a';ctx.fill();ctx.strokeStyle=c;ctx.lineWidth=active?1.8:1;ctx.stroke();
        if(n.type==='system'||n.type==='agent'||active||selected?.id===n.id){ctx.font=n.type==='system'?'600 9px ui-monospace,monospace':'500 7px ui-monospace,monospace';ctx.textAlign='center';ctx.fillStyle=active?'#e5f5ff':'#657b91';ctx.fillText(n.type==='system'?'WULAN CORE':String(n.label).slice(0,22),n.x,n.y+r+13)}
      });
      if(pointer.active){ctx.beginPath();ctx.arc(pointer.x,pointer.y,11+Math.sin(t)*2,0,6.28);ctx.strokeStyle='rgba(121,232,255,.11)';ctx.stroke()}
      t+=.025;requestAnimationFrame(draw);
    }

    function inspectNode(n){
      selected=n;const links=edges.filter(e=>e.a.id===n.id||e.b.id===n.id);inspect.classList.add('show');inspect.innerHTML=`<b>${String(n.label)}</b><small>${n.type} · strength ${Math.round(n.strength*100)}% · activation ${Math.round(n.activation*100)}% · visits ${n.visits}<br>${links.length} visible synapses · ${(n.tags||[]).slice(0,6).join(' · ')||'no tags'}</small>`;
    }
    function open(){root.classList.add('open');layout();resize()}
    function close(){root.classList.remove('open');selected=null;inspect.classList.remove('show')}

    root.querySelector('.nv-close').onclick=close;root.querySelector('.nv-backdrop').onclick=close;
    canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;if(dragging){dragging.x=pointer.x;dragging.y=pointer.y}canvas.style.cursor=nearest(pointer.x,pointer.y)?'pointer':'crosshair'});
    canvas.addEventListener('pointerleave',()=>pointer.active=false);
    canvas.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect(),n=nearest(e.clientX-r.left,e.clientY-r.top);if(n){dragging=n;inspectNode(n);canvas.setPointerCapture(e.pointerId)}});
    canvas.addEventListener('pointerup',e=>{dragging=null;try{canvas.releasePointerCapture(e.pointerId)}catch{}});
    canvas.addEventListener('dblclick',e=>{const r=canvas.getBoundingClientRect(),n=nearest(e.clientX-r.left,e.clientY-r.top);if(n){core.neural.activate(n.label,{limit:24,hops:3,reinforce:true});core.events.emit('neural.activated',{query:n.label,trace:core.neural.snapshot({limit:24}).trace});inspectNode(n);layout()}});
    core.events.on('neural.updated',()=>{if(root.classList.contains('open'))layout()});core.events.on('neural.activated',()=>{if(root.classList.contains('open'))layout()});core.events.on('memory.created',()=>{if(root.classList.contains('open'))layout()});
    base.addEventListener('click',open);document.querySelector('.w-neural')?.addEventListener('click',e=>{e.preventDefault();open()});
    globalThis.WULAN_NEURAL_FIELD={open,close,refresh:layout};
    window.addEventListener('resize',resize);resize();draw();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
