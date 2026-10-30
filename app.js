/* Funding Desk — interface. Lógica pura em core.js (FD) e mining.js (FDM). */
(function(){
var $=function(id){return document.getElementById(id)};
var VENUES=FD.VENUES, HOUR=FD.HOUR;
function ls(k,v){try{if(v===undefined){var r=localStorage.getItem(k);return r?JSON.parse(r):null}localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}}
function esc(s){return String(s===undefined||s===null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

/* ---------- configurações ---------- */
function cloneFees(){return JSON.parse(JSON.stringify(FD.DEFAULT_FEES))}
var FEES=cloneFees();
(function(){var s=ls('fd_fees');if(!s)return;
  for(var k in s){if(!FEES[k])continue;
    if(typeof s[k]==='number')FEES[k].taker=s[k];          // formato antigo: uma taxa por exchange
    else for(var f in s[k])if(isFinite(s[k][f]))FEES[k][f]=s[k][f];}})();
var settings=ls('fd_set')||{};
var SCAN_INPUTS=['cap','lev','hold','minvol','exS','exL','rebal','slip','minoi','acap','newdays','sort'];
var PLAN_INPUTS=['mp_ph','mp_h','mp_rfee','mp_pfee','mp_ofee','mp_rw','iv_total','iv_sess','iv_edge'];
SCAN_INPUTS.concat(PLAN_INPUTS).forEach(function(id){if(settings[id]!==undefined)$(id).value=settings[id]});
$('proxy').value=settings.proxy||'';
function saveSettings(){SCAN_INPUTS.concat(PLAN_INPUTS).forEach(function(id){settings[id]=$(id).value});settings.proxy=$('proxy').value.trim();ls('fd_set',settings)}

var state={rows:{},live:false,mode:settings.mode||'pp',updated:null,src:{},srcErr:{},ops:[]};
var mine={stats:null,btc:null,blocks:[],book:null,bookSrc:null,bookAt:null,err:{},at:null};

/* ---------- tema ---------- */
var THEMES=['auto','escuro','claro'];
function applyTheme(){
  var t=settings.theme||'auto',el=document.documentElement;
  if(t==='escuro')el.setAttribute('data-theme','dark');else if(t==='claro')el.setAttribute('data-theme','light');else el.removeAttribute('data-theme');
  $('theme').textContent=t;$('theme').setAttribute('aria-label','Tema: '+t+'. Tocar para trocar');
  document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){
    if(!m.dataset.orig)m.dataset.orig=m.content;
    m.content=t==='auto'?m.dataset.orig:(t==='escuro'?'#0c1210':'#f3f6f1');});
}
$('theme').addEventListener('click',function(){settings.theme=THEMES[(THEMES.indexOf(settings.theme||'auto')+1)%3];ls('fd_set',settings);applyTheme()});

/* ---------- utilidades ---------- */
function num(id){var v=parseFloat($(id).value);return isFinite(v)?v:0}
function pct(x,d){return (x>=0?'+':'')+x.toFixed(d===undefined?2:d)+'%'}
function pctp(x,d){return x.toFixed(d===undefined?1:d)+'%'}
function usd(x){return (x<0?'-':'')+'US$'+Math.abs(x).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
function nf(x,d){return x.toLocaleString('pt-BR',{minimumFractionDigits:d||0,maximumFractionDigits:d||0})}
function mi(x){return x===null||x===undefined?'—':(x>=1e9?(x/1e9).toFixed(1)+' bi':(x/1e6).toFixed(0)+' mi')}
function cls(x,a,b){return x>=a?'good':(x>=b?'warn':'bad')}
function hold(){return num('hold')||1}
function cd(ms){
  var d=ms-Date.now();if(d<=0)return 'liquidando';
  var s=Math.floor(d/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);s=s%60;
  return (h<10?'0':'')+h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s;
}
function ago(ms){
  var s=Math.max(0,Math.floor((Date.now()-ms)/1000)),m=Math.floor(s/60);
  if(m<1)return s+'s';if(m<60)return m+' min '+(s%60<10?'0':'')+s%60+'s';
  var h=Math.floor(m/60);return h<48?h+'h '+m%60+'min':Math.floor(h/24)+' dias';
}
function hhmm(ms){return new Date(ms).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
function tick(){
  document.querySelectorAll('[data-next]').forEach(function(e){e.textContent=cd(+e.dataset.next)});
  document.querySelectorAll('[data-ago]').forEach(function(e){e.textContent=ago(+e.dataset.ago)});
}
setInterval(tick,1000);

/* ---------- rede ---------- */
var PROXY_KEY={'fapi.binance.com':'binance','api.bybit.com':'bybit','api2.nicehash.com':'nicehash'};
var usedProxy={};
function fetchJSON(u,opt){
  var ctl=typeof AbortController!=='undefined'?new AbortController():null,o=Object.assign({},opt||{});
  if(ctl)o.signal=ctl.signal;
  var to=setTimeout(function(){if(ctl)ctl.abort()},12000);
  return fetch(u,o).then(function(r){clearTimeout(to);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()},function(e){clearTimeout(to);throw e});
}
function proxied(u){
  var p=(settings.proxy||settings.apiUrl||'').replace(/\/+$/,'');if(!p)return null;
  var x=new URL(u),k=PROXY_KEY[x.host];return k?p+'/'+k+x.pathname+x.search:null;
}
// Direto primeiro; se falhar e houver proxy configurado, tenta pelo proxy.
function jget(u,opt){
  return fetchJSON(u,opt).catch(function(e){
    var pu=proxied(u);if(!pu)throw e;
    return fetchJSON(pu,opt).then(function(d){usedProxy[new URL(u).host]=true;return d});
  });
}
function settle(p){return p.then(function(v){return {ok:true,v:v}},function(e){return {ok:false,e:e}})}
function errMsg(e){return e&&e.message?(e.message==='Load failed'||e.message==='Failed to fetch'?'bloqueado (região ou CORS)':e.message):'erro'}

/* ---------- funding: coleta ---------- */
var cache={};
function binExchangeInfo(){
  if(cache.binEx)return Promise.resolve(cache.binEx);
  return jget('https://fapi.binance.com/fapi/v1/exchangeInfo').then(function(d){
    cache.binEx={symbols:d.symbols.map(function(s){return {symbol:s.symbol,contractType:s.contractType,status:s.status,onboardDate:s.onboardDate}})};
    return cache.binEx}).catch(function(){return null});
}
function loadBinance(){
  return Promise.all([
    jget('https://fapi.binance.com/fapi/v1/premiumIndex'),
    jget('https://fapi.binance.com/fapi/v1/ticker/24hr'),
    jget('https://fapi.binance.com/fapi/v1/fundingInfo').catch(function(){return []}),
    binExchangeInfo()
  ]).then(function(a){return FD.parseBinance(a[0],a[1],a[2],a[3])});
}
function bybitInstruments(){
  if(cache.bybIns)return Promise.resolve(cache.bybIns);
  var all=[];
  function page(cursor,n){
    return jget('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'+(cursor?'&cursor='+encodeURIComponent(cursor):''))
    .then(function(d){
      all=all.concat(d.result.list||[]);
      if(d.result.nextPageCursor&&n<5)return page(d.result.nextPageCursor,n+1);
      cache.bybIns=all;return all;
    });
  }
  return page('',0).catch(function(){return null});
}
function loadBybit(){
  return Promise.all([jget('https://api.bybit.com/v5/market/tickers?category=linear'),bybitInstruments()])
    .then(function(a){if(a[0].retCode)throw new Error(a[0].retMsg);return FD.parseBybit(a[0],a[1])});
}
function hl(body){return fetchJSON('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
function loadHL(){return hl({type:'metaAndAssetCtxs'}).then(function(d){return FD.parseHL(d,Date.now())})}
function loadPredicted(){return hl({type:'predictedFundings'}).then(FD.parsePredicted)}

var loading=false;
function load(){
  if(loading)return;loading=true;usedProxy={};
  $('status').textContent='lendo…';$('status').className='chip demo';
  Promise.all([loadBinance(),loadBybit(),loadHL(),loadPredicted()].map(settle)).then(function(res){
    loading=false;
    var rows={},src={},err={},notes=[];
    function add(v,map,how){src[v]=how;Object.keys(map).forEach(function(c){(rows[c]=rows[c]||{})[v]=map[c]})}
    ['Binance','Bybit'].forEach(function(v,i){
      var host=i?'api.bybit.com':'fapi.binance.com';
      if(res[i].ok)add(v,res[i].v,usedProxy[host]?'proxy':'api');
      else{
        err[v]=errMsg(res[i].e);
        if(res[3].ok&&Object.keys(res[3].v[v]).length){add(v,res[3].v[v],'via HL');notes.push(v+': API direta '+err[v]+'; usando o previsto publicado pela Hyperliquid (sem volume, só moedas listadas na HL).')}
        else notes.push(v+': sem resposta ('+err[v]+').');
      }
    });
    if(res[2].ok)add('Hyperliquid',res[2].v,'api');else{err.Hyperliquid=errMsg(res[2].e);notes.push('Hyperliquid: sem resposta ('+err.Hyperliquid+').')}
    var n=Object.keys(src).length;
    state.updated=new Date();state.srcErr=err;
    if(n){
      state.rows=rows;state.live=true;state.src=src;
      var direct=Object.keys(src).filter(function(v){return src[v]!=='via HL'}).length;
      $('status').textContent=direct+'/3 direto'+(n>direct?' +'+(n-direct)+' via HL':'');
      $('status').className='chip '+(direct===3?'live':'demo');
      if(n<2&&state.mode==='pp')notes.push('Só uma exchange respondeu: Perp × Perp precisa de duas.');
    }else{
      state.rows=FD.demoData(Date.now());state.live=false;state.src={};
      $('status').textContent='exemplo';$('status').className='chip demo';
      notes=['Sem acesso às APIs das exchanges agora. Os números do funding são EXEMPLOS, não dados reais. Se abriu o arquivo por um app de mensagens, abra o endereço no Safari.'];
    }
    $('banner').hidden=!notes.length;$('banner').innerHTML=notes.join('<br>');
    $('stamp').textContent='Atualizado '+state.updated.toLocaleTimeString('pt-BR')+' · funding é snapshot do previsto (pode inverter) · retornos são projeção';
    renderScan();renderPositions();renderHome();renderConn();
  });
}

/* ---------- mineração: coleta ---------- */
var mineLoading=false,mineAgain=false;
function loadBook(){
  var direct='https://api2.nicehash.com/main/api/v2/hashpower/orderBook?algorithm=SHA256';
  var pu=proxied(direct);
  var snap=function(){return fetchJSON('data/nicehash.json?'+Math.floor(Date.now()/60000)).then(function(d){return {markets:d.markets,src:'foto GitHub',at:Date.parse(d.at)}})};
  if(pu)return fetchJSON(pu).then(function(d){return {markets:FDM.parseNiceHashBook(d),src:'proxy',at:Date.now()}}).catch(snap);
  return snap();
}
function loadMining(){
  if(mineLoading){mineAgain=true;return}mineLoading=true;mineAgain=false;
  Promise.all([
    fetchJSON('https://api.blockchair.com/bitcoin-cash/stats'),
    fetchJSON('https://mempool.space/api/v1/mining/hashrate/3d'),
    fetchJSON('https://api.blockchair.com/bitcoin-cash/blocks?limit=25'),
    loadBook(),
    fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,bitcoin-cash&vs_currencies=usd'),
    fetchJSON('https://mempool.space/api/v1/prices')
  ].map(settle)).then(function(r){
    mineLoading=false;mine.err={};mine.at=Date.now();
    if(r[0].ok)mine.stats=r[0].v.data;else mine.err.bch=errMsg(r[0].e);
    if(r[1].ok)mine.btcD=r[1].v.currentDifficulty;else mine.err.btc=errMsg(r[1].e);
    if(r[2].ok)mine.blocks=FDM.parseBlocks(r[2].v);else mine.err.blocks=errMsg(r[2].e);
    if(r[3].ok){mine.book=r[3].v.markets;mine.bookSrc=r[3].v.src;mine.bookAt=r[3].v.at}else mine.err.book=errMsg(r[3].e);
    if(r[4].ok)mine.cg=r[4].v;else mine.err.cg=errMsg(r[4].e);
    if(r[5].ok)mine.mp=r[5].v;
    fillPlanLive(false);
    renderMine();renderHome();renderConn();renderSessions();
    if(mineAgain)loadMining();
  });
}
// Valores ao vivo consolidados (com fallback entre fontes).
function live(){
  var bchUsd=mine.stats&&mine.stats.market_price_usd||(mine.cg&&mine.cg['bitcoin-cash']&&mine.cg['bitcoin-cash'].usd)||(mine.blocks[0]&&mine.blocks[0].priceUsd)||null;
  var btcUsd=(mine.cg&&mine.cg.bitcoin&&mine.cg.bitcoin.usd)||(mine.mp&&mine.mp.USD)||null;
  var D=mine.blocks.length?mine.blocks[0].difficulty:(mine.stats&&mine.stats.difficulty)||null;
  var mk=mine.book&&mine.book.filter(function(m){return m.activeOrders})[0]||(mine.book&&mine.book[0])||null;
  var st=mine.blocks.length?FDM.blockStats(mine.blocks,Date.now()):null;
  var fees=st&&st.feesAvgUsd&&bchUsd?st.feesAvgUsd/bchUsd:0;
  return {bchUsd:bchUsd,btcUsd:btcUsd,D:D,book:mk,st:st,rewardCoin:3.125+fees,btcD:mine.btcD};
}
// Blockchair grátis limita o uso por IP: no máximo uma leitura a cada 5 min.
setInterval(function(){if(document.visibilityState==='visible')loadMining()},300000);

/* ---------- histórico de funding ---------- */
var HIST_DAYS=7,histCache={},openHist={};
function loadHist(venue,sym,fallbackH){
  var key=venue+':'+sym,c=histCache[key];
  if(c&&Date.now()-c.at<10*60e3)return Promise.resolve(c.s);
  var start=Date.now()-HIST_DAYS*864e5,p;
  if(venue==='Binance')p=jget('https://fapi.binance.com/fapi/v1/fundingRate?symbol='+encodeURIComponent(sym)+'&startTime='+start+'&limit=1000').then(FD.parseBinanceHist);
  else if(venue==='Bybit')p=jget('https://api.bybit.com/v5/market/funding/history?category=linear&symbol='+encodeURIComponent(sym)+'&startTime='+start+'&endTime='+Date.now()+'&limit=200').then(FD.parseBybitHist);
  else p=hl({type:'fundingHistory',coin:sym,startTime:start}).then(FD.parseHLHist);
  return p.then(function(pts){var s=FD.historySeries(pts,fallbackH);histCache[key]={at:Date.now(),s:s};return s});
}
function oppKey(o){return o.coin+'|'+o.s+'|'+o.l}
function toggleHist(key){
  if(openHist[key]){delete openHist[key];var el=document.querySelector('[data-hist="'+CSS.escape(key)+'"]');if(el)el.hidden=true;return}
  var o=state.ops.filter(function(x){return oppKey(x)===key})[0];if(!o)return;
  openHist[key]={o:o,range:settings.histRange||3,status:'loading'};
  drawHist(key);
  var jobs=[loadHist(o.s,o.rs.sym,o.rs.hours),o.rl?loadHist(o.l,o.rl.sym,o.rl.hours):Promise.resolve(null)];
  Promise.all(jobs.map(settle)).then(function(r){
    var h=openHist[key];if(!h)return;
    h.a=r[0].ok?r[0].v:null;h.b=r[1].ok?r[1].v:null;
    h.err=[!r[0].ok?o.s:null,o.rl&&!r[1].ok?o.l:null].filter(Boolean);
    h.status='done';drawHist(key);
  });
}
function drawHist(key){
  var h=openHist[key],el=document.querySelector('[data-hist="'+CSS.escape(key)+'"]');
  if(!h||!el)return;
  el.hidden=false;
  if(h.status==='loading'){el.innerHTML='<div class="note">Carregando histórico de pagamentos…</div>';return}
  if(h.err.length){el.innerHTML='<div class="note">Histórico indisponível para '+h.err.join(' e ')+' neste acesso (bloqueio de região ou CORS). Configure um proxy em Ajustes.</div>';return}
  var o=h.o,days=h.range,since=Date.now()-days*864e5;
  var spread=FD.spreadSeries(h.a,h.b).filter(function(x){return x.t>=since});
  var be=o.m.beApr,st=FD.seriesStats(spread,be);
  var lastA=h.a[h.a.length-1],lastB=h.b?h.b[h.b.length-1]:null;
  var seg=[1,3,7].map(function(d){return '<button class="sm" data-range="'+d+'" aria-pressed="'+(d===days)+'">'+(d===1?'24h':d+'d')+'</button>'}).join('');
  var html='<div class="row" style="justify-content:space-between"><h3>Spread pago, % a.a. <span class="tag">dado real</span></h3><div class="seg">'+seg+'</div></div>';
  if(!st){el.innerHTML=html+'<div class="note">Sem pagamentos no período.</div>';return}
  var pts=spread.map(function(x){return {t:x.t,v:x.apr}});
  html+='<div class="chart">'+chartSVG(pts,be,function(v){return pct(v,1)})+'<div class="tip" hidden></div></div>'+
    '<div class="kv"><div><small>Média</small><span class="'+cls(st.mean,be,0)+'">'+pct(st.mean,1)+'</span></div>'+
    '<div><small>Mín / máx</small><span>'+st.min.toFixed(0)+' / '+st.max.toFixed(0)+'</span></div>'+
    '<div><small>Horas ≥ b.e.</small><span>'+(st.pctAboveBe===null?'—':st.pctAboveBe.toFixed(0)+'%')+'</span></div></div>'+
    '<div class="legs">Último pago: <b>'+o.s+'</b> '+pct(lastA.rate,4)+' ('+pct(lastA.apr,1)+' a.a.) às '+hhmm(lastA.t)+
    (lastB?' · <b>'+o.l+'</b> '+pct(lastB.rate,4)+' ('+pct(lastB.apr,1)+' a.a.) às '+hhmm(lastB.t):'')+'</div>'+
    '<div class="note">Linha tracejada: spread de break-even do ciclo ('+pct(be,1)+'). Spread alto só nas últimas horas e média baixa indica pico, não tendência.</div>'+
    '<details><summary>Ver tabela (média por dia)</summary>'+dailyTable(spread)+'</details>';
  el.innerHTML=html;
  bindChart(el.querySelector('.chart'),pts,function(v){return pct(v,1)});
}
function dailyTable(s){
  var by={};s.forEach(function(x){var d=new Date(x.t).toLocaleDateString('pt-BR');(by[d]=by[d]||[]).push(x.apr)});
  return '<table><tr><th>Dia</th><th>Média</th><th>Mín</th><th>Máx</th></tr>'+Object.keys(by).map(function(d){var v=by[d];
    return '<tr><td>'+d+'</td><td>'+pct(v.reduce(function(a,b){return a+b},0)/v.length,1)+'</td><td>'+Math.min.apply(null,v).toFixed(1)+'</td><td>'+Math.max.apply(null,v).toFixed(1)+'</td></tr>'}).join('')+'</table>';
}

/* ---------- gráfico de linha (uma série) ---------- */
var CW=340,CH=150,PL=38,PR=8,PT=10,PB=18;
function chartScale(s,ref){
  var v=s.map(function(x){return x.v});if(isFinite(ref))v.push(ref);
  var lo=Math.min.apply(null,v),hi=Math.max.apply(null,v);if(hi-lo<1e-9)hi=lo+1;
  var pad=(hi-lo)*0.08;lo-=pad;hi+=pad;
  var t0=s[0].t,t1=s[s.length-1].t;if(t1===t0)t1=t0+HOUR;
  return {x:function(t){return PL+(t-t0)/(t1-t0)*(CW-PL-PR)},y:function(v){return PT+(hi-v)/(hi-lo)*(CH-PT-PB)},lo:lo,hi:hi,t0:t0,t1:t1};
}
function chartSVG(s,ref,fmt,tickFmt){
  tickFmt=tickFmt||function(t){return t.toFixed(0)};
  var k=chartScale(s,ref),ticks=[k.lo,(k.lo+k.hi)/2,k.hi];
  var d=s.map(function(p,i){return (i?'L':'M')+k.x(p.t).toFixed(1)+' '+k.y(p.v).toFixed(1)}).join('');
  var g=ticks.map(function(t){var y=k.y(t).toFixed(1);return '<line x1="'+PL+'" x2="'+(CW-PR)+'" y1="'+y+'" y2="'+y+'"/>'}).join('');
  var yl=ticks.map(function(t){return '<text x="'+(PL-4)+'" y="'+(k.y(t)+3).toFixed(1)+'" text-anchor="end">'+tickFmt(t)+'</text>'}).join('');
  var last=s[s.length-1],lx=k.x(last.t),ly=k.y(last.v);
  var xl='<text x="'+PL+'" y="'+(CH-4)+'">'+new Date(k.t0).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' '+hhmm(k.t0)+'</text>'+
    '<text x="'+(CW-PR)+'" y="'+(CH-4)+'" text-anchor="end">agora</text>';
  return '<svg viewBox="0 0 '+CW+' '+CH+'" preserveAspectRatio="none" role="img" aria-label="Série de '+fmt(s[0].v)+' a '+fmt(last.v)+'">'+
    '<g class="grid">'+g+'</g>'+
    (k.lo<0&&k.hi>0?'<line class="zero" x1="'+PL+'" x2="'+(CW-PR)+'" y1="'+k.y(0)+'" y2="'+k.y(0)+'"/>':'')+
    (isFinite(ref)?'<line class="be" x1="'+PL+'" x2="'+(CW-PR)+'" y1="'+k.y(ref).toFixed(1)+'" y2="'+k.y(ref).toFixed(1)+'"/>':'')+
    '<path class="ln" d="'+d+'" vector-effect="non-scaling-stroke"/>'+
    '<g class="axis">'+yl+xl+'</g>'+
    '<line class="xh" x1="0" x2="0" y1="'+PT+'" y2="'+(CH-PB)+'" visibility="hidden" vector-effect="non-scaling-stroke"/>'+
    '<circle class="dot" cx="'+lx.toFixed(1)+'" cy="'+ly.toFixed(1)+'" r="4"/>'+
    '<text class="lbl" x="'+Math.min(lx,CW-PR-4).toFixed(1)+'" y="'+(ly<PT+14?ly+14:ly-8).toFixed(1)+'" text-anchor="end">'+fmt(last.v)+'</text>'+
    '</svg>';
}
function bindChart(box,s,fmt){
  var svg=box.querySelector('svg'),tip=box.querySelector('.tip'),xh=svg.querySelector('.xh'),k=chartScale(s,NaN);
  function move(e){
    var r=svg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*CW;
    var t=k.t0+(x-PL)/(CW-PL-PR)*(k.t1-k.t0),best=s[0];
    s.forEach(function(p){if(Math.abs(p.t-t)<Math.abs(best.t-t))best=p});
    var px=k.x(best.t);
    xh.setAttribute('x1',px);xh.setAttribute('x2',px);xh.setAttribute('visibility','visible');
    tip.hidden=false;tip.style.left=Math.max(50,Math.min(r.width-50,px/CW*r.width))+'px';
    tip.textContent=new Date(best.t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' · '+fmt(best.v);
  }
  function out(){tip.hidden=true;xh.setAttribute('visibility','hidden')}
  svg.addEventListener('pointermove',move);svg.addEventListener('pointerdown',move);svg.addEventListener('pointerleave',out);
}

/* ---------- funding: scanner ---------- */
function scanParams(){
  return {capital:num('cap'),lev:num('lev')||1,hold:hold(),minVol:num('minvol')*1e6,minOi:num('minoi')*1e6,aprCap:num('acap')||1e9,
    mode:state.mode,fees:FEES,execShort:$('exS').value,execLong:$('exL').value,slipPct:num('slip'),rebalUsd:num('rebal'),sort:$('sort').value,now:Date.now()};
}
function srcTag(v){var s=state.src[v];return s&&s!=='api'?' <span class="tag">'+s+'</span>':''}
function nextLine(o){
  var parts=[[o.s,o.rs]].concat(o.rl?[[o.l,o.rl]]:[]).filter(function(x){return x[1].next});
  if(!parts.length)return '';
  return '<div class="legs">Próximo funding: '+parts.map(function(x){return '<b>'+x[0]+'</b> '+hhmm(x[1].next)+' (<span class="cd" data-next="'+x[1].next+'">'+cd(x[1].next)+'</span>)'}).join(' · ')+'</div>';
}
function renderScan(){
  var p=scanParams(),ops=FD.opportunities(state.rows,p);state.ops=ops;
  var pairs={};
  ops.slice(0,25).forEach(function(o){
    if(o.m.netOnCap<=0)return;
    var key=state.mode==='pp'?[o.s,o.l].sort().join(' + '):o.s+' + Spot';
    pairs[key]=(pairs[key]||0)+o.m.netOnCap;
  });
  var pk=Object.keys(pairs).sort(function(a,b){return pairs[b]-pairs[a]});
  $('best').innerHTML='<h2>Melhor par agora <span class="tag">projeção</span></h2>'+(pk.length?
    '<div class="big">'+pk[0]+'</div><div class="note" style="margin-top:6px">Soma do retorno líquido projetado nas 25 melhores moedas. '+(pk[1]?'Seguinte: '+pk[1]+'.':'')+' Confirme taxas e acesso à exchange na sua conta e jurisdição antes de depositar.</div>':
    '<div class="note">Nenhuma moeda passa nos filtros. Reduza o volume mínimo ou aumente a duração.</div>');
  var newDays=num('newdays'),html='';
  ops.slice(0,30).forEach(function(o){
    var key=oppKey(o),k=o.m.netOnCap>0.3&&o.m.be<=p.hold?'g':(o.m.netOnCap>0?'w':'r');
    var tag=state.live?'':'<span class="chip demo">exemplo</span>';
    if(o.capped)tag+='<span class="chip demo">extremo</span>';
    if(o.age!==null&&o.age<newDays)tag+='<span class="chip warn" title="Listing recente: teto e intervalo de funding podem mudar">novo · '+Math.max(0,Math.floor(o.age))+'d</span>';
    var lev=o.rs.maxLev&&o.rs.maxLev<p.lev?'<span class="chip bad">alav. máx '+o.rs.maxLev+'x</span>':'';
    html+='<div class="card opp '+k+'"><div class="h"><span><span class="coin">'+esc(o.coin)+'</span>'+tag+lev+'</span><span class="big '+(o.m.netOnCap>0?'good':'bad')+'">'+pct(o.m.netOnCap)+'</span></div>'+
    '<div class="legs">Short <b>'+o.s+'</b>'+srcTag(o.s)+' ('+pct(o.rs.apr,1)+' a.a., '+o.rs.hours+'h)'+(o.rl?' · Long <b>'+o.l+'</b>'+srcTag(o.l)+' ('+pct(o.rl.apr,1)+' a.a., '+o.rl.hours+'h)':' · Long <b>spot</b> (sem funding; confirme que há spot)')+'</div>'+
    '<div class="kv"><div><small>Spread previsto</small><span class="'+cls(o.spread,25,10)+'">'+pct(o.spread,1)+'</span></div>'+
    '<div><small>Break-even</small><span>'+(isFinite(o.m.be)?o.m.be.toFixed(1)+' d':'—')+'</span></div>'+
    '<div><small>Líq. projetado</small><span>'+usd(o.m.netUsd)+'</span></div>'+
    '<div><small>Notional/perna</small><span>'+usd(o.m.notional)+'</span></div>'+
    '<div><small>Volume 24h</small><span>'+mi(o.vol)+'</span></div>'+
    '<div><small>Custos</small><span>'+usd(o.m.cost)+'</span></div></div>'+
    nextLine(o)+
    '<div class="row"><button class="sm" data-histbtn="'+esc(key)+'">'+(openHist[key]?'Fechar histórico':'Histórico')+'</button>'+
    '<button class="sm" data-calc="'+esc(key)+'">Calculadora</button>'+
    '<button class="sm" data-reg="'+esc(key)+'">Registrar posição</button></div>'+
    '<div class="hist" data-hist="'+esc(key)+'" hidden></div></div>';
  });
  $('list').innerHTML=html||'<div class="card note">Sem resultados.</div>';
  Object.keys(openHist).forEach(function(key){
    var o=ops.filter(function(x){return oppKey(x)===key})[0];
    if(!o){delete openHist[key];return}
    openHist[key].o=o;drawHist(key);
  });
}

/* ---------- funding: calculadora ---------- */
function renderCalc(){
  var rate=num('c_rate'),hrs=num('c_int')||8,apr=FD.aprFrom(rate/100,hrs),days=num('c_days')||1;
  var m=FD.cycle({capital:num('c_cap'),lev:num('c_lev')||1,aprNet:apr,days:days,feePct:num('c_fee'),exec:num('c_exec'),slipPct:num('c_slip'),fixedUsd:num('c_rebal')});
  var rows=[
    ['Spread anualizado',pct(apr,1),cls(apr,25,10)],
    ['Notional por perna',usd(m.notional),''],
    ['Funding bruto no ciclo',usd(m.gross),''],
    ['Taxas de execução','-'+usd(m.feeUsd),'warn'],
    ['Slippage + rebalanceamento','-'+usd(m.cost-m.feeUsd),'warn'],
    ['Resultado líquido do ciclo',usd(m.netUsd),m.netUsd>=0?'good':'bad'],
    ['Retorno sobre o capital',pct(m.netOnCap),m.netUsd>=0?'good':'bad'],
    ['Por dia (bruto)',usd(m.perDayUsd),''],
    ['Break-even',isFinite(m.be)?m.be.toFixed(1)+' dias':'nunca',m.be<=days?'good':'bad'],
    ['Spread mínimo para empatar em '+days+'d',pct(m.beApr,1),''],
    ['Ciclos de '+days+'d para dobrar',m.netOnCap>0?Math.ceil(Math.log(2)/Math.log(1+m.netOnCap/100))+' ciclos':'—','']
  ];
  $('c_out').innerHTML=resRows(rows);
}
function resRows(rows){return rows.map(function(r){return '<div><span class="mute">'+r[0]+'</span><span class="mono '+(r[2]||'')+'">'+r[1]+'</span></div>'}).join('')}

/* ---------- mineração: telas ---------- */
var SIG_TXT={favoravel:'Favorável',neutro:'Perto do empate',desfavoravel:'Desfavorável','sem-dado':'Sem dado'};
var SIG_CHIP={favoravel:'ok',neutro:'warn',desfavoravel:'bad','sem-dado':''};
function refPrice(L){return L.book?(L.book.medianWeighted||L.book.minActive):null}
function mineSignal(L){
  if(!L.D||!L.bchUsd||!L.btcUsd)return {sig:FDM.signal({edgePct:NaN})};
  var price=refPrice(L);
  var p=price?FDM.plan({ph:1,hours:24,D:L.D,rewardCoin:L.rewardCoin,coinUsd:L.bchUsd,priceBtcPerEhDay:price,btcUsd:L.btcUsd,rentFeePct:3,poolFeePct:num('mp_pfee')||2}):null;
  return {p:p,price:price,sig:FDM.signal({edgePct:p?p.edgePct:NaN,diffVsAvgPct:L.st?L.st.diffVsAvgPct:NaN})};
}
function sigHTML(L,R,compact){
  var s=R.sig,hp=L.D&&L.bchUsd?FDM.hashpriceUsd(L.D,L.rewardCoin,L.bchUsd):null;
  var h='<div class="row" style="justify-content:space-between"><h2 style="margin:0">Mineração BCH agora</h2><span class="chip '+SIG_CHIP[s.level]+'">'+SIG_TXT[s.level]+'</span></div>';
  if(R.p){
    h+='<div class="row" style="margin-top:10px;align-items:baseline"><span class="huge '+(R.p.edgePct>=0?'good':R.p.edgePct>=-5?'warn':'bad')+'">'+pct(R.p.edgePct,1)+'</span><span class="note">receita esperada vs aluguel (mediana, taxas incluídas)</span></div>';
    h+='<ul class="rules note" style="margin-top:8px">'+s.reasons.map(function(x){return '<li>'+x+'</li>'}).join('')+'</ul>';
  }else h+='<p class="note">'+(hp?'Sem preço de aluguel da NiceHash agora. Digite o preço em Planejar para calcular.':'Carregando dados da rede…')+'</p>';
  if(L.st)h+='<div class="legs" style="margin-top:6px">Último bloco há <b class="cd" data-ago="'+L.st.last.time+'">'+ago(L.st.last.time)+'</b>'+(compact?'':' · média dos últimos 10: <b>'+L.st.avg10.toFixed(1)+' min</b>')+'</div>';
  return h;
}
function renderMine(){
  var L=live(),R=mineSignal(L);
  var el=$('m_sig');el.className='card sig '+R.sig.level;el.innerHTML=sigHTML(L,R);
  var hp=L.D&&L.bchUsd?FDM.hashpriceUsd(L.D,L.rewardCoin,L.bchUsd):null;
  var hpBtc=L.btcD&&L.btcUsd?FDM.hashpriceUsd(L.btcD,3.125,L.btcUsd):null;
  var kv=[
    ['Receita BCH /PH·dia',hp?usd(hp):'—'],
    ['Aluguel /PH·dia',R.p?usd(R.p.rentPerPhDay):'—'],
    ['Preço de empate',R.p?R.p.breakEvenPrice.toFixed(4)+' BTC/EH':'—'],
    ['Receita BTC /PH·dia',hpBtc?usd(hpBtc):'—'],
    ['Dificuldade BCH',L.D?nf(L.D/1e9,1)+' G':'—'],
    ['vs média '+(L.st?L.st.n:25)+' blocos',L.st?pct(L.st.diffVsAvgPct,1):'—'],
    ['PH·dia por bloco',L.D?nf(FDM.phDaysPerBlock(L.D),1):'—'],
    ['BCH',L.bchUsd?usd(L.bchUsd):'—'],
    ['BTC',L.btcUsd?usd(L.btcUsd):'—']
  ];
  $('m_kv').innerHTML=kv.map(function(x){return '<div><small>'+x[0]+'</small><span>'+x[1]+'</span></div>'}).join('');
  var b=L.book;
  $('m_book').innerHTML=b?
    '<div class="kv"><div><small>Ordens pagando</small><span>'+b.activeOrders+' de '+b.orders+'</span></div>'+
    '<div><small>Velocidade total</small><span>'+nf(b.totalSpeed*1000,2)+' PH/s</span></div>'+
    '<div><small>Máquinas</small><span>'+nf(b.rigs)+'</span></div>'+
    '<div><small>Menor preço ativo</small><span>'+(b.minActive?b.minActive.toFixed(4):'—')+'</span></div>'+
    '<div><small>Mediana (por velocidade)</small><span>'+(b.medianWeighted?b.medianWeighted.toFixed(4):'—')+'</span></div>'+
    '<div><small>Maior preço ativo</small><span>'+(b.maxActive?b.maxActive.toFixed(4):'—')+'</span></div></div>'+
    '<p class="note" style="margin:8px 0 0">Preços em BTC por EH/s por dia. Fonte: '+mine.bookSrc+(mine.bookAt?', '+ago(mine.bookAt)+' atrás':'')+'. A NiceHash não deixa o navegador ler o livro direto; sem proxy, a foto do GitHub atrasa ~10-30 min.</p>'
    :'<p class="note">Livro indisponível ('+(mine.err.book||'carregando')+'). Digite o preço em Planejar.</p>';
  renderNet(L);renderPlan();
}
function renderNet(L){
  var st=L.st;
  $('n_kv').innerHTML=st?[
    ['Altura',nf(st.last.height)],['Último bloco','<span data-ago="'+st.last.time+'">'+ago(st.last.time)+'</span>'],['Média 10 blocos',st.avg10.toFixed(1)+' min'],
    ['Média '+st.n+' blocos',st.avgAll.toFixed(1)+' min'],['Dificuldade',nf(st.difficulty/1e9,2)+' G'],['vs média',pct(st.diffVsAvgPct,1)],
    ['Taxas por bloco',usd(st.feesAvgUsd)],['Blocos 24h',mine.stats?mine.stats.blocks_24h:'—'],['Fonte','Blockchair']
  ].map(function(x){return '<div><small>'+x[0]+'</small><span>'+x[1]+'</span></div>'}).join(''):'<div class="note">'+(mine.err.blocks?'Sem dados da rede ('+mine.err.blocks+').':'Carregando…')+'</div>';
  if(mine.blocks.length>1){
    var pts=mine.blocks.slice().reverse().map(function(b){return {t:b.time,v:b.difficulty/1e9}});
    $('n_chart').innerHTML=chartSVG(pts,NaN,function(v){return nf(v,1)+' G'},function(t){return t.toFixed(0)})+'<div class="tip" hidden></div>';
    bindChart($('n_chart'),pts,function(v){return nf(v,2)+' G'});
  }
  var rows=mine.blocks.slice(0,25).map(function(b,i){
    var nx=mine.blocks[i+1],iv=nx?(b.time-nx.time)/60000:null,who=b.miner||b.tag||'—';
    var bs=/blocksniper/i.test(b.tag);
    return '<tr><td>'+b.height+'</td><td>'+hhmm(b.time)+'</td><td>'+(iv===null?'—':iv.toFixed(1)+'m')+'</td><td class="wrap'+(bs?' warn':'')+'">'+esc(who.slice(0,40))+'</td><td>'+nf(b.difficulty/1e9,1)+'</td></tr>';
  }).join('');
  $('n_blocks').innerHTML='<tr><th>Bloco</th><th>Hora</th><th>Interv.</th><th>Quem</th><th>Dif. G</th></tr>'+rows;
}
function fillPlanLive(force){
  var L=live();
  function set(id,v,d){if(v===null||v===undefined||!isFinite(v))return;if(force||$(id).value==='')$(id).value=d===undefined?v:(+v).toFixed(d)}
  set('mp_d',L.D?L.D/1e9:null,2);set('mp_bch',L.bchUsd,2);set('mp_btc',L.btcUsd,0);set('mp_price',refPrice(L),4);
  if($('s_d').value==='')set('s_d',L.D?L.D/1e9:null,2);
  $('mp_src').textContent=L.D?'Ao vivo: dificuldade e cotações (Blockchair), preço = mediana do livro NiceHash.':'';
}
function planParams(){
  return {ph:num('mp_ph'),hours:num('mp_h'),D:num('mp_d')*1e9,rewardCoin:num('mp_rw'),coinUsd:num('mp_bch'),priceBtcPerEhDay:num('mp_price'),
    btcUsd:num('mp_btc'),rentFeePct:num('mp_rfee'),poolFeePct:num('mp_pfee'),orderFeeBtc:num('mp_ofee')};
}
function renderPlan(){
  var q=planParams();
  if(!(q.D>0&&q.coinUsd>0&&q.btcUsd>0&&q.ph>0&&q.hours>0)){$('mp_out').innerHTML='<div class="note">Preencha potência, duração, dificuldade e cotações (ou toque em Usar dados ao vivo).</div>';return}
  var p=FDM.plan(q),cpd=FDM.rentalUsdPerPhDay(q.priceBtcPerEhDay,q.btcUsd,q.rentFeePct);
  var hpb=FDM.hoursPerBlock(q.ph,q.D);
  $('mp_out').innerHTML=resRows([
    ['Custo da sessão',usd(p.cost),''],
    ['Blocos esperados (λ)',p.lambda.toFixed(3),''],
    ['Chance de ao menos 1 bloco',pctp(p.p1*100)+(p.p1>0?' (1 em '+nf(1/p.p1,1)+')':''),''],
    ['Chance de 2 ou mais',pctp(p.p2*100),''],
    ['Chance de perder tudo (0 blocos)',pctp(p.p0*100),p.p0>0.5?'bad':'warn'],
    ['Bloco líquido (após pool)',usd(p.blockNet),''],
    ['Valor esperado',usd(p.ev),''],
    ['Resultado esperado',usd(p.evNet),p.evNet>=0?'good':'bad'],
    ['Retorno esperado por US$1',p.evRatio?'US$'+p.evRatio.toFixed(3):'—',p.evRatio>=1?'good':(p.evRatio>=0.95?'warn':'bad')],
    ['Tempo médio por bloco nesse ritmo',hpb<48?nf(hpb,1)+' h':nf(hpb/24,1)+' dias',''],
    ['Orçamento p/ 50% de chance',cpd>0?usd(FDM.budgetForProb(0.5,q.D,cpd)):'—',''],
    ['Orçamento p/ 90% de chance',cpd>0?usd(FDM.budgetForProb(0.9,q.D,cpd)):'—',''],
    ['Preço de empate',p.breakEvenPrice.toFixed(4)+' BTC/EH/dia','']
  ]);
  renderInvest();
}

/* ---------- investimento × retorno ---------- */
var invScenario='now';
function renderInvest(){
  var q=planParams();
  if(!(q.D>0&&q.coinUsd>0&&q.btcUsd>0&&q.priceBtcPerEhDay>0)){$('iv_out').innerHTML='<div class="note">Preencha preço, dificuldade e cotações acima.</div>';$('iv_tab').innerHTML='';return}
  var p=FDM.plan(q),blockNet=p.blockNet,edge=num('iv_edge');
  var cpbNow=FDM.costPerBlock(q.D,FDM.rentalUsdPerPhDay(q.priceBtcPerEhDay,q.btcUsd,q.rentFeePct));
  var cpb=invScenario==='cap'?blockNet*(1-edge/100):cpbNow;
  var total=num('iv_total')||1000,sess=num('iv_sess')||total,stop=$('iv_stop').checked;
  var a=FDM.investment(total,cpb,blockNet),n=Math.max(1,Math.round(total/sess));
  var sim=FDM.simulateSessions({sessions:n,budget:sess,cpb:cpb,blockNet:blockNet,stopOnBlock:stop,runs:5000,seed:42});
  var ratio=blockNet/cpb;
  $('iv_out').innerHTML=resRows([
    ['Custo médio por bloco',usd(cpb),''],
    ['Bloco líquido (após pool)',usd(blockNet),''],
    ['Retorno por US$1','US$'+ratio.toFixed(3),ratio>=1?'good':'bad'],
    ['Blocos esperados com '+usd(total),a.lambda.toFixed(2),''],
    ['Blocos necessários para lucrar',String(a.kProfit),''],
    ['Chance de lucro gastando tudo',pctp(a.pProfit*100),a.pProfit>=0.5?'good':'warn'],
    ['Chance de nenhum bloco',pctp(a.pLossAll*100),a.pLossAll>0.3?'bad':''],
    ['Resultado esperado',usd(a.expectedNet),a.expectedNet>=0?'good':'bad'],
    ['Faixa provável (10% a 90%)',usd(a.p10)+' a '+usd(a.p90),''],
    [n+' sessões de '+usd(sess)+(stop?', parando no bloco':''),'lucro em '+pctp(sim.pProfit*100)+' dos cenários',sim.pProfit>=0.5?'good':'warn'],
    ['Sessões: resultado médio / mediano',usd(sim.mean)+' / '+usd(sim.p50),sim.mean>=0?'good':'bad'],
    ['Sessões: gasto médio / blocos médios',usd(sim.avgSpent)+' / '+sim.avgBlocks.toFixed(2),'']
  ]);
  var inv=[500,1000,2000,5000,10000,20000,50000];
  $('iv_tab').innerHTML='<tr><th>Investe</th><th>Blocos</th><th>P(lucro)</th><th>Esperado</th><th>10%–90%</th></tr>'+inv.map(function(v){
    var x=FDM.investment(v,cpb,blockNet);
    return '<tr><td>'+usd(v).replace(',00','')+'</td><td>'+x.lambda.toFixed(1)+'</td><td class="'+(x.pProfit>=0.5?'good':'bad')+'">'+pctp(x.pProfit*100,0)+'</td><td class="'+(x.expectedNet>=0?'good':'bad')+'">'+usd(x.expectedNet).replace(/,\d\d$/,'')+'</td><td>'+nf(x.p10)+' a '+nf(x.p90)+'</td></tr>'}).join('');
}

/* ---------- backend (operação) ---------- */
var ops={status:null,orders:[],pools:[],log:[],bal:null,err:{},at:0,dirty:false};
function apiCfg(){return {url:(settings.apiUrl||'').replace(/\/+$/,''),token:ls('fd_tok')||''}}
function apiCall(method,path,body){
  var c=apiCfg();
  if(!c.url)return Promise.reject(new Error('backend não configurado (Ajustes)'));
  return fetch(c.url+'/api'+path,{method:method,headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
    .then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j})});
}
var opsLoading=false;
function loadOps(){
  if(!apiCfg().url){renderOps();return}
  if(opsLoading)return;opsLoading=true;
  Promise.all([apiCall('GET','/status'),apiCall('GET','/orders'),apiCall('GET','/balance'),apiCall('GET','/pools'),apiCall('GET','/log')].map(settle)).then(function(r){
    opsLoading=false;ops.at=Date.now();ops.err={};
    if(r[0].ok)ops.status=r[0].v;else{ops.status=null;ops.err.status=r[0].e.message}
    if(r[1].ok)ops.orders=r[1].v.orders||[];else ops.err.orders=r[1].e.message;
    if(r[2].ok)ops.bal=r[2].v;else ops.err.bal=r[2].e.message;
    if(r[3].ok)ops.pools=r[3].v.list||[];else ops.err.pools=r[3].e.message;
    if(r[4].ok)ops.log=r[4].v.log||[];
    renderOps();renderHome();
  });
}
setInterval(function(){if(document.visibilityState==='visible'&&!$('mine-ops').hidden&&!$('tab-mine').hidden)loadOps()},30000);
var MODE_TXT={off:'Desligado',observe:'Observando',active:'Ativo'},MODE_CHIP={off:'',observe:'warn',active:'ok'};
var BOT_FIELDS=['mode','onBlock','payoutAddress','minEdgePct','bidPremiumPct','targetPh','minPh','sessionBudgetUsd','dailyBudgetUsd','poolFeePct','rentFeePct','poolId','orderAmountBtc'];
function renderOps(){
  var c=apiCfg(),st=ops.status;
  if(!c.url){
    $('o_conn').innerHTML='<h2>Backend não configurado</h2><p class="note">Para operar (ordens, robô, parada no bloco) é preciso publicar o backend no Cloudflare e informar o endereço e o token. O passo a passo está no README do repositório.</p><div class="row"><button class="sm" data-go="set">Abrir Ajustes</button></div>';
    ['o_status','o_orders','o_log'].forEach(function(id){$(id).innerHTML=''});$('o_bal').textContent='';return;
  }
  $('o_conn').innerHTML=st?'<div class="row" style="justify-content:space-between"><h2 style="margin:0">Backend</h2><span class="chip ok">conectado</span></div>'+
    '<div class="kv" style="margin-top:10px"><div><small>NiceHash</small><span class="'+(st.nhEnv==='produção'?'warn':'')+'">'+esc(st.nhEnv)+'</span></div><div><small>Chaves</small><span class="'+(st.keys?'good':'bad')+'">'+(st.keys?'ok':'faltando')+'</span></div><div><small>Telegram</small><span>'+(st.telegram?'ok':'—')+'</span></div>'+
    '<div><small>Teto por ordem</small><span>'+st.limits.maxOrderBtc+' BTC</span></div><div><small>Teto de potência</small><span>'+st.limits.maxLimitPh+' PH/s</span></div><div><small>Versão</small><span>'+esc(st.version)+'</span></div></div>'
    :'<div class="row" style="justify-content:space-between"><h2 style="margin:0">Backend</h2><span class="chip bad">sem conexão</span></div><p class="note">'+esc(ops.err.status||'carregando…')+'</p>';
  if(!st){$('o_status').innerHTML='';return}
  var cfg=st.config,s=st.state||{},m=s.market||{};
  var lvl=m.green===undefined?'sem-dado':(m.green?'favoravel':(m.edgeAtBidPct>=0?'neutro':'desfavoravel'));
  $('o_status').className='card sig '+lvl;
  $('o_status').innerHTML='<div class="row" style="justify-content:space-between"><h2 style="margin:0">Robô</h2><span class="chip '+MODE_CHIP[cfg.mode]+'">'+MODE_TXT[cfg.mode]+'</span></div>'+
    (m.bidEH?'<div class="row" style="margin-top:10px;align-items:baseline"><span class="huge '+(m.green?'good':m.edgeAtBidPct>=0?'warn':'bad')+'">'+pct(m.edgeAtBidPct,1)+'</span><span class="note">margem no lance (servidor)</span></div>'+
    '<div class="kv" style="margin-top:8px"><div><small>Lance</small><span>'+m.bidEH.toFixed(4)+'</span></div><div><small>Teto</small><span>'+m.capEH.toFixed(4)+'</span></div><div><small>Empate</small><span>'+m.breakEvenEH.toFixed(4)+'</span></div>'+
    '<div><small>Custo/bloco</small><span>'+usd(m.costPerBlockUsd)+'</span></div><div><small>Gasto hoje</small><span>'+usd(s.dailyUsd||0)+'</span></div><div><small>Blocos achados</small><span>'+(s.myBlocks||[]).length+'</span></div></div>'
    :'<p class="note">'+esc(m.reason||'Sem ciclo ainda. Toque em Rodar ciclo agora.')+'</p>')+
    '<div class="legs" style="margin-top:6px">Último ciclo: '+(s.lastTick?'<b data-ago="'+s.lastTick+'">'+ago(s.lastTick)+'</b> atrás':'nunca')+(s.lastHeight?' · bloco BCH '+s.lastHeight:'')+'</div>'+
    ((s.errors||[]).length?'<div class="note bad">'+esc(s.errors.join('; '))+'</div>':'')+
    ((s.myBlocks||[]).length?'<div class="legs">Seus blocos: '+s.myBlocks.slice(-5).reverse().map(function(b){return '<b>'+b.height+'</b> ('+(+b.bch).toFixed(4)+' BCH)'}).join(' · ')+'</div>':'');
  var btcUsd=m.btcUsd||live().btcUsd;
  $('o_bal').innerHTML=ops.bal?'Saldo disponível: <b>'+(+ops.bal.available).toFixed(8)+' BTC</b>'+(btcUsd?' ('+usd(+ops.bal.available*btcUsd)+')':''):esc(ops.err.bal||'');
  $('o_orders').innerHTML=ops.orders.length?ops.orders.map(function(o){
    return '<div class="card opp '+(o.managed?'g':'')+'" style="background:var(--panel2)"><div class="h"><span><b class="mono">'+esc(String(o.id).slice(0,8))+'</b>'+(o.managed?'<span class="chip ok">robô gerencia</span>':'<span class="chip">manual</span>')+'</span><span class="mono">'+esc(o.status)+'</span></div>'+
      '<div class="kv"><div><small>Preço</small><span>'+o.priceEH.toFixed(4)+'</span></div><div><small>Limite</small><span>'+nf(o.limitPH,2)+' PH</span></div><div><small>Entregando</small><span>'+nf(o.speedPH,2)+' PH</span></div>'+
      '<div><small>Gasto</small><span>'+o.paidBtc.toFixed(6)+'</span></div><div><small>Disponível</small><span>'+o.availableBtc.toFixed(6)+'</span></div><div><small>Pool</small><span style="font-size:12px">'+esc(o.poolName||'—')+'</span></div></div>'+
      '<div class="grid2"><label>Novo preço<input data-op="'+esc(o.id)+'" type="number" inputmode="decimal" step="0.0001" value="'+o.priceEH.toFixed(4)+'"></label><label>Nova potência (PH/s)<input data-ol="'+esc(o.id)+'" type="number" inputmode="decimal" value="'+o.limitPH.toFixed(2)+'"></label></div>'+
      '<div class="row"><button class="sm pri" data-oupd="'+esc(o.id)+'">Aplicar</button><button class="sm" data-orefill="'+esc(o.id)+'">Reabastecer</button><button class="sm" data-oman="'+esc(o.id)+'" data-v="'+(o.managed?0:1)+'">'+(o.managed?'Tirar do robô':'Robô gerencia')+'</button><button class="sm" data-ocancel="'+esc(o.id)+'">Cancelar</button></div></div>';
  }).join(''):'<p class="note">'+esc(ops.err.orders||'Nenhuma ordem ativa.')+'</p>';
  var popts='<option value="">—</option>'+ops.pools.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+' ('+esc(p.stratumHostname)+')</option>'}).join('');
  $('b_poolId').innerHTML=popts;$('n_pool').innerHTML=popts;
  if(!ops.dirty)BOT_FIELDS.forEach(function(k){var el=$('b_'+k);if(el)el.value=cfg[k]===undefined?'':cfg[k]});
  $('b_autoCreate').checked=!!cfg.autoCreate;
  if(cfg.poolId)$('n_pool').value=cfg.poolId;
  if(m.bidEH&&!$('n_price').value)$('n_price').value=m.bidEH.toFixed(4);
  if(!$('pl_user').value&&cfg.payoutAddress)$('pl_user').value=cfg.payoutAddress;
  var eh=(s.edgeHist||[]).map(function(x){return {t:x[0],v:x[1]}});
  if(eh.length>1){$('o_edge').innerHTML=chartSVG(eh,0,function(v){return pct(v,1)})+'<div class="tip" hidden></div>';bindChart($('o_edge'),eh,function(v){return pct(v,1)})}
  else $('o_edge').innerHTML='<p class="note">O histórico aparece depois de algumas horas de ciclos.</p>';
  var KC={acao:'ok',simulado:'warn',erro:'bad',bloco:'ok',config:''};
  $('o_log').innerHTML=ops.log.slice(0,40).map(function(l){return '<div><span class="note" style="flex:1"><span class="chip '+(KC[l.kind]||'')+'">'+esc(l.kind)+'</span> '+esc(l.text)+'</span><span class="mono note">'+new Date(l.t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</span></div>'}).join('')||'<div class="note">Sem eventos.</div>';
}
function opsMsg(id,t,bad){$(id).textContent=t;$(id).className='note'+(bad?' bad':'')}
function botForm(){
  var o={autoCreate:$('b_autoCreate').checked};
  BOT_FIELDS.forEach(function(k){var v=$('b_'+k).value;o[k]=['mode','onBlock','payoutAddress','poolId'].indexOf(k)>=0?v:parseFloat(v)});
  return o;
}
var PRESETS={
  low:{ph:10,h:24,rfee:3},mid:{ph:100,h:4,rfee:3},
  silverl:{ph:121,h:4,rfee:0,price:0.01/(121*4/24)*1000,ofee:0},
  burst:{ph:1000,h:0.25,rfee:3}
};

/* ---------- posições (funding) ---------- */
var pos=(ls('fd_pos')||[]).map(FD.ensureId);
function savePos(){ls('fd_pos',pos)}
function fillVenueSelects(){
  $('p_short').innerHTML=VENUES.map(function(v){return '<option>'+v+'</option>'}).join('');
  $('p_long').innerHTML=VENUES.concat(['Spot']).map(function(v){return '<option>'+v+'</option>'}).join('');
  $('p_long').value='Bybit';
}
function posAlerts(){
  return pos.filter(function(p){return !p.closed}).map(function(p){var ca=state.live?FD.currentSpread(state.rows,p):null;return {p:p,ca:ca,al:FD.positionAlert(ca,p)}});
}
function renderPositions(){
  var open=pos.filter(function(p){return !p.closed}),closed=pos.filter(function(p){return p.closed});
  var real=closed.reduce(function(a,p){return a+p.pnl},0);
  var wins=closed.filter(function(p){return p.pnl>0}).length;
  var openFund=open.reduce(function(a,p){return a+(p.funding||0)-p.fee},0);
  $('sum').innerHTML=
   '<div><small>Resultado fechado</small><span class="'+(real>=0?'good':'bad')+'">'+usd(real)+'</span></div>'+
   '<div><small>Abertas</small><span>'+open.length+'</span></div>'+
   '<div><small>Acerto</small><span>'+(closed.length?Math.round(wins/closed.length*100)+'%':'—')+'</span></div>'+
   '<div><small>Ciclos fechados</small><span>'+closed.length+'</span></div>'+
   '<div><small>Aberto, líquido</small><span class="'+(openFund>=0?'good':'bad')+'">'+usd(openFund)+'</span></div>'+
   '<div><small>Taxas pagas</small><span>'+usd(pos.reduce(function(a,p){return a+p.fee+(p.exitFee||0)},0))+'</span></div>';
  var h='',LV={bad:'r',warn:'w',ok:'g',none:''};
  pos.slice().reverse().forEach(function(p){
    var i=pos.indexOf(p),ca=p.closed||!state.live?null:FD.currentSpread(state.rows,p);
    var al=p.closed?null:FD.positionAlert(ca,p);
    var chip=al?'<span class="chip '+(al.level==='none'?'':al.level)+'">'+al.text+'</span>':'';
    var age=((p.closed||Date.now())-p.t)/864e5;
    h+='<div class="card opp '+(p.closed?'':LV[al.level])+'"><div class="h"><span><span class="coin">'+esc(p.coin)+'</span></span>'+(p.closed?'<span class="big '+(p.pnl>=0?'good':'bad')+'">'+usd(p.pnl)+'</span>':chip)+'</div>'+
    '<div class="legs">Short <b>'+esc(p.s)+'</b> · Long <b>'+esc(p.l)+'</b> · '+usd(p.notional)+' por perna · entrada '+new Date(p.t).toLocaleDateString('pt-BR')+' · '+age.toFixed(1)+(p.days?' de '+p.days:'')+' dias</div>'+
    '<div class="kv"><div><small>Spread entrada</small><span>'+pct(p.apr,1)+'</span></div>'+
    '<div><small>Spread agora</small><span class="'+(ca===null?'':al.level==='ok'?'good':al.level)+'">'+(ca===null?'—':pct(ca,1))+'</span></div>'+
    '<div><small>Break-even</small><span>'+(isFinite(p.beApr)&&p.beApr!==undefined?pct(p.beApr,1):'—')+'</span></div></div>';
    if(!p.closed){
      h+='<div class="row"><label style="flex:1;min-width:110px">Funding líquido recebido (US$)<input data-f="'+i+'" type="number" inputmode="decimal" value="'+(p.funding||0)+'"></label>'+
      '<label style="flex:1;min-width:110px">Taxas de saída (US$)<input data-x="'+i+'" type="number" inputmode="decimal" value="0"></label>'+
      '<button class="pri sm" data-close="'+i+'">Fechar</button></div>'+
      '<div class="note">Spread agora é o previsto ao vivo (snapshot). Funding recebido: copie do extrato da exchange.</div>';
    }else h+='<div class="note">Fechada em '+new Date(p.closed).toLocaleDateString('pt-BR')+' · funding '+usd(p.funding||0)+' · taxas '+usd(p.fee+(p.exitFee||0))+'</div>';
    h+='<div class="row"><button class="sm" data-del="'+i+'">Excluir</button></div></div>';
  });
  $('p_list').innerHTML=h||'<div class="card note">Nenhuma posição registrada. Use o scanner e toque em Registrar posição, ou preencha acima.</div>';
}

/* ---------- sessões de mineração ---------- */
var TAGS=[['rede-rapida','rede rápida'],['rede-lenta','rede lenta'],['burst','burst'],['ordem-baixa','ordem baixa'],['easymining','EasyMining'],['luck-100','luck > 100%'],['copiou-ultimo','mesma potência do último'],['noturno','madrugada'],['sinal-verde','sinal verde']];
var sessions=(ls('fd_mine')||[]).map(FDM.ensureSessionId);
function saveSessions(){ls('fd_mine',sessions)}
function localDT(ms){var d=new Date(ms);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)}
function fillTagSel(){$('s_tagsel').innerHTML=TAGS.map(function(t){return '<label><input type="checkbox" value="'+t[0]+'">'+t[1]+'</label>'}).join('');$('s_t').value=localDT(Date.now())}
function tagName(t){var f=TAGS.filter(function(x){return x[0]===t})[0];return f?f[1]:t}
function renderSessions(){
  var r=FDM.summarize(sessions);
  $('s_sum').innerHTML=[
    ['Sessões',r.n],['Custo',usd(r.cost)],['Recompensa',usd(r.reward)],
    ['Líquido','<span class="'+(r.net>=0?'good':'bad')+'">'+usd(r.net)+'</span>'],['ROI',r.roi===null?'—':pct(r.roi,1)],
    ['Blocos / esperados',r.blocks+' / '+r.lambda.toFixed(2)]
  ].map(function(x){return '<div><small>'+x[0]+'</small><span>'+x[1]+'</span></div>'}).join('');
  $('s_luck').textContent=r.lambda>0?('Sorte real '+r.luck.toFixed(2)+'×. Chance de ir tão bem só por acaso: '+pctp(r.pAsGood*100)+'; tão mal: '+pctp(r.pAsBad*100)+'. Abaixo de 5% em algum dos dois, o resultado começa a dizer algo; acima disso, é compatível com sorte pura.'):'Registre sessões para comparar o resultado real com o esperado pela matemática.';
  var bt=FDM.byTag(sessions);
  $('s_tags').innerHTML=bt.length?'<tr><th>Etiqueta</th><th>Sessões</th><th>Blocos/esp.</th><th>Sorte</th><th>ROI</th><th>Por acaso</th></tr>'+bt.map(function(t){
    return '<tr><td>'+esc(tagName(t.tag))+'</td><td>'+t.n+'</td><td>'+t.blocks+' / '+t.lambda.toFixed(2)+'</td><td>'+(t.luck===null?'—':t.luck.toFixed(2)+'×')+'</td><td class="'+(t.net>=0?'good':'bad')+'">'+(t.roi===null?'—':pct(t.roi,0))+'</td><td>'+(t.pAsGood===null?'—':pctp(Math.min(t.pAsGood,t.pAsBad)*100,0))+'</td></tr>'}).join(''):'<tr><td class="note">Sem sessões com etiqueta ainda.</td></tr>';
  $('s_list').innerHTML=sessions.slice().reverse().map(function(s){
    var i=sessions.indexOf(s),lam=FDM.sessionLambda(s),net=(+s.rewardUsd||0)-(+s.costUsd||0);
    return '<div class="card opp '+(s.blocks>0?'g':'r')+'"><div class="h"><span><span class="coin">'+(s.blocks>0?s.blocks+' bloco'+(s.blocks>1?'s':''):'Sem bloco')+'</span></span><span class="big '+(net>=0?'good':'bad')+'">'+usd(net)+'</span></div>'+
      '<div class="legs">'+new Date(s.t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' · <b>'+esc(s.platform)+'</b>'+(s.pool?' → '+esc(s.pool):'')+' · '+nf(+s.ph,1)+' PH/s × '+nf(+s.hours,2)+'h</div>'+
      '<div class="kv"><div><small>Custo</small><span>'+usd(+s.costUsd||0)+'</span></div><div><small>Esperado</small><span>'+lam.toFixed(3)+' bl.</span></div><div><small>Etiquetas</small><span style="font-size:12px">'+((s.tags||[]).map(tagName).join(', ')||'—')+'</span></div></div>'+
      (s.note?'<div class="note">'+esc(s.note)+'</div>':'')+
      '<div class="row"><button class="sm" data-sdel="'+i+'">Excluir</button></div></div>';
  }).join('')||'<div class="card note">Nenhuma sessão registrada. Use Mineração → Planejar → Registrar no diário, ou preencha acima.</div>';
}

/* ---------- início e conexões ---------- */
var SRC_NAME={api:'direto',proxy:'via proxy','via HL':'via Hyperliquid'};
function srcRow(name,ok,info,cls){return '<tr><td>'+name+'</td><td class="'+cls+'">'+ok+'</td><td class="wrap" style="text-align:right">'+info+'</td></tr>'}
function renderHome(){
  var rows=['Binance','Bybit','Hyperliquid'].map(function(v){
    var s=state.src[v];
    if(s)return srcRow(v,s==='via HL'?'parcial':'ok',SRC_NAME[s]+(state.updated?' · '+hhmm(state.updated):''),s==='via HL'?'warn':'good');
    return srcRow(v,state.updated?'falhou':'…',state.srcErr[v]||'',state.updated?'bad':'mute');
  });
  rows.push(srcRow('Rede BCH',mine.blocks.length?'ok':(mine.err.blocks?'falhou':'…'),mine.blocks.length?'Blockchair · '+hhmm(mine.at):(mine.err.blocks||''),mine.blocks.length?'good':(mine.err.blocks?'bad':'mute')));
  var L=live();
  rows.push(srcRow('Cotações',L.bchUsd&&L.btcUsd?'ok':'…',L.bchUsd?'BCH '+usd(L.bchUsd)+' · BTC '+usd(L.btcUsd):'',L.bchUsd?'good':'mute'));
  rows.push(srcRow('NiceHash',mine.book?(mine.bookSrc==='proxy'?'ok':'atrasado'):(mine.err.book?'falhou':'…'),mine.book?mine.bookSrc+(mine.bookAt?' · '+ago(mine.bookAt):''):(mine.err.book||''),mine.book?(mine.bookSrc==='proxy'?'good':'warn'):(mine.err.book?'bad':'mute')));
  if(settings.apiUrl){var bs=ops.status;rows.push(srcRow('Backend',bs?'ok':(ops.err.status?'falhou':'…'),bs?('robô '+MODE_TXT[bs.config.mode].toLowerCase()+' · NiceHash '+bs.nhEnv):(ops.err.status||''),bs?'good':(ops.err.status?'bad':'mute')))}
  $('h_src').innerHTML='<tr><th>Fonte</th><th>Estado</th><th>Detalhe</th></tr>'+rows.join('');
  var o=state.ops&&state.ops[0];
  $('h_fund').innerHTML='<div class="row" style="justify-content:space-between"><h2 style="margin:0">Funding agora</h2>'+(state.live?'':'<span class="chip demo">exemplo</span>')+'</div>'+
    (o?'<div class="row" style="margin-top:10px;align-items:baseline"><span class="coin">'+esc(o.coin)+'</span><span class="big '+(o.m.netOnCap>0?'good':'bad')+'">'+pct(o.m.netOnCap)+'</span><span class="note">líquido projetado no ciclo</span></div>'+
      '<div class="legs" style="margin-top:4px">Short <b>'+o.s+'</b> · Long <b>'+o.l+'</b> · spread '+pct(o.spread,1)+' a.a. · break-even '+(isFinite(o.m.be)?o.m.be.toFixed(1)+' d':'—')+'</div>':'<p class="note">Sem oportunidade nos filtros atuais.</p>')+
    '<div class="row" style="margin-top:10px"><button class="sm" data-go="fund">Abrir scanner</button></div>';
  var R=mineSignal(L);
  $('h_mine').className='card sig '+R.sig.level;
  $('h_mine').innerHTML=sigHTML(L,R,true)+'<div class="row" style="margin-top:10px"><button class="sm" data-go="mine">Abrir mineração</button><button class="sm" data-go="mine:plan">Planejar sessão</button></div>';
  var al=posAlerts().filter(function(x){return x.al.level==='bad'||x.al.level==='warn'});
  var ms=FDM.summarize(sessions);
  $('h_alerts').innerHTML='<h2>Alertas e diário</h2>'+
    (al.length?al.map(function(x){return '<div class="legs"><span class="chip '+x.al.level+'">'+x.al.text+'</span> <b>'+esc(x.p.coin)+'</b> '+esc(x.p.s)+' / '+esc(x.p.l)+'</div>'}).join(''):'<p class="note" style="margin:0">Nenhuma posição de funding em alerta.</p>')+
    '<div class="kv" style="margin-top:10px"><div><small>Posições abertas</small><span>'+pos.filter(function(p){return !p.closed}).length+'</span></div><div><small>Sessões de mineração</small><span>'+ms.n+'</span></div><div><small>Mineração líquido</small><span class="'+(ms.net>=0?'good':'bad')+'">'+usd(ms.net)+'</span></div></div>'+
    '<div class="row" style="margin-top:10px"><button class="sm" data-go="diary">Abrir diário</button></div>';
}
function renderConn(){
  var rows=[['Binance','dados públicos',state.src.Binance?SRC_NAME[state.src.Binance]:'sem acesso'],['Bybit','dados públicos',state.src.Bybit?SRC_NAME[state.src.Bybit]:'sem acesso'],
    ['Hyperliquid','dados públicos',state.src.Hyperliquid?'direto':'sem acesso'],['NiceHash','livro de ordens',mine.bookSrc||'sem acesso'],['Rede BCH','Blockchair',mine.blocks.length?'direto':'sem acesso'],
    ['Contas (saldo, ordens)',settings.apiUrl?'backend':'não conectadas',ops.status?(ops.status.keys?'NiceHash '+ops.status.nhEnv:'chaves faltando'):(settings.apiUrl?'sem conexão':'requer backend')]];
  $('conn').innerHTML='<tr><th>Conexão</th><th>Tipo</th><th>Estado</th></tr>'+rows.map(function(r){return '<tr><td>'+r[0]+'</td><td>'+r[1]+'</td><td>'+r[2]+'</td></tr>'}).join('');
}

/* ---------- exportar / importar ---------- */
function stamp(){return new Date().toISOString().slice(0,10)}
function saveFile(name,text,type){
  var blob=new Blob([text],{type:type}),file;
  try{file=new File([blob],name,{type:type})}catch(e){}
  if(file&&navigator.canShare&&navigator.canShare({files:[file]})){
    return navigator.share({files:[file],title:name}).catch(function(){});
  }
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1000);
}
function fullJSON(){return JSON.stringify({app:'funding-desk',version:2,exported:new Date().toISOString(),positions:pos.map(FD.ensureId),sessions:sessions.map(FDM.ensureSessionId)},null,2)}
$('x_csv').addEventListener('click',function(){saveFile('funding-desk-funding-'+stamp()+'.csv','﻿'+FD.toCSV(pos),'text/csv')});
$('x_mcsv').addEventListener('click',function(){saveFile('funding-desk-mineracao-'+stamp()+'.csv','﻿'+FDM.sessionsToCSV(sessions),'text/csv')});
$('x_json').addEventListener('click',function(){saveFile('funding-desk-diario-'+stamp()+'.json',fullJSON(),'application/json')});
$('x_copy').addEventListener('click',function(){
  var b=$('x_copy');
  try{navigator.clipboard.writeText(FD.toCSV(pos)).then(function(){b.textContent='Copiado'},function(){b.textContent='Cópia bloqueada'})}catch(e){b.textContent='Cópia bloqueada'}
});
$('x_imp').addEventListener('click',function(){$('x_file').click()});
$('x_file').addEventListener('change',function(){
  var f=this.files[0];if(!f)return;
  f.text().then(function(t){
    var msg=[];
    if(/^\s*[\[{]/.test(t)){
      var d=JSON.parse(t);
      var r=FD.mergePositions(pos,FD.fromJSON(t));pos=r.list;msg.push('funding: '+r.added+' novas, '+r.updated+' atualizadas');
      if(d.sessions){var idx={},add=0;sessions.forEach(function(s){idx[s.id]=1});d.sessions.map(FDM.ensureSessionId).forEach(function(s){if(!idx[s.id]){sessions.push(s);add++}});sessions.sort(function(a,b){return a.t-b.t});msg.push('mineração: '+add+' novas')}
    }else{var r2=FD.mergePositions(pos,FD.fromCSV(t));pos=r2.list;msg.push('funding: '+r2.added+' novas, '+r2.updated+' atualizadas')}
    savePos();saveSessions();renderPositions();renderSessions();renderHome();
    $('x_msg').textContent='Importado. '+msg.join('; ')+'.';
  }).catch(function(e){$('x_msg').textContent='Falha ao importar: '+e.message});
  this.value='';
});

/* ---------- ajustes ---------- */
var FEE_COLS=[['maker','Perp maker'],['taker','Perp taker'],['spotMaker','Spot maker'],['spotTaker','Spot taker']];
function renderFees(){
  var h='<tr><th>%</th>'+VENUES.map(function(v){return '<th>'+v+'</th>'}).join('')+'</tr>';
  FEE_COLS.forEach(function(c){h+='<tr><td>'+c[1]+'</td>'+VENUES.map(function(v){return '<td><input data-fee="'+v+'" data-k="'+c[0]+'" type="number" inputmode="decimal" step="0.005" value="'+FEES[v][c[0]]+'" aria-label="'+v+' '+c[1]+'"></td>'}).join('')+'</tr>'});
  $('feeTable').innerHTML=h;
}
function renderLiq(){
  var lev=num('l_lev')||1,mm=num('l_mm')/100;
  var d=(1/lev-mm)*100;
  $('l_out').innerHTML='<div><span class="mute">Alta do preço até liquidar o short</span><span class="mono '+(d>25?'good':d>12?'warn':'bad')+'">'+pct(d,1)+'</span></div>'+
   '<div><span class="mute">Margem livre sugerida por perna</span><span class="mono">30%</span></div>'+
   '<div><span class="mute">Alavancagem 3x ou mais</span><span class="mono bad">evite</span></div>';
}

/* ---------- navegação ---------- */
var TABS=['home','fund','mine','diary','set'];
function tab(t,sub){
  TABS.forEach(function(x){$('tab-'+x).hidden=x!==t});
  document.querySelectorAll('nav button').forEach(function(b){b.setAttribute('aria-current',b.dataset.tab===t?'true':'false')});
  if(sub)subTab(t,sub);
  settings.tab=t;ls('fd_set',settings);
  if((t==='mine'||t==='home')&&(!mine.at||Date.now()-mine.at>300000))loadMining();
  window.scrollTo(0,0);
}
var SUBS={fund:['fundSeg',['scan','calc']],mine:['mineSeg',['now','plan','net','ops']],diary:['diarySeg',['pos','mine']]};
function subTab(t,sub){
  var cfg=SUBS[t];
  if(t==='mine'&&sub==='ops')loadOps();
  cfg[1].forEach(function(x){$(t+'-'+x).hidden=x!==sub});
  document.querySelectorAll('#'+cfg[0]+' button').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.sub===sub?'true':'false')});
}
Object.keys(SUBS).forEach(function(t){document.querySelectorAll('#'+SUBS[t][0]+' button').forEach(function(b){b.addEventListener('click',function(){subTab(t,b.dataset.sub)})})});
document.querySelectorAll('nav button').forEach(function(b){b.addEventListener('click',function(){tab(b.dataset.tab)})});
document.addEventListener('click',function(e){var b=e.target.closest('[data-go]');if(!b)return;var g=b.dataset.go.split(':');tab(g[0],g[1])});
function setMode(m){
  state.mode=m;settings.mode=m;ls('fd_set',settings);
  document.querySelectorAll('#modeSeg button').forEach(function(x){x.setAttribute('aria-pressed',x.dataset.mode===m?'true':'false')});
}

/* ---------- eventos ---------- */
document.querySelectorAll('#modeSeg button').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.mode);renderScan();renderHome()})});
SCAN_INPUTS.forEach(function(id){$(id).addEventListener('input',function(){saveSettings();renderScan();renderHome()})});
['c_cap','c_lev','c_rate','c_int','c_days','c_fee','c_exec','c_slip','c_rebal'].forEach(function(id){$(id).addEventListener('input',renderCalc)});
['mp_ph','mp_h','mp_price','mp_rfee','mp_pfee','mp_ofee','mp_d','mp_rw','mp_bch','mp_btc'].forEach(function(id){$(id).addEventListener('input',function(){saveSettings();renderPlan()})});
['l_lev','l_mm'].forEach(function(id){$(id).addEventListener('input',renderLiq)});
$('proxy').addEventListener('change',function(){saveSettings();cache={};load();loadMining()});
$('reload').addEventListener('click',load);
$('mp_live').addEventListener('click',function(){fillPlanLive(true);renderPlan()});
$('presets').addEventListener('click',function(e){
  var b=e.target.closest('[data-preset]');if(!b)return;var p=PRESETS[b.dataset.preset];
  $('mp_ph').value=p.ph;$('mp_h').value=p.h;$('mp_rfee').value=p.rfee;
  $('mp_ofee').value=p.ofee===undefined?0.00001:p.ofee;
  if(p.price)$('mp_price').value=p.price.toFixed(4);else fillPlanLive(true);
  saveSettings();renderPlan();
});
$('mp_reg').addEventListener('click',function(){
  var q=planParams(),p=FDM.plan(q);
  $('s_ph').value=q.ph;$('s_h').value=q.hours;$('s_cost').value=p.cost.toFixed(2);$('s_d').value=(q.D/1e9).toFixed(2);
  $('s_t').value=localDT(Date.now());$('s_blocks').value=0;$('s_rw').value=0;
  var L=live(),R=mineSignal(L);
  var sv=document.querySelector('#s_tagsel input[value="sinal-verde"]');if(sv)sv.checked=R.sig.level==='favoravel';
  tab('diary','mine');
  $('s_ph').scrollIntoView({block:'center'});
});
$('s_add').addEventListener('click',function(){
  if(!num('s_ph')||!num('s_h'))return;
  var tags=[].map.call(document.querySelectorAll('#s_tagsel input:checked'),function(c){return c.value});
  var s={t:Date.parse($('s_t').value)||Date.now(),platform:$('s_plat').value,pool:$('s_pool').value.trim(),ph:num('s_ph'),hours:num('s_h'),
    costUsd:num('s_cost'),D:num('s_d')*1e9,blocks:Math.max(0,Math.round(num('s_blocks'))),rewardUsd:num('s_rw'),tags:tags,note:$('s_note').value.trim()};
  sessions.push(FDM.ensureSessionId(s));sessions.sort(function(a,b){return a.t-b.t});saveSessions();
  ['s_ph','s_h','s_cost','s_note'].forEach(function(i){$(i).value=''});$('s_blocks').value=0;$('s_rw').value=0;
  document.querySelectorAll('#s_tagsel input').forEach(function(c){c.checked=false});
  renderSessions();renderHome();
});
$('s_list').addEventListener('click',function(e){
  var b=e.target.closest('[data-sdel]');if(!b)return;
  if(confirm('Excluir esta sessão do diário?')){sessions.splice(+b.dataset.sdel,1);saveSessions();renderSessions();renderHome()}
});
$('list').addEventListener('click',function(e){
  var b=e.target.closest('button');if(!b)return;
  if(b.dataset.range){var box=b.closest('[data-hist]'),key=box.dataset.hist;openHist[key].range=+b.dataset.range;settings.histRange=+b.dataset.range;ls('fd_set',settings);drawHist(key);return}
  var key=b.dataset.histbtn||b.dataset.calc||b.dataset.reg;if(!key)return;
  var o=state.ops.filter(function(x){return oppKey(x)===key})[0];if(!o)return;
  if(b.dataset.histbtn){toggleHist(key);b.textContent=openHist[key]?'Fechar histórico':'Histórico';return}
  if(b.dataset.calc){
    $('c_cap').value=num('cap');$('c_lev').value=o.rl?num('lev'):1;$('c_days').value=hold();
    $('c_rate').value=(FD.rateFromApr(Math.min(o.spread,num('acap')||1e9),8)*100).toFixed(5);$('c_int').value=8;
    $('c_fee').value=(o.m.feeUsd/o.m.notional*100/4).toFixed(4);$('c_exec').value=4;$('c_slip').value=num('slip');$('c_rebal').value=o.rl?num('rebal'):0;
    renderCalc();subTab('fund','calc');window.scrollTo(0,0);
  }
  if(b.dataset.reg){
    $('p_coin').value=o.coin;$('p_short').value=o.s;$('p_long').value=o.l;$('p_apr').value=o.spread.toFixed(2);
    $('p_be').value=isFinite(o.m.beApr)?o.m.beApr.toFixed(2):'';$('p_days').value=hold();
    $('p_not').value=o.m.notional;tab('diary','pos');
  }
});
$('p_add').addEventListener('click',function(){
  var coin=$('p_coin').value.trim().toUpperCase();
  if(!coin||!num('p_not'))return;
  var p={coin:coin,s:$('p_short').value,l:$('p_long').value,notional:num('p_not'),apr:num('p_apr'),fee:num('p_fee'),funding:0,t:Date.now(),days:num('p_days')||undefined};
  if($('p_be').value!=='')p.beApr=num('p_be');
  pos.push(FD.ensureId(p));
  savePos();['p_coin','p_not','p_apr','p_be'].forEach(function(i){$(i).value=''});$('p_fee').value=0;renderPositions();renderHome();
});
$('p_list').addEventListener('input',function(e){
  if(e.target.dataset.f!==undefined){pos[+e.target.dataset.f].funding=parseFloat(e.target.value)||0;savePos();}
});
$('p_list').addEventListener('click',function(e){
  var b=e.target.closest('button');if(!b)return;
  if(b.dataset.close!==undefined){var i=+b.dataset.close,p=pos[i];
    var x=document.querySelector('[data-x="'+i+'"]');p.exitFee=x?(parseFloat(x.value)||0):0;
    p.pnl=(p.funding||0)-p.fee-p.exitFee;p.closed=Date.now();savePos();renderPositions();renderHome();}
  if(b.dataset.del!==undefined&&confirm('Excluir esta posição do diário?')){pos.splice(+b.dataset.del,1);savePos();renderPositions();renderHome();}
});
$('feeTable').addEventListener('input',function(e){
  var v=e.target.dataset.fee;if(v){FEES[v][e.target.dataset.k]=parseFloat(e.target.value)||0;ls('fd_fees',FEES);renderScan();}
});
$('feeReset').addEventListener('click',function(){FEES=cloneFees();ls('fd_fees',FEES);renderFees();renderScan()});
// Atualiza funding a cada 2 min com a aba visível.
setInterval(function(){if(document.visibilityState==='visible'&&state.live)load()},120000);

/* ---------- eventos: investimento e operação ---------- */
['iv_total','iv_sess','iv_edge','iv_stop'].forEach(function(id){$(id).addEventListener('input',function(){saveSettings();renderInvest()})});
document.querySelectorAll('#invSeg button').forEach(function(b){b.addEventListener('click',function(){
  invScenario=b.dataset.sc;document.querySelectorAll('#invSeg button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});renderInvest()})});
$('api_url').value=settings.apiUrl||'';
if(ls('fd_tok'))$('api_token').placeholder='token salvo neste aparelho';
$('api_save').addEventListener('click',function(){
  settings.apiUrl=$('api_url').value.trim().replace(/\/+$/,'');ls('fd_set',settings);
  if($('api_token').value)ls('fd_tok',$('api_token').value.trim());
  $('api_token').value='';$('api_token').placeholder=ls('fd_tok')?'token salvo neste aparelho':'';
  if(!settings.apiUrl){opsMsg('api_msg','Endereço vazio: backend desligado.');renderOps();return}
  opsMsg('api_msg','Testando…');
  apiCall('GET','/status').then(function(st){opsMsg('api_msg','Conectado. NiceHash: '+st.nhEnv+' · chaves '+(st.keys?'ok':'faltando')+' · robô '+MODE_TXT[st.config.mode]+'.');cache={};loadOps();loadMining()},function(e){opsMsg('api_msg','Falhou: '+e.message,true)});
});
$('api_clear').addEventListener('click',function(){try{localStorage.removeItem('fd_tok')}catch(e){}$('api_token').placeholder='';opsMsg('api_msg','Token apagado deste aparelho.')});
$('o_refresh').addEventListener('click',loadOps);
BOT_FIELDS.forEach(function(k){$('b_'+k).addEventListener('input',function(){ops.dirty=true})});
$('b_save').addEventListener('click',function(){
  var f=botForm();
  if(f.mode==='active'&&ops.status&&ops.status.config.mode!=='active'&&!confirm('Ativar o robô? Ele vai alterar e cancelar as ordens marcadas como "robô gerencia" na NiceHash ('+(ops.status?ops.status.nhEnv:'')+').'))return;
  apiCall('PUT','/config',f).then(function(){ops.dirty=false;opsMsg('b_msg','Robô salvo.');loadOps()},function(e){opsMsg('b_msg','Erro: '+e.message,true)});
});
$('b_tick').addEventListener('click',function(){
  opsMsg('b_msg','Rodando ciclo…');
  apiCall('POST','/tick').then(function(r){
    var a=r.actions||[];
    opsMsg('b_msg',(a.length?a.map(function(x){return (x.executed?'feito':'simulado')+': '+x.type+' · '+x.reason}).join(' | '):'Nenhuma ação necessária.')+(r.notes&&r.notes.length?' · '+r.notes.join('; '):'')+(r.errors&&r.errors.length?' · erros: '+r.errors.join('; '):''));
    loadOps();
  },function(e){opsMsg('b_msg','Erro: '+e.message,true)});
});
$('n_create').addEventListener('click',function(){
  var b={poolId:$('n_pool').value,priceEH:num('n_price'),limitPH:num('n_limit'),amountBtc:num('n_amount'),managed:$('n_managed').checked};
  if(!b.poolId){alert('Escolha um pool (cadastre abaixo se ainda não tiver).');return}
  var m=ops.status&&ops.status.state.market;
  var warn=m&&m.capEH&&b.priceEH>m.capEH?'\n\nATENÇÃO: preço acima do teto ('+m.capEH.toFixed(4)+'): valor esperado negativo.':'';
  if(!confirm('Criar ordem na NiceHash ('+(ops.status?ops.status.nhEnv:'')+')?\n'+b.priceEH+' BTC/EH/dia · '+b.limitPH+' PH/s · '+b.amountBtc+' BTC'+warn))return;
  apiCall('POST','/orders',b).then(function(){loadOps()},function(e){alert('Erro: '+e.message)});
});
$('pl_add').addEventListener('click',function(){
  var b={name:$('pl_name').value.trim(),host:$('pl_host').value.trim(),port:num('pl_port'),username:$('pl_user').value.trim(),password:$('pl_pass').value||'x'};
  apiCall('POST','/pools',b).then(function(){alert('Pool cadastrado.');loadOps()},function(e){alert('Erro: '+e.message)});
});
$('o_kill').addEventListener('click',function(){
  if(!confirm('EMERGÊNCIA: desligar o robô e cancelar todas as ordens que ele gerencia?'))return;
  apiCall('POST','/kill').then(function(r){alert('Robô desligado. Canceladas: '+r.cancelled.length+(r.failed.length?' · falhas: '+r.failed.join(', '):''));loadOps()},function(e){alert('Erro: '+e.message)});
});
$('o_orders').addEventListener('click',function(e){
  var b=e.target.closest('button');if(!b)return;
  if(b.dataset.oupd){var id=b.dataset.oupd,pr=parseFloat(document.querySelector('[data-op="'+CSS.escape(id)+'"]').value),li=parseFloat(document.querySelector('[data-ol="'+CSS.escape(id)+'"]').value);
    if(!confirm('Alterar a ordem '+id.slice(0,8)+' para '+pr+' BTC/EH/dia e '+li+' PH/s?'))return;
    apiCall('POST','/orders/'+encodeURIComponent(id),{priceEH:pr,limitPH:li}).then(loadOps,function(err){alert('Erro: '+err.message)})}
  if(b.dataset.ocancel&&confirm('Cancelar a ordem '+b.dataset.ocancel.slice(0,8)+'? O saldo não gasto volta para a carteira da NiceHash.'))
    apiCall('DELETE','/orders/'+encodeURIComponent(b.dataset.ocancel)).then(loadOps,function(err){alert('Erro: '+err.message)});
  if(b.dataset.orefill){var v=parseFloat(prompt('Reabastecer com quantos BTC?','0.001'));if(v>0)apiCall('POST','/orders/'+encodeURIComponent(b.dataset.orefill)+'/refill',{amountBtc:v}).then(loadOps,function(err){alert('Erro: '+err.message)})}
  if(b.dataset.oman)apiCall('POST','/orders/'+encodeURIComponent(b.dataset.oman)+'/manage',{managed:b.dataset.v==='1'}).then(loadOps,function(err){alert('Erro: '+err.message)});
});

/* ---------- início ---------- */
applyTheme();setMode(state.mode);fillVenueSelects();fillTagSel();
renderCalc();renderLiq();renderFees();renderPositions();renderSessions();renderPlan();renderConn();
state.rows=FD.demoData(Date.now());renderScan();renderHome();
tab(TABS.indexOf(settings.tab)>=0?settings.tab:'home');
load();loadMining();if(settings.apiUrl)loadOps();
if('serviceWorker' in navigator&&/^https?:/.test(location.protocol))navigator.serviceWorker.register('sw.js').catch(function(){});
})();
