/* NOVA 2 — interactive visual shell; intentionally independent of legacy modules */
(() => {
  const canvas = document.getElementById('nova-canvas');
  const ctx = canvas.getContext('2d');
  const input = document.getElementById('nova-input');
  const send = document.getElementById('nova-send');
  const toast = document.getElementById('nova-toast');
  const nodes = [
    {id:'nova',label:'NOVA',type:'core',x:.50,y:.46,r:30},
    {id:'memory',label:'MEMORY',type:'memory',x:.34,y:.32,r:13},
    {id:'atlas',label:'ATLAS',type:'agent',x:.68,y:.30,r:15},
    {id:'leon',label:'LEON',type:'agent',x:.72,y:.57,r:15},
    {id:'oracle',label:'ORACLE',type:'agent',x:.29,y:.62,r:15},
    {id:'projects',label:'PROJECTS',type:'data',x:.54,y:.22,r:11},
    {id:'tools',label:'TOOLS',type:'data',x:.81,y:.43,r:11},
    {id:'context',label:'CONTEXT',type:'memory',x:.42,y:.72,r:11},
    {id:'device',label:'DEVICES',type:'data',x:.63,y:.78,r:11}
  ];
  const links = [['nova','memory'],['nova','atlas'],['nova','leon'],['nova','oracle'],['nova','projects'],['nova','tools'],['nova','context'],['nova','device'],['memory','context'],['atlas','projects'],['leon','tools'],['oracle','device']];
  let w=0,h=0,dpr=1,t=0,active=null;
  const palette={core:'#73d7ff',agent:'#a98bff',memory:'#72e0b0',data:'#f0bd6b'};
  function resize(){dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0)}
  function pos(n){return{x:n.x*w,y:n.y*h}}
  function draw(){
    ctx.clearRect(0,0,w,h);t+=.006;
    const cx=w*.5,cy=h*.47;
    const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.min(w,h)*.35);glow.addColorStop(0,'rgba(115,215,255,.075)');glow.addColorStop(1,'rgba(115,215,255,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
    ctx.lineWidth=1;
    links.forEach(([a,b],i)=>{const A=pos(nodes.find(n=>n.id===a)),B=pos(nodes.find(n=>n.id===b));const pulse=(Math.sin(t*2+i*.8)+1)/2;ctx.strokeStyle=`rgba(115,215,255,${.08+pulse*.08})`;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();if(active){const q=(t*0.35+i*.071)%1;const px=A.x+(B.x-A.x)*q,py=A.y+(B.y-A.y)*q;ctx.fillStyle='rgba(115,215,255,.8)';ctx.beginPath();ctx.arc(px,py,1.7,0,Math.PI*2);ctx.fill()}});
    nodes.forEach(n=>{const p=pos(n),c=palette[n.type]||palette.data,breath=n.type==='core'?Math.sin(t*2)*2:0;ctx.shadowBlur=n.type==='core'?28:12;ctx.shadowColor=c;ctx.fillStyle=c;ctx.globalAlpha=.9;ctx.beginPath();ctx.arc(p.x,p.y,n.r+breath,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.globalAlpha=1;ctx.fillStyle='#07101a';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,n.r-3),0,Math.PI*2);ctx.fill();ctx.fillStyle='#aebbd0';ctx.font='8px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText(n.label,p.x,p.y+n.r+15)});
    requestAnimationFrame(draw);
  }
  function notify(text){toast.textContent=text;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1700)}
  function submit(){const q=input.value.trim();if(!q)return;input.value='';notify('REQUEST QUEUED · NOVA CORE');document.getElementById('core-state').textContent='PROCESSING';setTimeout(()=>document.getElementById('core-state').textContent='READY',900)}
  send?.addEventListener('click',submit);input?.addEventListener('keydown',e=>{if(e.key==='Enter')submit()});addEventListener('resize',resize);
  document.querySelectorAll('.rail-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.rail-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');notify(btn.dataset.view.toUpperCase()+' LAYER SELECTED')}));
  resize();draw();
})();
