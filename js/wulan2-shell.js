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

  const nodes = [
    { id:'wulan', label:'WULAN', type:'core', angle:0, orbit:0, radius:0, meta:'CORE · PRESENT' },
    { id:'memory', label:'MEMORY', type:'memory', angle:-2.4, orbit:.25, radius:.18, meta:'MEMORY · ACTIVE' },
    { id:'context', label:'CONTEXT', type:'memory', angle:1.7, orbit:.22, radius:.20, meta:'CONTEXT · LOCAL' },
    { id:'atlas', label:'ATLAS', type:'agent', angle:-.65, orbit:.27, radius:.30, meta:'AGENT · RESEARCH' },
    { id:'leon', label:'LEON', type:'agent', angle:.75, orbit:.30, radius:.32, meta:'AGENT · BUILD' },
    { id:'oracle', label:'ORACLE', type:'agent', angle:2.45, orbit:.31, radius:.31, meta:'AGENT · ANALYSIS' },
    { id:'pixel', label:'PIXEL', type:'agent', angle:3.55, orbit:.26, radius:.29, meta:'AGENT · CREATIVE' },
    { id:'projects', label:'PROJECTS', type:'data', angle:-1.55, orbit:.34, radius:.42, meta:'CONTEXT · PROJECTS' },
    { id:'tools', label:'TOOLS', type:'data', angle:.12, orbit:.35, radius:.43, meta:'SYSTEM · TOOLS' },
    { id:'devices', label:'DEVICES', type:'data', angle:1.65, orbit:.34, radius:.43, meta:'DEVICE · LINKED' },
    { id:'sentinel', label:'SENTINEL', type:'integration', angle:2.9, orbit:.34, radius:.45, meta:'INTEGRATION · DORMANT' },
    { id:'edgelab', label:'EDGELAB', type:'integration', angle:-2.8, orbit:.34, radius:.44, meta:'INTEGRATION · DORMANT' },
    { id:'github', label:'GITHUB', type:'integration', angle:3.95, orbit:.36, radius:.46, meta:'INTEGRATION · READY' }
  ];

  const palette = { core:'#74e8ff', agent:'#b59cff', memory:'#71e5b0', data:'#f2c875', integration:'#8194ad' };
  const activeAgents = new Set();
  const particles = [];
  const ripples = [];
  let w=0,h=0,dpr=1,t=0,hover=null,focus=null,activity=0,pointer={x:0,y:0,active:false};

  for(let i=0;i<260;i++){
    const a=Math.random()*Math.PI*2;
    const r=Math.pow(Math.random(),.72);
    particles.push({
      a,r,
      speed:(.0005+Math.random()*.0018)*(Math.random()<.5?-1:1),
      drift:(Math.random()-.5)*.0009,
      size:.35+Math.random()*1.35,
      alpha:.12+Math.random()*.45,
      phase:Math.random()*Math.PI*2
    });
  }

  function resize(){
    dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;
    canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    pointer.x=w/2;pointer.y=h/2;
  }

  function center(){return {x:w*.53,y:h*.51};}
  function nodePos(n){
    const c=center();
    if(n.id==='wulan') return c;
    const breathing=Math.sin(t*(.55+n.orbit*.2)+n.angle)*.012;
    const rr=n.radius+breathing;
    const a=n.angle+t*n.speed;
    return {x:c.x+Math.cos(a)*w*rr*.78,y:c.y+Math.sin(a)*h*rr*.43};
  }
  function find(id){return nodes.find(n=>n.id===id);}
  function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}

  function fieldPoint(angle, radius, layer=1){
    const c=center();
    const wobble=Math.sin(angle*3+t*1.2+layer)*.018+Math.sin(angle*7-t*.7)*.009;
    const r=radius+wobble;
    return {x:c.x+Math.cos(angle)*w*.34*r*layer,y:c.y+Math.sin(angle)*h*.20*r*layer};
  }

  function drawBackground(){
    ctx.clearRect(0,0,w,h);
    const c=center();
    const glow=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,Math.min(w,h)*.48);
    glow.addColorStop(0,'rgba(105,225,255,.13)');
    glow.addColorStop(.24,'rgba(126,137,255,.055)');
    glow.addColorStop(.58,'rgba(70,105,190,.018)');
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);

    particles.forEach((p,i)=>{
      p.a+=p.speed+p.drift;
      const rr=p.r;
      const px=c.x+Math.cos(p.a+t*p.drift*50)*w*(.12+rr*.42);
      const py=c.y+Math.sin(p.a+t*p.drift*50)*h*(.08+rr*.30);
      const pointerForce=pointer.active?Math.max(0,1-distance({x:px,y:py},pointer)/(Math.min(w,h)*.35)):0;
      const twinkle=.55+.45*Math.sin(t*1.7+p.phase);
      ctx.fillStyle=`rgba(150,211,255,${p.alpha*twinkle*(.65+pointerForce*.7)})`;
      ctx.beginPath();ctx.arc(px+(pointer.x-c.x)*pointerForce*.015,py+(pointer.y-c.y)*pointerForce*.015,p.size*(1+pointerForce),0,Math.PI*2);ctx.fill();
    });
  }

  function drawLivingField(){
    const c=center();
    const layers=8;
    for(let layer=0;layer<layers;layer++){
      ctx.beginPath();
      const steps=150;
      for(let i=0;i<=steps;i++){
        const a=(i/steps)*Math.PI*2;
        const base=.72+layer*.035;
        const energy=Math.sin(a*5+t*1.5+layer*.8)*.045+Math.sin(a*9-t*.8)*.025+Math.sin(a*2+t*.35)*.035;
        const p=fieldPoint(a,base+energy,1);
        if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
      }
      ctx.closePath();
      ctx.strokeStyle=`rgba(${layer%2?116:164},${layer%2?225:174},255,${.045+layer*.006})`;
      ctx.lineWidth=.65+(layers-layer)*.06;
      ctx.stroke();
    }

    // Fine neural threads: organic curves rather than a fixed graph.
    for(let i=0;i<26;i++){
      const a=(i/26)*Math.PI*2+t*.015;
      const inner=fieldPoint(a,.12+Math.sin(i+t)*.025,1);
      const outer=fieldPoint(a+.22*Math.sin(t*.4+i),.8+.08*Math.sin(t*.3+i),1);
      const mid=fieldPoint(a+.07,.42+.06*Math.sin(t+i),1);
      ctx.beginPath();ctx.moveTo(inner.x,inner.y);ctx.quadraticCurveTo(mid.x,mid.y,outer.x,outer.y);
      ctx.strokeStyle=`rgba(105,196,255,${.035+activity*.035})`;ctx.lineWidth=.45;ctx.stroke();
    }

    // Central presence: layered breathing aura and moving fragments, not a solid orb.
    const pulse=1+Math.sin(t*2.1)*.035+activity*.08;
    for(let ring=0;ring<5;ring++){
      const r=Math.min(w,h)*(.045+ring*.012)*pulse;
      ctx.beginPath();ctx.ellipse(c.x,c.y,r*1.5,r*.72,Math.sin(t*.25)*.1,0,Math.PI*2);
      ctx.strokeStyle=`rgba(111,225,255,${.08-ring*.012+activity*.03})`;ctx.lineWidth=1;ctx.stroke();
    }
    for(let i=0;i<52;i++){
      const a=i/52*Math.PI*2+t*(.22+(i%3)*.035);
      const r=Math.min(w,h)*(.025+((i*17)%100)/100*.055)*pulse;
      const x=c.x+Math.cos(a)*r*1.6,y=c.y+Math.sin(a)*r*.78;
      ctx.fillStyle=`rgba(150,239,255,${.15+((i%5)/10)+activity*.12})`;
      ctx.beginPath();ctx.arc(x,y,.6+(i%3)*.35,0,Math.PI*2);ctx.fill();
    }
  }

  function drawActivity(){
    activity*=.985;
    const c=center();
    if(activity>.01){
      const r=Math.min(w,h)*(.08+(1-activity)*.32);
      ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(180,151,255,${activity*.28})`;ctx.lineWidth=1.2;ctx.stroke();
    }
    for(let i=ripples.length-1;i>=0;i--){
      const q=ripples[i];q.r+=q.speed;q.life*=.985;
      ctx.beginPath();ctx.arc(q.x,q.y,q.r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(111,225,255,${q.life*.24})`;ctx.lineWidth=1;ctx.stroke();
      if(q.life<.015)ripples.splice(i,1);
    }
  }

  function drawNodes(){
    nodes.filter(n=>n.id!=='wulan').forEach(n=>{
      const p=nodePos(n),c=palette[n.type]||palette.data;
      const selected=focus?.id===n.id,hot=hover?.id===n.id,active=activeAgents.has(n.id);
      const visibility=n.type==='integration'?.48:n.type==='data'?.66:.86;
      const pulse=active?1+Math.sin(t*5)*.16:selected?1.08+Math.sin(t*2)*.05:1+Math.sin(t*1.1+n.angle)*.035;
      const size=(active?7:selected?5.5:4.5)*pulse;
      ctx.save();ctx.globalAlpha=visibility;
      ctx.shadowBlur=active?24:hot?18:10;ctx.shadowColor=c;
      ctx.fillStyle=c;ctx.beginPath();ctx.arc(p.x,p.y,size,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      ctx.strokeStyle=`rgba(210,240,255,${selected||active?.55:.16})`;ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,size+5+Math.sin(t+n.angle)*1.5,0,Math.PI*2);ctx.stroke();
      if(active){
        ctx.strokeStyle=`rgba(181,156,255,${.5+Math.sin(t*4)*.2})`;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(p.x,p.y,size+10+t%1*8,0,Math.PI*2);ctx.stroke();
      }
      ctx.fillStyle=selected||active?'#eaf7ff':'#7d8ca1';ctx.font=(active?'600 8px':'500 7px')+' ui-monospace,monospace';ctx.textAlign='center';ctx.fillText(n.label,p.x,p.y+size+16);
      ctx.restore();
    });
  }

  function draw(){
    t+=.008;
    drawBackground();drawLivingField();drawActivity();drawNodes();
    requestAnimationFrame(draw);
  }

  function notify(text){
    toast.textContent=text;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1700);
  }
  function showInspector(n,x,y){
    inspector.querySelector('.inspector-name').textContent=n.label;
    inspector.querySelector('.inspector-meta').textContent=n.meta;
    inspector.style.left=Math.min(x+16,w-175)+'px';inspector.style.top=Math.min(y+16,h-100)+'px';inspector.classList.add('show');
  }
  function hideInspector(){inspector.classList.remove('show');}
  function nodeAt(x,y){
    let nearest=null,best=Infinity;
    nodes.forEach(n=>{const p=nodePos(n),d=Math.hypot(p.x-x,p.y-y);const threshold=n.id==='wulan'?34:18;if(d<threshold&&d<best){nearest=n;best=d;}});
    return nearest;
  }

  function pointerMove(e){
    const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;
    const n=nodeAt(pointer.x,pointer.y);hover=n;canvas.style.cursor=n?'pointer':'default';if(n)showInspector(n,e.clientX,e.clientY);else hideInspector();
  }

  function activateAgent(agentId){
    const agent=find(agentId);if(!agent)return;
    focus=agent;focusName.textContent=agent.label;focusMeta.textContent=agent.meta;
    core.startAgent(agentId,{reason:'ui-exploration'});
    setTimeout(()=>{if(activeAgents.has(agentId))core.finishAgent(agentId,{reason:'ui-exploration'});},1500);
  }

  function pointerDown(e){
    const r=canvas.getBoundingClientRect();const x=e.clientX-r.left,y=e.clientY-r.top;const n=nodeAt(x,y);
    ripples.push({x,y,r:8,speed:4,life:1});activity=1;
    if(!n){focus=null;focusName.textContent='Wulan World';focusMeta.textContent='Live system overview';return;}
    focus=focus?.id===n.id?null:n;focusName.textContent=focus?focus.label:'Wulan World';focusMeta.textContent=focus?focus.meta:'Live system overview';notify(focus?`${n.label} · ${n.meta}`:'WORLD · OVERVIEW');
    if(n.type==='agent')activateAgent(n.id);
  }

  function submit(){
    const q=input.value.trim();if(!q)return;input.value='';
    core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text:q});
    state.textContent='LISTENING';threads.textContent='01';activity=1;focus=find('wulan');ripples.push({...center(),r:6,speed:5,life:1});
    title.textContent='I’m here.';subtitle.textContent='listening · remembering · ready';notify('WULAN · LISTENING');
    setTimeout(()=>{state.textContent='READY';threads.textContent=String(activeAgents.size).padStart(2,'0');title.textContent='The world is awake.';subtitle.textContent='memory · agents · projects · tools · devices';notify('CORE READY · AI GATEWAY NOT CONNECTED');},1100);
  }

  core.events.on(WULAN_EVENTS.SYSTEM_READY,event=>{
    coreStatus.textContent='READY';state.textContent='READY';document.getElementById('agent-count').textContent=String(event.payload.agents.length).padStart(2,'0');focusMeta.textContent='Core runtime online';title.textContent='The world is awake.';subtitle.textContent='memory · agents · projects · tools · devices';notify('WULAN CORE · ONLINE');
  });
  core.events.on(WULAN_EVENTS.AGENT_STARTED,event=>{
    activeAgents.add(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');activity=1;ripples.push({...center(),r:10,speed:5.5,life:1});notify(`${event.payload.agentId.toUpperCase()} · ACTIVE`);
  });
  core.events.on(WULAN_EVENTS.AGENT_FINISHED,event=>{
    activeAgents.delete(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');activity=.7;ripples.push({...center(),r:15,speed:4,life:.8});notify(`${event.payload.agentId.toUpperCase()} · COMPLETE`);
  });
  core.events.on(WULAN_EVENTS.AGENT_FAILED,event=>{activeAgents.delete(event.payload.agentId);activity=1;notify(`${event.payload.agentId.toUpperCase()} · ERROR`);});
  core.events.on(WULAN_EVENTS.INTEGRATION_CONNECTED,event=>{activity=.8;notify(`${event.payload.integrationId.toUpperCase()} · CONNECTED`);});

  document.querySelectorAll('.agent-row').forEach(row=>row.addEventListener('click',()=>activateAgent(row.dataset.agent)));
  send?.addEventListener('click',submit);input?.addEventListener('keydown',e=>{if(e.key==='Enter')submit});
  voice?.addEventListener('click',()=>{activity=.7;notify('VOICE LAYER · READY FOR INTEGRATION');});
  canvas.addEventListener('mousemove',pointerMove);canvas.addEventListener('mouseleave',()=>{hover=null;pointer.active=false;hideInspector();});canvas.addEventListener('click',pointerDown);addEventListener('resize',resize);
  document.querySelectorAll('.rail-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.rail-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');activity=.55;notify(btn.dataset.view.toUpperCase()+' LAYER · FOCUS CHANGED');}));
  resize();draw();core.boot();
})();
