/* BacBo Robot — V2 (script.js)
   Lógica inteligente: auto rounds, trend detector, signal strength, history, auto-bet (simulação).
   Colar como /script.js
*/

(function(){
  const $ = id => document.getElementById(id);
  const now = () => new Date().toLocaleTimeString();

  // Load config.json (async). If não encontrar, usa defaults.
  let CONFIG = {
    interval: 6,
    seed: null,
    autoBet: false,
    stake: 1000,
    bankroll: 10000,
    stopLoss: 3,
    takeProfit: 2000,
    historyLimit: 500
  };

  async function loadConfig(){
    try{
      const resp = await fetch('./config.json');
      if(!resp.ok) throw new Error('no config');
      const j = await resp.json();
      Object.assign(CONFIG, j);
    }catch(e){
      console.warn('config.json not found or invalid — using defaults');
    }
    // set UI initial values if exist
    if($('intervalInput')) $('intervalInput').value = CONFIG.interval;
    if($('seedInput')) $('seedInput').value = CONFIG.seed || '';
    if($('bankroll')) $('bankroll').value = CONFIG.bankroll;
    if($('stake')) $('stake').value = CONFIG.stake;
    if($('stopLoss')) $('stopLoss').value = CONFIG.stopLoss;
    if($('takeProfit')) $('takeProfit').value = CONFIG.takeProfit;
  }

  // PRNG Mulberry32 factory
  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // rgb -> hsv
  function rgbToHsv(r,g,b){
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h=0,s=0,v=max; const d=max-min;
    s = max===0?0:d/max;
    if(max!==min){
      switch(max){
        case r: h=(g-b)/d + (g<b?6:0); break;
        case g: h=(b-r)/d + 2; break;
        case b: h=(r-g)/d + 4; break;
      }
      h /= 6;
    }
    return {h: Math.round(h*360), s: Math.round(s*100), v: Math.round(v*100)};
  }

  function mapHsvToOutcome(hsv){
    const h = hsv.h, s = hsv.s, v = hsv.v;
    if(s < 12 && v > 90) return {o:null,label:'Indefinido'};
    if((h >= 340 && h <= 360) || (h >=0 && h <= 28)) return {o:'B', label:'BANKER'};
    if(h >= 190 && h <= 260) return {o:'P', label:'PLAYER'};
    if(h >= 30 && h <= 100) return {o:'T', label:'TIE'};
    return {o:null,label:'Indef'};
  }

  // UI refs (são opcionais dependendo do teu index.html)
  const refs = {
    cassinoRes: $('cassinoRes'), meuRes: $('meuRes'), historyBox: $('history'),
    statRounds: $('statRounds'), statBank: $('statBank'), statPlayer: $('statPlayer'),
    statTie: $('statTie'), statMatch: $('statMatch'),
    mainDot: $('mainDot'), mainSignal: $('mainSignal'), signalStrength: $('signalStrength'),
    robotMsg: $('robotMsg'), lastAnal: $('lastAnal'),
    btnAuto: $('btnAuto'), btnStep: $('btnStep'), btnClear: $('btnClear'),
    imgInput: $('imgInput'), seedInput: $('seedInput'), intervalInput: $('intervalInput'),
    btnExport: $('btnExport'), btnAutoBet: $('btnAutoBet'),
    bankrollInp: $('bankroll'), stakeInp: $('stake'),
    stopLossInp: $('stopLoss'), takeProfitInp: $('takeProfit'),
    bankrollDisplay: $('bankrollDisplay'), autoBetMode: $('autoBetMode')
  };

  // State
  let state = {
    rounds: [], // newest first {c,m,time,note}
    counts: {B:0,P:0,T:0},
    matches: 0,
    rng: Math.random,
    seed: null,
    auto: false,
    autoTimer: null,
    autoBet: false,
    interval: CONFIG.interval,
    bankroll: CONFIG.bankroll,
    stake: CONFIG.stake,
    stopLoss: CONFIG.stopLoss,
    takeProfit: CONFIG.takeProfit,
    lossStreak: 0,
    profitStart: CONFIG.bankroll
  };

  // Initialize PRNG from seed input or config
  function initPrng(){
    const sUI = (refs.seedInput && refs.seedInput.value) ? refs.seedInput.value.trim() : null;
    const s = sUI || CONFIG.seed;
    if(s){
      const n = parseInt(s) || s.split('').reduce((a,c)=>a + c.charCodeAt(0),0) & 0xffffffff;
      state.seed = n; state.rng = mulberry32(n);
    } else { state.seed = null; state.rng = Math.random; }
  }

  // simulate biased outcome (banker advantage)
  function genOutcome(rng){
    const r = rng();
    if(r < 0.485) return 'B';
    if(r < 0.97) return 'P';
    return 'T';
  }

  function pushRound(c, m, note){
    const time = now();
    state.rounds.unshift({c,m,time,note});
    if(state.rounds.length > (CONFIG.historyLimit||500)) state.rounds.pop();
    state.counts[c] = (state.counts[c]||0) + 1;
    if(c === m) state.matches++;
  }

  function renderHistory(){
    if(!refs.historyBox) return;
    refs.historyBox.innerHTML = '';
    state.rounds.slice(0,100).forEach(entry=>{
      const div = document.createElement('div'); div.className='hist-item';
      const left = document.createElement('div');
      left.innerHTML = `${entry.c === 'B' ? 'BANKER' : entry.c === 'P' ? 'PLAYER' : 'TIE'} ↔ ${entry.m === 'B' ? 'BANKER' : entry.m === 'P' ? 'PLAYER' : 'TIE'}`;
      const time = document.createElement('div'); time.className='small muted'; time.innerText = entry.time + (entry.note ? (' · ' + entry.note) : '');
      div.appendChild(left); div.appendChild(time);
      refs.historyBox.appendChild(div);
    });
    if(refs.statRounds) refs.statRounds.innerText = state.rounds.length;
    if(refs.statBank) refs.statBank.innerText = state.counts.B;
    if(refs.statPlayer) refs.statPlayer.innerText = state.counts.P;
    if(refs.statTie) refs.statTie.innerText = state.counts.T;
    if(refs.statMatch) refs.statMatch.innerText = state.matches;
  }

  function setMainSignal(code, strength, msg){
    if(refs.mainDot) refs.mainDot.style.background = code === 'B' ? getComputedStyle(document.documentElement).getPropertyValue('--bank') : code === 'P' ? getComputedStyle(document.documentElement).getPropertyValue('--player') : code === 'T' ? getComputedStyle(document.documentElement).getPropertyValue('--tie') : '#777';
    if(refs.mainSignal) refs.mainSignal.innerText = code ? `Sinal: ${code==='B'?'BANKER':code==='P'?'PLAYER':'TIE'}` : 'Sinal: —';
    if(refs.signalStrength) refs.signalStrength.innerText = 'Força: ' + (strength || '—');
    if(refs.robotMsg) refs.robotMsg.innerText = msg || '—';
  }

  // prediction: trend detector + strength
  function predict(){
    const N = Math.min(15, state.rounds.length);
    const slice = state.rounds.slice(0,N);
    const freq = {B:0,P:0,T:0};
    slice.forEach(r=>{ freq[r.c] = (freq[r.c]||0) + 1; });
    let code = 'B', strength = 'Fraco';
    if(N>0){
      const leader = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
      const leaderCode = leader[0], leaderCount = leader[1];
      const frac = leaderCount / N;
      if(frac >= 0.65){ code = leaderCode; strength='Forte'; }
      else if(frac >= 0.50){ code = leaderCode; strength='Médio'; }
      else { code = 'B'; strength='Fraco'; } // fallback conservative
    } else {
      // no data -> conservative
      code = 'B'; strength='Fraco';
    }
    // bias if global counts show banker advantage
    const globalBias = (state.counts.B + 1) / ( (state.counts.P||0) + (state.counts.B||0) + 1 );
    if(strength==='Fraco' && globalBias > 1.02) code = 'B';
    const label = code==='B' ? 'BANKER' : code==='P' ? 'PLAYER' : 'TIE';
    const msg = `${strength==='Forte'?'Sinal forte':'Sinal'} — ${label}. Probabilidade: ${strength==='Forte'?'alta':strength==='Médio'?'média':'baixa'}`;
    return {code, strength, msg};
  }

  // single cycle
  function step(doAutoBet=false){
    initPrng();
    const rng = state.rng;
    const casino = genOutcome(rng);
    const mine = genOutcome(Math.random); // my generator independent
    pushRound(casino, mine);
    // UI updates
    if(refs.cassinoRes) refs.cassinoRes.innerText = casino === 'B' ? 'BANKER (Vermelho)' : casino === 'P' ? 'PLAYER (Azul)' : 'TIE (Amarelo)';
    if(refs.meuRes) refs.meuRes.innerText = mine === 'B' ? 'BANKER (Vermelho)' : mine === 'P' ? 'PLAYER (Azul)' : 'TIE (Amarelo)';
    if(refs.lastAnal) refs.lastAnal.innerText = now();
    renderHistory();

    const pred = predict();
    setMainSignal(pred.code, pred.strength, pred.msg);

    if(doAutoBet && state.autoBet) runAutoBet(pred.code);
  }

  // auto loop
  function startAuto(){
    if(state.auto) return;
    state.interval = Math.max(1, Number((refs.intervalInput && refs.intervalInput.value) || CONFIG.interval));
    state.auto = true; if(refs.btnAuto) { refs.btnAuto.innerText = 'Auto (Ligado)'; refs.btnAuto.classList.remove('ghost'); }
    step(false);
    state.autoTimer = setInterval(()=> step(false), state.interval * 1000);
  }
  function stopAuto(){
    state.auto = false; if(refs.btnAuto){ refs.btnAuto.innerText='Auto (Desligado)'; refs.btnAuto.classList.add('ghost'); }
    clearInterval(state.autoTimer); state.autoTimer=null;
  }

  // Auto-bet simulation
  function runAutoBet(predCode){
    if(state.bankroll <= 0){ stopAutoBet(); return; }
    const stake = Number((refs.stakeInp && refs.stakeInp.value) || state.stake);
    const outcome = state.rounds[0].c;
    let win = (predCode === outcome);
    if(win){ state.bankroll += stake; state.lossStreak=0; }
    else { state.bankroll -= stake; state.lossStreak++; }
    if(refs.bankrollDisplay) refs.bankrollDisplay.innerText = state.bankroll;
    if(state.lossStreak >= state.stopLoss){ appendLog(`AutoBet parado por stopLoss (${state.lossStreak})`); stopAutoBet(); }
    if(state.bankroll - state.profitStart >= state.takeProfit){ appendLog(`AutoBet: take profit atingido (+${state.bankroll - state.profitStart})`); stopAutoBet(); }
  }

  function startAutoBet(){
    state.autoBet = true; state.bankroll = Number(refs.bankrollInp ? refs.bankrollInp.value : CONFIG.bankroll); state.stake = Number(refs.stakeInp ? refs.stakeInp.value : CONFIG.stake);
    state.stopLoss = Number(refs.stopLossInp ? refs.stopLossInp.value : CONFIG.stopLoss); state.takeProfit = Number(refs.takeProfitInp ? refs.takeProfitInp.value : CONFIG.takeProfit);
    state.lossStreak = 0; state.profitStart = state.bankroll;
    if(refs.btnAutoBet){ refs.btnAutoBet.innerText='Auto-Bet (ON)'; refs.btnAutoBet.classList.remove('ghost'); }
    if(refs.autoBetMode) refs.autoBetMode.innerText = 'ON';
    if(refs.bankrollDisplay) refs.bankrollDisplay.innerText = state.bankroll;
    state.autoBet = true;
  }
  function stopAutoBet(){
    state.autoBet = false; if(refs.btnAutoBet){ refs.btnAutoBet.innerText='Auto-Bet (OFF)'; refs.btnAutoBet.classList.add('ghost'); }
    if(refs.autoBetMode) refs.autoBetMode.innerText = 'OFF';
  }

  function appendLog(text){
    state.rounds.unshift({c:'T', m:'T', time: now(), note: text});
    renderHistory();
  }

  // image analyzer (central crop)
  async function analyzeImageFile(file){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = (ev)=>{
        const img = new Image();
        img.onload = ()=>{
          const MAX = 1000;
          let w = img.width, h = img.height;
          const scale = Math.min(1, MAX / Math.max(w,h));
          w = Math.round(w*scale); h = Math.round(h*scale);
          const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
          const cw = Math.max(20, Math.floor(w * 0.32));
          const ch = Math.max(20, Math.floor(h * 0.32));
          const sx = Math.floor((w - cw)/2), sy = Math.floor((h - ch)/2);
          const imgData = ctx.getImageData(sx, sy, cw, ch).data;
          let rSum=0,gSum=0,bSum=0,count=0;
          const total = cw*ch; const step = Math.max(1, Math.floor(total/3000));
          for(let i=0;i<total;i+=step){
            const idx = i*4; rSum += imgData[idx]; gSum += imgData[idx+1]; bSum += imgData[idx+2]; count++;
          }
          const rAvg = Math.round(rSum/count), gAvg = Math.round(gSum/count), bAvg = Math.round(bSum/count);
          const hsv = rgbToHsv(rAvg,gAvg,bAvg);
          const mapped = mapHsvToOutcome(hsv);
          resolve({r:rAvg,g:gAvg,b:bAvg,hsv,mapped});
        };
        img.onerror = (e)=> reject(e);
        img.src = ev.target.result;
      };
      reader.onerror = (e)=> reject(e);
      reader.readAsDataURL(file);
    });
  }

  // UI wiring (if elements exist on page)
  function bindUI(){
    if(refs.btnStep) refs.btnStep.addEventListener('click', ()=> step(false));
    if(refs.btnAuto) refs.btnAuto.addEventListener('click', ()=> { state.auto ? stopAuto() : startAuto(); });
    if(refs.btnClear) refs.btnClear.addEventListener('click', ()=> {
      if(!confirm('Apagar histórico e reiniciar contadores?')) return;
      state.rounds=[]; state.counts={B:0,P:0,T:0}; state.matches=0; renderHistory(); setMainSignal(null);
    });
    if(refs.imgInput) refs.imgInput.addEventListener('change', async (e)=>{
      if(!e.target.files || e.target.files.length===0) return;
      const file = e.target.files[0];
      try{
        const info = await analyzeImageFile(file);
        if(info.mapped && info.mapped.o){
          pushRound(info.mapped.o, info.mapped.o, 'Image import');
          state.matches++;
          renderHistory();
          appendLog(`Imagem detectada: ${info.mapped.label}`);
        } else alert('Detecção indefinida. Tenta recortar a área da rodada.');
      }catch(err){ console.error(err); alert('Erro ao analisar imagem.'); } finally { e.target.value=''; }
    });
    if(refs.btnExport) refs.btnExport.addEventListener('click', ()=>{
      const text = state.rounds.map((r,i)=> `${i+1}|C:${r.c}|M:${r.m}|T:${r.time}${r.note? ' | ' + r.note : ''}`).join('\n');
      const blob = new Blob([text], {type:'text/plain;charset=utf-8'}); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'bacbo_log.txt'; a.click(); URL.revokeObjectURL(url);
    });
    if(refs.btnAutoBet) refs.btnAutoBet.addEventListener('click', ()=> state.autoBet ? stopAutoBet() : startAutoBet());
    if(refs.intervalInput) refs.intervalInput.addEventListener('change', ()=> { state.interval = Math.max(1, Number(refs.intervalInput.value||CONFIG.interval)); if(state.auto){ stopAuto(); startAuto(); } });
    if(refs.seedInput) refs.seedInput.addEventListener('change', ()=> initPrng());
    if(refs.bankrollInp) refs.bankrollInp.addEventListener('change', ()=> { state.bankroll = Number(refs.bankrollInp.value||state.bankroll); if(refs.bankrollDisplay) refs.bankrollDisplay.innerText = state.bankroll; });
    if(refs.stakeInp) refs.stakeInp.addEventListener('change', ()=> state.stake = Number(refs.stakeInp.value||state.stake));
    if(refs.stopLossInp) refs.stopLossInp.addEventListener('change', ()=> state.stopLoss = Number(refs.stopLossInp.value||state.stopLoss));
    if(refs.takeProfitInp) refs.takeProfitInp.addEventListener('change', ()=> state.takeProfit = Number(refs.takeProfitInp.value||state.takeProfit));
  }

  // start
  (async ()=> {
    await loadConfig();
    bindUI();
    initPrng();
    renderHistory();
    setMainSignal(null);
  })();

})();
