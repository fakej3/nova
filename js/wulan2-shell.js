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
  const stateEl = document.getElementById('core-state');
  const coreStatus = document.getElementById('core-status');
  const threads = document.getElementById('threads');
  const focusName = document.getElementById('focus-name');
  const focusMeta = document.getElementById('focus-meta');
  const title = document.querySelector('.world-title h1');
  const subtitle = document.querySelector('.world-title p');

  const agents = [
    { id:'atlas', label:'ATLAS', role:'RESEARCH', color:[181,156,255], phase:0.2 },
    { id:'leon', label:'LEON', role:'BUILD', color:[111,225,255], phase:1.8 },
    { id:'oracle', label:'ORACLE', role:'ANALYSIS', color:[242,200,117], phase:3.3 },
    { id:'pixel', label:'PIXEL', role:'CREATIVE', color:[255,131,173], phase:4.7 }
  ];

  const particles = [];
  const tendrils = [];
  const memoryShards = [];
  const activityBursts = [];
  const activeAgents = new Set();
  const palette = { cyan:[111,225,255], violet:[181,156,255], green:[113,229,176] };
  let w=0,h=0,dpr=1,t=0,energy=0,targetEnergy=0,state='idle',pointer={x:0,y:0,active:false};

  for(let i=0;i<360;i++){
    const a=Math.random()*Math.PI*2;
    const r=Math.pow(Math.random(),1.55);
    particles.push({a,r,speed:(.00035+Math.random()*.00135)*(Math.random()<.5?-1:1),drift:(Math.random()-.5)*.0007,size:.35+Math.random()*1.45,alpha:.08+Math.random()*.42,phase:Math.random()*Math.PI*2});
  }
  for(let i=0;i<18;i++) tendrils.push({angle:i/18*Math.PI*2,phase:Math.random()*Math.PI*2,speed:.35+Math.random()*.55,width:.5+Math.random()*1.1});

  function resize(){dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);}
  function center(){return{x:w*.53,y:h*.53};}
  function rgba(c,a){return`rgba(${c[0]},${c[1]},${c[2]},${Math.max(0,a)})`;}
  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
  function setState(next,reason=''){
    state=next;
    const labels={idle:['The world is awake.','quiet · aware · waiting'],listening:['I’m here.','listening · present · remembering'],thinking:['Let me think.','following connections · exploring'],acting:['I’m on it.','working · moving · watching'],remembering:['I remember.','retrieving · connecting · resurfacing'],learning:['I’m learning.','updating · relating · adapting'],error:['Something changed.','isolating · recovering · watching']};
    const label=labels[next]||labels.idle;title.textContent=label[0];subtitle.textContent=label[1];stateEl.textContent=next.toUpperCase();if(reason)notify(`WULAN · ${reason.toUpperCase()}`);
  }

  function drawBackground(){
    ctx.clearRect(0,0,w,h);const c=center();
    const g=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,Math.min(w,h)*(.42+energy*.13));
    g.addColorStop(0,rgba([92,215,255],.10+.07*energy));g.addColorStop(.22,rgba([112,126,255],.055+.035*energy));g.addColorStop(.55,rgba([61,100,190],.018));g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    for(const p of particles){
      p.a+=p.speed+p.drift;const pulse=Math.sin(t*1.3+p.phase)*.5+.5;
      const pull=state==='listening'?.18:state==='thinking'?.08:state==='remembering'?.12:0;
      const rr=Math.max(.02,p.r-pull*(.5+p.r));const px=c.x+Math.cos(p.a+t*p.drift*60)*w*(.08+rr*.45);const py=c.y+Math.sin(p.a+t*p.drift*60)*h*(.055+rr*.34);
      const pointerForce=pointer.active?Math.max(0,1-dist({x:px,y:py},pointer)/(Math.min(w,h)*.28)):0;
      ctx.fillStyle=rgba([142,205,255],p.alpha*(.55+pulse*.55)*(state==='idle'?.75:1)*(1+pointerForce*.8));ctx.beginPath();ctx.arc(px+(pointer.x-c.x)*pointerForce*.025,py+(pointer.y-c.y)*pointerForce*.025,p.size*(1+pointerForce),0,Math.PI*2);ctx.fill();
    }
  }

  function shellPoint(a,r,layer=1){
    const c=center();const wobble=Math.sin(a*3+t*.55+layer)*.045+Math.sin(a*7-t*.35)*.025+Math.sin(a*11+t*.2)*.012;const breathe=1+Math.sin(t*.8+layer)*.018+energy*.035;const rr=r*(1+wobble)*breathe;
    return{x:c.x+Math.cos(a)*w*.32*rr,y:c.y+Math.sin(a)*h*.27*rr};
  }

  function drawLivingMembrane(){
    const c=center();
    for(let layer=0;layer<9;layer++){
      ctx.beginPath();for(let i=0;i<=180;i++){const a=i/180*Math.PI*2;const p=shellPoint(a,.96+layer*.055,layer);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}ctx.closePath();
      ctx.strokeStyle=rgba(layer%2?[105,201,255]:[150,137,255],.025+energy*.012+(layer===4?.012:0));ctx.lineWidth=.45+(8-layer)*.035;ctx.stroke();
    }
    for(const tr of tendrils){
      const a0=tr.angle+t*.018*tr.speed,inner=shellPoint(a0,.12,2),mid=shellPoint(a0+.28*Math.sin(t*.25+tr.phase),.52+.08*Math.sin(t*.45+tr.phase),3),outer=shellPoint(a0+.65,.92+.06*Math.sin(t*.3+tr.phase),4);
      ctx.beginPath();ctx.moveTo(inner.x,inner.y);ctx.bezierCurveTo(mid.x,mid.y,mid.x,mid.y,outer.x,outer.y);ctx.strokeStyle=rgba(state==='thinking'||state==='acting'?palette.cyan:palette.violet,.025+(state==='thinking'||state==='acting'?.055:.018));ctx.lineWidth=tr.width*(state==='thinking'||state==='acting'?1.5:1);ctx.stroke();
    }
    const pulse=1+Math.sin(t*1.8)*.045+energy*.09,innerR=Math.min(w,h)*.065*pulse;
    const cg=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,innerR*2.8);cg.addColorStop(0,rgba(palette.cyan,.16+.06*energy));cg.addColorStop(.35,rgba(palette.violet,.06+.03*energy));cg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=cg;ctx.beginPath();ctx.arc(c.x,c.y,innerR*2.8,0,Math.PI*2);ctx.fill();
    for(let i=0;i<74;i++){const a=i/74*Math.PI*2+t*(.12+(i%4)*.018);const rr=innerR*(.35+((i*37)%100)/100*1.25);const x=c.x+Math.cos(a)*rr*1.55,y=c.y+Math.sin(a)*rr*.72;ctx.fillStyle=rgba(i%5===0?palette.violet:palette.cyan,.08+(i%7)*.035+energy*.08);ctx.beginPath();ctx.arc(x,y,.55+(i%3)*.35,0,Math.PI*2);ctx.fill();}
    const breath=(Math.sin(t*.75)+1)/2;ctx.beginPath();ctx.ellipse(c.x,c.y,innerR*(1.4+breath*.35),innerR*(.7+breath*.18),Math.sin(t*.2)*.12,0,Math.PI*2);ctx.strokeStyle=rgba(palette.cyan,.10+energy*.04);ctx.lineWidth=1;ctx.stroke();
  }

  function drawStateStreams(){
    const c=center();const count=state==='idle'?0:state==='listening'?10:state==='thinking'?30:state==='acting'?22:state==='remembering'?18:state==='learning'?24:6;
    for(let i=0;i<count;i++){
      const phase=i/count*Math.PI*2+t*(state==='thinking'?.38:.18),outward=state==='acting'||state==='thinking',startR=Math.min(w,h)*(.07+((i*13)%50)/100*.04),endR=Math.min(w,h)*(outward?.20+((i*17)%70)/100*.28:.10+((i*19)%60)/100*.18),p=(Math.sin(t*2.2+i*.7)+1)/2;
      const s={x:c.x+Math.cos(phase)*startR*1.4,y:c.y+Math.sin(phase)*startR*.7},e={x:c.x+Math.cos(phase+.25*Math.sin(t+i))*endR*1.4,y:c.y+Math.sin(phase+.25*Math.sin(t+i))*endR*.7};
      ctx.fillStyle=rgba(state==='remembering'?palette.green:state==='acting'?palette.violet:palette.cyan,.12+energy*.16);ctx.beginPath();ctx.arc(s.x+(e.x-s.x)*p,s.y+(e.y-s.y)*p,1+energy*.8,0,Math.PI*2);ctx.fill();
    }
  }

  function drawMemoryShards(){
    for(let i=memoryShards.length-1;i>=0;i--){const m=memoryShards[i];m.life*=.994;m.r+=m.speed;const c=center(),x=c.x+Math.cos(m.a)*m.r*1.4,y=c.y+Math.sin(m.a)*m.r*.75;ctx.save();ctx.translate(x,y);ctx.rotate(m.a+.7);ctx.strokeStyle=rgba(palette.green,m.life*.5);ctx.fillStyle=rgba(palette.green,m.life*.08);ctx.lineWidth=.8;ctx.beginPath();ctx.roundRect(-8,-4,16,8,3);ctx.fill();ctx.stroke();ctx.restore();if(m.life<.03)memoryShards.splice(i,1);}
  }

  function drawAgentPresence(){
    const c=center();agents.forEach((a,index)=>{const active=activeAgents.has(a.id);if(!active&&state==='idle')return;const angle=a.phase+t*(active?.16:.035),radius=Math.min(w,h)*(.18+index*.045+(active?.035:0)),x=c.x+Math.cos(angle)*radius*1.45,y=c.y+Math.sin(angle)*radius*.72,col=a.color;ctx.save();for(let k=0;k<3;k++){ctx.beginPath();ctx.arc(x,y,4+k*5+Math.sin(t*2+a.phase)*1.2,0,Math.PI*2);ctx.strokeStyle=rgba(col,(active?.18:.05)-k*.018);ctx.lineWidth=.8;ctx.stroke();}ctx.fillStyle=rgba(col,active?.8:.18);ctx.shadowBlur=active?18:7;ctx.shadowColor=rgba(col,1);ctx.beginPath();ctx.arc(x,y,active?2.4:1.2,0,Math.PI*2);ctx.fill();ctx.restore();if(active){ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(c.x,c.y,c.x,c.y);ctx.strokeStyle=rgba(col,.10);ctx.lineWidth=.7;ctx.stroke();}});
  }

  function drawBursts(){
    for(let i=activityBursts.length-1;i>=0;i--){const b=activityBursts[i];b.r+=b.speed;b.life*=.975;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.strokeStyle=rgba(b.color,b.life*.3);ctx.lineWidth=1;ctx.stroke();if(b.life<.02)activityBursts.splice(i,1);}
  }
  function draw(){t+=.01;energy+=(targetEnergy-energy)*.035;targetEnergy*=.994;drawBackground();drawLivingMembrane();drawStateStreams();drawMemoryShards();drawAgentPresence();drawBursts();requestAnimationFrame(draw);}
  function notify(text){toast.textContent=text;toast.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.classList.remove('show'),1700);}
  function showInspector(text,meta,x,y){inspector.querySelector('.inspector-name').textContent=text;inspector.querySelector('.inspector-meta').textContent=meta;inspector.style.left=Math.min(x+16,w-175)+'px';inspector.style.top=Math.min(y+16,h-100)+'px';inspector.classList.add('show');}
  function hideInspector(){inspector.classList.remove('show');}
  function pointerMove(e){const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;if(state==='idle')targetEnergy=Math.max(targetEnergy,.22);showInspector('WULAN','PRESENT · AWARE',e.clientX,e.clientY);}
  function pointerDown(e){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;pointer.x=x;pointer.y=y;pointer.active=true;targetEnergy=1;activityBursts.push({x,y,r:8,speed:5,life:1,color:palette.cyan});setState('listening','interaction detected');setTimeout(()=>{if(state==='listening')setState('idle');},900);}
  function activateAgent(agentId){const agent=agents.find(a=>a.id===agentId);if(!agent)return;focusName.textContent=agent.label;focusMeta.textContent=`AGENT · ${agent.role}`;setState('acting',`${agent.label} active`);activeAgents.add(agentId);targetEnergy=1;activityBursts.push({...center(),r:12,speed:6,life:1,color:agent.color});core.startAgent(agentId,{reason:'ui-exploration'});setTimeout(()=>{if(activeAgents.has(agentId))core.finishAgent(agentId,{reason:'ui-exploration'});},1800);}
  function submit(){const q=input.value.trim();if(!q)return;input.value='';core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text:q});setState('thinking','thinking');focusName.textContent='Wulan';focusMeta.textContent='PROCESS · CONVERSATION';threads.textContent='01';targetEnergy=1;activityBursts.push({...center(),r:6,speed:4.5,life:1,color:palette.cyan});setTimeout(()=>{if(state==='thinking'){state='remembering';stateEl.textContent='REMEMBERING';title.textContent='I’m connecting that.';subtitle.textContent='context · memory · relationships';for(let i=0;i<6;i++)memoryShards.push({a:i/6*Math.PI*2+Math.random()*.4,r:35+Math.random()*15,speed:1.8+Math.random()*1.4,life:1});}},650);setTimeout(()=>{if(state==='remembering'){setState('idle');threads.textContent=String(activeAgents.size).padStart(2,'0');}},1700);}

  core.events.on(WULAN_EVENTS.SYSTEM_READY,event=>{coreStatus.textContent='READY';stateEl.textContent='READY';document.getElementById('agent-count').textContent=String(event.payload.agents.length).padStart(2,'0');focusMeta.textContent='Core runtime online';setState('idle');notify('WULAN CORE · ONLINE');});
  core.events.on(WULAN_EVENTS.AGENT_STARTED,event=>{activeAgents.add(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');targetEnergy=1;});
  core.events.on(WULAN_EVENTS.AGENT_FINISHED,event=>{activeAgents.delete(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');targetEnergy=.35;if(activeAgents.size===0&&state==='acting')setState('idle');});
  core.events.on(WULAN_EVENTS.AGENT_FAILED,event=>{activeAgents.delete(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');setState('error',`${event.payload.agentId} error`);setTimeout(()=>setState('idle'),1200);});

  document.querySelectorAll('.agent-row').forEach(row=>row.addEventListener('click',()=>activateAgent(row.dataset.agent)));
  send?.addEventListener('click',submit);input?.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});voice?.addEventListener('click',()=>{setState('listening','voice layer ready');targetEnergy=1;});
  canvas.addEventListener('mousemove',pointerMove);canvas.addEventListener('mouseleave',()=>{pointer.active=false;hideInspector();});canvas.addEventListener('click',pointerDown);addEventListener('resize',resize);
  document.querySelectorAll('.rail-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.rail-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');setState('listening',`${btn.dataset.view} layer`);setTimeout(()=>setState('idle'),850);}));
  resize();draw();core.boot();
})();
