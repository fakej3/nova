const STYLE = `
.wi-inspect{margin-left:auto;border:1px solid rgba(121,232,255,.14);background:rgba(121,232,255,.035);color:#9fdff2;border-radius:8px;padding:5px 7px;cursor:pointer;font:500 5px ui-monospace,monospace;letter-spacing:.1em}.wi-inspect:hover{background:rgba(121,232,255,.09);border-color:rgba(121,232,255,.25)}
.wi-inspect[disabled]{opacity:.55;cursor:wait}.wi-result{white-space:pre-wrap;word-break:break-word;max-height:58vh;overflow:auto;margin:12px 0 0;padding:12px;border:1px solid rgba(160,205,235,.08);border-radius:12px;background:rgba(0,0,0,.18);color:#a9bfd2;font:500 6px/1.65 ui-monospace,monospace}
`;

(() => {
  const boot = () => {
    const core = globalThis.WULAN_CORE;
    if (!core) return;
    if (!document.getElementById('wulan-integration-controls-style')) {
      const style = document.createElement('style'); style.id = 'wulan-integration-controls-style'; style.textContent = STYLE; document.head.appendChild(style);
    }

    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const showResult = (name, result) => {
      const existing = document.querySelector('.wi-integration-result');
      existing?.remove();
      const probe = document.createElement('div');
      probe.className = 'wi-probe wi-integration-result';
      const pretty = JSON.stringify(result, null, 2);
      probe.innerHTML = `<button class="wi-close" aria-label="Close">×</button><div class="wi-kicker">LIVE INTEGRATION RESULT</div><h3>${esc(name)}</h3><p>Read-only data returned by Wulan's actual integration capability.</p><pre class="wi-result">${esc(pretty)}</pre>`;
      document.body.appendChild(probe);
      probe.querySelector('.wi-close').onclick = () => probe.remove();
    };
    const inspect = async (name, button) => {
      button.disabled = true; button.textContent = 'CHECKING';
      try {
        const inputs = {
          'SENTINEL': { repo:'fakej3/Sentinel', branch:'main', paths:['package.json','README.md'] },
          'STRATEGY LAB': { repo:'fakej3/strategy-lab', branch:'claude/trading-lab-architecture-e4212v', paths:['README.md','pyproject.toml'] },
          'GITHUB': { owner:'fakej3', repo:'nova', ref:'master' }
        };
        const capability = name === 'SENTINEL' ? 'sentinel.inspect' : name === 'STRATEGY LAB' ? 'strategy-lab.inspect' : 'github.inspect';
        const result = await core.invokeCapability(capability, inputs[name] ?? {});
        showResult(name, result);
      } catch (error) {
        showResult(name, { error: String(error?.message || error) });
      } finally { button.disabled = false; button.textContent = 'INSPECT'; }
    };

    const enhance = () => {
      const layer = document.getElementById('wulan-world-layer');
      if (!layer) return;
      layer.querySelectorAll('.wi-item').forEach(item => {
        if (item.querySelector('.wi-inspect')) return;
        const name = item.querySelector('b')?.textContent?.trim()?.toUpperCase();
        if (!['SENTINEL','STRATEGY LAB','GITHUB'].includes(name)) return;
        const button = document.createElement('button');
        button.className = 'wi-inspect'; button.type = 'button'; button.textContent = 'INSPECT'; button.title = `Inspect ${name}`;
        button.addEventListener('click', event => { event.stopPropagation(); inspect(name, button); });
        item.appendChild(button);
      });
    };

    const observer = new MutationObserver(enhance);
    observer.observe(document.body, {childList:true,subtree:true});
    enhance();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
