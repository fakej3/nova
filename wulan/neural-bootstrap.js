(() => {
  const startedAt=Date.now();
  const trace=()=>document.querySelector('#trace');
  const footer=()=>document.querySelector('#footer');
  const show=(title,message)=>{
    const target=trace();
    if(target&&!window.WULAN_NEURAL_LAB_READY)target.innerHTML=`<b>${title}</b><br>${String(message).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}`;
    const foot=footer();
    if(foot&&!window.WULAN_NEURAL_LAB_READY)foot.textContent='NEURAL BOOT DIAGNOSTIC';
  };
  const timer=setInterval(()=>{
    if(window.WULAN_NEURAL_LAB_READY){clearInterval(timer);return;}
    if(Date.now()-startedAt<6000)return;
    clearInterval(timer);
    show('Neural runtime did not finish booting.','The page loaded, but the Wulan neural module did not report readiness within 6 seconds. Check DevTools → Console and Network for wulan/neural-lab.js or one of its imports.');
  },250);
  window.addEventListener('error',event=>{if(window.WULAN_NEURAL_LAB_READY)return;show('Neural module error.',event.error?.message||event.message||'Unknown browser error');},{once:false});
  window.addEventListener('unhandledrejection',event=>{if(window.WULAN_NEURAL_LAB_READY)return;show('Neural module promise error.',event.reason?.message||String(event.reason||'Unknown promise rejection'));},{once:false});
})();
