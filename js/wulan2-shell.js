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

  const nodes = [
    { id:'wulan', label:'WULAN', type:'core', x:.50, y:.49, r:34, meta:'CORE · ONLINE' },
    { id:'memory', label:'MEMORY', type:'memory', x:.34, y:.34, r:15, meta:'LOCAL · PERSISTENT' },
    { id:'atlas', label:'ATLAS', type:'agent', x:.69, y:.30, r:17, meta:'AGENT · RESEARCH' },
    { id:'leon', label:'LEON', type:'agent', x:.72, y:.60, r:17, meta:'AGENT · BUILD' },
    { id:'oracle', label:'ORACLE', type:'agent', x:.28, y:.63, r:17, meta:'AGENT · ANALYSIS' },
    { id:'pixel', label:'PIXEL', type:'agent', x:.42, y:.20, r:13, meta:'AGENT · CREATIVE' },
    { id:'projects', label:'PROJECTS', type:'data', x:.53, y:.20, r:12, meta:'CONTEXT · PROJECTS' },
    { id:'tools', label:'TOOLS', type:'data', x:.83, y:.45, r:12, meta:'SYSTEM · TOOLS' },
    { id:'context', label:'CONTEXT', type:'memory', x:.40, y:.76, r:12, meta:'MEMORY · CONTEXT' },
    { id:'devices', label:'DEVICES', type:'data', x:.63, y:.80, r:12, meta:'DEVICE · LINKED' },
    { id:'sentinel', label:'SENTINEL', type:'integration', x:.84, y:.67, r:11, meta:'INTEGRATION · DORMANT' },
    { id:'edgelab', label:'EDGELAB', type:'integration', x:.19, y:.34, r:11, meta:'INTEGRATION · DORMANT' },
    { id:'github', label:'GITHUB', type:'integration', x:.19, y:.76, r:11, meta:'INTEGRATION · READY' }
  ];
  const links = [['wulan','memory'],['wulan','atlas'],['wulan','leon'],['wulan','oracle'],['wulan','pixel'],['wulan','projects'],['wulan','tools'],['wulan','context'],['wulan','devices'],['memory','context'],['atlas','projects'],['leon','tools'],['oracle','devices'],['leon','github'],['oracle','sentinel'],['atlas','edgelab'],['sentinel','tools'],['edgelab','projects']];
  const palette = { core:'#6fe1ff', agent:'#ad91ff', memory:'#6fe0ae', data:'#efbf70', integration:'#7e91ad' };
  const activeAgents = new Set();
  let w=0,h=0,dpr=1,t=0,hover=null,focus=null,activityPulse=0;

  function resize(){dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0)}
  function pos(n){return{x:n.x*w,y:n.y*h}}
  function dist(a,b,x,y){const dx=a-x,dy=b-y;return Math.sqrt(dx*dx+dy*dy)}
  function find(id){return nodes.find(n=>n.id===id)}

  function draw(){
    ctx.clearRect(0,0,w,h);t+=.006;activityPulse*=.985;
    const g=ctx.createRadialGradient(w*.5,h*.49,0,w*.5,h*.49,Math.min(w,h)*.43);g.addColorStop(0,'rgba(111,225,255,.09)');g.addColorStop(.42,'rgba(111,225,255,.025)');g.addColorStop(1,'rgba(111,225,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    ctx.save();ctx.translate(w*.5,h*.49);ctx.rotate(t*.025);[.20,.29,.39].forEach((r,i)=>{ctx.beginPath();ctx.ellipse(0,0,w*r,h*r*.35,0,0,Math.PI*2);ctx.strokeStyle=`rgba(111,225,255,${.045-i*.009})`;ctx.setLineDash([2,12+i*5]);ctx.lineWidth=.7;ctx.stroke()});ctx.restore();ctx.setLineDash([]);
    links.forEach(([a,b],i)=>{
      const A=pos(find(a)),B=pos(find(b)); const involved=focus&&(a===focus.id||b===focus.id); const active=activeAgents.has(a)||activeAgents.has(b); const wave=(Math.sin(t*1.7+i*.72)+1)/2;
      ctx.lineWidth=involved||active?1.35:.7;ctx.strokeStyle=involved?`rgba(111,225,255,${.28+wave*.25})`:active?`rgba(173,145,255,${.20+wave*.22})`:`rgba(111,225,255,${.055+wave*.065})`;
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();
      if(involved||active||!focus){const q=(t*.22+i*.083)%1;const px=A.x+(B.x-A.x)*q,py=A.y+(B.y-A.y)*q;ctx.fillStyle=active?'rgba(173,145,255,.9)':'rgba(111,225,255,.48)';ctx.shadowBlur=active?10:5;ctx.shadowColor=ctx.fillStyle;ctx.beginPath();ctx.arc(px,py,active?2:1.2,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}
    });
    nodes.forEach(n=>{const p=pos(n),c=palette[n.type]||palette.data,selected=focus?.id===n.id,hot=hover?.id===n.id,active=activeAgents.has(n.id);const breathe=n.type==='core'?Math.sin(t*2.1)*2.4:Math.sin(t*1.2+n.x*8)*.7;const radius=n.r+breathe+(selected?3:0)+(active?2:0);ctx.shadowBlur=n.type==='core'?38:active?30:selected?25:13;ctx.shadowColor=c;ctx.globalAlpha=n.type==='integration'?.65:.92;ctx.fillStyle=c;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.globalAlpha=1;ctx.fillStyle='#07101a';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,radius-4),0,Math.PI*2);ctx.fill();if(n.type==='core'){ctx.strokeStyle='rgba(255,255,255,.38)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,radius+9+Math.sin(t*2)*2,0,Math.PI*2);ctx.stroke()}if(hot){ctx.strokeStyle='rgba(255,255,255,.65)';ctx.lineWidth=.8;ctx.beginPath();ctx.arc(p.x,p.y,radius+6,0,Math.PI*2);ctx.stroke()}ctx.fillStyle=selected||active?'#e8f6ff':'#8494aa';ctx.font=(n.type==='core'?'600 9px':'500 7px')+' ui-monospace,monospace';ctx.textAlign='center';ctx.fillText(n.label,p.x,p.y+radius+14)});
    if(activityPulse>.01){const r=Math.min(w,h)*(.12+activityPulse*.28);ctx.strokeStyle=`rgba(173,145,255,${activityPulse*.18})`;ctx.lineWidth=1;ctx.beginPath();ctx.arc(w*.5,h*.49,r,0,Math.PI*2);ctx.stroke()}
    requestAnimationFrame(draw);
  }

  function notify(text){toast.textContent=text;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1700)}
  function showInspector(n,x,y){inspector.querySelector('.inspector-name').textContent=n.label;inspector.querySelector('.inspector-meta').textContent=n.meta;inspector.style.left=Math.min(x+16,w-175)+'px';inspector.style.top=Math.min(y+16,h-100)+'px';inspector.classList.add('show')}
  function hideInspector(){inspector.classList.remove('show')}
  function nodeAt(x,y){for(let i=nodes.length-1;i>=0;i--){const n=nodes[i],p=pos(n);if(dist(p.x,p.y,x,y)<n.r+10)return n}return null}
  function pointerMove(e){const r=canvas.getBoundingClientRect(),n=nodeAt(e.clientX-r.left,e.clientY-r.top);hover=n;canvas.style.cursor=n?'pointer':'default';if(n)showInspector(n,e.clientX,e.clientY);else hideInspector()}
  function pointerDown(e){const r=canvas.getBoundingClientRect(),n=nodeAt(e.clientX-r.left,e.clientY-r.top);if(!n)return;focus=focus?.id===n.id?null:n;focusName.textContent=focus?focus.label:'Wulan World';focusMeta.textContent=focus?focus.meta:'Live system overview';notify(focus?`${n.label} · ${n.meta}`:'WORLD · OVERVIEW')}

  function submit(){
    const q=input.value.trim();if(!q)return;input.value='';
    core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text:q});
    state.textContent='PROCESSING';threads.textContent='01';activityPulse=1;focus=find('wulan');notify('REQUEST ACCEPTED · WULAN CORE');
    setTimeout(()=>{state.textContent='READY';threads.textContent='00';notify('CORE READY · AI GATEWAY NOT CONNECTED')},1100);
  }

  core.events.on(WULAN_EVENTS.SYSTEM_READY, event=>{
    coreStatus.textContent='READY';state.textContent='READY';document.getElementById('agent-count').textContent=String(event.payload.agents.length).padStart(2,'0');focusMeta.textContent='Core runtime online';notify('WULAN CORE · ONLINE');
  });
  core.events.on(WULAN_EVENTS.AGENT_STARTED, event=>{activeAgents.add(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');activityPulse=1;notify(`${event.payload.agentId.toUpperCase()} · ACTIVE`)});
  core.events.on(WULAN_EVENTS.AGENT_FINISHED, event=>{activeAgents.delete(event.payload.agentId);threads.textContent=String(activeAgents.size).padStart(2,'0');activityPulse=.7;notify(`${event.payload.agentId.toUpperCase()} · COMPLETE`)});
  core.events.on(WULAN_EVENTS.INTEGRATION_CONNECTED, event=>{activityPulse=.8;notify(`${event.payload.integrationId.toUpperCase()} · CONNECTED`)});

  document.querySelectorAll('.agent-row').forEach(row=>row.addEventListener('click',()=>{
    const agentId=row.dataset.agent;focus=find(agentId);focusName.textContent=focus.label;focusMeta.textContent=focus.meta;
    core.events.emit(WULAN_EVENTS.AGENT_STARTED,{agentId,reason:'ui-exploration'});
    setTimeout(()=>core.events.emit(WULAN_EVENTS.AGENT_FINISHED,{agentId,reason:'ui-exploration'}),900);
  }));
  send?.addEventListener('click',submit);input?.addEventListener('keydown',e=>{if(e.key==='Enter')submit()});voice?.addEventListener('click',()=>notify('VOICE LAYER · READY FOR INTEGRATION'));canvas.addEventListener('mousemove',pointerMove);canvas.addEventListener('mouseleave',()=>{hover=null;hideInspector()});canvas.addEventListener('click',pointerDown);addEventListener('resize',resize);
  document.querySelectorAll('.rail-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.rail-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');notify(btn.dataset.view.toUpperCase()+' LAYER SELECTED')}));
  resize();draw();core.boot();
})();
