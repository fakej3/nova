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

  let w=0,h=0,dpr=1,t=0,state='idle';
  const pointer={x:0,y:0,active:false};
  const particles=[];
  const tendrils=[];
  const sparks=[];

  for(let i=0;i<180;i++) particles.push({a:Math.random()*Math.PI*2,r:.08+Math.random()*.95,phase:Math.random()*6.28,speed:.15+Math.random()*.7,size:.35+Math.random()*1.5});
  for(let i=0;i<42;i++) tendrils.push({angle:i/42*Math.PI*2+Math.random()*.08,len:.55+Math.random()*.6,width:.5+Math.random()*1.5,phase:Math.random()*6.28,speed:.15+Math.random()*.45,curve:(Math.random()-.5)*.7});
  for(let i=0;i<28;i++) sparks.push({a:Math.random()*6.28,r:.1+Math.random()*.55,phase:Math.random()*6.28,speed:.4+Math.random()*1.2});

  function resize(){dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);pointer.x=w/2;pointer.y=h*.53}
  addEventListener('resize',resize);resize();
  const center=()=>({x:w/2,y:h*.53});
  const S=()=>Math.min(w,h);
  const energy=()=>({idle:.18,listening:.42,thinking:.9,remembering:.58,acting:1,learning:.72,error:.25}[state]??.2);

  function organicPoint(angle,r,phase=0){
    const q=center(), e=energy();
    const pulse=1+Math.sin(t*1.35+phase)*(.025+e*.025);
    const breathing=1+Math.sin(t*.58+phase*.3)*.045;
    const noise=Math.sin(angle*3.1+t*.38+phase)*.045+Math.sin(angle*7.7-t*.21+phase*2)*.018;
    const rr=r*(pulse+noise)*breathing;
    const squeeze=1+Math.sin(t*.27+phase)*.035;
    return {x:q.x+Math.cos(angle)*S()*.27*rr*squeeze,y:q.y+Math.sin(angle)*S()*.19*rr};
  }

  function drawTendril(th,index,e){
    const q=center();
    const a=th.angle+t*th.speed*.018;
    const steps=42;
    ctx.beginPath();
    for(let j=0;j<=steps;j++){
      const p=j/steps;
      const curl=Math.sin(p*4.8+th.phase+t*(.35+e*.7))*.12*p*p;
      const sway=Math.sin(t*.42+th.phase+p*3)*.025*p;
      const rr=.07+p*th.len+sway;
      const pt=organicPoint(a+curl+th.curve*p*p,rr,th.phase);
      if(j===0)ctx.moveTo(pt.x,pt.y);else ctx.lineTo(pt.x,pt.y);
    }
    const alpha=.035+e*.045*(index%4===0?1.5:1);
    ctx.strokeStyle=index%3===0?`rgba(104,226,255,${alpha})`:index%3===1?`rgba(157,137,255,${alpha*.8})`:`rgba(109,230,190,${alpha*.72})`;
    ctx.lineWidth=th.width*(.65+e*.5);
    ctx.stroke();
  }

  function draw(){
    ctx.clearRect(0,0,w,h);
    const q=center(),e=energy(),size=S();
    const bg=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,size*.55);
    bg.addColorStop(0,`rgba(62,150,255,${.055+e*.055})`);bg.addColorStop(.34,`rgba(68,92,180,${.025+e*.018})`);bg.addColorStop(1,'transparent');
    ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);

    // A quiet field of motes: they drift inward and outward instead of sitting on static rings.
    particles.forEach((p,i)=>{
      p.a += .0007*p.speed*(state==='thinking'?3.5:1);
      const breathe=Math.sin(t*.34+p.phase)*.035;
      const pt=organicPoint(p.a,p.r+breathe,p.phase);
      const d=Math.hypot(pt.x-pointer.x,pt.y-pointer.y);
      const attraction=pointer.active?Math.max(0,1-d/(size*.3)):0;
      const pulse=(Math.sin(t*(.8+p.speed)+p.phase)+1)/2;
      ctx.beginPath();ctx.arc(pt.x,pt.y,p.size*(.7+pulse*.7+attraction),0,6.283);
      ctx.fillStyle=`rgba(167,226,255,${.035+e*.06+attraction*.18})`;ctx.fill();
    });

    // The presence is a network of living filaments, not a fixed orbit diagram.
    tendrils.forEach((th,i)=>drawTendril(th,i,e));

    // Moving impulses travel through the filaments.
    sparks.forEach((s,i)=>{
      s.a+=.002*s.speed*(state==='thinking'?2.8:1);
      const pt=organicPoint(s.a,s.r+Math.sin(t*.8+s.phase)*.035,s.phase);
      const glow=ctx.createRadialGradient(pt.x,pt.y,0,pt.x,pt.y,9+e*8);
      glow.addColorStop(0,`rgba(205,248,255,${.5+e*.25})`);glow.addColorStop(1,'transparent');
      ctx.fillStyle=glow;ctx.fillRect(pt.x-14,pt.y-14,28,28);
      ctx.beginPath();ctx.arc(pt.x,pt.y,1.1+e*.9,0,6.283);ctx.fillStyle='#c9f6ff';ctx.fill();
    });

    // Soft, asymmetrical living membrane.
    for(let layer=0;layer<5;layer++){
      ctx.beginPath();
      const n=150;
      for(let i=0;i<=n;i++){
        const a=i/n*6.283;
        const base=.12+layer*.055;
        const wob=.028*Math.sin(a*(3+layer*.7)+t*(.5+layer*.08))+ .017*Math.sin(a*8-t*.32+layer);
        const rr=base+wob;
        const x=q.x+Math.cos(a)*size*.55*rr/.18;
        const y=q.y+Math.sin(a)*size*.38*rr/.18;
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.closePath();
      ctx.strokeStyle=`rgba(105,205,255,${.025+e*.025-layer*.003})`;ctx.lineWidth=.55;ctx.stroke();
    }

    // Core: deliberately abstract, no eye, no orb, no fixed geometry.
    const coreR=size*(.055+e*.012);
    const glow=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,coreR*4.5);
    glow.addColorStop(0,`rgba(125,225,255,${.15+e*.12})`);glow.addColorStop(.25,`rgba(95,143,255,${.08+e*.06})`);glow.addColorStop(1,'transparent');
    ctx.fillStyle=glow;ctx.fillRect(q.x-coreR*5,q.y-coreR*5,q.x?coreR*10:1,coreR*10);
    for(let k=0;k<3;k++){
      ctx.beginPath();
      for(let i=0;i<=90;i++){
        const a=i/90*6.283;
        const wob=Math.sin(a*(4+k)+t*(.7+k*.2))*coreR*.22+Math.cos(a*7-t)*coreR*.1;
        const rr=coreR*(.65+k*.18)+wob;
        const x=q.x+Math.cos(a+t*(.03+k*.01))*rr;
        const y=q.y+Math.sin(a-t*(.04+k*.015))*rr*.62;
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.closePath();ctx.strokeStyle=`rgba(169,239,255,${.13+k*.035+e*.08})`;ctx.lineWidth=1.1-k*.2;ctx.stroke();
    }
    ctx.beginPath();ctx.arc(q.x+Math.sin(t*.8)*2,q.y+Math.cos(t*.65)*2,2.3+e*2.5,0,6.283);ctx.fillStyle='#e6fbff';ctx.shadowBlur=28;ctx.shadowColor='#72e8ff';ctx.fill();ctx.shadowBlur=0;

    if(pointer.active){
      const near=Math.max(0,1-Math.hypot(pointer.x-q.x,pointer.y-q.y)/(size*.5));
      if(near>.02){ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(pointer.x,pointer.y);ctx.strokeStyle=`rgba(121,232,255,${near*.035})`;ctx.lineWidth=.7;ctx.stroke()}
    }
    requestAnimationFrame(draw);t+=.012;
  }
  draw();

  // Hide the legacy CSS orb geometry; canvas owns the presence now.
  presence.classList.add('canvas-presence');

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