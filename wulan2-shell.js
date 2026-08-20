import { createDefaultWulanCore } from '../wulan/core/manifest.js';
import { WULAN_EVENTS } from '../wulan/core/event-bus.js';

(() => {
  const core = createDefaultWulanCore();
  const canvas = document.getElementById('nova-canvas');
  const ctx = canvas.getContext('2d');
  const input = document.getElementById('nova-input');
  const send = document.getElementById('nova-send');
  const voice = document.getElementById('voice');
  const toast = document.getElementById('nova-toast');
  const inspector = document.getElementById('node-inspector');
  const state = document.getElementById('core-state');
  const coreStatus = document.getElementById('core-status');
  const threads = document.getElementById('threads');
  const focusName = document.getElementById('focus-name');
  const focusMeta = document.getElementById('focus-meta');
  const title = document.querySelector('.world-title h1');
  const subtitle = document.querySelector('.world-title p');

  // These are contexts, not "nodes". They are intentionally rendered as
  // quiet spatial labels instead of glowing circles.
  const contexts = [
    { id:'memory', label:'MEMORY', kind:'memory', angle:-2.35, radius:.62, meta:'MEMORY · ACTIVE' },
    { id:'context', label:'CONTEXT', kind:'memory', angle:1.78, radius:.66, meta:'CONTEXT · LOCAL' },
    { id:'atlas', label:'ATLAS', kind:'agent', angle:-.68, radius:.79, meta:'AGENT · RESEARCH' },
    { id:'leon', label:'LEON', kind:'agent', angle:.68, radius:.82, meta:'AGENT · BUILD' },
    { id:'oracle', label:'ORACLE', kind:'agent', angle:2.55, radius:.80, meta:'AGENT · ANALYSIS' },
    { id:'pixel', label:'PIXEL', kind:'agent', angle:3.62, radius:.72, meta:'AGENT · CREATIVE' },
    { id:'projects', label:'PROJECTS', kind:'data', angle:-1.55, radius:.93, meta:'CONTEXT · PROJECTS' },
    { id:'tools', label:'TOOLS', kind:'data', angle:.10, radius:.96, meta:'SYSTEM · TOOLS' },
    { id:'devices', label:'DEVICES', kind:'data', angle:1.55, radius:.94, meta:'DEVICE · LINKED' },
    { id:'sentinel', label:'SENTINEL', kind:'integration', angle:2.95, radius:.95, meta:'INTEGRATION · DORMANT' },
    { id:'edgelab', label:'EDGELAB', kind:'integration', angle:-2.95, radius:.93, meta:'INTEGRATION · DORMANT' },
    { id:'github', label:'GITHUB', kind:'integration', angle:3.95, radius:.94, meta:'INTEGRATION · READY' }
  ];

  const palette = {
    core:'#74e8ff', agent:'#b59cff', memory:'#71e5b0',
    data:'#f2c875', integration:'#8194ad'
  };

  const activeAgents = new Set();
  const flow = [];
  const motes = [];
  const ripples = [];
  let w=0,h=0,dpr=1,t=0,hover=null,focus=null;
  let activity=0, attention=0;
  let visualState='idle';
  let pointer={x:0,y:0,active:false};

  for(let i=0;i<150;i++){
    flow.push({
      a:Math.random()*Math.PI*2,
      r:.16+Math.random()*.88,
      speed:.00025+Math.random()*.00075,
      lane:(Math.random()-.5)*.09,
      size:.45+Math.random()*1.2,
      phase:Math.random()*Math.PI*2,
      life:Math.random()
    });
  }
  for(let i=0;i<90;i++){
    motes.push({
      a:Math.random()*Math.PI*2,
      r:.22+Math.random()*.9,
      speed:(Math.random()>.5?1:-1)*(.00025+Math.random()*.0007),
      size:.3+Math.random()*1.15,
      alpha:.08+Math.random()*.28,
      phase:Math.random()*Math.PI*2
    });
  }

  function resize(){
    dpr=Math.min(devicePixelRatio||1,2);
    w=innerWidth; h=innerHeight;
    canvas.width=w*dpr; canvas.height=h*dpr;
    canvas.style.width=w+'px'; canvas.style.height=h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    pointer.x=w*.5; pointer.y=h*.52;
  }

  function center(){ return {x:w*.52,y:h*.53}; }
  function minDim(){ return Math.min(w,h); }
  function find(id){ return contexts.find(n=>n.id===id); }
  function distance(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }

  function stateEnergy(){
    const map={idle:.08,listening:.35,thinking:.72,remembering:.58,acting:.9,learning:.66,error:.3};
    return map[visualState] ?? .1;
  }

  // Organic field: no fixed graph, no closed "bubble". The contour is
  // continuously deformed by state, attention and time.
  function fieldPoint(a,r,layer=0){
    const c=center();
    const e=stateEnergy();
    const asym=Math.sin(a*2.7+t*.42+layer*.5)*.035
      +Math.sin(a*5.1-t*.72)*.018
      +Math.cos(a*1.45+t*.21)*.028;
    const breath=Math.sin(t*1.55+layer*.7)*(.018+e*.018);
    const rr=r+asym+breath;
    const squeeze=1+.08*Math.sin(a*3-t*.25);
    return {
      x:c.x+Math.cos(a)*minDim()*.40*rr*squeeze,
      y:c.y+Math.sin(a)*minDim()*.235*rr,
    };
  }

  function contextPos(n){
    const c=center();
    const drift=Math.sin(t*.32+n.angle*1.7)*.012;
    const a=n.angle+Math.sin(t*.16+n.radius)*.012;
    const r=n.radius+drift;
    return {
      x:c.x+Math.cos(a)*minDim()*.39*r,
      y:c.y+Math.sin(a)*minDim()*.235*r
    };
  }

  function drawBackground(){
    ctx.clearRect(0,0,w,h);
    const c=center();
    const g=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,minDim()*.62);
    g.addColorStop(0,'rgba(72,201,255,.085)');
    g.addColorStop(.22,'rgba(92,116,255,.035)');
    g.addColorStop(.58,'rgba(36,65,120,.012)');
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);

    // Sparse dust, with gentle parallax. The space should breathe, not snow.
    motes.forEach((m,i)=>{
      m.a+=m.speed;
      const rr=m.r+Math.sin(t*.2+m.phase)*.012;
      const x=c.x+Math.cos(m.a)*minDim()*(.16+rr*.45);
      const y=c.y+Math.sin(m.a)*minDim()*(.09+rr*.27);
      const tw=.55+.45*Math.sin(t*1.15+m.phase);
      const near=pointer.active?Math.max(0,1-distance({x,y},pointer)/(minDim()*.38)):0;
      ctx.fillStyle=`rgba(154,215,255,${m.alpha*tw*(1+near*.8)})`;
      ctx.beginPath(); ctx.arc(x,y,m.size*(1+near*.45),0,Math.PI*2); ctx.fill();
    });
  }

  function drawAtmosphere(){
    const c=center();
    const e=stateEnergy();

    // Broad, very low-contrast breathing bands. They establish depth without
    // reading as an object or a dashboard component.
    for(let layer=0;layer<6;layer++){
      ctx.beginPath();
      const steps=180;
      for(let i=0;i<=steps;i++){
        const a=i/steps*Math.PI*2;
        const p=fieldPoint(a,.46+layer*.075,layer);
        if(i===0)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
      }
      ctx.closePath();
      const alpha=.026+layer*.004+e*.008;
      ctx.strokeStyle=`rgba(105,201,255,${alpha})`;
      ctx.lineWidth=.55+(5-layer)*.05;
      ctx.stroke();
    }

    // Long living filaments. They bend around the presence rather than
    // connecting icons to one another.
    for(let i=0;i<22;i++){
      const base=i/22*Math.PI*2+t*.008;
      const inner=fieldPoint(base,.10+.025*Math.sin(t+i),i%3);
      const mid=fieldPoint(base+.16*Math.sin(t*.22+i),.40+.08*Math.sin(t*.3+i),i%4);
      const outer=fieldPoint(base+.34*Math.sin(t*.17+i),.98+.06*Math.sin(t*.24+i),i%5);
      ctx.beginPath();
      ctx.moveTo(inner.x,inner.y);
      ctx.quadraticCurveTo(mid.x,mid.y,outer.x,outer.y);
      ctx.strokeStyle=`rgba(101,190,255,${.028+e*.025})`;
      ctx.lineWidth=.45;
      ctx.stroke();
    }

    // Directional streams make the environment feel like it is processing,
    // even at idle. Their direction changes with the actual Wulan state.
    flow.forEach((p,i)=>{
      const radialPull=(visualState==='thinking'||visualState==='remembering'||visualState==='learning')?.0012:-.00035;
      p.r+=radialPull + Math.sin(t*.4+p.phase)*.00004;
      p.a+=p.speed*(visualState==='acting'?2.2:1)+p.lane*.0008;
      if(p.r<.12)p.r=.96;
      if(p.r>1.04)p.r=.14;
      const a=p.a+Math.sin(t*.18+p.phase)*.025;
      const rr=p.r;
      const pos=fieldPoint(a,rr,2);
      const tail=fieldPoint(a-.055,Math.max(.1,rr-.035),2);
      const alpha=.07+e*.12+.04*Math.sin(t*1.8+p.phase);
      ctx.strokeStyle=`rgba(128,218,255,${Math.max(.025,alpha)})`;
      ctx.lineWidth=.45+p.size*.18;
      ctx.beginPath();ctx.moveTo(tail.x,tail.y);ctx.lineTo(pos.x,pos.y);ctx.stroke();
      if(i%3===0){
        ctx.fillStyle=`rgba(190,241,255,${Math.max(.04,alpha*.8)})`;
        ctx.beginPath();ctx.arc(pos.x,pos.y,p.size,0,Math.PI*2);ctx.fill();
      }
    });

    // Attention field follows the user rather than merely creating a click ripple.
    if(pointer.active){
      attention+=(.7-attention)*.045;
      const ar=minDim()*.16;
      const ag=ctx.createRadialGradient(pointer.x,pointer.y,0,pointer.x,pointer.y,ar);
      ag.addColorStop(0,`rgba(117,226,255,${.045*attention})`);
      ag.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=ag;ctx.fillRect(pointer.x-ar,pointer.y-ar,ar*2,ar*2);
    }else attention*=.97;

    // The presence: a dark, breathing aperture surrounded by moving light.
    // It is deliberately not a circle/orb; the shape has a living asymmetry.
    const pulse=1+Math.sin(t*1.7)*.045+e*.07;
    const rx=minDim()*.115*pulse;
    const ry=minDim()*.052*pulse;
    const coreGlow=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,rx*2.5);
    coreGlow.addColorStop(0,`rgba(100,226,255,${.13+e*.08})`);
    coreGlow.addColorStop(.32,`rgba(88,121,255,${.045+e*.035})`);
    coreGlow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=coreGlow;ctx.fillRect(c.x-rx*2.5,c.y-ry*3,c.x+rx*2.5-(c.x-rx*2.5),ry*6);

    for(let ring=0;ring<4;ring++){
      ctx.beginPath();
      const steps=100;
      for(let i=0;i<=steps;i++){
        const a=i/steps*Math.PI*2;
        const wob=.035*Math.sin(a*4+t*1.2+ring)+.018*Math.sin(a*7-t*.8);
        const x=c.x+Math.cos(a)*(rx*(1+ring*.13)+wob*minDim());
        const y=c.y+Math.sin(a)*(ry*(1+ring*.15)+wob*.42*minDim());
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.strokeStyle=`rgba(111,225,255,${.11-ring*.018+e*.025})`;
      ctx.lineWidth=ring===0?1.15:.65;
      ctx.stroke();
    }

    // Rotating broken arcs provide subtle "attention" and make the center feel
    // active without turning it into an icon.
    for(let arc=0;arc<5;arc++){
      const start=t*(.18+(arc%2)*-.08)+arc*1.23;
      ctx.beginPath();
      ctx.ellipse(c.x,c.y,rx*(1.25+arc*.18),ry*(1.25+arc*.17),Math.sin(t*.2)*.05,start,start+.75+e*.2);
      ctx.strokeStyle=`rgba(168,218,255,${.07+e*.025})`;
      ctx.lineWidth=.7;
      ctx.stroke();
    }
  }

  function drawContextMarkers(){
    const c=center();
    contexts.forEach(n=>{
      const p=contextPos(n);
      const color=palette[n.kind]||palette.data;
      const active=activeAgents.has(n.id);
      const selected=focus?.id===n.id;
      const near=hover?.id===n.id;
      const emphasis=selected||active||near;
      const distanceFromCenter=Math.hypot(p.x-c.x,p.y-c.y);
      const alpha=n.kind==='integration'?.34:n.kind==='data'?.48:.62;

      // A tiny glyph and a hairline are enough to locate a context. No glowing ball.
      const dir=Math.atan2(p.y-c.y,p.x-c.x);
      const gx=p.x-Math.cos(dir)*10, gy=p.y-Math.sin(dir)*10;
      ctx.save();
      ctx.globalAlpha=emphasis?1:alpha;
      ctx.strokeStyle=color;
      ctx.lineWidth=emphasis?1.2:.65;
      ctx.beginPath();ctx.moveTo(c.x+Math.cos(dir)*distanceFromCenter*.67,c.y+Math.sin(dir)*distanceFromCenter*.67);ctx.lineTo(gx,gy);ctx.stroke();
      ctx.translate(gx,gy);ctx.rotate(dir+.785);
      ctx.strokeStyle=color;ctx.strokeRect(-2.6,-2.6,5.2,5.2);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha=emphasis?1:alpha;
      ctx.fillStyle=emphasis?'#dceeff':'#8293a9';
      ctx.font=(emphasis?'600 8px':'500 7px')+' ui-monospace,monospace';
      ctx.textAlign='center';ctx.fillText(n.label,p.x,p.y+16);
      if(active){
        ctx.fillStyle='#74e8ff';ctx.font='500 6px ui-monospace,monospace';ctx.fillText('ACTIVE',p.x,p.y+27);
      }
      ctx.restore();
    });
  }

  function drawActivity(){
    activity*=.982;
    const c=center();
    for(let i=ripples.length-1;i>=0;i--){
      const q=ripples[i];q.r+=q.speed;q.life*=.982;
      ctx.beginPath();ctx.arc(q.x,q.y,q.r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(113,226,255,${q.life*.18})`;
      ctx.lineWidth=.8;ctx.stroke();
      if(q.life<.015)ripples.splice(i,1);
    }
    if(activity>.015){
      const r=minDim()*(.05+(1-activity)*.20);
      ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(181,156,255,${activity*.12})`;ctx.lineWidth=.8;ctx.stroke();
    }
  }

  function draw(){
    t+=.009;
    drawBackground();
    drawAtmosphere();
    drawActivity();
    drawContextMarkers();
    requestAnimationFrame(draw);
  }

  function notify(text){
    if(!toast)return;
    toast.textContent=text;toast.classList.add('show');
    setTimeout(()=>toast.classList.remove('show'),1700);
  }
  function showInspector(n,x,y){
    if(!inspector)return;
    inspector.querySelector('.inspector-name').textContent=n.label;
    inspector.querySelector('.inspector-meta').textContent=n.meta;
    inspector.style.left=Math.min(x+16,w-175)+'px';
    inspector.style.top=Math.min(y+16,h-100)+'px';
    inspector.classList.add('show');
  }
  function hideInspector(){ inspector?.classList.remove('show'); }

  function nodeAt(x,y){
    let nearest=null,best=Infinity;
    contexts.forEach(n=>{
      const p=contextPos(n),d=Math.hypot(p.x-x,p.y-y);
      if(d<24&&d<best){nearest=n;best=d;}
    });
    const c=center();
    if(Math.hypot(c.x-x,c.y-y)<Math.min(w,h)*.13)return {id:'wulan',label:'WULAN',kind:'core',meta:'CORE · PRESENT'};
    return nearest;
  }

  function pointerMove(e){
    const r=canvas.getBoundingClientRect();
    pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;
    const n=nodeAt(pointer.x,pointer.y);hover=n;
    canvas.style.cursor=n?'pointer':'default';
    if(n)showInspector(n,e.clientX,e.clientY);else hideInspector();
  }

  function activateAgent(agentId){
    const agent=find(agentId);if(!agent)return;
    focus=agent;focusName.textContent=agent.label;focusMeta.textContent=agent.meta;
    visualState='acting';activity=1;
    core.startAgent(agentId,{reason:'ui-exploration'});
    setTimeout(()=>{if(activeAgents.has(agentId))core.finishAgent(agentId,{reason:'ui-exploration'});},1500);
  }

  function pointerDown(e){
    const r=canvas.getBoundingClientRect();
    const x=e.clientX-r.left,y=e.clientY-r.top;
    const n=nodeAt(x,y);
    ripples.push({x,y,r:4,speed:3.2,life:1});activity=1;
    if(!n){focus=null;focusName.textContent='Wulan World';focusMeta.textContent='Live system overview';visualState='idle';return;}
    focus=focus?.id===n.id?null:n;
    focusName.textContent=focus?focus.label:'Wulan World';
    focusMeta.textContent=focus?focus.meta:'Live system overview';
    notify(focus?`${n.label} · ${n.meta}`:'WORLD · OVERVIEW');
    if(n.kind==='agent')activateAgent(n.id);
    else if(n.id==='memory'){visualState='remembering';setTimeout(()=>{if(!activeAgents.size)visualState='idle';},1400);}
  }

  function submit(){
    const q=input.value.trim();if(!q)return;
    input.value='';
    core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text:q});
    visualState='listening';state.textContent='LISTENING';threads.textContent='01';activity=1;
    focus={id:'wulan',label:'WULAN',kind:'core',meta:'CORE · LISTENING'};
    focusName.textContent='WULAN';focusMeta.textContent='CORE · LISTENING';
    ripples.push({...center(),r:4,speed:4.5,life:1});
    title.textContent='I’m listening.';subtitle.textContent='attention · memory · response';
    notify('WULAN · LISTENING');
    setTimeout(()=>{
      if(visualState==='listening')visualState='thinking';
      state.textContent='THINKING';
      title.textContent='I’m thinking.';subtitle.textContent='following the thread · finding context';
    },650);
    setTimeout(()=>{
      if(visualState==='thinking')visualState='idle';
      state.textContent='READY';threads.textContent=String(activeAgents.size).padStart(2,'0');
      title.textContent='Wulan is here.';subtitle.textContent='memory · agents · projects · tools · devices';
      notify('CORE READY · AI GATEWAY NOT CONNECTED');
    },1800);
  }

  core.events.on(WULAN_EVENTS.SYSTEM_READY,event=>{
    coreStatus.textContent='READY';state.textContent='READY';
    document.getElementById('agent-count').textContent=String(event.payload.agents.length).padStart(2,'0');
    focusMeta.textContent='Core runtime online';
    title.textContent='Wulan is here.';subtitle.textContent='memory · agents · projects · tools · devices';
    notify('WULAN CORE · ONLINE');
  });
  core.events.on(WULAN_EVENTS.AGENT_STARTED,event=>{
    activeAgents.add(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');
    visualState='acting';activity=1;ripples.push({...center(),r:8,speed:4.8,life:1});
    notify(`${event.payload.agentId.toUpperCase()} · ACTIVE`);
  });
  core.events.on(WULAN_EVENTS.AGENT_FINISHED,event=>{
    activeAgents.delete(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');
    activity=.7;ripples.push({...center(),r:12,speed:3.8,life:.8});
    visualState=activeAgents.size?'acting':'idle';
    notify(`${event.payload.agentId.toUpperCase()} · COMPLETE`);
  });
  core.events.on(WULAN_EVENTS.AGENT_FAILED,event=>{
    activeAgents.delete(event.payload.agentId);visualState='error';activity=1;notify(`${event.payload.agentId.toUpperCase()} · ERROR`);
    setTimeout(()=>{visualState='idle';},900);
  });
  core.events.on(WULAN_EVENTS.INTEGRATION_CONNECTED,event=>{activity=.8;notify(`${event.payload.integrationId.toUpperCase()} · CONNECTED`);});

  document.querySelectorAll('.agent-row').forEach(row=>row.addEventListener('click',()=>activateAgent(row.dataset.agent)));
  send?.addEventListener('click',submit);
  input?.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
  voice?.addEventListener('click',()=>{visualState='listening';activity=.7;notify('VOICE LAYER · READY FOR INTEGRATION');});
  canvas.addEventListener('mousemove',pointerMove);
  canvas.addEventListener('mouseleave',()=>{hover=null;pointer.active=false;hideInspector();});
  canvas.addEventListener('click',pointerDown);
  addEventListener('resize',resize);
  document.querySelectorAll('.rail-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.rail-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');activity=.55;notify(btn.dataset.view.toUpperCase()+' LAYER · FOCUS CHANGED');
  }));

  resize();
  draw();
  core.boot();
})();
