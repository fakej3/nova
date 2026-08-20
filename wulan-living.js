import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';

(() => {
  const core = createDefaultWulanCore();
  const $ = (s) => document.querySelector(s);
  const canvas = $('#nova-canvas');
  const ctx = canvas.getContext('2d');
  const input = $('#nova-input');
  const composer = $('#composer');
  const voice = $('#voice');
  const messages = $('#messages');
  const presence = $('.presence-core');
  const presenceText = $('#presence-text');
  const activityState = $('#activity-state');
  const activityLine = $('#activity-line');
  const headline = $('#headline');
  const subline = $('#subline');
  const memoryLabel = $('#memory-label');
  const agentsLabel = $('#agents-label');
  const memoryHint = $('#memory-hint');
  const providerHint = $('#provider-hint');

  let w=0,h=0,dpr=1,t=0,state='idle',pointer={x:0,y:0,active:false};
  const particles=[]; const threads=[]; const memories=[];
  for(let i=0;i<70;i++) particles.push({a:Math.random()*Math.PI*2,r:.15+Math.random()*.9,s:.0002+Math.random()*.0007,sz:.5+Math.random()*1.4,p:Math.random()*6.28});
  for(let i=0;i<18;i++) threads.push({a:i/18*Math.PI*2,phase:Math.random()*6.28,s:.15+Math.random()*.18});

  function resize(){dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);pointer.x=w/2;pointer.y=h*.54}
  addEventListener('resize',resize);resize();
  const c=()=>({x:w/2,y:h*.54}); const scale=()=>Math.min(w,h);
  const energy=()=>({idle:.08,listening:.28,thinking:.72,remembering:.5,acting:.9,learning:.62,error:.2}[state]??.1);
  function point(a,r,phase=0){const q=c();const e=energy();const wob=Math.sin(a*3+t*.45+phase)*.035+Math.sin(a*7-t*.3)*.018;const rr=r+wob+Math.sin(t*1.3+phase)*(.008+e*.01);return{x:q.x+Math.cos(a)*scale()*.30*rr,y:q.y+Math.sin(a)*scale()*.13*rr}}

  function draw(){
    ctx.clearRect(0,0,w,h);const q=c(),e=energy();
    const bg=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,scale()*.62);bg.addColorStop(0,`rgba(71,174,255,${.08+e*.05})`);bg.addColorStop(.45,'rgba(46,67,130,.025)');bg.addColorStop(1,'transparent');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    particles.forEach(p=>{p.a+=p.s*(state==='thinking'?2.4:1);const z=point(p.a,p.r+Math.sin(t*.2+p.p)*.015,p.p);const near=pointer.active?Math.max(0,1-Math.hypot(z.x-pointer.x,z.y-pointer.y)/(scale()*.28)):0;ctx.fillStyle=`rgba(164,220,255,${(.05+e*.1)*(.45+.55*Math.sin(t+p.p)**2)*(1+near)})`;ctx.beginPath();ctx.arc(z.x,z.y,p.sz*(1+near),0,6.283);ctx.fill()});
    threads.forEach((th,i)=>{const a=th.a+t*th.s*.02,inner=point(a,.12,i),mid=point(a+.18*Math.sin(t*.2+th.phase),.45,i+2),out=point(a+.38*Math.sin(t*.13+th.phase),.98,i+4);ctx.beginPath();ctx.moveTo(inner.x,inner.y);ctx.quadraticCurveTo(mid.x,mid.y,out.x,out.y);ctx.strokeStyle=`rgba(${i%3===0?'121,226,255':i%3===1?'151,127,255':'111,229,180'},${.025+e*.025})`;ctx.lineWidth=.55;ctx.stroke()});
    const rx=scale()*.105*(1+Math.sin(t*1.6)*.05+e*.06),ry=scale()*.045*(1+Math.sin(t*1.1)*.05+e*.05);
    for(let ring=0;ring<4;ring++){ctx.beginPath();for(let i=0;i<=120;i++){const a=i/120*6.283,wob=.025*Math.sin(a*(3+ring)+t*1.1)+.014*Math.cos(a*7-t*.8),x=q.x+Math.cos(a)*(rx*(1+ring*.15)+wob*scale()),y=q.y+Math.sin(a)*(ry*(1+ring*.17)+wob*.42*scale());i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.closePath();ctx.strokeStyle=`rgba(121,232,255,${.11-ring*.018+e*.03})`;ctx.lineWidth=ring?.55:.95;ctx.stroke()}
    const glow=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,rx*2.7);glow.addColorStop(0,`rgba(111,227,255,${.13+e*.09})`);glow.addColorStop(.3,'rgba(100,130,255,.045)');glow.addColorStop(1,'transparent');ctx.fillStyle=glow;ctx.fillRect(q.x-rx*3,q.y-ry*4,rx*6,ry*8);
    const eyeW=state==='thinking'?rx*1.5:rx*.8;ctx.beginPath();ctx.ellipse(q.x,q.y,eyeW,Math.max(4,ry*.34),0,0,6.283);ctx.fillStyle='rgba(3,7,13,.75)';ctx.fill();ctx.strokeStyle=`rgba(181,239,255,${.22+e*.15})`;ctx.stroke();ctx.beginPath();ctx.arc(q.x,q.y,3+e*3+Math.sin(t*2)*1.2,0,6.283);ctx.fillStyle='#d8f8ff';ctx.shadowBlur=20;ctx.shadowColor='#79e8ff';ctx.fill();ctx.shadowBlur=0;
    if(pointer.active){const g=ctx.createRadialGradient(pointer.x,pointer.y,0,pointer.x,pointer.y,scale()*.16);g.addColorStop(0,`rgba(121,232,255,${.035*energy()})`);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(pointer.x-scale()*.16,pointer.y-scale()*.16,scale()*.32,scale()*.32)}
    requestAnimationFrame(draw);t+=.012;
  }
  draw();

  function setState(next,line){state=next;presence.classList.toggle('active',next==='listening'||next==='acting');presence.classList.toggle('thinking',next==='thinking'||next==='learning');presenceText.textContent=next.toUpperCase();activityState.textContent=next.toUpperCase();activityLine.textContent=line||'Listening for you.';const copy={idle:["I'm here.",'quiet · aware · waiting'],listening:["I'm listening.",'with you · right now'],thinking:["Let me think.",'connecting what I know'],remembering:["I remember.",'looking through memory'],acting:["On it.",'working on your request'],learning:["I'm learning.",'feedback becomes experience'],error:["Something broke.",'recovering safely']}[next]||["I'm here.",''];headline.textContent=copy[0];subline.textContent=copy[1]}
  function addMessage(who,text){const el=document.createElement('div');el.className='message '+who;const name=document.createElement('span');name.className='message-name';name.textContent=who==='user'?'YOU':'WULAN';const p=document.createElement('p');p.textContent=text;el.append(name,p);messages.appendChild(el);messages.scrollTop=messages.scrollHeight}
  function localReply(text){const s=text.toLowerCase();if(/hello|hi|hey|bro/.test(s))return "Hey. I'm right here. What are we building?";if(/who are you|what are you/.test(s))return "I'm Wulan — the personal layer we're building around your tools, memory and future AI providers.";if(/remember|memory/.test(s))return memories.length?`I have ${memories.length} new local memory entries from this session.`:"Memory is ready. Tell me what you want me to keep.";if(/sentinel/.test(s))return "Sentinel is registered as an integration. The real interface can be connected later without changing my core.";if(/edgelab|edge lab/.test(s))return "EdgeLab is registered too. We can connect it as a capability without changing Wulan's core.";if(/learn|learning/.test(s))return "The learning store is live. Right now it records feedback; the model/provider layer can be connected later.";if(/project|build/.test(s))return "I'm ready. Give me the next thing and I'll keep it in context.";return `I heard you: “${text}”. My local brain is online, but no production model is connected yet. The AI gateway is ready for one.`}
  async function sendMessage(text){text=text.trim();if(!text)return;addMessage('user',text);core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text});setState('thinking','processing your message');const memory=core.remember({content:text,source:'conversation',tags:['session']});memories.push(memory);memoryLabel.querySelector('b').textContent=String(memories.length);memoryHint.textContent=`memory · ${memories.length} this session`;await new Promise(r=>setTimeout(r,420+Math.random()*500));let reply;try{reply=await core.ai.generate({messages:[{role:'user',content:text}],system:'You are Wulan, a personal AI OS. Be concise and warm.'})}catch{reply=localReply(text)}setState('acting','responding to you');await new Promise(r=>setTimeout(r,180));addMessage('wulan',typeof reply==='string'?reply:(reply?.text||reply?.content||localReply(text)));core.recordFeedback({type:'conversation',signal:'useful',input:text});setState('idle','Listening for you.');input.focus()}
  composer.addEventListener('submit',e=>{e.preventDefault();const text=input.value;input.value='';sendMessage(text)});
  presence.addEventListener('click',()=>{setState('listening',"I'm listening");input.focus();setTimeout(()=>{if(state==='listening')setState('idle','Listening for you.')},3000)});
  document.addEventListener('pointermove',e=>{pointer.x=e.clientX;pointer.y=e.clientY;pointer.active=true});document.addEventListener('pointerleave',()=>pointer.active=false);
  voice.addEventListener('click',()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){addMessage('wulan','Voice input is not available in this browser. Text is ready.');return}const rec=new SR();rec.lang=navigator.language||'en-IN';rec.interimResults=false;setState('listening','Listening to your voice…');rec.onresult=e=>{input.value=e.results[0][0].transcript;const text=input.value;input.value='';sendMessage(text)};rec.onerror=()=>setState('idle','Listening for you.');rec.onend=()=>{if(state==='listening')setState('idle','Listening for you.')};rec.start()});
  document.querySelectorAll('.quick button').forEach(btn=>btn.addEventListener('click',()=>{const a=btn.dataset.action;const lines={memory:'Memory is awake. Tell me what matters.',agents:'Four agents are registered: Atlas, Leon, Oracle and Pixel.',projects:'Projects will become a contextual workspace, not another dashboard.',systems:'Sentinel, EdgeLab and GitHub are registered integrations.'};addMessage('wulan',lines[a]);setState('remembering',a+' context opened');setTimeout(()=>setState('idle','Listening for you.'),1600)}));
  core.events.on(WULAN_EVENTS.SYSTEM_READY,()=>{activityLine.textContent='Core online. I am ready.';providerHint.textContent=core.ai.listProviders().length?'AI gateway · connected':'AI gateway · waiting for provider'});
  core.boot();agentsLabel.querySelector('b').textContent=String(core.state.agents.size);setState('idle','Core online. Listening for you.');
  const clock=$('#clock');const tick=()=>clock.textContent=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});tick();setInterval(tick,1000);
})();
