import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';

(() => {
  const core=createDefaultWulanCore();
  const $=s=>document.querySelector(s);
  const canvas=$('#nova-canvas'),ctx=canvas.getContext('2d');
  const input=$('#nova-input'),composer=$('#composer'),presence=$('#presence-core');
  const messages=$('#messages'),headline=$('#headline'),subline=$('#subline'),eyebrow=$('#eyebrow');
  const presenceText=$('#presence-text'),attentionTitle=$('#attention-title'),attentionDetail=$('#attention-detail');
  const activityStream=$('#activity-stream'),memoryCount=$('#memory-count'),memoryHint=$('#memory-hint'),providerHint=$('#provider-hint'),systemState=$('#system-state');

  let w=0,h=0,dpr=1,t=0,state='idle',memories=[];
  const pointer={x:0,y:0,active:false,down:false};
  const particles=[],filaments=[],orbits=[];
  for(let i=0;i<230;i++) particles.push({a:Math.random()*6.283,r:.12+Math.random()*.9,z:Math.random(),phase:Math.random()*6.283,speed:.18+Math.random()*.9,size:.45+Math.random()*1.7});
  for(let i=0;i<34;i++) filaments.push({a:i/34*6.283,phase:Math.random()*6.283,len:.55+Math.random()*.65,curve:(Math.random()-.5)*.7,speed:.12+Math.random()*.5});
  for(let i=0;i<7;i++) orbits.push({a:Math.random()*6.283,r:.12+Math.random()*.5,speed:(Math.random()>.5?1:-1)*(.05+Math.random()*.14),phase:Math.random()*6.283});

  function resize(){dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);pointer.x=w/2;pointer.y=h*.54}
  addEventListener('resize',resize);resize();
  const center=()=>({x:w/2,y:h*.54}),scale=()=>Math.min(w,h),energy=()=>({idle:.12,listening:.42,thinking:.9,remembering:.62,acting:.82,learning:.72,error:.2}[state]||.1);

  function point(a,r,phase=0){const q=center(),e=energy(),s=scale();const breath=1+Math.sin(t*.55+phase)*(.035+e*.018);const wob=Math.sin(a*3.7+t*.31+phase)*.045+Math.sin(a*8.3-t*.18+phase*2)*.018;const rr=r*(breath+wob);return{x:q.x+Math.cos(a)*s*.30*rr,y:q.y+Math.sin(a)*s*.22*rr*(.92+e*.05)}}

  function draw(){
    ctx.clearRect(0,0,w,h);const q=center(),s=scale(),e=energy();
    const field=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,s*.58);field.addColorStop(0,`rgba(58,151,255,${.045+e*.075})`);field.addColorStop(.32,`rgba(77,92,190,${.025+e*.03})`);field.addColorStop(1,'transparent');ctx.fillStyle=field;ctx.fillRect(0,0,w,h);

    // Ambient motes respond to the pointer instead of living on static rings.
    particles.forEach((p,i)=>{p.a+=.0008*p.speed*(state==='thinking'?3:1);const pt=point(p.a,p.r+Math.sin(t*.32+p.phase)*.025,p.phase);const d=Math.hypot(pt.x-pointer.x,pt.y-pointer.y);const near=pointer.active?Math.max(0,1-d/(s*.33)):0;const pulse=(Math.sin(t*(.7+p.speed)+p.phase)+1)/2;ctx.beginPath();ctx.arc(pt.x,pt.y,p.size*(.65+pulse*.65+near),0,6.283);ctx.fillStyle=`rgba(175,225,255,${.025+e*.055+near*.22})`;ctx.fill()});

    // Organic filaments continuously re-form; they are a visual metaphor for attention/context, not a dashboard graph.
    filaments.forEach((f,idx)=>{const steps=55;ctx.beginPath();for(let j=0;j<=steps;j++){const p=j/steps;const curl=Math.sin(p*4.5+f.phase+t*(.25+e*.7))*f.curve*p*p;const sway=Math.sin(t*.35+f.phase+p*5)*.025*p;const pt=point(f.a+t*f.speed*.018+curl,f.len*p+.035+sway,f.phase);j?ctx.lineTo(pt.x,pt.y):ctx.moveTo(pt.x,pt.y)}ctx.strokeStyle=idx%4===0?`rgba(102,225,255,${.045+e*.045})`:idx%4===1?`rgba(163,139,255,${.025+e*.035})`:`rgba(112,210,190,${.018+e*.025})`;ctx.lineWidth=.55+(idx%5===0?0.55:0);ctx.stroke()});

    // A few impulses travel through the field.
    orbits.forEach((o,i)=>{o.a+=o.speed*(state==='thinking'?.035:.012);const pt=point(o.a,o.r+Math.sin(t*.7+o.phase)*.03,o.phase);const g=ctx.createRadialGradient(pt.x,pt.y,0,pt.x,pt.y,12+e*9);g.addColorStop(0,`rgba(214,249,255,${.65+e*.2})`);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(pt.x-15,pt.y-15,30,30);ctx.beginPath();ctx.arc(pt.x,pt.y,1.2+e*1.1,0,6.283);ctx.fillStyle='#d9f9ff';ctx.fill()});

    // Central presence is deliberately irregular and subtle; no glowing orb or eye.
    const coreR=s*(.035+e*.012);const cg=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,coreR*7);cg.addColorStop(0,`rgba(129,231,255,${.12+e*.14})`);cg.addColorStop(.3,`rgba(91,130,255,${.06+e*.06})`);cg.addColorStop(1,'transparent');ctx.fillStyle=cg;ctx.fillRect(q.x-coreR*7,q.y-coreR*7,coreR*14,coreR*14);
    for(let k=0;k<4;k++){ctx.beginPath();for(let i=0;i<=100;i++){const a=i/100*6.283;const wob=Math.sin(a*(3+k)+t*(.45+k*.16))*coreR*(.45+.08*k)+Math.cos(a*7-t*.8)*coreR*.25;const rr=coreR*(.75+k*.22)+wob;const x=q.x+Math.cos(a+t*(.025+k*.008))*rr*1.8,y=q.y+Math.sin(a-t*(.03+k*.009))*rr*.72;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.closePath();ctx.strokeStyle=`rgba(170,238,255,${.12+k*.018+e*.08})`;ctx.lineWidth=.7;ctx.stroke()}
    ctx.beginPath();ctx.arc(q.x+Math.sin(t*.8)*3,q.y+Math.cos(t*.6)*2,1.8+e*2.2,0,6.283);ctx.fillStyle='#e6fbff';ctx.shadowBlur=22+e*18;ctx.shadowColor='#72e8ff';ctx.fill();ctx.shadowBlur=0;

    // Attention beam: only appears when the user is actually interacting.
    if(pointer.active){const near=Math.max(0,1-Math.hypot(pointer.x-q.x,pointer.y-q.y)/(s*.45));if(near>.08){ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.quadraticCurveTo((q.x+pointer.x)/2,(q.y+pointer.y)/2-35,pointer.x,pointer.y);ctx.strokeStyle=`rgba(114,232,255,${near*.08})`;ctx.lineWidth=1;ctx.stroke()}}
    t+=.012;requestAnimationFrame(draw);
  }
  draw();

  const stateCopy={idle:["I'm here.",'quiet · aware · waiting','QUIET','Listening for you','Wulan is quiet until you give her something to do.'],listening:["I'm listening.",'with you · right now','LISTENING','Listening to you','Attention is on you.'],thinking:["Let me think.",'connecting · reasoning · checking','THINKING','Working through it','Wulan is connecting the relevant pieces.'],remembering:["I remember.",'searching · relating · recalling','MEMORY','Searching memory','Relevant context is moving closer.'],acting:["On it.",'working · executing · observing','ACTING','Doing the work','A capability is active.'],learning:["I'm learning.",'feedback · adjustment · experience','LEARNING','Updating experience','Useful feedback is being recorded locally.'],error:["Something broke.",'recovering · safely · locally','ERROR','Recovering','Something needs attention.']};
  function setState(next){state=next;const c=stateCopy[next]||stateCopy.idle;headline.textContent=c[0];subline.textContent=c[1];presenceText.textContent=c[2];attentionTitle.textContent=c[3];attentionDetail.textContent=c[4];presence.classList.toggle('active',next==='listening'||next==='acting');presence.classList.toggle('thinking',next==='thinking'||next==='learning');systemState.textContent=next==='idle'?'LOCAL CORE ONLINE':`LOCAL CORE · ${next.toUpperCase()}`}
  function addMessage(who,text){const el=document.createElement('div');el.className=`message ${who}`;const n=document.createElement('span');n.className='message-name';n.textContent=who==='user'?'YOU':'WULAN';const p=document.createElement('p');p.textContent=text;el.append(n,p);messages.appendChild(el);messages.scrollTop=messages.scrollHeight}
  function stream(text){const el=document.createElement('div');el.className='stream-item';el.innerHTML=`<b>WULAN</b> · ${text}`;activityStream.appendChild(el);while(activityStream.children.length>3)activityStream.firstChild.remove();setTimeout(()=>el.remove(),5200)}
  function localReply(text){const s=text.toLowerCase();if(/^(hi|hello|hey|bro)\b/.test(s))return "Hey. I'm right here. What are we building?";if(/who are you|what are you/.test(s))return "I'm Wulan — the personal layer around your memory, tools, projects and future AI providers.";if(/remember|memory/.test(s))return memories.length?`I have ${memories.length} new local memories from this session.`:"Memory is awake. Tell me what matters and I'll keep it locally.";if(/sentinel/.test(s))return "Sentinel is connected as a registered capability. Later, Wulan can surface its live state only when you ask for it.";if(/edgelab|edge lab/.test(s))return "EdgeLab is registered too. It can become another capability in Wulan's world without changing the core.";if(/learn|learning/.test(s))return "The local learning loop records feedback now. A future model can use that experience without replacing the core.";if(/project|build/.test(s))return "I'm ready. Give me the next thing and I'll keep the context around it.";return `I heard you: “${text}”. My local core is working, but no production AI provider is connected yet.`}

  async function sendMessage(text){text=text.trim();if(!text)return;addMessage('user',text);core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text});setState('thinking');stream(`processing <b>“${text.slice(0,44)}${text.length>44?'…':''}”</b>`);const memory=core.remember({content:text,source:'conversation',tags:['session']});memories.push(memory);memoryCount.textContent=`${memories.length} this session`;memoryHint.textContent=`MEMORY · ${memories.length}`;await new Promise(r=>setTimeout(r,350+Math.random()*450));let reply;try{reply=await core.ai.generate({messages:[{role:'user',content:text}],system:'You are Wulan, a personal AI OS. Be concise, warm, grounded and useful.'})}catch{reply=localReply(text)}setState('acting');stream('responding to you');await new Promise(r=>setTimeout(r,160));addMessage('wulan',typeof reply==='string'?reply:(reply?.text||reply?.content||localReply(text)));core.recordFeedback({type:'conversation',signal:'useful',input:text});setState('idle');input.focus()}

  composer.addEventListener('submit',e=>{e.preventDefault();const text=input.value;input.value='';sendMessage(text)});
  function wake(){setState('listening');input.focus();stream('attention shifted to <b>you</b>');setTimeout(()=>{if(state==='listening')setState('idle')},3200)}
  presence.addEventListener('click',wake);presence.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();wake()}});$('#identity').addEventListener('click',wake);
  document.addEventListener('pointermove',e=>{pointer.x=e.clientX;pointer.y=e.clientY;pointer.active=true});document.addEventListener('pointerleave',()=>pointer.active=false);

  $('#voice').addEventListener('click',()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){addMessage('wulan','Voice input is not available in this browser. Text is ready.');return}const rec=new SR();rec.lang=navigator.language||'en-IN';rec.interimResults=false;setState('listening');rec.onresult=e=>{input.value=e.results[0][0].transcript;const text=input.value;input.value='';sendMessage(text)};rec.onerror=()=>setState('idle');rec.onend=()=>{if(state==='listening')setState('idle')};rec.start()});

  const contextText={memory:'Memory is awake. Tell me what matters and I will keep it locally.',sentinel:'Sentinel is a registered capability. Its live surface will appear when you need it.',edge:'EdgeLab is registered. Wulan can bring its context into the conversation.',projects:'Projects are part of your world. Wulan should reveal them by relevance, not leave them on screen all day.'};
  document.querySelectorAll('.context-card').forEach(card=>card.addEventListener('click',()=>{document.querySelectorAll('.context-card').forEach(c=>c.classList.remove('active'));card.classList.add('active');const type=card.dataset.context;setState(type==='memory'?'remembering':'acting');stream(`${card.querySelector('b').textContent} context <b>opened</b>`);addMessage('wulan',contextText[type]);setTimeout(()=>{card.classList.remove('active');setState('idle')},2200)}));
  document.querySelectorAll('.quick button').forEach(btn=>btn.addEventListener('click',()=>{const a=btn.dataset.action;const lines={memory:'Memory is awake. Tell me what matters.',agents:'Agents are registered in the core. They will become contextual workers, not permanent dashboard tiles.',projects:'Projects will appear around what you are doing.',systems:'Sentinel, EdgeLab and GitHub are registered integrations.'};setState(a==='memory'?'remembering':'acting');stream(`${a} context <b>opened</b>`);addMessage('wulan',lines[a]);setTimeout(()=>setState('idle'),1800)}));

  core.events.on(WULAN_EVENTS.SYSTEM_READY,()=>{systemState.textContent='LOCAL CORE ONLINE';providerHint.textContent=core.ai.listProviders().length?'AI GATEWAY · CONNECTED':'AI GATEWAY · WAITING FOR PROVIDER'});
  core.boot();
  memoryCount.textContent='quiet';setState('idle');
  const clock=$('#clock'),tick=()=>clock.textContent=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});tick();setInterval(tick,1000);
})();
