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
// Conserta endereço salvo errado (uma versão antiga gravava o link de conexão inteiro como endereço).
(function(){var u=settings.apiUrl;if(!u)return;var c=parseConnect(u);
  if(c&&!c.error){settings.apiUrl=c.u;ls('fd_tok',c.t)}else if(!/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?$/i.test(u))settings.apiUrl='';
  if(settings.apiUrl!==u)ls('fd_set',settings)})();
var SCAN_INPUTS=['cap','lev','hold','minvol','exS','exL','rebal','slip','minoi','acap','newdays','sort','f_target'];
var PLAN_INPUTS=['mp_ph','mp_h','mp_rfee','mp_pfee','mp_ofee','mp_rw','iv_total','iv_sess','iv_edge'];
// Regra nova (validada em 90 dias): execução padrão com ordem limite (maker). Migra uma vez quem tinha o padrão antigo.
if(!settings.makerV1){settings.exS='maker';settings.exL='maker';settings.makerV1=true;ls('fd_set',settings)}
SCAN_INPUTS.concat(PLAN_INPUTS).forEach(function(id){if(settings[id]!==undefined)$(id).value=settings[id]});
$('proxy').value=settings.proxy||'';
$('f_crypto').checked=settings.cryptoOnly!==false;
function saveSettings(){SCAN_INPUTS.concat(PLAN_INPUTS).forEach(function(id){settings[id]=$(id).value});settings.proxy=$('proxy').value.trim();ls('fd_set',settings)}

var state={rows:{},live:false,mode:settings.mode||'pp',updated:null,src:{},srcErr:{},ops:[],kinds:{}};
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
function pct(x,d){d=d===undefined?2:d;return (x>=0?'+':'-')+Math.abs(x).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})+'%'}
function pctp(x,d){d=d===undefined?1:d;return x.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})+'%'}
function usd(x,d){d=d===undefined?2:d;return (x<0?'-':'')+'US$'+Math.abs(x).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function plural(n,um,varios){return n+' '+(n===1?um:varios)}
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
// Relógio do cabeçalho: hora local do aparelho e UTC.
var TZ=(function(){try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone||'';return z==='America/Sao_Paulo'?'Brasília':z.split('/').pop().replace(/_/g,' ')}catch(e){return 'local'}})();
function tickClock(){var el=document.getElementById('clock');if(el){var n=Date.now();el.textContent='Agora: '+hhmm(n)+' ('+TZ+') · '+utcHM(n)+' UTC'}if(typeof renderNext==='function'&&document.getElementById('mine-net')&&!document.getElementById('mine-net').hidden)renderNext()}
function tick(){
  document.querySelectorAll('[data-next]').forEach(function(e){e.textContent=cd(+e.dataset.next)});
  document.querySelectorAll('[data-ago]').forEach(function(e){e.textContent=ago(+e.dataset.ago)});
}
setInterval(tick,1000);

/* ---------- rede ---------- */
var PROXY_KEY={'fapi.binance.com':'binance','api.bybit.com':'bybit','api2.nicehash.com':'nicehash','whattomine.com':'wtm'};
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
function loadOKX(){return Promise.all([fetchJSON('https://www.okx.com/api/v5/public/funding-rate?instId=ANY'),fetchJSON('https://www.okx.com/api/v5/market/tickers?instType=SWAP')]).then(function(a){return FD.parseOKX(a[0],a[1])})}
function loadBitget(){return Promise.all([fetchJSON('https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES'),fetchJSON('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES')]).then(function(a){return FD.parseBitget(a[0],a[1])})}
function loadGate(){return Promise.all([fetchJSON('https://api.gateio.ws/api/v4/futures/usdt/contracts'),fetchJSON('https://api.gateio.ws/api/v4/futures/usdt/tickers')]).then(function(a){return FD.parseGate(a[0],a[1])})}

var loading=false,loadingAt=0;
function load(){
  if(loading&&Date.now()-loadingAt<45000)return;loading=true;loadingAt=Date.now();usedProxy={};
  $('status').textContent='lendo…';$('status').className='chip demo';
  Promise.all([loadBinance(),loadBybit(),loadHL(),loadPredicted(),loadOKX(),loadBitget(),loadGate()].map(settle)).then(function(res){
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
    ['OKX','Bitget','Gate'].forEach(function(v,i){var r=res[4+i];if(r.ok)add(v,r.v,'api');else{err[v]=errMsg(r.e);notes.push(v+': sem resposta ('+err[v]+').')}});
    var n=Object.keys(src).length;
    state.updated=new Date();state.srcErr=err;
    if(n){
      state.rows=rows;state.live=true;state.src=src;state.kinds=FD.assetKinds(rows);
      var direct=Object.keys(src).filter(function(v){return src[v]!=='via HL'}).length;
      var all=direct===VENUES.length;
      $('status').textContent=all?'ao vivo':'parcial';
      $('status').className='chip '+(all?'live':'demo');
      if(n<2&&state.mode==='pp')notes.push('Só uma exchange respondeu: Perp × Perp precisa de duas.');
    }else{
      state.rows=FD.demoData(Date.now());state.live=false;state.src={};
      $('status').textContent='exemplo';$('status').className='chip demo';
      notes=['Sem acesso às APIs das exchanges agora. Os números do funding são EXEMPLOS, não dados reais. Se abriu o arquivo por um app de mensagens, abra o endereço no Safari.'];
    }
    $('banner').hidden=!notes.length;$('banner').innerHTML=notes.join('<br>');
    $('stamp').textContent='Funding atualizado às '+state.updated.toLocaleTimeString('pt-BR')+' (taxa prevista do próximo pagamento; pode inverter).';
    renderScan();renderPositions();renderHome();renderConn();updateRadar();
  });
}

/* ---------- mineração: coleta ---------- */
var mineLoading=false,mineLoadingAt=0,mineAgain=false;
function loadBook(){
  var direct='https://api2.nicehash.com/main/api/v2/hashpower/orderBook?algorithm=SHA256ASICBOOST&size=1000'; // sem size a NiceHash manda só as 100 mais caras
  var pu=proxied(direct);
  var snap=function(){return fetchJSON('data/nicehash.json?'+Math.floor(Date.now()/60000)).then(function(d){return {markets:d.markets,src:'foto GitHub',at:Date.parse(d.at)}})};
  if(pu)return fetchJSON(pu).then(function(d){return {markets:FDM.parseNiceHashBook(d),src:'proxy',at:Date.now()}}).catch(snap);
  return snap();
}
function loadMining(){
  if(mineLoading&&Date.now()-mineLoadingAt<45000){mineAgain=true;return}mineLoading=true;mineLoadingAt=Date.now();mineAgain=false;
  Promise.all([
    fetchJSON('https://api.blockchair.com/bitcoin-cash/stats'),
    fetchJSON('https://mempool.space/api/v1/mining/hashrate/3d'),
    fetchJSON('https://api.blockchair.com/bitcoin-cash/blocks?limit=25'),
    loadBook(),
    fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,bitcoin-cash,bitcoin-cash-sv&vs_currencies=usd'),
    fetchJSON('https://mempool.space/api/v1/prices'),
    fetchJSON('https://api.whatsonchain.com/v1/bsv/main/chain/info'),
    fetchJSON('https://api.whatsonchain.com/v1/bsv/main/exchangerate'),
    fetchJSON('https://mempool.space/api/v1/difficulty-adjustment')
  ].map(settle)).then(function(r){
    mineLoading=false;mine.err={};mine.at=Date.now();
    if(r[0].ok)mine.stats=r[0].v.data;else mine.err.bch=errMsg(r[0].e);
    if(r[1].ok)mine.btcD=r[1].v.currentDifficulty;else mine.err.btc=errMsg(r[1].e);
    if(r[2].ok)mine.blocks=FDM.parseBlocks(r[2].v);else mine.err.blocks=errMsg(r[2].e);
    if(r[3].ok){mine.book=r[3].v.markets;mine.bookSrc=r[3].v.src;mine.bookAt=r[3].v.at}else mine.err.book=errMsg(r[3].e);
    if(r[4].ok)mine.cg=r[4].v;else mine.err.cg=errMsg(r[4].e);
    if(r[5].ok)mine.mp=r[5].v;
    if(r[6].ok)mine.bsvD=r[6].v.difficulty;else mine.err.bsv=errMsg(r[6].e);
    if(r[8].ok)mine.btcAdj={changePct:r[8].v.difficultyChange,remainingMs:r[8].v.remainingTime,remainingBlocks:r[8].v.remainingBlocks,avgMin:r[8].v.timeAvg/60000};
    mine.bsvUsd=(r[7].ok&&r[7].v.rate)||(mine.cg&&mine.cg['bitcoin-cash-sv']&&mine.cg['bitcoin-cash-sv'].usd)||mine.bsvUsd||null;
    fillPlanLive(false);
    renderMine();renderHome();renderConn();renderSessions();
    if(mineAgain)loadMining();
    loadMarketMap();
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
  // potência da rede BCH (PH/s): estatística de 24 h ou estimativa pela dificuldade e intervalo médio
  var netPH=mine.stats&&+mine.stats.hashrate_24h?+mine.stats.hashrate_24h/1e15:(D&&st&&st.avgAll>0?D*4294967296/(st.avgAll*60)/1e15:null);
  return {bchUsd:bchUsd,btcUsd:btcUsd,D:D,book:mk,st:st,rewardCoin:3.125+fees,btcD:mine.btcD,bsvD:mine.bsvD,bsvUsd:mine.bsvUsd,networkPH:netPH};
}
// Blockchair grátis limita o uso por IP: no máximo uma leitura a cada 5 min.

/* ---------- histórico de funding ---------- */
var HIST_DAYS=7,histCache={},openHist={};
function loadHist(venue,sym,fallbackH){
  var key=venue+':'+sym,c=histCache[key];
  if(c&&Date.now()-c.at<10*60e3)return Promise.resolve(c.s);
  var start=Date.now()-HIST_DAYS*864e5,p;
  if(venue==='Binance')p=jget('https://fapi.binance.com/fapi/v1/fundingRate?symbol='+encodeURIComponent(sym)+'&startTime='+start+'&limit=1000').then(FD.parseBinanceHist);
  else if(venue==='Bybit')p=jget('https://api.bybit.com/v5/market/funding/history?category=linear&symbol='+encodeURIComponent(sym)+'&startTime='+start+'&endTime='+Date.now()+'&limit=200').then(FD.parseBybitHist);
  else if(venue==='OKX')p=fetchJSON('https://www.okx.com/api/v5/public/funding-rate-history?instId='+encodeURIComponent(sym)+'&limit=100').then(FD.parseOKXHist);
  else if(venue==='Bitget')p=fetchJSON('https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol='+encodeURIComponent(sym)+'&productType=USDT-FUTURES&pageSize=100').then(FD.parseBitgetHist);
  else if(venue==='Gate')p=fetchJSON('https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract='+encodeURIComponent(sym)+'&limit=100').then(FD.parseGateHist);
  else p=hl({type:'fundingHistory',coin:sym,startTime:start}).then(FD.parseHLHist);
  return p.then(function(pts){var s=FD.historySeries(pts,fallbackH);histCache[key]={at:Date.now(),s:s};return s});
}
function oppKey(o){return o.coin+'|'+o.s+'|'+o.l}
// O painel confere 72 h de funding pago nas corretoras; manda ao servidor o que conferiu, para o robô decidir igual ao painel
// enquanto o servidor ainda não tem 24 h de histórico próprio do par. No máximo a cada 5 min.
var lastShare=0;
function shareVerified(){
  if(!settings.apiUrl||Date.now()-lastShare<5*60e3)return;
  var pairs=Object.keys(stabMap).map(function(k){var x=stabMap[k];return x&&x.stable24!==undefined?{key:k,stable24:!!x.stable24,expNet:isFinite(x.expNet)?x.expNet:null,halfLifeH:x.halfLifeH||null}:null}).filter(Boolean);
  if(!pairs.length)return;
  lastShare=Date.now();
  apiCall('POST','/funding/verified',{pairs:pairs}).catch(function(){});
}
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
    '<div><small>Horas acima do empate</small><span>'+(st.pctAboveBe===null?'—':st.pctAboveBe.toFixed(0)+'%')+'</span></div></div>'+
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
    mode:state.mode,fees:FEES,execShort:$('exS').value,execLong:$('exL').value,slipPct:num('slip'),rebalUsd:num('rebal'),sort:$('sort').value,now:Date.now(),
    cryptoOnly:settings.cryptoOnly!==false,kinds:state.kinds};
}
function srcTag(v){var s=state.src[v];return s&&s!=='api'?' <span class="tag">'+s+'</span>':''}
function nextLine(o){
  var parts=[[o.s,o.rs]].concat(o.rl?[[o.l,o.rl]]:[]).filter(function(x){return x[1].next});
  if(!parts.length)return '';
  return '<div class="legs">Próximo funding: '+parts.map(function(x){return '<b>'+x[0]+'</b> '+hhmm(x[1].next)+' (<span class="cd" data-next="'+x[1].next+'">'+cd(x[1].next)+'</span>)'}).join(' · ')+'</div>';
}
function chip(level){var L=FDC.LEVELS[level]||FDC.LEVELS.none;return '<span class="chip '+L.cls+'">'+L.icon+' '+L.label+'</span>'}
function verdictCtx(p){return {hold:p.hold,newDays:num('newdays'),src:state.src,lev:p.lev,aprCap:p.aprCap<1e8?p.aprCap:null}}
function stabOf(o){var x=stabMap[oppKey(o)];return x?x.stab:null}
function fundFor(mode){
  var p=scanParams();p.mode=mode;
  var ops=FD.opportunities(state.rows,p),c=verdictCtx(p);
  var vs=ops.map(function(o){var x=stabMap[oppKey(o)];return FDC.fundingVerdict(o,Object.assign({stab:stabOf(o),requireStable24:true,stable24:x?x.stable24:undefined,expNet:x?x.expNet:undefined,halfLifeH:x?x.halfLifeH:null},c))});
  return {ops:ops,vs:vs,sum:FDC.fundingSummary(ops,vs,{hold:p.hold})};
}
// Nota da IA do servidor para o par (se ele acompanha esse par há pelo menos 6 h).
function aiChip(o){var sc=ops.status&&ops.status.state&&ops.status.state.aiScores,M=ops.status&&ops.status.state&&ops.status.state.model;
  var a=sc&&sc[o.coin+'|'+o.s+'|'+o.l];if(!a||!M)return '';
  return '<span class="chip '+(a.p>=M.threshold?'ok':'warn')+'" title="Chance, segundo a IA, de pagar as taxas em 3 dias">IA '+pctp(a.p*100,0)+'</span>'}
function renderScan(){
  var p=scanParams(),r=fundFor(state.mode),sum=r.sum,RANK={go:0,maybe:1,no:2,none:3};
  var idx=r.ops.map(function(o,i){return i}).sort(function(a,b){return RANK[r.vs[a].level]-RANK[r.vs[b].level]||a-b});
  var ops=idx.map(function(i){return r.ops[i]}),vs=idx.map(function(i){return r.vs[i]});
  state.ops=ops;state.fundSummary=sum;
  $('f_scen').textContent='Cenário: '+usd(p.capital).replace(',00','')+' · '+p.lev+'x por perna · ciclo de '+p.hold+' dias';
  var allP=scanParams();allP.cryptoOnly=false;
  var hidden=settings.cryptoOnly!==false?FD.opportunities(state.rows,allP).length-r.ops.length:0;
  $('f_hidden').textContent=hidden>0?hidden+' de ações/commodities escondidas':(settings.cryptoOnly!==false?'':'mostrando todos os ativos');
  $('f_mode').textContent=state.mode==='pp'?'Short numa exchange e long em outra: você ganha a diferença de funding entre elas.':'Compra à vista e short no perpétuo da mesma exchange: você ganha o funding positivo.';
  $('best').innerHTML='<div class="row between"><div class="eyebrow">Resumo</div>'+chip(sum.level)+'</div><div class="lead">'+esc(sum.title)+'</div><p class="why">'+esc(sum.text)+'</p>'+
    (state.live?'':'<p class="note warn">Exemplo: sem dados ao vivo agora.</p>')+
    '<p class="note" style="margin:0">'+(state.updated?'Atualizado às '+hhmm(state.updated)+'. ':'')+'A taxa é a prevista para o próximo pagamento; valores em US$ são projeção.</p>'+
    '<div class="row" style="margin-top:8px"><button class="sm" data-go="diary:robo">O que o robô teria feito (simulado)</button></div>';
  var html='',LV={go:'g',maybe:'w',no:'r',none:''};
  ops.slice(0,30).forEach(function(o,i){
    var key=oppKey(o),v=vs[i],st=stabOf(o),pending=i<5&&state.live&&!stabMap[key];
    var tags=(state.live?'':'<span class="chip demo">exemplo</span>')+(o.capped?'<span class="chip warn">extremo</span>':'')+
      (o.age!==null&&o.age<num('newdays')?'<span class="chip warn">novo · '+Math.max(0,Math.floor(o.age))+'d</span>':'')+
      (state.kinds[o.coin]?'<span class="chip warn" title="Ativo tradicional tokenizado: segue o horário da bolsa">'+esc(state.kinds[o.coin])+'</span>':'')+
      aiChip(o);
    var plan=FDI.fundingPlan(o,{now:Date.now(),hold:p.hold,aprCap:p.aprCap<1e8?p.aprCap:null}),bt=(stabMap[key]||{}).bt;
    var tgt=num('f_target')>0&&v.level!=='no'?FDI.capitalForTarget(o,num('f_target'),p):null;
    html+='<div class="card opp '+LV[v.level]+'"><div class="h"><span><span class="coin">'+esc(o.coin)+'</span>'+tags+'</span>'+chip(v.level)+'</div>'+
    '<div class="lead" style="font-size:15px;margin:0">'+esc(v.title)+'</div>'+
    '<p class="why" style="margin:0">'+esc(v.why)+'</p>'+
    (st?'<p class="note" style="margin:0"><span class="chip '+st.cls+'">'+st.label+'</span> '+esc(st.text)+'</p>':(pending?'<p class="note" style="margin:0">Conferindo o histórico de pagamentos…</p>':''))+
    (v.risks.filter(function(x){return !st||x!==st.text}).length?'<ul class="risks">'+v.risks.filter(function(x){return !st||x!==st.text}).map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>':'')+
    '<p class="note" style="margin:0"><b>O que fazer:</b> '+esc(v.action)+'</p>'+
    (v.level!=='no'?'<div class="box" style="margin-top:0"><b>Plano do ciclo</b>'+esc(FDI.planText(plan,o,Date.now()))+
      (bt!==undefined?'<div style="margin-top:4px">'+esc(FDI.backtestText(bt,p.hold))+'</div>':'')+
      '<div style="margin-top:4px">'+esc(FDI.shortTerm(o,{fees:FEES,slipPct:num('slip'),stab:st}).text)+'</div>'+
      (tgt?'<div style="margin-top:4px">Para buscar '+usd(num('f_target'),0)+' neste ciclo: capital de ~'+usd(tgt.capital,0)+' ('+usd(tgt.perLeg,0)+' por perna)'+
        (tgt.maxCapital?(tgt.feasible?'; cabe na liquidez (até ~'+usd(tgt.maxCapital,0)+').':'; acima do que a liquidez comporta (~'+usd(tgt.maxCapital,0)+'): use outra moeda ou divida.'):'.')+'</div>':'')+
      '</div>':'')+
    nextLine(o)+
    (v.level!=='no'?'<details class="nums"><summary>Como executar (passo a passo)</summary><ol class="note" style="margin:6px 0;padding-left:18px">'+
      FDI.executionSteps(o,{capital:p.capital,lev:p.lev,hold:p.hold,now:Date.now(),plan:plan,mode:state.mode}).map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ol></details>':'')+
    '<details class="nums"><summary>Números</summary>'+
    '<div class="legs" style="margin:6px 0">Short <b>'+o.s+'</b>'+srcTag(o.s)+' ('+pct(o.rs.apr,1)+' a.a., paga a cada '+o.rs.hours+'h)'+(o.rl?' · Long <b>'+o.l+'</b>'+srcTag(o.l)+' ('+pct(o.rl.apr,1)+' a.a., a cada '+o.rl.hours+'h)':' · Long <b>spot</b> (sem funding)')+'</div>'+
    '<div class="kv"><div><small>Spread previsto</small><span>'+pct(o.spread,1)+'</span></div>'+
    '<div><small>Break-even</small><span>'+(isFinite(o.m.be)?o.m.be.toFixed(1)+' d':'—')+'</span></div>'+
    '<div><small>Líq. no ciclo</small><span>'+usd(o.m.netUsd)+'</span></div>'+
    '<div><small>Por perna</small><span>'+usd(o.m.notional)+'</span></div>'+
    '<div><small>Volume 24h</small><span>'+mi(o.vol)+'</span></div>'+
    '<div><small>Custos</small><span>'+usd(o.m.cost)+'</span></div></div></details>'+
    '<div class="row"><button class="sm" data-histbtn="'+esc(key)+'">'+(openHist[key]?'Fechar histórico':'Histórico')+'</button>'+
    '<button class="sm" data-calc="'+esc(key)+'">Calculadora</button>'+
    '<button class="sm" data-reg="'+esc(key)+'">Registrar posição</button></div>'+
    '<div class="hist" data-hist="'+esc(key)+'" hidden></div></div>';
  });
  $('list').innerHTML=html||'<div class="card note">Nenhuma moeda passa nos filtros. Em "Ajustar cenário", reduza o volume mínimo ou aumente a duração.</div>';
  Object.keys(openHist).forEach(function(key){
    var o=ops.filter(function(x){return oppKey(x)===key})[0];
    if(!o){delete openHist[key];return}
    openHist[key].o=o;drawHist(key);
  });
  ensureStability(ops.slice(0,8));
}
// Selo de estabilidade: busca o histórico pago (72 h) das melhores oportunidades.
var stabMap={},stabPending=false;
function ensureStability(list){
  if(!state.live||stabPending)return;
  var need=list.filter(function(o){var x=stabMap[oppKey(o)];return !x||Date.now()-x.at>10*60e3});
  if(!need.length)return;
  stabPending=true;
  Promise.all(need.map(function(o){
    return Promise.all([loadHist(o.s,o.rs.sym,o.rs.hours),o.rl?loadHist(o.l,o.rl.sym,o.rl.hours):Promise.resolve(null)]).then(function(r){
      var full=FD.spreadSeries(r[0],r[1]),since=Date.now()-3*864e5,sp=full.filter(function(x){return x.t>=since});
      var bt=FDI.backtestFunding(full,{holdDays:hold(),beApr:o.m.beApr,notional:o.m.notional,costPct:o.m.costPct});
      // 24 h seguidas acima do empate (regra validada no histórico)
      var d24=full.filter(function(x){return x.t>=Date.now()-24*36e5});
      var s24=d24.length>=3&&d24[0].t<=Date.now()-20*36e5?d24.every(function(x){return x.apr>=o.m.beApr}):false;
      // meia-vida (AR(1)) da diferença e o esperado no ciclo por ela (pesquisa: o que decide é quanto tempo dura)
      var ar=FDI.ar1(full.map(function(x){return x.apr})),cap=ar?FDI.expectedCapturePct(ar,o.spread,hold()*24):null;
      var expNet=cap===null?null:o.m.notional*cap/100-o.m.cost;
      stabMap[oppKey(o)]={at:Date.now(),stab:FDC.stability(FD.seriesStats(sp,o.m.beApr)),bt:bt,stable24:s24,expNet:expNet,halfLifeH:ar?ar.halfLifeH:null};
    }).catch(function(){stabMap[oppKey(o)]={at:Date.now(),stab:null}});
  })).then(function(){stabPending=false;renderScan();renderHome();shareVerified()});
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
// Foto do livro da NiceHash com mais de 30 min: o veredito pode estar errado.
function staleBook(){return mine.bookSrc!=='proxy'&&mine.bookAt&&Date.now()-mine.bookAt>30*60e3}
function staleHTML(){return staleBook()?'<p class="note warn" style="margin:8px 0 0">Atenção: o preço do aluguel é de '+ago(mine.bookAt)+' atrás. Conecte o backend (Ajustes) para preço em tempo real antes de decidir.</p>':''}
function minEdge(){return ops.status&&ops.status.config?+ops.status.config.minEdgePct:(num('iv_edge')||3)}
function poolFee(){return num('mp_pfee')||2}
// Veredito de mineração (BCH) e dados comuns à comparação.
function mineVerdict(L){
  var price=refPrice(L),rent=price&&L.btcUsd?FDM.rentalUsdPerPhDay(price,L.btcUsd,3):null;
  var rev=L.D&&L.bchUsd?FDM.hashpriceUsd(L.D,L.rewardCoin,L.bchUsd)*(1-poolFee()/100):null;
  var be=rev&&L.btcUsd?rev/1.03/L.btcUsd*1000:null;
  var thin=L.book&&L.book.activeOrders<5?L.book.activeOrders:0;
  var v=FDC.miningVerdict({coin:'BCH',revenue:rev,rent:rent,rentPriceEH:price,breakEvenEH:be,coinUsd:L.bchUsd,networkPH:L.networkPH,avgBlockMin:L.st?L.st.avgAll:null,minEdgePct:minEdge(),thin:thin});
  return {v:v,rent:rent,rev:rev,price:price,thin:thin};
}
var COIN_NOTES={
  BTC:'O bloco vale muito, mas precisa de muito hash: com potência alugada pequena é bilhete de loteria.',
  BCH:'Moeda que o robô monitora (confere se a recompensa caiu no seu endereço). Há pools solo conhecidos.',
  BSV:'Bloco menor e mais frequente, menos variação. Poucos pools solo e liquidez menor para vender: confira o pool e onde vender antes.'
};
function coinRows(L,V){
  return FDC.coinCompare([
    {coin:'BTC',name:'Bitcoin',D:L.btcD,rewardCoin:3.125,coinUsd:L.btcUsd,notes:COIN_NOTES.BTC},
    {coin:'BCH',name:'Bitcoin Cash',D:L.D,rewardCoin:L.rewardCoin,coinUsd:L.bchUsd,notes:COIN_NOTES.BCH},
    {coin:'BSV',name:'Bitcoin SV',D:L.bsvD,rewardCoin:3.125,coinUsd:L.bsvUsd,notes:COIN_NOTES.BSV}
  ],{rent:V.rent,poolFeePct:poolFee(),minEdgePct:minEdge(),refPh:10,thin:V.thin});
}
// Histórico da margem do BCH: leituras do aparelho + do servidor (a cada 15 min).
function edgeHistBCH(){
  var h=hist.filter(function(x){return x.edges&&isFinite(x.edges.BCH)}).map(function(x){return {t:x.t,v:x.edges.BCH}});
  (ops.status&&ops.status.state&&ops.status.state.edgeHist||[]).forEach(function(x){h.push({t:x[0],v:x[1]})});
  return h.sort(function(a,b){return a.t-b.t});
}
function mineOutlookFor(L,V){
  var eh=edgeHistBCH(),prof=FDR.hourProfile(eh.map(function(x){return {t:x.t,edges:{BCH:x.v}}}),'BCH',-new Date().getTimezoneOffset());
  var best=prof.filter(function(x){return x.n>=2}).sort(function(a,b){return b.avg-a.avg})[0]||null;
  return FDI.miningOutlook({edgeNow:V.v.level==='none'?NaN:V.v.edgePct,minEdgePct:minEdge(),thin:V.thin,hist:eh,bestHour:best,
    diffVsAvgPct:L.st?L.st.diffVsAvgPct:NaN,price24hPct:mine.stats?+mine.stats.market_price_usd_change_24h_percentage:NaN,
    btcRetarget:mine.btcAdj,rent:V.rent,budget:num('iv_sess')||300,hours:6,coin:'BCH'});
}
function renderOutlook(L,V){
  var o=mineOutlookFor(L,V),ACT={entrar:'ok',teto:'warn',esperar:'bad','sem-dado':''},ACTL={entrar:'Entrar',teto:'Ordem com teto',esperar:'Esperar','sem-dado':'Sem dado'};
  var chance='';
  if(o.suggestPh&&L.D){var lam=FDM.expectedBlocks(o.suggestPh,o.hours,L.D);
    chance='<div class="box"><b>Com essa potência</b>Chance de achar ao menos 1 bloco em '+o.hours+' h: '+pctp((1-Math.exp(-lam))*100)+'; chance de não achar nenhum (perder o valor gasto): '+pctp(Math.exp(-lam)*100)+'. O bloco vale ~'+usd(V.v.level==='none'?0:L.rewardCoin*L.bchUsd*(1-poolFee()/100),0)+'.</div>'}
  var avg=L.st?L.st.avgAll:null,nb=avg?FDI.nextBlockChance(avg,10):null;
  var split=mine.blocks.length?FDI.networkSplit(mine.blocks).slice(0,4):[],story=FDI.lastBlockStory(mine.blocks,Date.now());
  var btc=mine.btcAdj;
  $('m_out').innerHTML='<div class="row between"><div class="eyebrow">Previsão e recomendação</div><span class="chip '+ACT[o.action]+'">'+ACTL[o.action]+'</span></div>'+
    '<div class="lead">'+esc(o.title)+'</div><p class="why">'+esc(o.text||'')+'</p>'+
    (o.pros.length?'<b class="good" style="font-size:13px">A favor</b><ul class="rules note" style="margin:4px 0 8px">'+o.pros.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>':'')+
    (o.cons.length?'<b class="bad" style="font-size:13px">Contra</b><ul class="rules note" style="margin:4px 0 8px">'+o.cons.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>':'')+
    (o.plus?'<div class="box"><b>Se as coisas mudarem</b>'+esc(o.plus)+'</div>':'')+chance+
    '<details style="margin-top:8px"><summary>Rede agora: próximo bloco, divisão e último bloco</summary><ul class="rules note" style="margin-top:6px">'+
      (nb!==null?'<li>Chance de a rede BCH achar um bloco nos próximos 10 min: <b>'+pctp(nb*100,0)+'</b>; em 1 h: '+pctp(FDI.nextBlockChance(avg,60)*100,0)+'. Vale sempre, não importa há quanto tempo saiu o último (cada tentativa é independente).</li>':'')+
      (split.length?'<li>Últimos '+mine.blocks.length+' blocos: '+split.map(function(x){return esc(x.name)+' '+pctp(x.pct,0)}).join(' · ')+'. A divisão da rede entre pools não muda a sua chance por PH.</li>':'')+
      (story?'<li>'+esc(story.text)+'</li>':'')+
      (btc&&isFinite(btc.changePct)?'<li>Bitcoin: próximo reajuste de dificuldade em ~'+FDI.dur(btc.remainingMs)+' ('+nf(btc.remainingBlocks)+' blocos), estimado em '+pct(btc.changePct,1)+'. Chance de um bloco BTC em 10 min: '+pctp(FDI.nextBlockChance(btc.avgMin,10)*100,0)+'.</li>':'')+
    '</ul></details>';
}
function renderCoins(L,V){
  var rows=coinRows(L,V);
  $('m_coins').innerHTML=rows.length?rows.map(function(c){
    return '<div class="coinrow"><div class="row between"><b>'+c.coin+' · '+c.name+'</b>'+chip(c.level)+'</div>'+
      '<div>Rende <b>'+usd(c.revenue)+'</b> por PH/s ao dia'+(c.edgePct===null?'':' · aluguel '+usd(V.rent)+' → <b class="'+(c.edgePct>=0?'good':'bad')+'">'+pct(c.edgePct,1)+'</b>')+'</div>'+
      '<div class="note">Com '+c.refPh+' PH/s: 1 bloco a cada ~'+FDC.hoursTxt(c.hoursPerBlock)+' em média (variação '+c.variance.label+') · o bloco vale '+usd(c.blockUsd,0)+(c.costPerBlock?' · custa em média '+usd(c.costPerBlock,0)+' de aluguel':'')+'</div>'+
      '<div class="note">'+esc(c.notes)+'</div></div>';
  }).join('')+'<p class="note" style="margin:8px 0 0">O robô e a aba Operar trabalham com BCH. Para outra moeda, a ordem aponta para um pool dela; a parada automática no bloco hoje só confere BCH.</p>'+
    ((market.map||[]).filter(function(m){return m.algo!=='SHA256ASICBOOST'&&m.level==='go'}).length?'<div class="box"><b>Outros algoritmos compensando agora</b>'+(market.map||[]).filter(function(m){return m.algo!=='SHA256ASICBOOST'&&m.level==='go'}).map(function(m){return esc(m.label)+' ('+esc(m.coins.join('+'))+') '+pct(m.edgePct,1)}).join(' · ')+' <button class="sm" data-go="mine:algos">Ver como minerar</button></div>':'')
  :'<p class="note">Carregando dados das redes…</p>';
}
var SIG_TXT={favoravel:'Favorável',neutro:'Perto do empate',desfavoravel:'Desfavorável','sem-dado':'Sem dado'};
var SIG_CHIP={favoravel:'ok',neutro:'warn',desfavoravel:'bad','sem-dado':''};
function refPrice(L){return L.book?(L.book.medianWeighted||L.book.minActive):null}
function mineSignal(L){
  if(!L.D||!L.bchUsd||!L.btcUsd)return {sig:FDM.signal({edgePct:NaN})};
  var price=refPrice(L);
  var p=price?FDM.plan({ph:1,hours:24,D:L.D,rewardCoin:L.rewardCoin,coinUsd:L.bchUsd,priceBtcPerEhDay:price,btcUsd:L.btcUsd,rentFeePct:3,poolFeePct:num('mp_pfee')||2}):null;
  return {p:p,price:price,sig:FDM.signal({edgePct:p?p.edgePct:NaN,diffVsAvgPct:L.st?L.st.diffVsAvgPct:NaN})};
}
function renderMine(){
  var L=live(),R=mineSignal(L);
  var V=mineVerdict(L),SIGC={go:'favoravel',maybe:'neutro',no:'desfavoravel',none:''};
  var el=$('m_sig');el.className='card sig '+SIGC[V.v.level];
  el.innerHTML='<div class="row between"><div class="eyebrow">Mineração solo · BCH</div>'+chip(V.v.level)+'</div>'+
    '<div class="lead">'+esc(V.v.title)+'</div><p class="why">'+esc(V.v.why)+'</p>'+
    (V.v.when?'<div class="box"><b>Quando passa a compensar</b>'+esc(V.v.when)+'</div>':'')+
    (V.v.action?'<div class="box"><b>O que fazer</b>'+esc(V.v.action)+'</div>':'')+
    staleHTML()+(V.v.note?'<p class="note" style="margin:10px 0 0">'+esc(V.v.note)+'</p>':'')+
    '<p class="note" style="margin:6px 0 0">'+(L.st?'Último bloco BCH há <b data-ago="'+L.st.last.time+'">'+ago(L.st.last.time)+'</b>. ':'')+'Preço do aluguel: '+(mine.bookSrc==='proxy'?'tempo real':(mine.bookSrc?mine.bookSrc+(mine.bookAt?', '+ago(mine.bookAt)+' atrás':''):'indisponível'))+'.</p>';
  renderCoins(L,V);
  renderOutlook(L,V);
  var hp=L.D&&L.bchUsd?FDM.hashpriceUsd(L.D,L.rewardCoin,L.bchUsd):null;
  var hpBtc=L.btcD&&L.btcUsd?FDM.hashpriceUsd(L.btcD,3.125,L.btcUsd):null;
  var kv=[
    ['Receita BCH /PH·dia',hp?usd(hp):'—'],
    ['Aluguel /PH·dia',R.p?usd(R.p.rentPerPhDay):'—'],
    ['Preço de empate',R.p?R.p.breakEvenPrice.toFixed(4).replace('.',',')+' BTC/EH':'—'],
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
    '<div><small>Menor preço ativo</small><span>'+(b.minActive?b.minActive.toFixed(4).replace('.',','):'—')+'</span></div>'+
    '<div><small>Mediana (por velocidade)</small><span>'+(b.medianWeighted?b.medianWeighted.toFixed(4).replace('.',','):'—')+'</span></div>'+
    '<div><small>Maior preço ativo</small><span>'+(b.maxActive?b.maxActive.toFixed(4).replace('.',','):'—')+'</span></div></div>'+
    '<p class="note" style="margin:8px 0 0">Preços em BTC por EH/s por dia. Fonte: '+mine.bookSrc+(mine.bookAt?', '+ago(mine.bookAt)+' atrás':'')+'. A NiceHash não deixa o navegador ler o livro direto; sem proxy, a foto do GitHub atrasa ~10-30 min.</p>'
    :'<p class="note">Livro indisponível ('+(mine.err.book||'carregando')+'). Digite o preço em Planejar.</p>';
  renderNet(L);renderPlan();
}
// Indicador para leigos: valor + seta colorida + dica de quando é bom.
function kvJ(label,value,tone,word,hint){return '<div><small>'+label+'</small><span>'+value+'</span>'+(word?'<span class="tone '+(tone||'neutral')+'">'+word+'</span>':'')+(hint?'<em class="hint">'+hint+'</em>':'')+'</div>'}
function renderNet(L){
  var st=L.st;
  renderNetCard(L);
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
    ['Preço de empate',p.breakEvenPrice.toFixed(4).replace('.',',')+' BTC/EH/dia','']
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
  var ac=window.AbortController?new AbortController():null,tm=ac?setTimeout(function(){ac.abort()},20000):0;
  return fetch(c.url+'/api'+path,{method:method,headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:ac?ac.signal:undefined})
    .then(function(r){clearTimeout(tm);return r.json().catch(function(){return null}).then(function(j){
      if(j===null||typeof j!=='object')throw new Error('esse endereço não respondeu como o backend (HTTP '+r.status+'). Cole o link de conexão de novo.');
      if(!r.ok){var er=new Error(j.error||('HTTP '+r.status));er.data=j;throw er}return j})},
    function(e){clearTimeout(tm);throw new Error(e&&e.name==='AbortError'?'o backend não respondeu em 20 s; confira a internet e tente de novo':'sem conexão com o backend ('+(e&&e.message||e)+')')});
}
var opsLoading=false,opsLoadingAt=0;
function loadOps(){
  if(!apiCfg().url){renderOps();return}
  if(opsLoading&&Date.now()-opsLoadingAt<45000)return;opsLoading=true;opsLoadingAt=Date.now();
  Promise.all([apiCall('GET','/status'),apiCall('GET','/orders'),apiCall('GET','/balance'),apiCall('GET','/pools'),apiCall('GET','/log')].map(settle)).then(function(r){
    opsLoading=false;ops.at=Date.now();ops.err={};
    if(r[0].ok&&r[0].v&&r[0].v.config){ops.status=r[0].v;mergeServerAlerts((r[0].v.state||{}).alerts||[])}else{ops.status=null;ops.err.status=r[0].ok?'resposta inesperada do backend':r[0].e.message}
    if(r[1].ok)ops.orders=r[1].v.orders||[];else ops.err.orders=r[1].e.message;
    if(r[2].ok)ops.bal=r[2].v;else ops.err.bal=r[2].e.message;
    if(r[3].ok)ops.pools=r[3].v.list||[];else ops.err.pools=r[3].e.message;
    if(r[4].ok)ops.log=r[4].v.log||[];
    renderOps();renderHome();renderMine();renderAcct();renderRadar();renderRobo();renderWindow();renderHeat();renderAI();renderNext();renderAct();renderHashMkts();renderFronts();renderEntry();renderBPlan();renderExec();renderRTest();renderReady();
  });
}
// Dados do servidor em qualquer aba: 30 s em Operar, 60 s nas outras. Ao voltar do segundo plano (iPhone deixa o app
// congelado por horas), freshen() atualiza na hora tudo o que estiver velho.
setInterval(function(){if(document.visibilityState==='visible')freshen()},30000);
function freshen(){
  var now=Date.now(),opsTab=!$('mine-ops').hidden&&!$('tab-mine').hidden;
  if(settings.apiUrl&&now-(ops.at||0)>(opsTab?25000:55000))loadOps();
  if(now-(mine.at||0)>300000)loadMining();
  if(now-(state.updated?+state.updated:0)>120000)load();
  if(settings.apiUrl&&!$('tab-mine').hidden&&!$('mine-net').hidden&&now-blk.at>120000)loadBlocksLog();
}
var MODE_TXT={off:'Desligado',observe:'Observando',active:'Ativo'},MODE_CHIP={off:'',observe:'warn',active:'ok'};
var BOT_FIELDS=['mode','onBlock','payoutAddress','minEdgePct','minEdgeMode','relPct','relFloorPct','sniperDiffDropPct','sniperFeeX','sniperAgeMin','sniperMinEdge','sniperPh','sniperIdlePh','sniperShotMin','bidPremiumPct','targetPh','minPh','sessionBudgetUsd','stopCooldownH','dailyBudgetUsd','weeklyLossUsd','poolFeePct','rentFeePct','poolId','orderAmountBtc'];
// Margem em linguagem simples: retorno médio (não é chance) e a chance de achar bloco com a potência alvo em 24 h.
function robotExplain(m,cfg){
  var ph=+cfg.targetPh||0,pd=m.phDaysPerBlock||(m.D?m.D*4294967296/1e15/86400:0),blk=m.blockNetUsd||(m.bchUsd?3.125*m.bchUsd*(1-(cfg.poolFeePct||2)/100):0);
  if(!(pd>0&&ph>0&&m.costPerBlockUsd>0))return '';
  var lam=ph/pd,cost=lam*m.costPerBlockUsd,p=1-Math.exp(-lam),back=1+m.edgeAtBidPct/100;
  return '<div class="box" style="margin-top:10px"><b>O que é esse '+pct(m.edgeAtBidPct,1)+'</b>'+
    (m.edgeAtBidPct>=0?'Retorno médio esperado, não chance: no preço de agora, cada US$1 de aluguel volta em média US$'+nf(back,2)+' em BCH, contando muitos blocos. ':'Retorno médio negativo: no preço de agora, cada US$1 de aluguel volta em média US$'+nf(back,2)+'. ')+
    '<br><b style="margin-top:6px">E a chance de achar bloco?</b>Com '+nf(ph,0)+' PH/s por 24 h: custo de ~'+usd(cost)+' e <strong>'+pctp(p*100,0)+'</strong> de chance de achar pelo menos um bloco (vale ~'+usd(blk)+'). '+
    'Em '+pctp((1-p)*100,0)+' dos dias assim não sai bloco e o aluguel do dia é perdido: o ganho médio só aparece depois de vários blocos.</div>'+
    '<details style="margin-top:8px"><summary>O que são lance, teto, empate e custo/bloco</summary><dl class="gloss" style="margin-top:6px">'+
    '<dt>Lance</dt><dd>Preço que o robô pagaria agora: um pouco acima do menor preço que está recebendo hash.</dd>'+
    '<dt>Empate</dt><dd>Preço em que o aluguel custa exatamente o que o hash rende em média (já sem taxas do pool e da NiceHash).</dd>'+
    '<dt>Teto</dt><dd>Preço máximo que o robô aceita: empate menos a sua margem mínima ('+nf(cfg.minEdgePct,1)+'%). Acima dele, ele pausa.</dd>'+
    '<dt>Custo/bloco</dt><dd>Quanto se gasta em média, nesse lance, para achar um bloco. Compare com o valor do bloco.</dd>'+
    '<dt>Margem</dt><dd>Empate ÷ lance − 1. É o "desconto" sobre o preço justo; não é probabilidade.</dd></dl></details>';
}
// Resultado como seria de verdade: gasto contra os blocos que saíram no sorteio pelos blocos reais da rede.
function simResultHTML(p){
  if(!(p.spendUsd>0))return '<p class="note">Sem compras simuladas ainda.</p>';
  var won=p.wonUsd||0,res=won-p.spendUsd,n=p.blocks||0,dr=p.draws||0,pr=p.ph&&p.D?p.ph*1e15/(p.D*4294967296/600+p.ph*1e15):null;
  return '<div class="kv"><div><small>Gasto (aluguel)</small><span>'+usd(p.spendUsd)+'</span></div><div><small>Blocos que seriam seus</small><span>'+n+'</span></div><div><small>Resultado simulado</small><span class="'+(res>=0?'good':'bad')+'">'+signUsd(res)+'</span></div></div>'+
    '<div class="box" style="margin-top:8px"><b>Entrou em algum bloco?</b>'+
    (dr?'Enquanto o robô estaria comprando, a rede BCH achou <strong>'+dr+' bloco'+(dr>1?'s':'')+'</strong>. Cada um seria seu com '+(pr?'~'+pctp(pr*100,2):'uma pequena')+' de chance (sua potência ÷ a da rede). ':'A rede ainda não achou nenhum bloco enquanto o robô estaria comprando. ')+
    (n?'<span class="good">'+(n===1?'Saiu 1':'Saíram '+n)+' para você: '+(p.wins||[]).slice(-5).reverse().map(function(w){return 'bloco '+w.height+' ('+usd(w.usd,0)+')'}).join(', ')+'.</span> ':(dr?'Nenhum saiu para você até agora, então o aluguel foi todo perdido. ':''))+
    'O sorteio usa o hash de cada bloco real, que ninguém controla: o resultado não pode ser escolhido depois.'+
    (p.lambda>0?' <strong>Sorte:</strong> esperado '+nf(p.lambda,2)+' bloco'+(p.lambda>=1.5?'s':'')+'; normal entre '+Math.max(0,Math.floor(p.lambda-2*Math.sqrt(p.lambda)))+' e '+Math.ceil(p.lambda+2*Math.sqrt(p.lambda))+'; saíram '+n+(n>p.lambda+2*Math.sqrt(p.lambda)?' (sorte acima do normal)':(n===0&&p.lambda>3?' (azar acima do normal)':'')):'')+'</div>'+
    '<details style="margin-top:8px"><summary>Chance e média de longo prazo</summary>'+outcomesHTML(p.spendUsd,p.evUsd,p.lambda,p.blockNetUsd)+'</details>';
}
// Contínuo (sua configuração) × rajada de 50 PH/s parando no bloco (método do vídeo): mesmos blocos e sorteio.
// Tabela de cenários: custo × receita × lucro (com e sem a sorte) e o % sobre o custo, lado a lado.
function money(x,cost){var c=Math.abs(x)<0.005?'':(x>0?'good':'bad');return '<span class="'+c+'">'+signUsd(x)+'</span>'+(cost>0?'<div class="note '+c+'">'+pct(x/cost*100,1)+'</div>':'')}
function scenTable(cols,rows){
  return '<div class="scroll"><table style="font-size:12px"><tr><th></th>'+cols.map(function(k){return '<th>'+k[1]+'</th>'}).join('')+'</tr>'+
    rows.map(function(r){return '<tr><td>'+r[0]+'</td>'+cols.map(function(k){return '<td>'+(k[0]?r[1](k[0]):'—')+'</td>'}).join('')+'</tr>'}).join('')+'</table></div>';
}
var SCEN_ROWS=[
  ['Desde',function(x){return new Date(x.since).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}],
  ['Horas comprando',function(x){return nf(x.hoursOn||0,1)+' h'}],
  ['Custo',function(x){return usd(x.spendUsd||0)}],
  ['Receita (blocos)',function(x){return usd(x.wonUsd||0)+'<div class="note">'+(x.blocks||0)+' de '+(x.draws||0)+'</div>'}],
  ['<b>Lucro (com sorte)</b>',function(x){return '<b>'+money((x.wonUsd||0)-(x.spendUsd||0),x.spendUsd||0)+'</b>'}],
  ['Média (sem sorte)',function(x){return money((x.evUsd||0)-(x.spendUsd||0),x.spendUsd||0)}]
];
// Cenários numa tabela só, uma linha por cenário: os 4 acompanhados ao vivo e os 5 que teriam dado mais lucro na mesma
// janela (servidor testa potência × regra de entrada × stop-loss com os mesmos blocos e o mesmo sorteio; atualiza a cada 15 min).
function burstHTML(p,b,c,a){
  if(!b&&!c&&!a)return '';
  var B=(ops.status&&ops.status.state&&ops.status.state.bestScen)||null;
  var ent=function(f){return f===null||f===undefined?'sempre ligado':'margem a partir de '+nf(f,0)+'%'};
  var stp=function(x){return x.stopUsd?'stop US$'+nf(x.stopUsd,0)+' + '+nf(x.coolH,0)+' h':'sem stop'};
  var mine=[[p,'Sua','só verde · '+stp({stopUsd:+((ops.status||{}).config||{}).sessionBudgetUsd||0,coolH:+((ops.status||{}).config||{}).stopCooldownH||6})],[c,'Copiloto','plano da IA'],[b,'Rajada','só verde · para no bloco'],[a,'Sempre ligado','sem pausa · sem stop'],[(ops.status&&ops.status.state&&ops.status.state.paperSniper)||null,'Sniper','bloco atrasado · tiro curto']]
    .filter(function(r){return r[0]}).map(function(r){return {x:r[0],name:r[1],sub:r[2],ph:r[0].ph}});
  var best=B&&B.top?B.top.map(function(x,i){return {x:x,name:'Melhor '+(i+1),sub:ent(x.filter)+' · '+stp(x),ph:x.ph,best:true}}):[];
  var eff=B&&B.eff?B.eff.map(function(x,i){return {x:x,name:'Eficiente '+(i+1),sub:ent(x.filter)+' · '+stp(x),ph:x.ph,best:true}}):[];
  var tr=function(r){var x=r.x,cost=x.spendUsd||0,won=x.wonUsd||0,pf=won-cost,ev=(x.evUsd||0)-cost,cl=Math.abs(pf)<0.005?'':(pf>0?'good':'bad');
    return '<tr'+(r.best?' style="background:rgba(46,125,50,.06)"':'')+'><td style="padding:5px 3px;white-space:normal;overflow-wrap:anywhere"><b>'+r.name+'</b> <span class="note">'+(r.ph?nf(r.ph,0)+' PH/s':'—')+'</span><div class="note" style="line-height:1.2">'+r.sub+' · '+nf(x.hoursOn!==undefined?x.hoursOn:x.hours||0,1)+' h</div></td>'+
      '<td style="padding:5px 3px;text-align:center">'+(x.blocks||0)+'<div class="note">de '+(x.draws||0)+'</div></td>'+
      '<td style="padding:5px 3px;text-align:right;white-space:nowrap">'+usd(cost,0)+'</td>'+
      '<td style="padding:5px 3px;text-align:right;white-space:nowrap"><b class="'+cl+'">'+(pf>=0?'+':'')+usd(pf,0)+'</b>'+(cost>0?'<div class="note '+cl+'">'+pct(pf/cost*100,0)+'</div>':'')+'</td>'+
      '<td style="padding:5px 3px;text-align:right" class="note">'+(cost>0?pct(ev/cost*100,1):'—')+'</td></tr>'};
  var sep=function(t){return '<tr><td colspan="5" class="eyebrow" style="padding:8px 3px 2px;white-space:normal">'+t+'</td></tr>'};
  return '<div class="eyebrow" style="margin:14px 0 6px">Cenários (mesmos blocos, mesmo sorteio)</div>'+
    '<table style="font-size:12px;width:100%;table-layout:fixed;border-collapse:collapse"><colgroup><col style="width:42%"><col style="width:12%"><col style="width:15%"><col style="width:17%"><col style="width:14%"></colgroup><tr class="note"><th style="text-align:left;padding:2px 3px">Cenário</th><th style="padding:2px 3px">Blocos</th><th style="text-align:right;padding:2px 3px">Custo</th><th style="text-align:right;padding:2px 3px">Lucro</th><th style="text-align:right;padding:2px 3px">Média</th></tr>'+
    sep('Acompanhando')+mine.map(tr).join('')+
    (best.length?sep('Teria sido melhor · desde '+new Date(B.from).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))+best.map(tr).join('')+(eff.length?sep('Menor custo com maior lucro (lucro por dólar gasto)')+eff.map(tr).join(''):''):'<tr><td colspan="5" class="note" style="padding:6px 4px">Os 5 melhores aparecem no próximo cálculo do servidor (até 15 min).</td></tr>')+'</table>'+
    (B&&B.oos?(function(O){var ln=function(lab,x){if(!x)return '';var s2=x.second;return '<div class="note" style="margin-top:3px">'+lab+': '+nf(x.ph,0)+' PH/s · '+ent(x.filter)+' · '+stp(x)+'. Na 1ª metade: '+signUsd(x.first.profitUsd)+(x.first.pct!==null?' ('+pct(x.first.pct,0)+')':'')+'. <b>Na 2ª metade: '+(s2.costUsd>0?'<span class="'+(s2.profitUsd>=0?'good':'bad')+'">'+signUsd(s2.profitUsd)+(s2.pct!==null?' ('+pct(s2.pct,0)+')':'')+'</span>, média '+(s2.evPct!==null?pct(s2.evPct,1):'—'):'não teria comprado')+'</b>.</div>'};
      return '<div class="box" style="margin-top:8px"><b>Teste fora da amostra</b><div class="note">A melhor combinação é escolhida só com a 1ª metade da janela (até '+new Date(O.mid).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+') e conferida na 2ª metade, que ela não viu. Se for sorte, na 2ª metade ela volta para a média.</div>'+ln('Melhor pela sorte',O.byLuck)+ln('Melhor pela média',O.byAvg)+'</div>'})(B.oos):'')+
    archiveHTML()+'<p class="note" style="margin:6px 0 0">Lucro = blocos − aluguel (com a sorte que saiu); o % é sobre o custo. Média = o que sobraria em média, sem sorte. Blocos "de" = blocos da rede enquanto o cenário comprava. Os "melhores" são escolhidos depois de ver os blocos (retrovisor): mostram o que teria ganhado mais, não o que vai ganhar. "Melhor" = maior lucro em dólar; "Eficiente" = maior lucro por dólar gasto (sem repetir os de "Melhor")'+(B?'; '+B.tested+' combinações testadas':'')+'.</p>';
}
// Simulações arquivadas na correção do preço (31/10): compravam a ~0,402, preço que não recebe hash. O custo no preço
// real soma ~5,8% (0,4254 ÷ 0,402); os blocos sorteados continuam valendo (o sorteio não depende do preço).
function archiveHTML(){
  var A=ops.status&&ops.status.state&&ops.status.state.paperArchive;if(!A)return '';
  var hd=function(lab,x){return lab+'<div class="note">'+(x&&x.ph?nf(x.ph,0)+' PH/s':'—')+'</div>'},F=1.058,cols=[[A.paper,hd('Sua',A.paper)],[A.plan,hd('Copiloto',A.plan)],[A.burst,hd('Rajada',A.burst)],[A.always,hd('Sempre ligado',A.always)]];
  var rows=SCEN_ROWS.concat([
    ['Custo no preço real (+5,8%)',function(x){return usd((x.spendUsd||0)*F)}],
    ['<b>Lucro no preço real</b>',function(x){var c=(x.spendUsd||0)*F;return '<b>'+money((x.wonUsd||0)-c,c)+'</b>'}],
    ['Média no preço real',function(x){var c=(x.spendUsd||0)*F;return money((x.evUsd||0)-c,c)}]]);
  return '<details style="margin-top:8px"><summary>Antes da correção do preço (até '+dt2(A.at)+')</summary><p class="note" style="margin:6px 0">Essas simulações compravam a ~0,402, mas o hash de verdade só ia para lances a partir de ~0,4254 (~5,8% mais caro). As linhas "no preço real" refazem a conta com o custo certo.</p>'+scenTable(cols,rows)+'</details>';
}
// Desfechos honestos de um período de aluguel: sem bloco (o mais comum) perde o gasto; com bloco ganha o bloco menos o gasto.
// A média de longo prazo (receita esperada − gasto) só aparece repetindo muitas vezes.
function outcomesHTML(spend,ev,lam,blk){
  if(!(spend>0))return '<p class="note">Sem compras simuladas ainda.</p>';
  var ch=1-Math.exp(-lam),V=blk>0?blk:(lam>0?ev/lam:0),avg=ev-spend;
  return '<div class="kv"><div><small>Gasto (aluguel)</small><span>'+usd(spend)+'</span></div><div><small>Chance de 1 bloco ou mais</small><span>'+pctp(ch*100,ch<0.1?1:0)+'</span></div><div><small>Média de longo prazo</small><span class="'+(avg>=0?'good':'bad')+'">'+signUsd(avg)+'</span></div></div>'+
    '<div class="box" style="margin-top:8px"><b>Se fosse dinheiro de verdade</b>'+
    '<span class="bad">Sem bloco ('+pctp((1-ch)*100,0)+' de chance, o mais provável): −'+usd(spend)+'</span>, perde todo o aluguel.<br>'+
    '<span class="good">Com 1 bloco ('+pctp(ch*100,ch<0.1?1:0)+'): ~'+signUsd(V-spend)+'</span> (bloco de ~'+usd(V)+' menos o aluguel).<br>'+
    'A média ('+signUsd(avg)+') é o que sobra em média repetindo isso muitas vezes; numa vez só, é um dos dois desfechos acima.</div>';
}
function dayRows(days,cols){
  var ks=Object.keys(days||{}).sort().reverse().slice(0,7);
  return ks.length?'<div class="scroll"><table><tr>'+cols.map(function(c){return '<th>'+c[0]+'</th>'}).join('')+'</tr>'+ks.map(function(k){var d=days[k];
    return '<tr><td>'+k.slice(8,10)+'/'+k.slice(5,7)+'</td>'+cols.slice(1).map(function(c){return '<td>'+c[1](d)+'</td>'}).join('')+'</tr>'}).join('')+'</table></div>':'';
}
function renderPaper(st){
  var s=st.state||{},p=s.paper,cfg=st.config,el=$('o_paper');
  var head='<div class="row" style="justify-content:space-between"><h2 style="margin:0">Simulação</h2><span class="chip">o que o robô teria feito</span></div>';
  if(!p){el.innerHTML=head+'<p class="note">'+(cfg.mode==='observe'?'Começa no próximo ciclo do robô (até 3 min).':'Só roda com o robô em Observar.')+'</p>';return}
  el.innerHTML=head+
    '<p class="note" style="margin:6px 0">Desde '+new Date(p.since).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'. '+
    (cfg.mode!=='observe'?'<b>Parada</b>: o robô não está em Observar.':(p.on?'Agora: <b class="good">compraria</b> '+nf(p.ph,0)+' PH/s a '+(+p.priceEH).toFixed(4).replace('.',',')+'.':'Agora: <b>pausado</b> (aluguel acima do teto ou limite do dia).'))+'</p>'+
    simResultHTML(p)+
    '<div class="kv" style="margin-top:8px"><div><small>Tempo comprando</small><span>'+nf(p.hoursOn,1)+' h</span></div><div><small>Sessões</small><span>'+p.sessions+'</span></div><div><small>Stop-loss</small><span>'+p.stops+'</span></div></div>'+
    dayRows(p.days,[['Dia (UTC)'],['Horas',function(d){return nf(d.hoursOn,1)}],['Gasto',function(d){return usd(d.spendUsd)}],['Blocos',function(d){return (d.blocks||0)+' de '+(d.draws||0)}],['Resultado',function(d){return signUsd((d.wonUsd||0)-d.spendUsd)}]])+
    '<p class="note" style="margin:8px 0 0">Acerto do robô = só comprar abaixo do empate (média de longo prazo positiva) sem estourar os limites. O dinheiro de verdade depende de sorte: a simulação não inventa blocos, mostra os dois desfechos e a chance de cada um.</p>'+
    '<div class="row" style="margin-top:8px"><button class="sm pri" data-go="diary:robo">Ver operações simuladas</button><button class="sm" id="o_paper_reset">Reiniciar simulação</button></div>';
  var real=s.real,re=$('o_real');
  re.hidden=!(real&&(real.spendUsd>0||real.blocks>0||cfg.mode==='active'));
  if(!re.hidden){var rr=(real.revenueUsd||0)-(real.spendUsd||0);
    re.innerHTML='<div class="row" style="justify-content:space-between"><h2 style="margin:0">Resultado real</h2><span class="chip '+(rr>=0?'ok':'bad')+'">'+(rr>=0?'+':'')+usd(rr)+'</span></div>'+
      '<div class="kv" style="margin-top:8px"><div><small>Gasto (ordens do robô)</small><span>'+usd(real.spendUsd||0)+'</span></div><div><small>Blocos</small><span>'+(real.blocks||0)+'</span></div><div><small>Recebido</small><span>'+usd(real.revenueUsd||0)+'</span></div></div>'+
      dayRows(real.days,[['Dia (UTC)'],['Gasto',function(d){return usd(d.spendUsd)}],['Blocos',function(d){return d.blocks}],['Recebido',function(d){return usd(d.revenueUsd)}]])+
      '<p class="note" style="margin:8px 0 0">Desde '+new Date(real.since).toLocaleDateString('pt-BR')+'. Conta só ordens marcadas "robô gerencia"; o extrato da NiceHash é o registro oficial.</p>';}
}
/* ---------- diário do robô simulado ---------- */
function utcHM(ms){var d=new Date(ms);return ('0'+d.getUTCHours()).slice(-2)+':'+('0'+d.getUTCMinutes()).slice(-2)}
// Data e hora local, com a hora UTC (a do servidor) entre parênteses.
function dt2(ms){return new Date(ms).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' ('+utcHM(ms)+' UTC)'}
function btcTxt(b,d){d=d||6;var px=ops&&ops.status&&ops.status.state&&ops.status.state.market&&ops.status.state.market.btcUsd;return (+b||0).toFixed(d).replace('.',',')+' BTC'+(px?' ('+usd((+b||0)*px)+')':'')}
function usdBtc(u){var px=ops&&ops.status&&ops.status.state&&ops.status.state.market&&ops.status.state.market.btcUsd;return usd(u||0)+(px?' <span class="note">('+((u||0)/px).toFixed(6).replace('.',',')+' BTC)</span>':'')}
function signUsd(x){if(Math.abs(x)<0.005)return 'US$0,00';return (x>=0?'+':'')+usd(x)}
var roboAll={f:false,m:false};
function renderRobo(){
  if(!$('rb_head'))return;
  var st=ops.status,s=st&&st.state||{},fp=s.fundPaper,mp=s.paper;
  if(!settings.apiUrl||!st){
    $('rb_head').innerHTML='<div class="eyebrow">Robô simulado</div><div class="lead">O que o robô teria feito</div><p class="note">'+(settings.apiUrl?esc(ops.err.status||'Carregando do servidor…'):'Ele roda no servidor 24 h. Conecte o backend em Ajustes para ver.')+'</p>';
    $('rb_fund').innerHTML='';$('rb_mine').innerHTML='';$('rb_score').innerHTML='';$('rb_algo').innerHTML='';return;
  }
  var fs=fp&&fp.summary,runs=(mp&&mp.runs)||[],cur=mp&&mp.run;
  var mAll=runs.concat(cur?[cur]:[]),mSpend=mp?mp.spendUsd:0,mEv=mp?mp.evUsd:0,mLam=mp?mp.lambda:0; // mesmos totais da aba Operar
  $('rb_head').innerHTML='<div class="eyebrow">Robô simulado</div><div class="lead">O que o robô teria feito, operação por operação</div>'+
    '<p class="note" style="margin:4px 0 10px">Regras fixas, registradas na hora da decisão, sem olhar o futuro. Nenhum dinheiro usado. As regras estão no fim da página.</p>'+
    '<div class="kv"><div><small>Funding fechadas</small><span>'+(fs?fs.closed:0)+'</span></div><div><small>Acerto</small><span>'+(fs&&fs.closed?fs.wins+' de '+fs.closed:'—')+'</span></div><div><small>Funding (fechadas)</small><span class="'+(fs&&fs.netUsd<0?'bad':'good')+'">'+(fs?signUsd(fs.netUsd):'—')+'</span></div>'+
    '<div><small>Mineração: gasto</small><span>'+(mp?usd(mSpend):'—')+'</span></div><div><small>Blocos que seriam seus</small><span>'+(mp?(mp.blocks||0)+' de '+(mp.draws||0):'—')+'</span></div><div><small>Resultado simulado</small><span class="'+(mp&&(mp.wonUsd||0)-mSpend<0?'bad':'good')+'">'+(mp?signUsd((mp.wonUsd||0)-mSpend):'—')+'</span></div></div>';
  // funding
  var fh='<div class="row between"><h2 style="margin:0">Funding</h2>'+(fs?'<span class="note">desde '+dt2(fs.since)+'</span>':'')+'</div>';
  if(!fp)fh+='<p class="note">Começa no próximo ciclo do servidor (até 3 min).</p>';
  else{
    fh+='<div class="eyebrow" style="margin:10px 0 6px">Abertas agora ('+fp.open.length+')</div>'+(fp.open.length?'<div class="stack" style="gap:8px">'+fp.open.map(function(o){var acc=o.fundingUsd-o.feesUsd;
      return '<div class="box" style="margin:0"><b>'+esc(o.coin)+' · short '+esc(o.s)+', long '+esc(o.l)+'</b>Desde '+dt2(o.openedAt)+' ('+ago(o.openedAt)+'). '+o.payments+' pagamento'+(o.payments===1?'':'s')+': recebido '+signUsd(o.fundingUsd)+', custos até agora '+usd(o.feesUsd)+' → <strong class="'+(acc>=0?'good':'bad')+'">'+signUsd(acc)+'</strong> (falta o custo de saída). Diferença: '+pct(o.entrySpread,1)+' a.a. na entrada, '+(o.spreadNow===null||o.spreadNow===undefined?'sem dado':pct(o.spreadNow,1)+' a.a.')+' agora.</div>'}).join('')+'</div>'
      :'<p class="note" style="margin:0">Nenhuma: nada passou nas regras de entrada agora.</p>');
    var cl=fp.closed||[],show=roboAll.f?cl:cl.slice(0,15);
    fh+='<div class="eyebrow" style="margin:12px 0 6px">Fechadas ('+cl.length+(fs&&fs.closed>cl.length?' de '+fs.closed:'')+')</div>'+(cl.length?'<div class="stack" style="gap:6px">'+show.map(function(c){
      return '<div class="trow"><div><b>'+esc(c.coin)+'</b> <span class="note">short '+esc(c.s)+', long '+esc(c.l)+'</span></div><div class="note">'+dt2(c.openedAt)+' → '+dt2(c.closedAt)+' · '+FDI.dur(c.closedAt-c.openedAt)+' · '+c.payments+' pagto'+(c.payments===1?'':'s')+' · <strong class="'+(c.netUsd>=0?'good':'bad')+'">'+signUsd(c.netUsd)+'</strong> ('+pct(c.retPct,2)+')</div><div class="note">Saída: '+esc(c.reason)+'</div></div>'}).join('')+'</div>'+
      (cl.length>15?'<div style="margin-top:6px"><button class="sm" data-roboall="f">'+(roboAll.f?'Mostrar menos':'Ver todas ('+cl.length+')')+'</button></div>':'')
      :'<p class="note" style="margin:0">Nenhuma ainda. Uma operação fecha quando o funding vira contra; pode levar horas ou dias.</p>');
    if(fs&&fs.closed)fh+='<p class="note" style="margin:8px 0 0">Média de '+FDI.dur(fs.avgHours*3600e3)+' por operação. Acerto = fechou no positivo depois de todas as taxas.</p>';
  }
  $('rb_fund').innerHTML=fh+aiCompareHTML(s);
  renderScore(s.alertScore);
  // mineração
  var mh='<div class="row between"><h2 style="margin:0">Mineração (BCH solo)</h2>'+(mp?'<span class="note">desde '+dt2(mp.since)+'</span>':'')+'</div>';
  if(!mp)mh+='<p class="note">'+(st.config.mode==='observe'?'Começa no próximo ciclo (até 3 min).':'Só roda com o robô em Observar (Mineração → Operar).')+'</p>';
  else{
    mh+=cur?'<div class="box" style="margin:10px 0 0"><b>Comprando agora (simulado)</b>Desde '+dt2(cur.start)+' ('+ago(cur.start)+'): '+nf(cur.ph,0)+' PH/s a '+cur.priceEH.toFixed(4).replace('.',',')+' (margem '+pct(cur.edgePct,1)+'). Gasto até agora '+usd(cur.spendUsd)+'. Blocos da rede nesse tempo: '+(cur.draws||0)+'; seus: '+(cur.blocks||0)+'.</div>'
      :'<p class="note" style="margin:10px 0 0">Agora: pausado (aluguel acima do teto, limite do dia ou sem dados).</p>';
    var rs=runs.slice().reverse(),showm=roboAll.m?rs:rs.slice(0,15);
    mh+='<div class="eyebrow" style="margin:12px 0 6px">Operações encerradas ('+rs.length+')</div>'+(rs.length?'<div class="stack" style="gap:6px">'+showm.map(function(r){
      return '<div class="trow"><div><b>'+nf(r.ph,0)+' PH/s</b> <span class="note">a '+r.priceEH.toFixed(4).replace('.',',')+' (margem '+pct(r.edgePct,1)+')</span></div><div class="note">'+dt2(r.start)+' → '+dt2(r.end)+' · '+FDI.dur(r.end-r.start)+' · gasto '+usd(r.spendUsd)+' · blocos da rede '+(r.draws||0)+', seus '+(r.blocks||0)+' → <strong class="'+(((r.wonUsd||0)-r.spendUsd)>=0?'good':'bad')+'">'+signUsd((r.wonUsd||0)-r.spendUsd)+'</strong></div><div class="note">Saída: '+esc(r.reason)+'</div></div>'}).join('')+'</div>'+
      (rs.length>15?'<div style="margin-top:6px"><button class="sm" data-roboall="m">'+(roboAll.m?'Mostrar menos':'Ver todas ('+rs.length+')')+'</button></div>':'')
      :'<p class="note" style="margin:0">Nenhuma encerrada ainda.</p>');
    mh+=simResultHTML(mp)+burstHTML(mp,s.paperBurst,s.paperPlan,s.paperAlways);
  }
  mh+='<div class="row" style="margin-top:8px"><button class="sm" data-roboreset="funding">Reiniciar funding</button><button class="sm" data-roboreset="mining">Reiniciar mineração</button></div>';
  $('rb_mine').innerHTML=mh;
  renderAlgoPaper(s.algoPaper);
}
var algoOpen={};
function renderAlgoPaper(ap){
  var h='<div class="row between"><h2 style="margin:0">Outras moedas (pool PPS)</h2>'+(ap?'<span class="note">desde '+dt2(ap.since)+'</span>':'')+'</div>'+
    '<p class="note" style="margin:4px 0 8px">Mesmo orçamento para cada algoritmo (US$'+((ap&&ap.budgetUsdDay)||100)+'/dia de aluguel enquanto compensa). Pool PPS paga por share: sem sorte de bloco, o resultado é o esperado. Margem realista: dificuldade média de 24 h, pool PPS 4%, shares perdidos e venda das moedas 2,5%. Recalcula a cada 15 min.'+(ap&&ap.v===2?'':' (Resultado anterior usava a conta bruta da WhatToMine e exagerava o lucro; recomeça no próximo cálculo.)')+'</p>';
  if(!ap){$('rb_algo').innerHTML=h+'<p class="note">Começa no próximo cálculo do servidor (até 15 min).</p>';return}
  var list=Object.keys(ap.algos).map(function(k){var a=ap.algos[k];a.key=k;a.res=a.revUsd-a.spendUsd;return a}).sort(function(x,y){return y.res-x.res||(y.edgeNow||-1e9)-(x.edgeNow||-1e9)});
  var tot=list.reduce(function(s,a){return s+a.res},0),sp=list.reduce(function(s,a){return s+a.spendUsd},0);
  h+='<div class="kv"><div><small>Gasto total</small><span>'+usd(sp)+'</span></div><div><small>Resultado total</small><span class="'+(tot>=0?'good':'bad')+'">'+signUsd(tot)+'</span></div><div><small>Comprando agora</small><span>'+list.filter(function(a){return a.on}).length+' de '+list.length+'</span></div></div>'+
    '<div class="stack" style="gap:6px;margin-top:8px">'+list.map(function(a){
      var st=a.on?'<span class="chip ok">comprando</span>':'<span class="chip">parado</span>';
      var runs=(a.runs||[]).slice().reverse();
      return '<div class="trow"><div class="row between"><span><b>'+esc(a.label)+'</b> <span class="note">'+esc((a.coins||[]).join('+'))+'</span></span>'+st+'</div>'+
        '<div class="note">Margem agora '+(isFinite(a.edgeNow)&&a.edgeNow!==null?pct(a.edgeNow,1):'—')+' · '+nf(a.hoursOn,1)+' h comprando · gasto '+usd(a.spendUsd)+' · receita '+usd(a.revUsd)+' → <strong class="'+(a.res>=0?'good':'bad')+'">'+signUsd(a.res)+'</strong>'+(a.spendUsd>0?' ('+pct(a.res/a.spendUsd*100,1)+')':'')+'</div>'+
        (runs.length?'<details'+(algoOpen[a.key]?' open':'')+' data-algoruns="'+esc(a.key)+'"><summary class="note">Operações ('+runs.length+')</summary>'+runs.slice(0,10).map(function(r){return '<div class="note">'+dt2(r.start)+' → '+dt2(r.end)+' · margem '+pct(r.edgePct,1)+' · '+signUsd(r.revUsd-r.spendUsd)+' · saída: '+esc(r.reason)+'</div>'}).join('')+'</details>':'')+'</div>'}).join('')+'</div>'+
    '<div class="row" style="margin-top:8px"><button class="sm" data-roboreset="algos">Reiniciar outras moedas</button></div>';
  $('rb_algo').innerHTML=h;
}
// Placar dos alertas de funding: projetado no alerta × o que de fato pagou no prazo, já com as taxas.
// IA em modo sombra: o mesmo robô de funding, mas só entra quando a IA dá p maior ou igual ao limiar. Lado a lado com as regras.
var GH_DOC='https://github.com/Sr-Geovani/funding-desk/blob/main/docs/modelo-funding.md';
function aiCompareHTML(s){
  var M=s.model,fa=s.fundPaperAI,fr=s.fundPaper;
  if(!M)return '<div class="box" style="margin-top:12px"><b>IA (modo sombra)</b>Modelo ainda não treinado.</div>';
  var R=M.report||{},a=fa&&fa.summary,r=fr&&fr.summary,pc=function(x){return x===null||x===undefined?'—':pctp(x*100,0)};
  var col=function(x){return x?[x.closed,x.closed?x.wins+' de '+x.closed:'—',signUsd(x.netUsd),isFinite(x.netMixedUsd)?signUsd(x.netMixedUsd)+(x.closed?' ('+x.winsMixed+' de '+x.closed+')':''):'—',x.open+(x.open?' ('+signUsd(x.openNetUsd)+')':'')]:['—','—','—','—','—']};
  var A=col(a),B=col(r),lab=['Fechadas','Acerto','Resultado (2 ordens limite)','Se 1 perna fosse a mercado','Abertas agora'];
  var h='<div class="eyebrow" style="margin:14px 0 6px">Regras × Regras + IA (modo sombra)</div><div class="scroll"><table><tr><th></th><th>Regras</th><th>Regras + IA</th></tr>'+
    lab.map(function(l,i){return '<tr><td>'+l+'</td><td>'+B[i]+'</td><td>'+A[i]+'</td></tr>'}).join('')+'</table></div>';
  if(fa&&fa.open&&fa.open.length)h+='<p class="note" style="margin:6px 0 0">Abertas pela IA: '+fa.open.map(function(o){var ai=(s.aiScores||{})[o.key];return esc(o.coin)+' (short '+esc(o.s)+', long '+esc(o.l)+(ai?', IA '+pctp(ai.p*100,0):'')+')'}).join(' · ')+'</p>';
  h+='<p class="note" style="margin:6px 0 0"><b>Realismo:</b> o resultado supõe as 2 pernas em ordem limite (maker), que pode não executar. Se uma perna precisar ir a mercado (taker) na entrada e na saída, cada operação custa ~US$0,60 a mais: a linha "Se 1 perna fosse a mercado" mostra isso. Com dinheiro real, só vale se as duas ordens limite executarem.</p>';
  h+='<div class="box" style="margin-top:8px"><b>Como a IA decide</b>Entra só quando a regra diz "Compensa" <strong>e</strong> a IA dá chance a partir de '+pctp(M.threshold*100,0)+' de a entrada pagar as taxas em 3 dias. '+
    'Ela olha o histórico do próprio spread (média de 8, 24 e 72 h, oscilação, horas acima do empate, tamanho do pico). Treino: '+(R.days||'—')+' dias, '+(R.coins||'—')+' moedas (Hyperliquid, OKX, Bitget). '+
    'No teste com dados que ela não viu: regras acertaram '+pc(R.test&&R.test.hit)+'; só as aprovadas pela IA, '+pc(R.testKept&&R.testKept.hit)+'; as vetadas, '+pc(R.testDropped&&R.testDropped.hit)+'. '+
    'Precisa de 6 h de histórico do par para dar nota. <a href="'+GH_DOC+'" target="_blank" rel="noopener">Relatório do modelo</a>.</div>';
  return h;
}
function renderScore(sc){
  var h='<div class="row between"><h2 style="margin:0">Placar dos alertas de funding</h2>'+(sc?'<span class="note">desde '+dt2(sc.summary.since)+'</span>':'')+'</div>'+
    '<p class="note" style="margin:4px 0 8px">Cada alerta de entrada vira uma posição hipotética mantida pelo prazo que ele projetou (3 dias). No fim, compara o projetado com o que de fato pagou, já com as taxas.</p>';
  if(!sc){$('rb_score').innerHTML=h+'<p class="note">Começa com o próximo alerta de entrada.</p>';return}
  var m=sc.summary,ratio=m.projUsd>0?m.realUsd/m.projUsd*100:null;
  h+='<div class="kv"><div><small>Avaliados</small><span>'+m.scored+'</span></div><div><small>Acerto</small><span>'+(m.scored?m.hits+' de '+m.scored+' ('+pctp(m.hits/m.scored*100,0)+')':'—')+'</span></div><div><small>Em andamento</small><span>'+m.open+'</span></div>'+
    '<div><small>Projetado</small><span>'+(m.scored?signUsd(m.projUsd):'—')+'</span></div><div><small>Realizado</small><span class="'+(m.realUsd<0?'bad':'good')+'">'+(m.scored?signUsd(m.realUsd):'—')+'</span></div><div><small>Realizado ÷ projetado</small><span>'+(ratio===null||!m.scored?'—':pctp(ratio,0))+'</span></div></div>';
  if(!m.scored)h+='<p class="note" style="margin:8px 0 0">Os primeiros resultados saem 3 dias depois dos primeiros alertas.</p>';
  if(m.aiYes&&(m.aiYes.n||m.aiNo.n))h+='<p class="note" style="margin:8px 0 0"><b>IA:</b> dos que ela aprovaria, '+m.aiYes.hits+' de '+m.aiYes.n+' acertaram ('+signUsd(m.aiYes.netUsd)+'); dos que vetaria, '+m.aiNo.hits+' de '+m.aiNo.n+' ('+signUsd(m.aiNo.netUsd)+').</p>';
  var op=(sc.open||[]).slice().sort(function(a,b){return b.t-a.t});
  if(op.length)h+='<div class="eyebrow" style="margin:12px 0 6px">Em andamento</div><div class="stack" style="gap:6px">'+op.slice(0,10).map(function(o){
    var el=Date.now()-o.t;return '<div class="trow"><div><b>'+esc(o.coin)+'</b> <span class="note">short '+esc(o.s)+', long '+esc(o.l)+' · alerta '+dt2(o.t)+(o.ai!==null&&o.ai!==undefined?' · IA '+pctp(o.ai*100,0):'')+'</span></div><div class="note">'+FDI.dur(el)+' de '+o.holdDays+' dias · '+o.payments+' pagto'+(o.payments===1?'':'s')+' · recebido '+signUsd(o.fundingUsd)+' · projetado '+signUsd(o.projUsd||0)+' (já descontando taxas)</div></div>'}).join('')+'</div>'+(op.length>10?'<p class="note">+'+(op.length-10)+' em andamento.</p>':'');
  var dn=sc.done||[];
  if(dn.length)h+='<div class="eyebrow" style="margin:12px 0 6px">Avaliados</div><div class="stack" style="gap:6px">'+dn.slice(0,20).map(function(d){
    return '<div class="trow"><div>'+(d.hit?'<span class="chip ok">acertou</span>':'<span class="chip bad">errou</span>')+' <b>'+esc(d.coin)+'</b> <span class="note">short '+esc(d.s)+', long '+esc(d.l)+' · alerta '+dt2(d.t)+(d.ai!==null&&d.ai!==undefined?' · IA '+pctp(d.ai*100,0):'')+'</span></div><div class="note">Projetado '+signUsd(d.projUsd||0)+' → realizado <strong class="'+(d.netUsd>=0?'good':'bad')+'">'+signUsd(d.netUsd)+'</strong> ('+d.payments+' pagamentos, recebido '+signUsd(d.fundingUsd)+', taxas '+usd(d.costsUsd)+')</div></div>'}).join('')+'</div>';
  $('rb_score').innerHTML=h;
}
document.addEventListener('click',function(e){
  var a=e.target.closest('[data-roboall]');if(a){roboAll[a.dataset.roboall]=!roboAll[a.dataset.roboall];renderRobo();return}
  var ar=e.target.closest('[data-algoruns] summary');if(ar){var k=ar.parentNode.dataset.algoruns;setTimeout(function(){algoOpen[k]=ar.parentNode.open},0);return}
  var r=e.target.closest('[data-roboreset]');if(!r)return;
  if(!confirm('Zerar as operações simuladas de '+({funding:'funding',algos:'outras moedas'}[r.dataset.roboreset]||'mineração')+' e começar de agora?'))return;
  apiCall('POST','/paper/reset',{what:r.dataset.roboreset}).then(function(){loadOps()},function(err){alert('Erro: '+err.message)});
});
/* ---------- copiloto: o que fazer agora (plano de ação com números e travas) ---------- */
function renderAct(){
  if($('h_act'))$('h_act').hidden=true; // Início mostra o relatório completo do copiloto; o plano detalhado fica em Mineração
  ['m_act'].forEach(function(id){var el=$(id);if(!el)return;
    var P=ops.status&&ops.status.state&&ops.status.state.plan;
    if(!P){el.hidden=true;return}
    el.hidden=false;var M=P.mining,cfg=(ops.status||{}).config||{};
    el.className='card sig '+(M&&M.action==='alugar'?'favoravel':'neutro');
    var h='<div class="row between"><div class="eyebrow">Plano de mineração · o que fazer agora</div><span class="chip">copiloto</span></div>';
    if(M){
      h+='<div class="lead">'+esc(M.title)+'</div><p class="note" style="margin:4px 0 8px">'+esc(M.text)+'</p>'+
        '<div class="kv judged">'+
        kvJ('Potência',M.ph+' PH/s','',null,'~'+usd(M.costPerHourUsd,0)+' por hora')+
        kvJ('Preço',M.price.toFixed(4).replace('.',','),M.price<=M.maxPrice?'good':'bad',M.price<=M.maxPrice?'↓ abaixo do máximo':'↑ acima do máximo','máximo que compensa: '+M.maxPrice.toFixed(4).replace('.',','))+
        kvJ('Orçamento por tentativa',usd(M.budgetUsd,0),'',null,'= '+M.amountBtc.toString().replace('.',',')+' BTC na ordem; stop-loss: ao gastar isso sem bloco, para e espera '+(((ops.status||{}).config||{}).stopCooldownH===undefined?6:(ops.status.config.stopCooldownH))+' h')+
        kvJ('Duração',nf(M.durationH,1)+' h','',null,'tempo para gastar o orçamento nesta potência; janelas reais vão de minutos a poucas horas')+
        kvJ('Chance de bloco',pctp(M.chance*100,0),'neutral','→ por tentativa',(M.action==='alugar'?'com margem positiva, repetir tende a lucrar':'com margem negativa, repetir tende a perder')+'; sem bloco, perde o orçamento')+
        kvJ('Bloco vale',usd(M.blockUsd||0,0),'',null,'recompensa já sem a taxa do pool')+'</div>'+
        (M.why?'<details style="margin-top:8px"><summary>Por que '+M.ph+' PH/s?</summary><ol class="note" style="margin:6px 0 0;padding-left:18px">'+M.why.map(function(w){return '<li>'+esc(w)+'</li>'}).join('')+'</ol>'+
          (M.alt?'<div class="scroll"><table style="margin-top:6px"><tr><th>Potência</th><th>Gasto em 2 h</th><th>Chance de bloco</th></tr>'+M.alt.map(function(a){return '<tr><td>'+a.ph+' PH/s</td><td>'+usd(a.costUsd,0)+'</td><td>'+pctp(a.chance*100,0)+'</td></tr>'}).join('')+'</table></div><p class="note" style="margin:4px 0 0">Chance e gasto crescem juntos: a média por dólar é igual. Se quiser arriscar menos por sessão, baixe o orçamento (Operar → Stop-loss por sessão) que a potência sugerida cai junto.</p>':'')+'</details>':'')+
        powerHTML(M.power)+mineVsPlan(M)+chanceCalc(M)+norteHTML()+
        '<div class="row" style="margin-top:10px"><button class="sm pri" data-plan="apply">Aplicar plano no robô</button></div>';
    }
    if(P.blockers&&P.blockers.length)h+='<div class="eyebrow" style="margin:12px 0 6px">O que trava para operar ('+P.blockers.length+')</div><div class="stack" style="gap:6px">'+P.blockers.map(function(b,i){
      var btn=b.id==='pool'&&b.poolId?'<button class="sm" data-plan="pool" data-pool="'+esc(b.poolId)+'">'+esc(b.fix)+'</button>':
        b.id==='auto'?'<button class="sm" data-plan="apply">Aplicar o plano</button>':
        b.id==='mode'?'<button class="sm" data-plan="active">Ativar o robô</button>':
        b.id==='balance'?'<a class="sm" href="https://www.nicehash.com/my/wallet" target="_blank" rel="noopener">Abrir carteira da NiceHash</a>':'';
      return '<div class="trow"><div class="note"><b>'+(i+1)+'.</b> '+esc(b.text)+' <span class="note">'+esc(b.id==='pool'&&b.poolId?'':b.fix)+'</span></div>'+(btn?'<div style="margin-top:4px">'+btn+'</div>':'')+'</div>'}).join('')+'</div>';
    else if(M)h+='<p class="note" style="margin:10px 0 0"><b class="good">Nada travando:</b> o robô está pronto e opera sozinho conforme o plano.</p>';
    var whyL=function(w){return w&&w.length?'<details style="margin-top:4px"><summary class="note">Por quê?</summary><ul class="note" style="margin:4px 0 0;padding-left:18px">'+w.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul></details>':''};
    if(P.funding)h+='<div class="box" style="margin-top:10px"><b>'+esc(P.funding.title)+'</b>'+esc(P.funding.text)+whyL(P.funding.why)+'</div>';
    if(P.others&&P.others.length)h+='<div class="box" style="margin-top:8px"><b>Outras moedas (pool PPS, ordem manual)</b>'+P.others.map(function(o){return '<div style="margin-top:4px"><strong>'+esc(o.title)+'.</strong> '+esc(o.text)+whyL(o.why)+'</div>'}).join('')+'</div>';
    h+='<details style="margin-top:8px"><summary>Solo × PPS: qual depende de sorte?</summary><p class="note" style="margin:6px 0 0"><b>Solo</b> (BCH no BlockSniper): você só recebe se o SEU hash achar um bloco. Ou ganha o bloco inteiro (~US$900), ou não ganha nada: é sorte, com chance proporcional à sua potência. <b>PPS</b> (pay per share): o pool paga cada "share" (prova de trabalho) que você entrega, pelo valor médio, ache o pool bloco ou não. O pool fica com o risco da sorte e cobra uma taxa por isso. Por isso, em PPS o resultado já é o esperado: receita por hash − aluguel − taxas, todo dia, sem loteria. As outras moedas são simuladas assim.</p></details>';
    el.innerHTML=h;
  });
}
// Sua configuração (o que o robô executa) × sugestão do copiloto, com os mesmos números de mercado.
function mineVsPlan(M){
  var Y=M.mine;if(!Y)return '';
  var r=[['Potência',Y.ph+' PH/s',M.ph+' PH/s'],['Orçamento por tentativa',usd(Y.budgetUsd,0),usd(M.budgetUsd,0)],['Custo por hora',usd(Y.costPerHourUsd,0),usd(M.costPerHourUsd,0)],
    ['Orçamento dura',Y.durationH>=999?'muito tempo':nf(Y.durationH,1)+' h',nf(M.durationH,1)+' h'],['Gasto numa janela de 2 h',usd(Y.cost2h,0),usd(M.cost2h,0)],['Chance nessa janela',pctp(Y.chance2h*100,0),pctp(M.chance2h*100,0)]];
  var diff=Y.ph!==M.ph;
  return '<div class="eyebrow" style="margin:12px 0 6px">Sua configuração × sugestão do copiloto</div><div class="scroll"><table><tr><th></th><th>Sua (o robô executa)</th><th>Copiloto</th></tr>'+
    r.map(function(x){return '<tr><td>'+x[0]+'</td><td>'+x[1]+'</td><td>'+x[2]+'</td></tr>'}).join('')+'</table></div>'+
    '<p class="note" style="margin:4px 0 0">'+(diff?'Os dois rodam na simulação com os mesmos blocos reais (Diário → Robô): em semanas, dá para ver qual escolha funcionou melhor. Para usar a sugestão, toque em "Aplicar plano no robô".':'Sua configuração já é igual à sugestão.')+'</p>';
}
// Calculadora: chance desejada → potência e custo, com a dificuldade e o preço de agora (janela de ~2 h).
function chanceCalc(M){
  if(!(M.ph>0&&M.durationH>0&&M.expBlocks>0))return '';
  var cph=M.costPerHourUsd/M.ph,lam1=M.expBlocks/(M.ph*M.durationH),h=2;
  var rows=[0.1,0.2,0.3,0.5].map(function(p){var ph=-Math.log(1-p)/(lam1*h);return '<tr><td>'+pctp(p*100,0)+'</td><td>'+nf(ph,0)+' PH/s</td><td>'+usd(ph*h*cph,0)+'</td><td>'+usd(ph*lam1*h*(M.blockUsd||0),0)+'</td></tr>'}).join('');
  return '<details style="margin-top:8px"><summary>Escolher pela chance (dificuldade de agora)</summary><p class="note" style="margin:6px 0">Com a dificuldade e o preço de agora, cada PH/s por 1 h custa '+usd(cph,2)+' e dá '+pctp(lam1*100,3)+' de chance. Para uma janela de 2 h:</p>'+
    '<div class="scroll"><table><tr><th>Chance que você quer</th><th>Potência</th><th>Custo (perde se não sair)</th><th>Na média volta</th></tr>'+rows+'</table></div>'+
    '<p class="note" style="margin:4px 0 0">"Na média volta" = blocos esperados × valor do bloco: fica acima do custo só quando a margem é positiva. Chance maior custa mais na mesma proporção; se a dificuldade sobe, a mesma chance passa a custar mais.</p></details>';
}
// Norte operacional: o que cada leitura decide.
function norteHTML(){
  return '<details style="margin-top:6px"><summary>Norte operacional: o que cada número decide</summary><ol class="note" style="margin:6px 0 0;padding-left:18px">'+
    '<li><b>Margem (preço × empate) decide SE compra.</b> É a única alavanca do lucro médio. Abaixo do mínimo, não compra.</li>'+
    '<li><b>Orçamento por tentativa decide QUANTO arrisca (soma todas as ordens até achar bloco; ao estourar, o robô para e espera).</b> Em solo, sem bloco você perde o que gastou.</li>'+
    '<li><b>Dificuldade decide QUANTA chance o dinheiro compra.</b> Dificuldade 10% maior = cada dólar compra 10% menos chance (e o empate cai junto).</li>'+
    '<li><b>Duração da janela decide a POTÊNCIA.</b> Potência = orçamento ÷ (custo por PH/s por hora × horas que a janela costuma durar).</li>'+
    '<li><b>Tempo desde o último bloco, mempool e taxas não mudam a sua chance.</b> O sorteio não tem memória; só a dificuldade importa.</li>'+
    '<li><b>Hash da rede chegando é aviso de janela fechando:</b> a dificuldade sobe em horas e a margem cai.</li></ol></details>';
}
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-plan]');if(!b)return;
  var P=ops.status&&ops.status.state&&ops.status.state.plan,M=P&&P.mining,act=b.dataset.plan,body=null,msg='';
  if(act==='apply'&&M){body=M.apply;msg='Aplicar no robô: '+M.apply.targetPh+' PH/s, orçamento de US$'+M.apply.sessionBudgetUsd+' por tentativa ('+M.apply.orderAmountBtc+' BTC por ordem), parar no bloco e criar ordem sozinho quando a janela abrir? O modo atual não muda.'}
  if(act==='pool'){body={poolId:b.dataset.pool};msg='Usar este pool nas ordens do robô?'}
  if(act==='active'){body={mode:'active'};msg='Ativar o robô? Ele vai criar, alterar e cancelar ordens reais na NiceHash (produção) com o seu saldo, seguindo o plano. Confira o saldo e o pool antes.'}
  if(!body||!confirm(msg))return;
  b.disabled=true;
  apiCall('PUT','/config',body).then(function(){loadOps()},function(err){alert('Não deu: '+err.message);b.disabled=false});
});
// Margem "bruta" (como a WhatToMine mostra: dificuldade do momento, sem perdas) × realista (média de 24 h, pool PPS,
// shares perdidos e venda das moedas). Mostra só quando a diferença importa.
function rawTxt(m){
  if(!isFinite(m.rawEdgePct)||m.edgePct===null||Math.abs(m.rawEdgePct-m.edgePct)<1)return '';
  return '<div class="note">Na conta bruta da WhatToMine daria '+pct(m.rawEdgePct,1)+'. A realista '+(m.pps?'desconta pool PPS (4%), shares perdidos e venda das moedas (2,5%) e ':'')+'usa a dificuldade média de 24 h quando a do momento está num vale (DOGE e DASH reajustam a cada bloco; o vale dura minutos).</div>';
}
function thinTxt(m){
  return 'Livro raso: '+(m.paying<5?'só '+m.paying+' ordens recebendo hash':'o mercado inteiro gasta ~'+usd(m.marketUsdDay||0,0)+'/dia')+'; uma ordem de US$100/dia mudaria o preço. O "compensa" não vale para volume real.';
}
// Potência ideal calculada pela IA: lucro esperado por dia em cada potência (lance pela profundidade do livro), sorte e
// capital mínimo pelo critério de Kelly.
function powerHTML(P){
  if(!P||!P.curve||!P.curve.length)return '';
  var head=P.idealPh>0?'Potência ideal (IA): <b class="good">'+P.idealPh+' PH/s</b> · lucro esperado ~'+usd(P.idealProfitDay,0)+'/dia · margem real '+pct(P.edgePct,1)
    :'Potência ideal (IA): <b class="bad">0 PH/s agora</b> · margem real '+pct(P.edgePct,1)+' no preço que de fato recebe hash: nenhuma potência tem lucro esperado';
  return '<div class="box" style="margin-top:10px"><b>'+head+'</b>'+
    '<div class="scroll"><table style="margin-top:6px"><tr><th>PH/s</th><th>Lance</th><th>Margem</th><th>Lucro esperado/dia</th><th>Blocos/dia</th><th>Sorte (±1 dia)</th></tr>'+
    P.curve.filter(function(r){return [5,10,30,50,100,200,500].indexOf(r.ph)>=0||r.ph===P.idealPh}).map(function(r){
      return '<tr'+(r.ph===P.idealPh?' style="font-weight:700"':'')+'><td>'+r.ph+(r.overCap?'*':'')+'</td><td>'+r.bidEH.toFixed(4).replace('.',',')+'</td><td class="'+(r.edgePct>=0?'good':'bad')+'">'+pct(r.edgePct,1)+'</td><td class="'+(r.profitDay>=0?'good':'bad')+'">'+signUsd(r.profitDay)+'</td><td>'+nf(r.blocksDay,2)+'</td><td>±'+usd(r.luckDay,0)+'</td></tr>'}).join('')+'</table></div>'+
    '<p class="note" style="margin:6px 0 0">'+(P.edgePct>=0?'O lucro esperado cresce junto com a potência enquanto o livro aguenta sem subir o lance: a potência não muda a margem, muda o tamanho do ganho <b>e</b> da sorte. ':'Com margem negativa, a perda esperada por dia cresce junto com a potência: a potência não muda a margem, muda o tamanho do ganho <b>e</b> da perda. ')+'Potências com * passam do teto de segurança do servidor. '+
    (P.bankrollMinUsd?'Para a sorte não quebrar o caixa antes de a média aparecer, o capital deveria ser de pelo menos ~'+usd(P.bankrollMinUsd,0)+' (critério de Kelly: bloco ÷ 2 × margem).':'Com margem negativa, mais potência só aumenta a perda esperada.')+
    (P.curve.some(function(r){return r.overCap})?' * acima do teto de segurança do servidor ('+P.capPh+' PH/s).':'')+'</p></div>';
}
// Cartilha de entrada: os 9 fatores em sequência, avaliados pelo servidor a cada ciclo (worker/src/entry.js).
// Contexto para minerar (últimas 24 h): a média do mercado, onde está a sua meta, o que ajustar para operar agora e quanto
// custa, a regra relativa opcional e com quanta potência os blocos saíram. É o parâmetro claro para decidir entradas.
function ctx24HTML(E){
  var S=ops.status.state,cfg=ops.status.config||{},M=S.mktMargin||{},H=M.h24||M.d7,L=S.luck24,mk=S.market||{},R=S.minEdgeNow||{},B=E.market&&E.market.band;
  if(!H)return '';
  // a configuração salva manda: se a regra foi trocada depois do último ciclo, o painel já mostra a nova
  if(cfg.minEdgeMode!=='relativo')R={value:cfg.minEdgePct,relative:false,base:cfg.minEdgePct};
  var snOn=!!cfg.sniper;
  var fixed=R.base!==undefined?R.base:cfg.minEdgePct,base=R.relative?R.value:fixed,now=mk.edgeAtBidPct,diff=base-H.avg,stop=cfg.sessionBudgetUsd||300;
  var lossTry=function(m){return m<0?usd(-m/100*stop,0):'US$0'};
  var h='<div class="box" style="margin:0 0 8px"><b>Contexto para minerar (últimas '+esc(H.label||'24 h')+')</b>'+
    '<div class="kv" style="margin-top:4px"><div><small>Margem média</small><span class="'+(H.avg>=0?'good':'bad')+'">'+pct(H.avg,1)+'</span></div><div><small>Agora ('+nf(+cfg.targetPh||0,0)+' PH/s)</small><span class="'+(now>=0?'good':'bad')+'">'+(isFinite(now)?pct(now,1):'—')+'</span></div><div><small>'+(R.relative?'Regra ativa (relativa)':'Sua meta (fixa)')+'</small><span>'+pct(base,1)+'</span></div></div>'+
    '<ul class="note" style="margin:6px 0 0;padding-left:18px">'+
    (R.relative?'<li>Regra relativa ativa: margem mínima de hoje '+pct(base,1)+' (sua meta fixa salva é '+pct(fixed,1)+' e volta quando a regra for desligada).</li>':'')+'<li>'+(R.relative?'A regra ativa de ':'Sua meta de ')+pct(base,1)+' está <b>'+nf(Math.abs(diff),1)+' pontos '+(diff>=0?'acima':'abaixo')+'</b> da média do período e foi atingida em <b>'+pctp(H.pctMin||0,1)+'</b> do tempo (cerca de '+nf(H.hoursMin||0,1)+' h).</li>'+
    (isFinite(now)&&now<base?'<li><b>Para operar agora</b>, a margem mínima teria de ir para '+pct(Math.floor(now*2)/2,1)+'. Custo esperado: cada US$100 de aluguel volta, em média, US$'+nf(100+now,2)+'; numa tentativa de US$'+nf(stop,0)+' sem bloco, a perda média seria de '+lossTry(now)+' (com bloco, ganha o bloco menos o gasto).</li>':(isFinite(now)?'<li>A margem de agora já passa da sua meta: o robô compraria.</li>':''))+
    (isFinite(H.top25)?(R.relative?'<li><b>Regra relativa ligada:</b> margem mínima de hoje <b>'+pct(R.value,1)+'</b> (os 25% melhores momentos das últimas 24 h, piso '+pct(cfg.relFloorPct===undefined?-2:cfg.relFloorPct,1)+').</li>':'<li><details><summary><b>Opção desligada:</b> regra relativa</summary><span>Se você ligar a regra relativa (Operar → Robô), entrar só nos 25% melhores momentos do dia daria hoje uma margem mínima de '+pct(Math.max(cfg.relFloorPct===undefined?-2:cfg.relFloorPct,H.top25),1)+'. São mais entradas que a sua meta, mas '+(H.top25<0?'ainda com perda média de cerca de '+nf(-H.top25,1)+'% por dólar: serve para jogar na loteria de forma controlada, não para lucro médio.':'com lucro médio positivo nesses momentos.')+' Hoje ela não está valendo: vale a sua meta de '+pct(fixed,1)+'.</span></details></li>'):'')+
    (B?'<li><b>Faixa aprendida pela IA:</b> a partir de '+nf(B.from,0)+'%, as 2 horas seguintes ficaram positivas em '+pctp(B.hit*100,0)+' das vezes.</li>':'<li><b>Faixa aprendida pela IA:</b> ainda nenhuma faixa com lucro esperado positivo nas 2 horas seguintes.</li>')+
    (L?'<li><b>Blocos nas últimas 24 h:</b> '+L.blocks+'. O mais fácil sairia com '+nf(L.minNeedPH,0)+' PH/s; metade dos blocos precisaria de até '+nf(L.medNeedPH||0,0)+' PH/s (sorteio: a maioria só sai para quem tem muita potência). '+(function(){var r=L.rows.filter(function(x){return x.ph===(+cfg.targetPh)})[0]||L.rows.filter(function(x){return x.ph>=(+cfg.targetPh)})[0];return r?'Com '+nf(r.ph,0)+' PH/s'+(r.ph!==(+cfg.targetPh)?' (a linha mais perto dos seus '+nf(+cfg.targetPh,0)+')':'')+' ligado o tempo todo, teriam sido <b>'+r.won+'</b> bloco(s) (esperado '+nf(r.expected,1)+'), resultado com a sorte '+signUsd(r.profitUsd)+'.':''})()+'</li>':'')+
    '</ul></div>';
  return h;
}
function renderEntry(){
  var el=$('m_entry'),E=ops.status&&ops.status.state&&ops.status.state.entryCheck;
  if(!el)return;if(!E){el.hidden=true;return}
  el.hidden=false;
  var V={entrar:['ok','✓ Entrar'],cautela:['warn','! Cautela'],esperar:['warn','… Esperar'],nao:['bad','✕ Não entrar']}[E.verdict]||['','—'];
  el.className='card sig '+({entrar:'favoravel',cautela:'neutro',esperar:'neutro',nao:'desfavoravel'}[E.verdict]||'');
  var S={ok:['ok','✓'],warn:['warn','!'],bad:['bad','✕'],na:['','—'],info:['','i']};
  var RT=ops.status.state.robotTest,rtOn=RT&&!RT.done,C0=ops.status.config||{},MN=ops.status.state.minEdgeNow||{};
  var stale=(C0.minEdgeMode==='relativo')!==!!MN.relative||(C0.minEdgeMode!=='relativo'&&MN.value!==undefined&&MN.value!==C0.minEdgePct);
  var SNc=ops.status.config||{},SNs=ops.status.state.sniper||{},PS=ops.status.state.paperSniper||{},lbt=ops.status.state.lastBlockT;
  // mesma fonte do cartão da Rede: o bloco mais recente entre o Blockchair (lido pelo celular) e o servidor
  var Lv=null;try{Lv=live()}catch(e){}var cbt=Lv&&Lv.st&&Lv.st.last?Lv.st.last.time:0,newest=Math.max(lbt||0,cbt||0)||null,sAge=newest?(Date.now()-newest)/60e3:null;
  var srvAge=lbt?(Date.now()-lbt)/60e3:null,lagNote=newest&&lbt&&newest>lbt+60e3?'O servidor ainda não viu o bloco mais novo: a decisão do ciclo usou o bloco de '+nf(srvAge,0)+' min atrás.':'',WT=ops.status.watch||null,watchNote=WT&&WT.firedAt?'Vigia de bloco: confere a rede a cada '+nf((WT.every||6e3)/1e3,0)+' s entre os ciclos e decide na hora em que o bloco vira (último disparo: bloco '+WT.firedH+' às '+hhmm(new Date(WT.firedAt))+'). ':'Vigia de bloco: confere a rede a cada 6 s entre os ciclos e decide na hora em que o bloco vira. ',tickAt=ops.status.state.lastTick;
  var snHTML=SNc.sniper?'<div class="box" style="margin:0 0 8px"><b>Modo Sniper '+(SNc.mode==='active'?'ligado (robô em Ativo)':'ligado (robô em Observar: só simula)')+'</b>'+
    (function(){var I=ops.status.state.snInfo||{},bch=(ops.status.state.market||{}).bchUsd||0;return '<div class="kv" style="margin-top:4px"><div><small>Dificuldade do bloco em mineração × média de 12</small><span class="'+(I.diffDropPct!==null&&I.diffDropPct>=(SNc.sniperDiffDropPct||0.5)?'warn':'')+'">'+(I.diffDropPct!==null&&I.diffDropPct!==undefined?(I.diffDropPct>=0?nf(I.diffDropPct,2)+'% abaixo':nf(-I.diffDropPct,2)+'% acima'):'—')+'</span><div class="note">gatilho: '+nf(SNc.sniperDiffDropPct||10,1)+'% abaixo</div></div><div><small>Mempool × média do dia</small><span class="'+(I.feeX>=(SNc.sniperFeeX||3)?'warn':'')+'">'+(I.feeX?nf(I.feeX,1)+' vezes':'—')+'</span><div class="note">gatilho: '+nf(SNc.sniperFeeX||3,1)+' vezes · '+(I.mpBytes!==null&&I.mpBytes!==undefined?nf(I.mpBytes/1000,1)+' KB, taxas de ~'+usd((I.feeBchMin||0)*bch,2):'—')+'</div></div></div>'})()+'<div class="kv" style="margin-top:4px"><div><small>Último bloco há</small><span class="'+(sAge!==null&&sAge>(SNc.sniperAgeMin||20)?'warn':'')+'">'+(sAge!==null?nf(sAge,0)+' min':'—')+'</span></div><div><small>Gatilho</small><span>'+nf(SNc.sniperAgeMin||20,0)+' min · margem a partir de '+pct(SNc.sniperMinEdge===undefined?-7:SNc.sniperMinEdge,1)+'</span></div><div><small>Agora</small><span>'+((SNs.shotStart||PS.shot)?'<b class="warn">tiro: '+nf(SNc.sniperPh||25,0)+' PH/s</b>':'espera: '+nf(SNc.sniperIdlePh===undefined?1:SNc.sniperIdlePh,0)+' PH/s')+'</span></div></div>'+
    '<div class="note" style="margin-top:4px">'+(lagNote?'<b class="warn">'+lagNote+'</b> ':'')+watchNote+'Decisão do último ciclo do servidor ('+(tickAt?hhmm(new Date(tickAt)):'—')+'): '+esc(PS.reason||'')+'. Tiros: '+((SNs.shots||(PS.sn&&PS.sn.shots))||0)+' (encerrados por bloco '+((SNs.endsBlock||(PS.sn&&PS.sn.endsBlock))||0)+', por prazo '+((SNs.endsTime||(PS.sn&&PS.sn.endsTime))||0)+'). A cartilha abaixo continua mostrando a leitura por margem, que fica de lado enquanto o Sniper estiver ligado.</div></div>':'';
  el.innerHTML=snHTML+(stale?'<div class="box" style="margin:0 0 8px"><b class="warn">Configuração alterada</b>A cartilha e o copiloto são recalculados pelo servidor a cada 3 min: os textos abaixo ainda usam a regra anterior e se atualizam no próximo ciclo.</div>':'')+(rtOn?'<div class="box" style="margin:0 0 8px"><b class="warn">Teste do robô em andamento</b>A margem mínima está temporariamente em −5% para o teste; por isso o veredito pode dizer "Entrar" com margem negativa. Ele volta à sua regra quando o teste terminar.</div>':'')+'<div class="row between"><div class="eyebrow">Cartilha de entrada · '+E.okCount+' de '+E.scored+' a favor</div><span class="chip '+V[0]+'">'+V[1]+'</span></div>'+
    '<div class="lead">'+esc(E.title)+'</div><p class="why" style="margin:0 0 8px">'+esc(E.text)+'</p>'+
    ctx24HTML(E)+
    '<div class="stack" style="gap:4px">'+E.steps.map(function(s){var c=S[s.status]||S.na;
      return '<details class="trow"><summary><span class="chip '+c[0]+'">'+c[1]+'</span> <b>'+s.n+'. '+esc(s.title)+'</b><div class="note" style="margin:2px 0 0 28px">'+esc(s.value)+'</div>'+(s.action?'<div class="note" style="margin:2px 0 0 28px"><b>Leitura:</b> '+esc(s.action)+'</div>':'')+'</summary><p class="note" style="margin:4px 0 0"><b>Por que importa:</b> '+esc(s.why)+'</p></details>'}).join('')+'</div>'+
    (E.lottery?'<p class="note" style="margin:8px 0 0">'+esc(E.lottery)+'</p>':'')+
    '<details style="margin-top:8px"><summary>Como funciona esse ecossistema</summary><ul class="note" style="margin:6px 0 0;padding-left:18px">'+
    '<li><b>Quem vende o hash</b> na NiceHash são donos de máquinas. Eles poderiam minerar BTC, então só vendem pelo que o BTC paga: o aluguel fica ~ no hashprice do BTC.</li>'+
    '<li><b>Quem compra</b> paga isso + 3% e aponta para um pool solo de BCH (BlockSniper cobra 2%). Só sobra lucro quando o BCH paga mais que o BTC por hash, além desses ~5%: DARR maior que ~1,05.</li>'+
    '<li><b>A rede corrige sozinha</b>: se o BCH paga mais, mais máquinas migram, os blocos aceleram e a dificuldade sobe em horas (ASERT). Por isso as janelas boas são raras e curtas (mediana ~2 h).</li>'+
    '<li><b>Mineração industrial</b> (máquina própria + pool que paga por share) busca margem estável sobre a energia, quase sem sorte. Exemplo medido hoje: um S21 XP hospedado a US$0,065/kWh recebe ~US$8,7/dia e gasta ~US$5,7 de energia (~+50% sobre a energia), sem contar a compra da máquina.</li>'+
    '<li><b>Solo com hash alugado</b> é outro jogo: cada tentativa é tudo ou nada (achou: +200% ou mais; não achou: −100%). O ROI alto existe por tentativa, mas a média de muitas tentativas é só a margem do passo 1. Margem positiva + repetição = lucro; margem negativa + repetição = perda certa.</li>'+
    '<li>Cartilha completa: docs/cartilha-mineracao.md.</li></ul></details>';
}
/* ---------- copiloto IA: análise, previsões conferíveis, XP e maturidade ---------- */
// A IA bate o acaso? Compara o acerto COM sinal com o grupo de controle (mesma pergunta, sem sinal) e mostra a calibração.
function skillHTML(A,T){
  var LF=A.lift||{by:{}},rows=Object.keys(LF.by||{}).map(function(k){var x=LF.by[k],s=x.sig||{n:0,hits:0},c=x.ctrl||{n:0,hits:0};
    return '<tr><td>'+esc((T[k]||{}).label||k)+'</td><td>'+(s.n?pctp(s.hits/s.n*100,0)+' ('+s.hits+'/'+s.n+')':'—')+'</td><td>'+(c.n?pctp(c.hits/c.n*100,0)+' ('+c.hits+'/'+c.n+')':'—')+'</td><td>'+(x.pts===null?'faltam dados':'<b class="'+(x.pts>0?'good':'bad')+'">'+(x.pts>0?'+':'')+nf(x.pts,0)+' pts</b>')+'</td></tr>'}).join('');
  var rt=(A.stats||{}).btc_retarget,br=Object.keys(A.stats||{}).filter(function(k){return A.stats[k].n>=5&&isFinite(A.stats[k].b)}).map(function(k){var b=A.stats[k].b/A.stats[k].n;
    return '<tr><td>'+esc((T[k]||{}).label||k)+'</td><td>'+nf(b,2)+'</td><td>'+(b<0.15?'<span class="good">boa</span>':b<0.25?'média':'<span class="bad">pior que chute</span>')+'</td></tr>'}).join('');
  var un=A.unscoredBy||{},uk=Object.keys(un).filter(function(k){return un[k]>0});
  var head=LF.pts===null||LF.pts===undefined?'Ainda sem dados suficientes (5+ previsões e 5+ amostras de controle por tipo).':(LF.pts>0?'Sim: <b class="good">+'+nf(LF.pts,0)+' pontos</b> acima do acaso nas previsões difíceis.':'<b class="bad">Ainda não</b> ('+nf(LF.pts,0)+' pontos): o sinal não está ajudando. O nível fica em Analista até isso mudar.');
  return '<details style="margin-top:6px"'+(LF.pts!==null&&LF.pts!==undefined&&LF.pts<=0?' open':'')+'><summary>A IA bate o acaso?</summary><p class="note" style="margin:6px 0">'+head+' Grupo de controle: a cada 6 h o servidor faz a mesma pergunta SEM sinal (ex.: "a janela abre em 6 h?" num horário qualquer). Se a IA acerta 45% quando prevê e, sem sinal, dá 20%, ela sabe algo (+25 pts).</p>'+
    (rows?'<div class="scroll"><table><tr><th>Previsão difícil</th><th>Com sinal</th><th>Sem sinal (acaso)</th><th>Vantagem</th></tr>'+rows+'</table></div>':'')+
    (rt&&rt.bn?'<p class="note" style="margin:6px 0 0">Reajuste do BTC: a previsão chegou mais perto que "o DARR fica igual" em '+rt.beat+' de '+rt.bn+'.</p>':'')+
    (br?'<div class="scroll" style="margin-top:6px"><table><tr><th>Calibração</th><th>Erro (Brier)</th><th></th></tr>'+br+'</table></div><p class="note" style="margin:4px 0 0">Brier: 0 = confiança perfeita; 0,25 = igual a chutar 50%.</p>':'')+
    (uk.length?'<p class="note" style="margin:6px 0 0">Ficaram sem conferir (faltou dado no prazo): '+uk.map(function(k){return esc((T[k]||{}).label||k)+' '+un[k]}).join(' · ')+'.</p>':'')+'</details>';
}
function renderAI(){
  var st=ops.status&&ops.status.state,A=st&&st.ai,an=st&&st.aiAnalysis,R=st&&st.aiReport,T=(st&&st.aiTypes)||{};
  var bar=$('aibar'),card=$('h_ai');
  if(!A){bar.style.display='none';card.hidden=true;return}
  bar.style.display='block';card.hidden=false;
  var nx=A.next;
  $('aibar_t').innerHTML='<b>IA copiloto</b> · Nível '+A.level.n+' '+esc(A.level.name)+' · '+A.xp+' XP';
  var HD=A.hard||{n:0,hits:0},lt=st.lastTick||0,old=Date.now()-lt>10*60e3;
  $('aibar_r').innerHTML=(A.resolved?'difíceis '+HD.hits+'/'+HD.n+' · todas '+A.hits+'/'+A.resolved:'aprendendo')+(lt?' · <span class="'+(old?'bad':'')+'">'+(old?'servidor parado desde ':'dados de ')+hhmm(new Date(lt))+'</span>':'');
  $('aibar_p').style.width=Math.round((A.progress||0)*100)+'%';
  // Fácil (persistência) acerta quase sempre: não vira "confiável", mostra só o acerto. Difícil: confiável com 20+ e 60%+.
  var conf=function(r){if(r.hard===false)return '<span class="chip">persistência · '+(r.n?'acerto '+pctp(r.rate*100,0)+' em '+r.n:'sem histórico')+'</span>';
    return r.trusted?'<span class="chip ok">confiável · '+r.n+' conferidas</span>':'<span class="chip">em teste · '+(r.n||0)+' conferidas</span>'};
  var dueTxt=function(o){var ms=o.due-Date.now();return ms>0?'confere em '+FDI.dur(ms):'conferindo'};
  var h='<div class="row between"><div class="eyebrow">Copiloto IA</div><span class="chip">Nível '+A.level.n+' · '+esc(A.level.name)+'</span></div>'+
    (R&&R.sections?'<div class="box" style="margin:6px 0 0"><span class="chip '+({favoravel:'ok',neutro:'warn',desfavoravel:'bad'}[R.tone]||'')+'">'+({favoravel:'favorável',neutro:'neutro',desfavoravel:'desfavorável'}[R.tone]||'—')+'</span> <b>'+esc(R.headline)+'</b></div>'+R.sections.map(function(x,i){return '<details'+(i<2||x.id==='ajustes'||x.id==='niveis'?' open':'')+' style="margin-top:6px"><summary><b>'+esc(x.title)+'</b></summary><ul class="note" style="margin:4px 0 0;padding-left:18px">'+x.items.map(function(l){return '<li>'+esc(l)+'</li>'}).join('')+'</ul></details>'}).join(''):'<div class="lead">O que está acontecendo agora</div>'+(an?'<ul class="note" style="margin:6px 0 0;padding-left:18px">'+an.lines.map(function(l){return '<li>'+esc(l)+'</li>'}).join('')+'</ul>':''))+panoramaHTML(st&&st.aiPanorama,false);
  if(an&&an.recs.length)h+='<div class="eyebrow" style="margin:12px 0 6px">Sugestões</div><div class="stack" style="gap:6px">'+an.recs.map(function(r){return '<div class="box" style="margin:0">'+esc(r.text)+' '+conf(r)+'</div>'}).join('')+'</div>';
  h+='<div class="eyebrow" style="margin:12px 0 6px">Previsões em aberto ('+A.open.length+')</div>'+(A.open.length?'<div class="stack" style="gap:4px">'+A.open.slice(0,8).map(function(o){return '<div class="trow"><div class="note">'+esc(o.text)+'</div>'+(o.why?'<div class="note"><b>Por quê:</b> '+esc(o.why)+'</div>':'')+'<div class="note">'+dueTxt(o)+' · confiança '+pctp(o.conf*100,0)+(o.trusted?' · confiável':'')+'</div></div>'}).join('')+'</div>':'<p class="note" style="margin:0">Nenhuma agora: ela prevê quando algum sinal aparece.</p>');
  var dn=A.done.filter(function(d){return d.hit!==null&&d.hit!==undefined});
  h+='<div class="eyebrow" style="margin:12px 0 6px">Conferidas</div>'+(dn.length?'<div class="stack" style="gap:4px">'+dn.slice(0,8).map(function(d){return '<div class="trow"><div class="note">'+(d.hit?'<span class="chip ok">acertou +'+d.xp+' XP</span>':'<span class="chip bad">errou · 0 XP</span>')+(T[d.type]&&!T[d.type].hard?' <span class="chip">fácil</span>':' <span class="chip warn">difícil</span>')+' '+esc(d.text)+'</div>'+(d.why?'<div class="note"><b>Por quê previu:</b> '+esc(d.why)+'</div>':'')+(d.check?'<div class="note"><b>Como foi conferida:</b> '+esc(d.check)+'</div>':'')+'<div class="note">'+dt2(d.resolvedAt)+'</div></div>'}).join('')+'</div>':'<p class="note" style="margin:0">As primeiras são conferidas em 1 a 6 h; as de funding, em 3 dias.</p>');
  var OL=(st&&st.opLog)||[];
  if(OL.length)h+='<div class="eyebrow" style="margin:12px 0 6px">Seus ajustes (correções do operador)</div><div class="stack" style="gap:4px">'+OL.slice(0,5).map(function(o){return '<div class="trow"><div class="note">'+esc(o.changes.map(function(c){return c.label+' '+c.from+' → '+c.to}).join('; '))+'</div>'+(o.plan?'<div class="note">copiloto sugeria '+o.plan.ph+' PH/s e '+usd(o.plan.budgetUsd,0)+' por sessão</div>':'')+'<div class="note">'+dt2(o.t)+'</div></div>'}).join('')+'</div><p class="note" style="margin:4px 0 0">Seus ajustes rodam como cenário na simulação, ao lado da sugestão: os resultados mostram quem acertou mais.</p>';
  var ks=Object.keys(T);
  h+='<details style="margin-top:10px"><summary>O que ela aprendeu por tipo de previsão</summary><div class="scroll"><table><tr><th>Previsão</th><th>Tipo</th><th>Conferidas</th><th>Acerto</th><th>XP</th></tr>'+ks.map(function(k){var s=(A.stats||{})[k]||{n:0,hits:0};return '<tr><td>'+esc(T[k].label)+'</td><td>'+(T[k].hard?'difícil':'fácil')+'</td><td>'+s.n+'</td><td>'+(s.n?pctp(s.hits/s.n*100,0):'—')+'</td><td>'+(s.xp||0)+'</td></tr>'}).join('')+'</table></div><p class="note" style="margin:6px 0 0">Fácil = aposta que o que está aí continua (ex.: margem boa segue boa por 1 h): acerta quase sempre e por isso vale pouco. Difícil = aposta numa mudança (janela abre, dificuldade sobe, DARR depois do reajuste, funding paga as taxas): é aqui que se vê se a IA sabe algo.</p></details>'+
    skillHTML(A,T)+
    '<details style="margin-top:6px"><summary>Como a IA aprende e ganha XP</summary><p class="note" style="margin:6px 0 0">A cada 3 min o servidor junta todos os sinais (DARR, margem, reajuste do BTC, BCH contra o BTC, blocos chegando, funding com 24 h estável e meia-vida, outras moedas) e transforma cada sinal numa previsão com prazo. Quando o prazo vence, ele confere com os dados reais. Acerto difícil vale 10 XP (15 se o tipo já é confiável); acerto fácil vale 2; erro vale 0. Não precisa que você execute: conta se a dica era boa. A confiança de cada tipo vem do histórico de acertos dele; tipos com 20+ conferidas e 60%+ de acerto viram "confiáveis". Níveis: Aprendiz → Analista (30 conferidas, 5 difíceis) → Estrategista (100, 20 difíceis com acerto a partir de 50% e acima do acaso) → Mestre (300, 60 difíceis com acerto a partir de 55% e acima do acaso). Tempo sozinho não sobe de nível: precisa acertar as difíceis e bater o grupo de controle.'+(nx?' Próximo nível: '+esc(nx.name)+' ('+A.resolved+' de '+nx.min+' conferidas; difíceis '+HD.n+' de '+nx.hard+(nx.hit?', acerto nelas '+pctp(HD.rate*100,0)+' de pelo menos '+pctp(nx.hit*100,0):'')+').':'')+'</p></details>';
  card.innerHTML=h;
}
// Cartão único da rede: usa o bloco mais recente entre a Blockchair (painel) e o servidor, e julga cada número.
function renderNetCard(L){
  var el=$('n_kv');if(!el)return;
  L=L||live();var st=L.st,sv=ops.status&&ops.status.state;
  if(!st&&!(sv&&sv.lastBlockT)){el.innerHTML='<div class="note">'+(mine.err.blocks?'Sem dados da rede ('+mine.err.blocks+').':'Carregando…')+'</div>';return}
  var h=st?st.last.height:0,t=st?st.last.time:0;
  if(sv&&sv.lastHeight&&sv.lastHeight>h){h=sv.lastHeight;t=sv.lastBlockT||t}
  var since=Date.now()-t,D=st?st.difficulty:(sv.market||{}).D,vs=st?st.diffVsAvgPct:null,mp=sv&&sv.mempool,b24=mine.stats?mine.stats.blocks_24h:null;
  var dNext=D?D*Math.pow(2,(600-since/1000)/172800):null;
  var avgJ=function(m,lo,hi){return m>hi?['good','↓ blocos lentos: dificuldade cai (bom)']:m<lo?['bad','↑ blocos rápidos: hash chegando (ruim)']:['neutral','→ normal (perto de 10 min)']};
  var a10=st?avgJ(st.avg10,8,12):null,a25=st?avgJ(st.avgAll,9,11):null;
  var dJ=vs===null?null:(vs<=-1?['good','↓ mais fácil que a média (bom)']:vs>=1?['bad','↑ mais difícil que a média (ruim)']:['neutral','→ na média']);
  var bJ=b24===null?null:(b24<138?['good','↓ menos blocos: hash saiu do BCH (bom)']:b24>150?['bad','↑ mais blocos: hash chegou (ruim)']:['neutral','→ normal (144 por dia)']);
  el.innerHTML=[
    kvJ('Último bloco','#'+nf(h)+' · há <span data-ago="'+t+'">'+ago(t)+'</span>','neutral',since>1800e3?'→ demorando (sorte)':'→ sorte','tempo entre blocos é sorteio: de 1 a 30 min é normal'),
    kvJ('Próximo bloco','#'+nf(h+1),'',null,'dificuldade dele: '+(dNext?nf(dNext/1e9,2)+' G':'—')),
    kvJ('Média 10 blocos',st?st.avg10.toFixed(1).replace('.',',')+' min':'—',a10&&a10[0],a10&&a10[1],'ideal: acima de 10 min'),
    kvJ('Média '+(st?st.n:25)+' blocos',st?st.avgAll.toFixed(1).replace('.',',')+' min':'—',a25&&a25[0],a25&&a25[1],'mais confiável que a de 10'),
    kvJ('Dificuldade',D?nf(D/1e9,2)+' G':'—',dJ&&dJ[0],dJ&&(dJ[1]+(vs!==null?' '+pct(vs,1):'')),'menor é melhor: cada hash vale mais'),
    kvJ('Hash da rede',D?nf(D*4294967296/600/1e18,2)+' EH/s':'—',dJ&&dJ[0],dJ&&(dJ[0]==='good'?'↓ menos concorrência':dJ[0]==='bad'?'↑ mais concorrência':'→ estável'),'potência total disputando cada bloco'),
    kvJ('Blocos em 24 h',b24===null?'—':b24,bJ&&bJ[0],bJ&&bJ[1],'esperado: 144'),
    kvJ('Pendentes',mp?mp.tx+' tx · '+nf(mp.bytes/1000,1)+' KB':'—','neutral','→ pouco efeito','mais transações, taxas um pouco maiores'),
    kvJ('Taxas por bloco',st?usd(st.feesAvgUsd):'—','neutral','→ pouco efeito','irrelevante perto dos 3,125 BCH do bloco')
  ].join('');
  $('n_note').textContent='Fontes: Blockchair (blocos e médias) e o seu servidor (mempool e blocos ao vivo); vale o bloco mais recente das duas.';
}
// Próximo bloco: tempo desde o último, média, mempool, dificuldade exata do próximo (ASERT). Sem "previsão de quando sai".
function renderNext(){renderNetCard()}
/* ---------- janela do BCH: DARR e sinais além da sorte (docs/pesquisa-mineracao.md) ---------- */
function renderWindow(){
  var el=$('m_window');if(!el)return;
  var st=ops.status&&ops.status.state,D=st&&st.darr;
  if(!D){el.className='card';el.innerHTML='<div class="eyebrow">Janela do BCH</div><p class="note" style="margin:4px 0 0">'+(settings.apiUrl?'Calculando no servidor (até 15 min).':'Precisa do backend conectado: ele calcula o DARR a cada 3 min.')+'</p>';return}
  var m=st.market||{},cfg=ops.status.config||{},green=m.green,d=D.v,R=st.retarget,M=st.momentum,W=st.window;
  var lvl=green?'favoravel':(d>=1?'neutro':'desfavoravel');el.className='card sig '+lvl;
  var title=green?'Janela aberta: o aluguel está abaixo do que o BCH paga':(d>=1?'Perto: o BCH paga mais que o BTC, mas a margem ainda não passou do seu mínimo':'Janela fechada: o BCH está pagando menos que o BTC');
  var rows=[];
  var pf=(cfg.poolFeePct||2)/100,rf=(cfg.rentFeePct||3)/100,maxNH=D.hpBch*(1-pf)/(1+rf);
  var dT=d>=1.05?['good','↑ BCH paga mais (bom)']:d>=1?['warn','→ quase: taxas comem a vantagem']:['bad','↓ BCH paga menos (ruim)'];
  var eT=!isFinite(m.edgeAtBidPct)?null:(m.edgeAtBidPct>=(cfg.minEdgePct||3)?['good','↑ acima do seu mínimo (bom)']:m.edgeAtBidPct>=0?['warn','→ positiva, abaixo do mínimo']:['bad','↓ prejuízo médio (ruim)']);
  rows.push('<div class="kv judged" style="margin-top:8px">'+
    kvJ('DARR',nf(d,3),dT[0],dT[1],'bom acima de 1,05 (paga as taxas)')+
    kvJ('Margem no lance',isFinite(m.edgeAtBidPct)?pct(m.edgeAtBidPct,1):'—',eT&&eT[0],eT&&eT[1],'o robô compra acima de '+nf(cfg.minEdgePct||3,1)+'%')+
    kvJ('NiceHash cobra',m.bidEH?m.bidEH.toFixed(4).replace('.',','):'—',m.bidEH?(m.bidEH<=maxNH?'good':'bad'):'',m.bidEH?(m.bidEH<=maxNH?'↓ abaixo do máximo (bom)':'↑ acima do máximo (ruim)'):null,'máximo que compensa: '+maxNH.toFixed(4).replace('.',','))+
    kvJ('BCH paga',D.hpBch.toFixed(4).replace('.',','),'',null,'BTC por EH/s por dia')+
    kvJ('BTC paga',D.hpBtc.toFixed(4).replace('.',','),'',null,'a NiceHash cobra perto disto')+
    kvJ('Aluguel ÷ BTC',D.nhRatio?nf(D.nhRatio,3)+'×':'—','',null,'perto de 1: aluguel segue o BTC')+'</div>');
  if(R)rows.push('<div class="box" style="margin-top:8px"><b>Próximo reajuste do BTC</b>'+(R.at?'Por volta de '+new Date(R.at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' ('+(R.remainingBlocks||0)+' blocos). ':'')+'Estimativa '+pct(R.changePct,1)+' na dificuldade do BTC → o DARR vai para ~<strong>'+nf(R.darrAfter,3)+'</strong>'+(R.changePct>0?' (o BCH fica relativamente mais vantajoso).':' (o BCH fica relativamente menos vantajoso).')+'</div>');
  if(M)rows.push('<div class="box" style="margin-top:8px"><b>BCH contra o BTC</b>Preço '+pct(M.vsEmaPct,1)+' em relação à média de 2 dias'+(M.ret24Pct!==null?'; '+pct(M.ret24Pct,1)+' em 24 h':'')+'. '+(M.vsEmaPct>2?'O preço subiu antes da dificuldade reagir: costuma abrir janela nas próximas horas.':(M.vsEmaPct<-2?'O preço caiu antes da dificuldade: a janela tende a piorar.':'Sem sinal forte.'))+'</div>');
  if(W&&W.last24h)rows.push('<div class="box" style="margin-top:8px"><b>A janela está fechando?</b>Blocos na última hora: <strong>'+W.last1h+'</strong> (esperado 6); últimas 6 h: '+W.last6h+' (esperado 36). Pools grandes que trocam de moeda: '+(W.bigShare6h!==null?pctp(W.bigShare6h*100,0):'—')+' dos blocos das últimas 6 h ('+(W.bigShare24h!==null?pctp(W.bigShare24h*100,0):'—')+' em 24 h). '+
    (W.last6h>42||(W.bigShare6h!==null&&W.bigShare24h!==null&&W.bigShare6h>W.bigShare24h+0.1)?'Hash grande chegando: a dificuldade vai subir e a janela tende a fechar em horas.':'Sem sinal de hash grande chegando.')+'</div>');
  el.innerHTML='<div class="row between"><div class="eyebrow">Janela do BCH</div><span class="chip '+(green?'ok':(d>=1?'warn':'bad'))+'">DARR '+nf(d,3)+'</span></div><div class="lead">'+esc(title)+'</div>'+
    '<p class="note" style="margin:4px 0 0">DARR = quanto o BCH paga por hash ÷ quanto o BTC paga. Agora: '+esc(FDS.band(d))+'.</p>'+rows.join('')+
    '<details style="margin-top:8px"><summary>Como ler o DARR</summary><p class="note" style="margin:6px 0 0">Blocos saem o tempo todo, com DARR alto ou baixo: o DARR não muda a chance de achar bloco. Ele mede se o aluguel compensa. A NiceHash cobra pelo valor do hash no BTC (o maior mercado). Se o BCH paga menos que o BTC (DARR abaixo de 1), você paga mais pelo hash do que ele rende em média no BCH: cada bloco que você acha sai caro. Acima de ~1,04, o BCH paga mais que o aluguel com as taxas, e cada bloco sai mais barato que o valor dele. Nos últimos 6 meses a média foi 0,94 e ficou acima de 1,04 só em 0,5% das horas, em janelas de poucas horas. O robô já compra só quando a margem no lance passa do seu mínimo: é a mesma conta, feita com o preço real da NiceHash.</p></details>';
}
// Referência do DARR (180 dias até 30/10/2026; pesquisa) para o texto da faixa.
var FDS={band:function(d){var A=[[1.05,'0,1'],[1.04,'0,5'],[1.03,'1,3'],[1.0,'10,3']];for(var i=0;i<A.length;i++)if(d>=A[i][0])return 'acima de '+nf(A[i][0],2)+', o que aconteceu em só '+A[i][1]+'% das horas nos últimos 6 meses';return d>=0.94?'acima da média dos últimos 6 meses (0,94), mas abaixo de 1':'abaixo da média dos últimos 6 meses (0,94)'}};
// Mapa hora × dia da margem do aluguel gravada pelo servidor (horário local).
function renderHeat(){
  var el=$('bl_heat');if(!el)return;
  var W=ops.status&&ops.status.state&&ops.status.state.nhWeek;
  if(!W){el.innerHTML='<h2>Aluguel por hora e dia</h2><p class="note">O servidor grava o livro da NiceHash a cada 3 min; o mapa aparece com o backend conectado.</p>';return}
  var tot=W.reduce(function(a,b){return a+b[0]},0),days=['dom','seg','ter','qua','qui','sex','sáb'],off=-new Date().getTimezoneOffset()/60;
  var cell=function(dl,hl){var hu=((hl-off)%24+24)%24,du=(dl+Math.floor((hl-off)/24)+7)%7,b=W[du*24+hu];return b&&b[0]?b[1]/b[0]:null};
  var col=function(v){if(v===null)return 'transparent';var a=Math.min(.6,.12+Math.abs(v)/12);return v>=0?'rgba(46,125,50,'+a+')':'rgba(198,40,40,'+a+')'};
  var h='<h2>Margem do aluguel por hora e dia</h2><p class="note" style="margin:4px 0 8px">Média da margem no lance (%) gravada pelo servidor, no horário local. '+tot+' leituras de 3 min'+(tot<2000?': ainda pouco; o mapa fica confiável com 4 a 8 semanas.':'.')+' Verde = aluguel barato; vermelho = caro.</p>'+
    '<div class="scroll"><table class="heat" style="font-size:11px"><tr><th>h</th>'+days.map(function(d){return '<th>'+d+'</th>'}).join('')+'</tr>';
  for(var hl=0;hl<24;hl++){h+='<tr><td class="mono">'+('0'+hl).slice(-2)+'</td>';for(var dl=0;dl<7;dl++){var v=cell(dl,hl);h+='<td class="mono" style="text-align:center;background:'+col(v)+'">'+(v===null?'':nf(v,1))+'</td>'}h+='</tr>'}
  el.innerHTML=h+'</table></div>';
}
// Código só de leitura para suporte (o servidor deriva do token do painel; só abre status e blocos).
document.addEventListener('click',function(e){
  if(e.target.id==='rt_get'){var b=e.target;if(!settings.apiUrl){$('rt_val').textContent='Conecte o backend primeiro.';return}
    b.disabled=true;apiCall('GET','/readtoken').then(function(r){b.disabled=false;$('rt_val').textContent=r.token||'Servidor sem token configurado.';$('rt_copy').hidden=!r.token},function(er){b.disabled=false;$('rt_val').textContent='Falhou: '+er.message+' (o servidor pode estar numa versão antiga; tente em 2 min)'})}
  if(e.target.id==='rt_copy'){var t=$('rt_val').textContent;if(navigator.clipboard)navigator.clipboard.writeText(t).then(function(){e.target.textContent='Copiado'},function(){});}
});
/* ---------- registro dos blocos da rede (servidor) ---------- */
var blk={list:[],sum:null,at:0,err:null};
function loadBlocksLog(force){
  if(!settings.apiUrl){renderBlocksLog();return}
  if(!force&&Date.now()-blk.at<120000){renderBlocksLog();return}
  apiCall('GET','/blocks').then(function(r){blk.list=r.blocks||[];blk.sum=r.summary;blk.snFreq=r.snFreq||null;blk.luck=r.luck||null;renderLuck();blk.at=Date.now();blk.err=null;renderBlocksLog()},function(e){blk.err=e.message;renderBlocksLog()});
}
function hhU(t){return hhmm(t)+' ('+utcHM(t)+' UTC)'}
// Placar da sorte: quem estivesse ligado o tempo todo com X PH/s, quantos blocos teria achado e com qual resultado;
// e os testes que mostram se existe padrão (não existe: cada hash é independente).
var luckWin=24;
function renderLuck(){
  var el=$('bl_luck');if(!el)return;
  var L=blk.luck,head='<h2 style="margin:0 0 4px">Placar da sorte</h2><p class="note" style="margin:0 0 8px">Se alguém estivesse ligado o tempo todo com cada potência, no preço de cada momento: quantos blocos teria achado, quanto gastou e o resultado. Mostra a sorte; não prevê o próximo bloco.</p>';
  if(!L||!L.windows||!L.windows.length){el.innerHTML=head+'<p class="note">'+(settings.apiUrl?'Juntando blocos no registro do servidor…':'Precisa do backend conectado.')+'</p>';return}
  var W=L.windows.filter(function(w){return w.hours===luckWin})[0]||L.windows[L.windows.length-1];
  var lab=function(h){return h>=48?(h/24)+' dias':h+' h'};
  var h=head+'<div class="seg" style="margin-bottom:6px">'+L.windows.map(function(w){return '<button class="sm" data-luckw="'+w.hours+'" aria-pressed="'+(w===W)+'">'+lab(w.hours)+'</button>'}).join('')+'</div>'+
    '<p class="note" style="margin:0 0 6px">'+W.blocks+' blocos da rede (esperado '+W.expectedBlocks+'). O bloco mais "fácil" teria saído com '+nf(W.minNeedPH,0)+' PH/s.</p>'+
    '<div class="scroll"><table style="font-size:12px"><tr><th>PH/s</th><th>Blocos seus</th><th>Lucro (com sorte)</th><th>Média (sem sorte)</th></tr>'+
    W.rows.map(function(r){return '<tr><td>'+r.ph+'</td><td>'+r.won+'<div class="note">esperado '+nf(r.expected,2)+'</div></td><td>'+'<b class="'+(r.profitUsd>=0?'good':'bad')+'">'+(r.profitUsd>=0?'+':'')+usd(r.profitUsd,0)+'</b> <span class="note">'+(r.costUsd>0?pct(r.profitUsd/r.costUsd*100,0):'')+'</span><div class="note">custo '+usd(r.costUsd,0)+'</div><div class="note">receita '+usd(r.revUsd,0)+'</div></td><td>'+(r.expPct===null?'—':'<span class="'+(r.expPct>=0?'good':'bad')+'">'+pct(r.expPct,1)+'</span>')+'</td></tr>'}).join('')+'</table></div>';
  var T=L.tests;
  if(T)h+='<div class="box" style="margin-top:8px"><b>Existe padrão? '+(T.pattern?'<span class="warn">algo fora do acaso: acompanhar</span>':'<span class="good">não: dentro do acaso</span>')+'</b>'+
    '<ul class="note" style="margin:4px 0 0;padding-left:18px">'+
    '<li>Um bloco "fácil" puxa outro? Correlação entre um bloco e o seguinte: '+nf(T.autocorr,3)+' (acaso: até ±'+nf(T.autocorrLimit,3)+').</li>'+
    (T.easyAfterEasy!==null?'<li>Blocos que sairiam com até 100 PH/s: '+pctp(T.easyBase*100,1)+' de todos; logo depois de outro assim: '+pctp(T.easyAfterEasy*100,1)+' ('+T.easyAfterN+' casos).</li>':'')+
    '<li>Hora do dia (UTC): '+T.hours.map(function(x){return x.from+'–'+(x.from+6)+'h '+(x.z===null?'—':(Math.abs(x.z)<2?'normal':'desvio '+nf(x.z,1)+'σ'))}).join(' · ')+'.</li>'+
    '<li>Distribuição dos sorteios: qui² '+nf(T.chi2,1)+' (acaso: até 16,9 em 95% das vezes) em '+T.n+' blocos.</li></ul>'+
    '<p class="note" style="margin:4px 0 0">Conclusão: o que aconteceu nas últimas horas não muda a chance do próximo bloco. O que decide o resultado de longo prazo é a margem (preço do aluguel × quanto o bloco paga); a potência só muda o tamanho do ganho e da sorte.</p></div>';
  if(L.recent&&L.recent.length)h+='<details style="margin-top:8px"><summary>Últimos blocos: potência mínima para ser seu</summary><div class="stack" style="gap:2px;margin-top:6px">'+L.recent.map(function(b){return '<div class="note">'+b.h+' · '+hhmm(new Date(b.t))+' · '+esc(b.pool||'')+' · seria seu com <b>'+nf(b.needPH,0)+' PH/s ou mais</b></div>'}).join('')+'</div></details>';
  el.innerHTML=h;
}
document.addEventListener('click',function(e){var b=e.target.closest('#bl_luck [data-luckw]');if(!b)return;luckWin=+b.dataset.luckw;renderLuck()});
function snLim(){var c=ops.status&&ops.status.config;return c&&c.sniperDiffDropPct!==undefined?c.sniperDiffDropPct:0.5}
function snFreqHTML(F){if(!F||!F.rows)return '';return '<div class="box" style="margin-top:8px"><b>Gatilho de dificuldade do Sniper: com que frequência dispara</b>Na virada de cada bloco, a dificuldade do bloco seguinte (fórmula da rede) comparada com a média dos 12 últimos. '+F.n+' viradas'+(F.days?' em '+nf(F.days,1)+' dias':'')+'; a maior queda foi '+nf(F.max,2)+'%.<div class="stack" style="gap:2px;margin-top:6px">'+F.rows.map(function(r){return '<div class="note">'+(r.pct===F.current?'<b>':'')+nf(r.pct,1)+'% abaixo: '+r.n+' viradas ('+pctp(r.share,1)+')'+(r.perDay!==null?' · ~'+nf(r.perDay,1)+' por dia':'')+(r.pct===F.current?' · seu gatilho</b>':'')+'</div>'}).join('')+'</div><p class="note" style="margin:6px 0 0">A dificuldade mais baixa já entra na margem do momento: o gatilho escolhe a hora, mas a trava de margem continua valendo.</p></div>'}
function renderBlocksLog(){
  var L=blk.list,S=blk.sum,fb=$('bl_fallback');
  if(!settings.apiUrl){fb.hidden=false;$('bl_src').textContent='Blockchair';$('bl_msg').textContent='Últimos blocos (Blockchair). Com o backend conectado, cada bloco ganha o contexto do momento (hash alugado, margem, simulação).';return}
  if(blk.err){fb.hidden=false;$('bl_msg').textContent='Registro do servidor indisponível ('+blk.err+'); mostrando a Blockchair.';return}
  if(!L.length){fb.hidden=false;$('bl_msg').textContent='O registro do servidor começa no próximo bloco. Toque em "Buscar blocos anteriores" para trazer as últimas horas.';return}
  fb.hidden=true;$('bl_src').textContent=L.length+' blocos · servidor';
  $('bl_msg').textContent='Mais novo primeiro. Toque num bloco para ver o contexto daquele momento.';
  $('bl_list').innerHTML='<div class="stack" style="gap:0">'+L.slice(0,40).map(function(b){
    var gap=b.dt===null||b.dt===undefined?'':(b.dt<60?'<1 min':FDI.dur(b.dt*1000));
    var head='<b class="mono">'+b.h+'</b> <span class="note">'+hhmm(b.t)+'</span> · <b>'+esc(b.pool)+'</b>'+(b.solo?' <span class="chip ok">solo</span>':'')+(b.mine?' <span class="chip ok">seu</span>':'')+(b.dd!==undefined&&b.dd!==null&&b.dd>=snLim()?' <span class="chip warn">gatilho Sniper</span>':'')+(b.simWon?' <span class="chip ok">seria seu</span>':'')+
      (gap?' <span class="note">· '+gap+(b.dt>1800?' <span class="warn">(lento)</span>':'')+'</span>':'');
    var line=(b.txs?b.txs+' tx · ':'')+(b.size?nf(b.size/1000,1)+' KB · ':'')+(isFinite(b.reward)?b.reward.toFixed(4).replace('.',',')+' BCH':'—')+(b.usd?' ('+usd(b.usd,0)+')':'')+(b.edge!==undefined&&b.edge!==null?' · margem '+pct(b.edge,1):'')+(b.dd!==undefined&&b.dd!==null?' · dificuldade seguinte '+(b.dd>=0?nf(b.dd,2)+'% abaixo':nf(-b.dd,2)+'% acima')+' da média':'');
    var det=['Hora: '+dt2(b.t),'Taxas das transações: '+(+b.fees||0).toFixed(5).replace('.',',')+' BCH'+(b.poolFeePct!==null&&b.poolFeePct!==undefined?' · fatia do pool: '+nf(b.poolFeePct,1)+'%':''),
      b.dd!==undefined&&b.dd!==null?'Dificuldade do bloco seguinte (fórmula da rede, já com a demora deste bloco): '+(b.dd>=0?nf(b.dd,2)+'% abaixo':nf(-b.dd,2)+'% acima')+' da média dos 12 últimos blocos; gatilho do Sniper: '+nf(snLim(),1)+'% abaixo'+(b.dd>=snLim()?' (dispararia na virada)':''):'',
      b.netPH?'Potência da rede: '+nf(b.netPH,0)+' PH/s (dificuldade '+nf(b.D/1e9,1)+' G)':'',
      b.nhPH?'NiceHash: '+nf(b.nhPH,0)+' PH/s alugados; lance '+(b.nhBid||0).toFixed(4).replace('.',',')+', empate '+(b.be||0).toFixed(4).replace('.',',')+' BTC/EH/dia':'',
      b.realPH?'Suas ordens: '+nf(b.realPH,2)+' PH/s (chance de ser seu: '+pctp(b.realProb*100,2)+')':'',
      b.simPH?'Simulação (cenário Sua): '+nf(b.simPH,0)+' PH/s'+(b.simBid?' comprando a '+b.simBid.toFixed(4).replace('.',',')+(b.simEdge!==undefined?' (margem na compra '+pct(b.simEdge,1)+')':''):'')+', chance '+pctp(b.simProb*100,2)+', '+(b.simWon?'seria seu':'não saiu'):'',
      'Assinatura: '+esc(b.tag||'—'),(ops.status&&ops.status.state&&ops.status.state.lastHeight?'Confirmações: '+Math.max(1,ops.status.state.lastHeight-b.h+1):''),b.backfill?'Buscado depois: sem dados de mercado do momento.':''].filter(Boolean);
    return '<details class="trow"><summary style="list-style:none;cursor:pointer"><div>'+head+'</div><div class="note">'+line+'</div></summary><div class="note" style="margin-top:4px">'+det.join('<br>')+'</div></details>'}).join('')+'</div>'+
    (L.length>40?'<p class="note">Mostrando 40 de '+L.length+'. O CSV tem todos.</p>':'');
  renderAudit(L);
  if(!S){$('bl_sum').innerHTML='';return}
  var lh=new Array(24).fill(0);S.solo.hoursUtc.forEach(function(n,h){var d=new Date(Date.UTC(2026,0,1,h));lh[d.getHours()]+=n});
  var top=lh.map(function(n,h){return [h,n]}).filter(function(x){return x[1]>0}).sort(function(a,b){return b[1]-a[1]}).slice(0,4);
  $('bl_sum').innerHTML='<p class="note" style="margin:0 0 8px">'+S.n+' blocos, de '+dt2(S.from)+' a '+dt2(S.to)+'.</p>'+
    '<div class="kv"><div><small>Intervalo médio</small><span>'+(S.dt?FDI.dur(S.dt*1000):'—')+'</span></div><div><small>Lentos (&gt;30 min)</small><span>'+S.slow+'</span></div><div><small>Rápidos (&lt;2 min)</small><span>'+S.fast+'</span></div>'+
    '<div><small>Transações</small><span>'+(S.txs?nf(S.txs,0):'—')+'</span></div><div><small>Tamanho</small><span>'+(S.size?nf(S.size/1000,1)+' KB':'—')+'</span></div><div><small>Taxas</small><span>'+(S.fees!==null?S.fees.toFixed(4).replace('.',','):'—')+'</span></div></div>'+
    '<div class="eyebrow" style="margin:10px 0 4px">Quem achou</div><div class="row" style="gap:6px">'+S.byPool.slice(0,12).map(function(p){return '<span class="chip'+(p.solo?' ok':'')+'">'+esc(p.pool)+' '+p.n+'</span>'}).join('')+(S.byPool.length>12?'<span class="note">+'+(S.byPool.length-12)+'</span>':'')+'</div>'+
    '<div class="box" style="margin-top:8px"><b>Blocos solo (onde vai o hash alugado)</b>'+S.solo.n+' de '+S.n+' ('+pctp(S.n?S.solo.n/S.n*100:0,0)+'). '+
    (S.solo.edge!==null?'Margem média do aluguel quando saíram: '+pct(S.solo.edge,1)+' (outros blocos: '+(S.other.edge!==null?pct(S.other.edge,1):'—')+'). ':'')+
    (top.length?'Horários (local) com mais blocos solo: '+top.map(function(x){return ('0'+x[0]).slice(-2)+'h ('+x[1]+')'}).join(', ')+'. ':'')+
    'Intervalos: '+pctp(S.n?S.fast/S.n*100:0,0)+' abaixo de 2 min e '+pctp(S.n?S.slow/S.n*100:0,0)+' acima de 30 min (sorteio puro daria ~18% e ~5%).</div>'+snFreqHTML(blk.snFreq);
}
// Auditoria dos pools solo pela própria blockchain: quantos blocos, a fatia que o pool tirou e quantas saídas.
function renderAudit(L){
  var el=$('bl_audit');if(!el)return;
  var by={};(L||[]).filter(function(b){return b.solo}).forEach(function(b){var e=by[b.pool]||(by[b.pool]={n:0,fees:[],outs:[]});e.n++;if(b.poolFeePct!==null&&b.poolFeePct!==undefined)e.fees.push(b.poolFeePct);e.outs.push(b.outs)});
  var ks=Object.keys(by).sort(function(a,b){return by[b].n-by[a].n});
  if(!ks.length){el.innerHTML='<h2>Auditoria dos pools solo</h2><p class="note">Sem blocos solo no registro ainda.</p>';return}
  var med=function(a){if(!a.length)return null;var x=a.slice().sort(function(p,q){return p-q});return x[Math.floor(x.length/2)]};
  el.innerHTML='<h2>Auditoria dos pools solo</h2><p class="note" style="margin:4px 0 8px">Lido de cada bloco: a recompensa vai direto para o minerador e o pool fica com uma fatia. Fatia diferente da anunciada ou bloco sem pagamento ao minerador é sinal de alerta (há golpes de pools "solo" que desviam o hash).</p>'+
    '<div class="scroll"><table><tr><th>Pool</th><th>Blocos</th><th>Fatia do pool</th><th>Saídas</th></tr>'+ks.map(function(k){var e=by[k],f=med(e.fees);return '<tr><td>'+esc(k)+'</td><td>'+e.n+'</td><td>'+(f===null?'não separada':nf(f,1)+'%')+'</td><td>'+med(e.outs)+'</td></tr>'}).join('')+'</table></div>';
}
$('bl_csv').addEventListener('click',function(){
  if(!blk.list.length)return;
  var cols=['h','t','dt','pool','solo','tag','txs','size','reward','fees','poolFeePct','usd','bchUsd','D','netPH','nhPH','nhBid','nhMedian','be','edge','realPH','realProb','simPH','simProb','simWon','mine','backfill'];
  var csv=['altura,hora_utc,'+cols.slice(2).join(',')].concat(blk.list.map(function(b){return [b.h,new Date(b.t).toISOString()].concat(cols.slice(2).map(function(c){var v=b[c];return v===undefined||v===null?'':String(v).replace(/,/g,' ')})).join(',')})).join('\n');
  saveFile('blocos-bch-'+stamp()+'.csv',csv,'text/csv');
});
$('bl_more').addEventListener('click',function(){
  var b=$('bl_more');b.disabled=true;b.textContent='Buscando…';
  apiCall('POST','/blocks/backfill',{count:20}).then(function(r){b.textContent='Buscar blocos anteriores';b.disabled=false;loadBlocksLog(true)},function(e){b.textContent='Buscar blocos anteriores';b.disabled=false;$('bl_msg').textContent='Falhou: '+e.message});
});
// Fornecedores de hash: mesmo hash, preço total (com a taxa de cada um) e margem para o BCH solo.
function renderHashMkts(){
  var el=$('o_hash');if(!el)return;
  var st=ops.status&&ops.status.state,H=st&&st.hashMkts,mk=(st&&st.market)||{},cfg=(ops.status&&ops.status.config)||{};
  var head='<h2 style="margin:0 0 6px">Fornecedores de hash (SHA-256)</h2>';
  if(!H){el.innerHTML=head+'<p class="note">Lido pelo servidor a cada 15 min (aparece no próximo ciclo).</p>';return}
  var fee=+cfg.rentFeePct||3,be=mk.breakEvenEH?mk.breakEvenEH*(1+fee/100):null; // empate sem a taxa do fornecedor
  var row=function(name,price,feePct,note){if(!isFinite(price)||price===null)return '<tr><td>'+name+'</td><td colspan="3">sem dado agora</td></tr>';
    var tot=price*(1+feePct/100),e=be?(be/tot-1)*100:null;
    return '<tr><td>'+name+'</td><td>'+price.toFixed(4).replace('.',',')+'</td><td>'+nf(feePct,0)+'%</td><td>'+tot.toFixed(4).replace('.',',')+'</td><td>'+(e===null?'—':'<b class="'+(e>=0?'good':'bad')+'">'+pct(e,1)+'</b>')+'</td></tr>'+(note?'<tr><td></td><td colspan="4" class="note">'+note+'</td></tr>':'')};
  var B=H.braiins||{},M=H.mrr||{};
  el.innerHTML=head+'<p class="note" style="margin:0 0 6px">Preço para receber hash agora, em BTC por EH/s por dia. Margem = quanto o hash rende no BCH (pool solo) ÷ preço total − 1. Atualizado '+ago(H.at)+' atrás.</p>'+
    '<div class="scroll"><table><tr><th>Fornecedor</th><th>Preço</th><th>Taxa</th><th>Total</th><th>Margem BCH</th></tr>'+
    row('NiceHash',mk.bidEH,fee,'Hoje usada pelo robô. Exige KYC; depósitos de exchange podem ficar retidos pela Travel Rule (VASP).')+
    row('Braiins Hashpower',B.matchEH,B.feePct||0,'Taxa 0% no beta (pode mudar). Disponível ~'+nf((B.availPH||0)/1000,1)+' EH/s. <b>Exige pool com extranonce2 de 7 ou mais: a maioria dos pools de BCH usa 4.</b> Use "Conferir com a Braiins" no cadastro de pool.')+
    row('MiningRigRentals',M.suggestedEH,0,'Preço sugerido do SHA-256 (o menor anúncio: '+(isFinite(M.lowestEH)?M.lowestEH.toFixed(4).replace('.',','):'—')+'). Aluga máquinas por horas fixas; caro para o BCH solo.')+'</table></div>'+
    ((H.err||[]).length?'<p class="note warn" style="margin:6px 0 0">'+esc(H.err.join(' · '))+'</p>':'');
}
// Prontidão para o dinheiro real: os critérios objetivos da fase de observação, cada um com o estado de agora.
// Só recomenda ligar quando todos estiverem cumpridos (a decisão final é sua).
function renderReady(){
  var el=$('h_ready');if(!el)return;var st=ops.status,S=st&&st.state,cfg=st&&st.config;if(!S||!cfg){el.hidden=true;return}
  el.hidden=false;
  var A=S.ai||{},M=(S.entryCheck&&S.entryCheck.market)||{},B=M.band,P=S.paper||{},F=(S.fundPaper&&S.fundPaper.summary)||{},X=S.exec,lift=A.lift||{};
  var ev=P.spendUsd>0?((P.evUsd||0)-P.spendUsd)/P.spendUsd*100:null;
  var items=[
    [!!B,'Faixa de entrada comprovada','A IA precisa achar uma faixa de margem com lucro esperado positivo nas 2 horas seguintes, mesmo no pior caso do intervalo.',B?'Achada: a partir de '+nf(B.from,0)+'% ('+pctp(B.hit*100,0)+' de acerto, '+nf(B.n,0)+' leituras).':'Ainda não: nos dados até agora, as margens altas não se sustentaram.'],
    [(A.hard&&A.hard.n>=20)&&lift.pts>0,'IA melhor que o acaso','Pelo menos 20 previsões difíceis conferidas e acerto acima do grupo de controle.',(A.hard?A.hard.hits+' de '+A.hard.n+' difíceis':'0 difíceis')+(lift.pts!==null&&lift.pts!==undefined?'; contra o acaso: '+(lift.pts>0?'+':'')+nf(lift.pts,0)+' pontos':'; sem comparação ainda')+'.'],
    [ev!==null&&ev>0&&P.spendUsd>=1000,'Simulação da sua regra com média positiva','O cenário "Sua" com pelo menos US$1.000 de compras simuladas e média (sem sorte) positiva.',P.spendUsd>0?usd(P.spendUsd,0)+' simulados; média '+pct(ev,1)+'.':'Sem compras simuladas: a sua regra ainda não ficou verde.'],
    [F.closed>=10&&F.netUsd>0,'Funding simulado positivo','Pelo menos 10 operações fechadas com resultado positivo depois das taxas.',(F.closed||0)+' fechadas; resultado '+signUsd(F.netUsd||0)+'.'],
    (function(){var C=S.calib||S.calibPrev,R=C&&C.done&&C.result,cm=R&&(R.effVsPricePct!==undefined&&R.effVsPricePct!==null?R.effVsPricePct:R.diffPct),good=!!(R&&(R.delivered>=0.9||R.outbidPct>=10)&&cm!==null&&cm!==undefined&&Math.abs(cm)<=10);
      return [good,'Teste de calibração aprovado','10 PH/s por 2 horas (Mineração → Operar): entrega de 90% ou mais e custo real até 10% diferente da simulação.',R?('Feito: entrega '+(R.delivered!==null?pctp(R.delivered*100,0):'—')+', custo por hash '+(cm!==null&&cm!==undefined?pct(cm,1):'—')+' contra o preço'+(good?'.':': precisa de ajuste.')):C&&!C.done?'Em andamento.':'Ainda não (botão em Mineração → Operar).']})(),
    [cfg.sessionBudgetUsd>0&&cfg.dailyBudgetUsd>0&&cfg.weeklyLossUsd>0,'Limites de perda configurados','Stop-loss por tentativa, limite diário e perda máxima em 7 dias.','Stop-loss US$'+nf(cfg.sessionBudgetUsd||0,0)+', diário US$'+nf(cfg.dailyBudgetUsd||0,0)+', semanal US$'+nf(cfg.weeklyLossUsd||0,0)+'.']
  ];
  // separa por frente: mineração (itens 1, 2, 3, 5, 6) e funding (itens 4 e 6)
  var row=function(i){return '<details class="trow"><summary><span class="chip '+(i[0]?'ok':'')+'">'+(i[0]?'✓':'…')+'</span> <b>'+esc(i[1])+'</b><div class="note" style="margin:2px 0 0 28px">'+esc(i[3])+'</div></summary><p class="note" style="margin:4px 0 0">'+esc(i[2])+'</p></details>'};
  var mine=[items[0],items[1],items[2],items[4],items[5]],fund=[items[3],items[5]];
  var sec=function(t,list){var d=list.filter(function(i){return i[0]}).length;return '<div class="row between" style="margin:8px 0 4px"><b>'+t+'</b><span class="chip '+(d===list.length?'ok':'')+'">'+d+' de '+list.length+'</span></div><div class="stack" style="gap:4px">'+list.map(row).join('')+'</div>'};
  el.innerHTML='<div class="eyebrow">Fase de observação</div><div class="lead">Prontidão para o dinheiro real</div><p class="note" style="margin:4px 0 4px">Cada frente liga sozinha quando todos os critérios dela estiverem cumpridos. Até lá, o painel observa, simula e aprende. A decisão final é sua.</p>'+
    sec('Mineração (BCH solo)',mine)+sec('Funding (arbitragem de taxa)',fund);
}
// Regra relativa: calcula no próprio painel a margem mínima de hoje com a fatia e o piso escolhidos nos campos (antes de
// salvar), com a mesma conta do servidor: percentil das margens das últimas 24 h, nunca abaixo do piso.
function relCalcUI(){
  var box=$('b_relCalc'),note=$('b_relNow');if(!box||!note)return;var st=ops.status;if(!st)return;
  var S=st.state||{},mode=($('b_minEdgeMode')||{}).value||st.config.minEdgeMode,pctSel=+(($('b_relPct')||{}).value||75),fl=parseFloat((($('b_relFloorPct')||{}).value||'').replace(',','.'));
  if(!isFinite(fl))fl=-2;
  var fix=S.paperArchive&&S.paperArchive.at,now=Date.now(),v=(S.edgeHist||[]).filter(function(x){return x&&isFinite(x[1])&&x[0]>=now-864e5}).map(function(x){return fix&&x[0]<fix?((1+x[1]/100)/1.058-1)*100:x[1]}).sort(function(a,b){return a-b});
  if(v.length<24){box.value='—';note.textContent='Juntando leituras das últimas 24 h ('+v.length+' de 24 necessárias).';return}
  var p=v[Math.min(v.length-1,Math.floor(v.length*pctSel/100))],used=Math.round(Math.max(fl,p)*10)/10,share=100-pctSel;
  box.value=(used>=0?'+':'')+String(used.toFixed(1)).replace('.',',')+'%';
  note.innerHTML=(mode==='relativo'?'':'<b>Só vale se a regra de entrada for "Relativa".</b> ')+'Os '+share+'% melhores momentos das últimas 24 h chegaram a '+pct(p,1)+'; o piso é '+pct(fl,1)+'. Vale o maior dos dois'+(p<fl?' (hoje, o piso)':'')+'. Mais fatia (ex.: 50% do dia) baixa a regra e o robô entra mais vezes, com perda média maior por dólar; menos fatia sobe a regra.';
}
document.addEventListener('change',function(e){if(['b_relPct','b_minEdgeMode','b_relFloorPct'].indexOf(e.target.id)>=0){relCalcUI();var f=$('b_minEdgePct'),n=$('b_minNote'),rel=($('b_minEdgeMode')||{}).value==='relativo';if(f)f.style.opacity=rel?'.5':'';if(n)n.textContent=rel?'Guardada: não vale com a regra relativa ligada; volta a valer se escolher "Fixa".':''}});
document.addEventListener('input',function(e){if(e.target.id==='b_relFloorPct')relCalcUI()});
// Plano para o saldo: a sugestão do robô para gastar o saldo da NiceHash numa janela (ex.: a madrugada) do jeito mais
// eficiente para o cenário, com o custo e a chance de bloco escritos, e botões para aplicar e desfazer.
function renderBPlan(){
  var el=$('o_bplan');if(!el)return;var st=ops.status,S=st&&st.state;if(!S||!S.balPlan){el.innerHTML='';el.hidden=true;return}
  el.hidden=false;var P=S.balPlan,on=S.planOn,h='<div class="row between"><div class="eyebrow">Sugestão do robô</div><span class="chip'+(on?' ok':'')+'">'+(on?'plano ativo':'pronto para aplicar')+'</span></div><div class="lead">Plano para o seu saldo</div>';
  if(!P.ok){el.innerHTML=h+'<p class="note">'+esc(P.why)+' Deposite pelo menos '+String(P.need.toFixed(5)).replace('.',',')+' BTC para ter uma ordem.</p>';return}
  h+='<p class="note" style="margin:4px 0 8px">Para gastar '+btcTxt(P.amountBtc)+' nas próximas ~'+P.hours+' horas do jeito mais eficiente para o mercado de agora: o robô compra só nos 25% melhores momentos do dia (margem mínima de hoje '+pct(P.threshold,1)+', nunca abaixo de '+pct(P.floor,0)+') e, fora deles, fica na potência mínima.</p>'+
    '<div class="kv"><div><small>Potência nas janelas</small><span>'+nf(P.ph,0)+' PH/s</span></div><div><small>Tempo comprando</small><span>~'+nf(P.buyH,1)+' h</span></div><div><small>Chance de 1 bloco ou mais</small><span>'+pctp(P.chance*100,1)+'</span></div>'+
    '<div><small>Se achar</small><span class="good">~'+usd(P.blockUsd-P.budgetUsd,0)+'</span></div><div><small>Se não achar</small><span class="bad">−'+usd(P.budgetUsd,0)+'</span></div><div><small>Perda média esperada</small><span>~'+usd(P.expLossUsd,2)+'</span></div></div>'+
    '<details style="margin-top:6px"><summary>Por que assim</summary><ul class="note" style="margin:6px 0 0;padding-left:18px">'+
    '<li>A chance de achar bloco depende só de quanto se gasta, não da potência nem do tempo: com '+usd(P.budgetUsd,0)+' ela é '+pctp(P.chance*100,1)+' de qualquer jeito.</li>'+
    '<li>O que dá para melhorar é <b>quando</b> se gasta: nos melhores momentos do dia a margem é menos negativa, então a perda média cai (cerca de '+usd(P.expLossUsd,2)+' em vez de ~'+usd(P.budgetUsd*0.03,2)+' gastando a qualquer hora).</li>'+
    '<li>Fora das janelas, a ordem fica na potência mínima (1 PH/s, ~'+usd(P.perPhH,2)+' por hora) em vez de ser cancelada: cancelar e criar de novo custa '+usd(P.feeUsd,2)+' de taxa da NiceHash por ordem nova.</li>'+
    '<li>Stop-loss igual ao valor da ordem: o máximo que dá para perder é o que está nela. Ao achar bloco, a ordem é encerrada.</li></ul></details>'+
    (on?'<button id="bp_undo" style="margin-top:8px">Desfazer e voltar à configuração anterior</button>':'<button class="pri" id="bp_go" style="margin-top:8px">Aplicar este plano</button>')+'<p class="note" id="bp_msg" style="margin:6px 0 0"></p>';
  el.innerHTML=h;
}
document.addEventListener('click',function(e){
  var id=e.target.id;if(id!=='bp_go'&&id!=='bp_undo')return;
  if(id==='bp_go'&&!confirm('Aplicar o plano? O robô vai para Ativo com a regra relativa e pode gastar todo o valor da ordem.'))return;
  var b=e.target;b.disabled=true;
  apiCall('POST',id==='bp_go'?'/balanceplan/apply':'/balanceplan/undo',{}).then(function(){$('bp_msg').textContent='Feito. Atualizando…';loadOps()},function(er){b.disabled=false;$('bp_msg').textContent='Não deu: '+er.message});
});
// Teste do robô: modo Ativo com limites mínimos, para ver na NiceHash real o robô criar, ajustar, parar no stop-loss e esperar.
function renderRTest(){
  var el=$('o_rtest');if(!el)return;var st=ops.status,S=st&&st.state,cfg=(st&&st.config)||{};if(!S){el.innerHTML='';return}
  var T=S.robotTest,C=S.calib,h='<h2 style="margin:0 0 4px">Teste do robô (modo Ativo, limites mínimos)</h2>';
  var CK=[['create','Criou a ordem sozinho'],['update','Ajustou preço ou potência'],['stop','Stop-loss encerrou a tentativa'],['cooling','Respeitou a espera depois do stop-loss']];
  var chk=function(c){return '<div class="stack" style="gap:3px;margin:6px 0">'+CK.map(function(k){var v=c&&c[k[0]];return '<div class="note"><span class="chip '+(v?'ok':'')+'">'+(v?'✓':'…')+'</span> '+k[1]+(v?' · '+hhmm(new Date(v)):'')+'</div>'}).join('')+'</div>'};
  if(!T){
    var calibBusy=C&&!C.done,pool=cfg.poolId;
    h+='<p class="note" style="margin:0 0 6px">Depois da calibração, este teste põe o robô para operar sozinho na NiceHash real por até 2 horas, com limites que não deixam o gasto passar de cerca de US$20, para ver cada mecanismo funcionar: criar a ordem, ajustar o preço, parar no stop-loss e esperar antes de voltar.</p>'+
      '<div class="box" style="margin:0 0 6px"><b>O que muda só durante o teste</b>Modo Ativo · 10 PH/s · margem mínima −5% (para o robô entrar com o mercado de agora) · stop-loss US$8 por tentativa · espera de 15 min · limite diário US$20 · ordem de 0,001 BTC. No fim, o servidor encerra as ordens do teste e devolve exatamente a sua configuração (modo, margem mínima de '+nf(cfg.minEdgePct||0,0)+'%, potência de '+nf(cfg.targetPh||0,0)+' PH/s, stop-loss de US$'+nf(cfg.sessionBudgetUsd||0,0)+').</div>'+
      '<p class="note" style="margin:0 0 6px">Gasto esperado: US$8 a US$16 (cerca de 50 minutos). Com a margem de agora, a perda esperada é de cerca de US$1; o resto depende da sorte (chance pequena de bloco). Precisa de pelo menos 0,001 BTC livre na NiceHash'+(pool?'':' e do pool escolhido <b class="bad">(falta)</b>')+'.</p>'+
      '<button class="pri" id="rt_go"'+(calibBusy||!pool?' disabled':'')+'>Iniciar teste do robô</button>'+(calibBusy?'<p class="note" style="margin:6px 0 0">Disponível quando o teste de calibração terminar.</p>':'')+'<p class="note" id="rt_msg" style="margin:6px 0 0"></p>';
  }else if(!T.done){
    var X2=S.exec,paid=(T.ids||[]).reduce(function(a,id){var o=X2&&X2.orders&&X2.orders.filter(function(r){return r.id===id})[0];return a+(o?o.paidBtc||0:0)},0);
    h+='<div class="box" style="margin:0 0 6px"><b>Em andamento</b>Começou '+dt2(T.start)+' · decorrido '+FDI.dur(Date.now()-T.start)+' · encerra em até '+FDI.dur(Math.max(0,T.until-Date.now()))+' (ou assim que o stop-loss e a espera forem vistos).<div class="kv" style="margin-top:6px"><div><small>Gasto até agora</small><span>'+btcTxt(paid)+'</span></div><div><small>Stop-loss do teste</small><span>US$15</span></div></div><div class="note">O gasto é lançado pela NiceHash com alguns minutos de atraso.</div></div>'+chk(T.checks)+
      ((T.events||[]).length?'<details><summary>Ações do robô na NiceHash ('+T.events.length+')</summary><div class="stack" style="gap:3px;margin-top:4px">'+T.events.slice().reverse().map(function(e){return '<div class="note">'+hhmm(new Date(e.t))+' · '+({create:'criou',update:'ajustou',cancel:'encerrou',erro:'erro'}[e.type]||e.type)+(e.priceEH?' a '+e.priceEH.toFixed(4).replace('.',','):'')+(e.limitPH?' · '+nf(e.limitPH,1)+' PH/s':'')+' · '+esc(e.reason||'')+'</div>'}).join('')+'</div></details>':'<p class="note">Aguardando o primeiro ciclo do robô (até 3 min).</p>')+
      (T.fast?'<p class="note" style="margin:6px 0 0">Acelerado: stop-loss em US$'+nf(T.fast.stopUsd,0)+' e espera de 10 min.</p>':(T.checks&&T.checks.create?'<button class="pri" id="rt_fast" style="margin-top:6px">Concluir mais rápido (stop-loss agora, espera de 10 min)</button> ':''))+'<button id="rt_stop" style="margin-top:6px">Encerrar agora e devolver a configuração</button><p class="note" id="rt_msg" style="margin:6px 0 0"></p>';
  }else{
    var all=CK.every(function(k){return T.checks&&T.checks[k[0]]});
    h+='<div class="box" style="margin:0 0 6px"><b>Resultado ('+dt2(T.start)+')</b>'+chk(T.checks)+'<div class="note">Duração '+FDI.dur((T.done||Date.now())-T.start)+' · ordens do teste: '+(T.orders||0)+' · gasto ~'+usdBtc(T.spentUsd)+'. Configuração original devolvida (modo '+esc((T.backup||{}).mode||'')+').</div>'+
      '<p class="note" style="margin:6px 0 0">'+(all?'<b class="good">Todos os mecanismos funcionaram na NiceHash real.</b> O robô está pronto; falta só a fase de observação mostrar uma faixa de entrada comprovada.':'<b class="warn">Nem tudo foi exercitado.</b> Os itens sem ✓ não aconteceram no tempo do teste (por exemplo, o stop-loss não chegou a US$15 ou o preço não precisou de ajuste). Me mande este resultado: dá para repetir com outro prazo.')+'</p></div>'+
      '<button id="rt_again">Fazer outro teste</button>';
  }
  el.innerHTML=h;
}
document.addEventListener('click',function(e){
  var id=e.target.id;if(['rt_go','rt_stop','rt_again','rt_fast'].indexOf(id)<0)return;
  if(id==='rt_fast'&&!confirm('Baixar o stop-loss do teste para logo acima do gasto atual e a espera para 10 min? O teste termina em uns 15 min.'))return;
  if(id==='rt_go'&&!confirm('Iniciar o teste do robô? Ele vai operar em modo Ativo por até 2 horas com stop-loss de US$8 e limite diário de US$20, e devolver a sua configuração no fim.'))return;
  if(id==='rt_stop'&&!confirm('Encerrar o teste agora e devolver a configuração?'))return;
  var b=e.target;b.disabled=true;
  var go=id==='rt_fast'?apiCall('POST','/robottest/fast',{}):id==='rt_go'?apiCall('POST','/robottest/start',{hours:2}):id==='rt_stop'?apiCall('POST','/robottest/stop',{}):apiCall('POST','/robottest/clear',{});
  go.then(function(){if($('rt_msg'))$('rt_msg').textContent='Feito. Atualizando…';loadOps()},function(er){b.disabled=false;if($('rt_msg'))$('rt_msg').textContent='Não deu: '+er.message});
});
// Execução real × simulação (calibração): o que de fato aconteceu com as ordens do robô no modo Ativo.
function renderExec(){
  var el=$('o_exec');if(!el)return;var st=ops.status,S=st&&st.state,X=S&&S.exec,C=S&&S.calib,cfg=(st&&st.config)||{};
  var h='<h2 style="margin:0 0 4px">Teste de calibração (simulado × real)</h2>';
  if(!S){el.innerHTML=h+'<p class="note">Conecte o backend.</p>';return}
  var mk=S.market||{},bl=(S.plan&&S.plan.blockers)||[],poolFix=bl.filter(function(b){return b.id==='pool'&&b.poolId})[0],pool=cfg.poolId||(poolFix&&poolFix.poolId)||'';
  var cost=mk.bidEH&&mk.btcUsd?10/1000*mk.bidEH*mk.btcUsd*1.03*2/24:null;
  if(!C){
    h+='<p class="note" style="margin:0 0 8px">O último passo antes do dinheiro real. O painel abre uma ordem pequena de <b>10 PH/s por 2 horas</b> no preço que entrega essa potência, mede quanto tempo o hash demora a chegar, quanto foi entregue e quanto custou de verdade, e compara com a simulação do mesmo período. A ordem fica fora do controle do robô e o servidor a encerra sozinho no prazo; o que sobrar do valor volta para a sua carteira na NiceHash.</p>'+
      '<div class="kv"><div><small>Valor da ordem</small><span>0,001 BTC</span></div><div><small>Gasto esperado</small><span>'+(cost?'~'+usd(cost,0):'—')+'</span></div><div><small>Chance de bloco</small><span>'+(S.market&&S.market.phDaysPerBlock?pctp((1-Math.exp(-10/S.market.phDaysPerBlock*2/24))*100,1):'~3%')+'</span></div></div>'+
      '<p class="note" style="margin:6px 0">Precisa de: chaves da NiceHash conectadas, pool escolhido'+(pool?' (ok)':' <b class="bad">(falta: Mineração → Robô → Pool para ordens novas)</b>')+' e pelo menos 0,001 BTC de saldo na NiceHash (mínimo da NiceHash por ordem). Com margem negativa, o gasto esperado vira perda esperada de poucos dólares: o objetivo é medir, não lucrar.</p>'+
      '<button class="pri" id="cal_go"'+(pool?'':' disabled')+'>Iniciar teste de calibração</button><p class="note" id="cal_msg" style="margin:6px 0 0"></p>';
  }else if(!C.done){
    var left=Math.max(0,C.until-Date.now());
    h+='<div class="box" style="margin:0 0 8px"><b>Em andamento</b>'+nf(C.ph,0)+' PH/s a '+C.priceEH.toFixed(4).replace('.',',')+' · começou '+dt2(C.start)+' · decorrido '+FDI.dur(Date.now()-C.start)+' · encerra em '+FDI.dur(left)+'.</div>'+
      (function(){var o=X&&X.orders&&X.orders.filter(function(r){return r.id===C.id})[0];return o?'<div class="kv" style="margin:0 0 8px"><div><small>Hash chegou em</small><span>'+(o.toHashMin!==null?nf(o.toHashMin,0)+' min':'aguardando')+'</span></div><div><small>Entrega até agora</small><span>'+(o.delivered!==null?pctp(o.delivered*100,0):'—')+'</span></div></div><p class="note" style="margin:0 0 8px">O valor pago é lançado pela NiceHash com alguns minutos de atraso: o custo real só é comparado com a simulação no fim, com o valor final da ordem.</p>':''})()+
      '<button id="cal_stop">Encerrar agora</button><p class="note" id="cal_msg" style="margin:6px 0 0">O resultado aparece aqui e no Telegram quando encerrar.</p>';
  }else{
    var R=C.result||{},mktOut=R.outbidPct!==null&&R.outbidPct!==undefined&&R.outbidPct>=10,ok1=R.delivered!==null&&(R.delivered>=0.9||mktOut),cmp=R.effVsPricePct!==undefined&&R.effVsPricePct!==null?R.effVsPricePct:R.diffPct,ok2=cmp!==null&&cmp!==undefined&&Math.abs(cmp)<=10,ok3=R.toHashMin!==null&&R.toHashMin<=10;
    h+='<div class="box" style="margin:0 0 8px"><b>Resultado: '+dt2(C.start)+' a '+dt2(C.start+(R.hours||0)*3600e3)+'</b>'+
      '<div class="kv" style="margin-top:4px"><div><small>Duração</small><span>'+FDI.dur((R.hours||0)*3600e3)+'</span></div><div><small>Gasto real</small><span>'+usd(R.paidUsd||0)+'</span></div><div><small>Gasto simulado</small><span>'+usd(R.simUsd||0)+'</span></div><div><small>Diferença</small><span class="'+(Math.abs((R.paidUsd||0)-(R.simUsd||0))<=0.1*(R.simUsd||1)?'good':'bad')+'">'+signUsd((R.paidUsd||0)-(R.simUsd||0))+(R.simUsd?' ('+pct(((R.paidUsd||0)/R.simUsd-1)*100,1)+')':'')+'</span></div><div><small>Custo por hash × preço</small><span class="'+(ok2?'good':'bad')+'">'+(cmp!==null&&cmp!==undefined?pct(cmp,1):'—')+'</span></div>'+
      '<div><small>Entrega média</small><span class="'+(ok1?'good':'bad')+'">'+(R.delivered!==null?pctp(R.delivered*100,0):'—')+'</span></div>'+(R.outbidPct!==null&&R.outbidPct!==undefined?'<div><small>Mercado acima do preço</small><span>'+pctp(R.outbidPct,0)+' do tempo</span></div>':'')+'<div><small>Hash chegou em</small><span class="'+(ok3?'good':'warn')+'">'+(R.toHashMin!==null?nf(R.toHashMin,0)+' min':'—')+'</span></div></div>'+
      '<p class="note" style="margin:6px 0 0">'+(ok1&&ok2&&ok3?'<b class="good">Calibrado:</b> a execução real bate com a simulação (custo por hash recebido até 10% do preço, hash em até 10 min'+(mktOut&&R.delivered<0.9?'; a entrega caiu porque o mercado passou do preço da ordem em '+pctp(R.outbidPct,0)+' do tempo, o que é comportamento do mercado, não falha':', entrega de 90% ou mais')+'). Os resultados simulados valem como prévia do real.':'<b class="warn">Diferenças a corrigir:</b> '+[!ok1?'a entrega ficou abaixo de 90% sem o mercado ter passado do preço (a NiceHash entregou menos que o pedido)':'',!ok2?'o custo por hash recebido diferiu mais de 10% do preço da ordem':'',!ok3?'o hash demorou mais de 10 min para chegar':''].filter(Boolean).join('; ')+'. Me mande este resultado para ajustar a simulação antes de escalar.')+'</p></div>'+
      '<button id="cal_again">Fazer outro teste</button>';
  }
  if(X&&X.orders&&X.orders.length)h+='<details style="margin-top:8px"><summary>Ordens registradas</summary><div class="stack" style="gap:4px;margin-top:4px">'+X.orders.map(function(o){return '<div class="note">'+dt2(o.created)+' · '+nf(o.limitPH,1)+' PH/s a '+o.priceEH.toFixed(4).replace('.',',')+(o.alive?' · ativa':'')+' · hash em '+(o.toHashMin!==null?nf(o.toHashMin,0)+' min':'—')+' · entrega '+(o.delivered!==null?pctp(o.delivered*100,0):'—')+'</div>'}).join('')+'</div></details>';
  el.innerHTML=h;
}
document.addEventListener('click',function(e){
  var id=e.target.id;if(['cal_go','cal_stop','cal_again'].indexOf(id)<0)return;
  var st=ops.status,cfg=(st&&st.config)||{},bl=(st&&st.state&&st.state.plan&&st.state.plan.blockers)||[],pf=bl.filter(function(b){return b.id==='pool'&&b.poolId})[0];
  if(id==='cal_go'&&!confirm('Abrir a ordem de teste: 10 PH/s por 2 horas, 0,001 BTC, encerrada sozinha no prazo?'))return;
  if(id==='cal_stop'&&!confirm('Encerrar a ordem de teste agora?'))return;
  var b=e.target;b.disabled=true;
  var go=id==='cal_go'?apiCall('POST','/calib/start',{ph:10,hours:2,poolId:cfg.poolId||(pf&&pf.poolId)}):id==='cal_stop'?apiCall('POST','/calib/stop',{}):apiCall('POST','/calib/clear',{});
  go.then(function(){$('cal_msg')&&($('cal_msg').textContent='Feito. Atualizando…');loadOps()},function(er){b.disabled=false;if($('cal_msg'))$('cal_msg').textContent='Não deu: '+er.message});
});
function renderOps(){
  var c=apiCfg(),st=ops.status;
  if(!c.url){
    $('o_conn').innerHTML='<h2>Backend não configurado</h2><p class="note">Para operar (ordens, robô, parada no bloco) é preciso o backend. É só mandar um token do Cloudflare no chat: o passo a passo de 4 itens está em Ajustes.</p><div class="row"><button class="sm" data-go="set" data-focus="#setup">Abrir Ajustes</button></div>';
    ['o_status','o_orders','o_log'].forEach(function(id){$(id).innerHTML=''});$('o_bal').textContent='';return;
  }
  $('o_conn').innerHTML=st?'<div class="row" style="justify-content:space-between"><h2 style="margin:0">Backend</h2><span class="chip ok">conectado</span></div>'+
    '<div class="kv" style="margin-top:10px"><div><small>NiceHash</small><span class="'+(st.nhEnv==='produção'?'warn':'')+'">'+esc(st.nhEnv)+'</span></div><div><small>Chaves</small><span class="'+(st.keys?'good':'bad')+'">'+(st.keys?'ok':'faltando <button class="sm" data-go="set" data-focus="#acct">Conectar</button>')+'</span></div><div><small>Telegram</small><span>'+(st.telegram?'ok':'—')+'</span></div>'+
    '<div><small>Teto por ordem</small><span>'+String(st.limits.maxOrderBtc).replace('.',',')+' BTC</span></div><div><small>Teto de potência</small><span>'+st.limits.maxLimitPh+' PH/s</span></div><div><small>Versão</small><span>'+esc(st.version)+'</span></div></div>'
    :'<div class="row" style="justify-content:space-between"><h2 style="margin:0">Backend</h2><span class="chip bad">sem conexão</span></div><p class="note">'+esc(ops.err.status||'carregando…')+'</p>';
  if(!st){$('o_status').innerHTML='';return}
  var cfg=st.config,s=st.state||{},m=s.market||{};
  var lvl=m.green===undefined?'sem-dado':(m.green?'favoravel':(m.edgeAtBidPct>=0?'neutro':'desfavoravel'));
  $('o_status').className='card sig '+lvl;
  $('o_status').innerHTML='<div class="row" style="justify-content:space-between"><h2 style="margin:0">Robô</h2><span class="chip '+MODE_CHIP[cfg.mode]+'">'+MODE_TXT[cfg.mode]+'</span></div>'+
    (m.bidEH?'<div class="row" style="margin-top:10px;align-items:baseline"><span class="huge '+(m.green?'good':m.edgeAtBidPct>=0?'warn':'bad')+'">'+pct(m.edgeAtBidPct,1)+'</span><span class="note">margem no lance (servidor)</span></div>'+
    '<div class="kv judged" style="margin-top:8px">'+
      kvJ('Lance',m.bidEH.toFixed(4).replace('.',','),m.bidEH<=m.capEH?'good':'bad',m.bidEH<=m.capEH?'↓ abaixo do teto: compra':'↑ acima do teto: pausa','preço que o robô pagaria agora')+
      kvJ('Teto',m.capEH.toFixed(4).replace('.',','),'',null,'máximo aceito (empate − sua margem)')+
      kvJ('Empate',m.breakEvenEH.toFixed(4).replace('.',','),'',null,'acima disto, prejuízo médio')+
      kvJ('Custo por bloco',usd(m.costPerBlockUsd),m.blockNetUsd&&m.costPerBlockUsd<m.blockNetUsd?'good':'bad',m.blockNetUsd?(m.costPerBlockUsd<m.blockNetUsd?'↓ abaixo do valor do bloco':'↑ acima do valor do bloco'):null,m.blockNetUsd?'bloco vale ~'+usd(m.blockNetUsd,0):'')+
      kvJ('Gasto hoje',usd(s.dailyUsd||0),(s.dailyUsd||0)>=(cfg.dailyBudgetUsd||1e9)?'bad':(s.dailyUsd||0)>=0.8*(cfg.dailyBudgetUsd||1e9)?'warn':'neutral',(s.dailyUsd||0)>=(cfg.dailyBudgetUsd||1e9)?'limite do dia atingido':'→ dentro do limite','limite diário: '+usd(cfg.dailyBudgetUsd||0,0))+
      kvJ('Blocos achados',(s.myBlocks||[]).length,'',null,'pagos no seu endereço')+'</div>'+
    robotExplain(m,cfg)
    :'<p class="note">'+esc(m.reason||'Sem ciclo ainda. Toque em Rodar ciclo agora.')+'</p>')+
    '<div class="legs" style="margin-top:6px">Último ciclo: '+(s.lastTick?'<b data-ago="'+s.lastTick+'">'+ago(s.lastTick)+'</b> atrás':'nunca')+(s.lastHeight?' · bloco BCH '+s.lastHeight:'')+'</div>'+
    ((s.errors||[]).length?'<div class="note bad">'+esc(s.errors.join('; '))+'</div>':'')+
    ((s.myBlocks||[]).length?'<div class="legs">Seus blocos: '+s.myBlocks.slice(-5).reverse().map(function(b){return '<b>'+b.height+'</b> ('+(+b.bch).toFixed(4).replace('.',',')+' BCH)'}).join(' · ')+'</div>':'');
  renderPaper(st);
  var btcUsd=m.btcUsd||live().btcUsd;
  $('o_bal').innerHTML=ops.bal?'Saldo disponível: <b>'+(+ops.bal.available).toFixed(8).replace('.',',')+' BTC</b>'+(btcUsd?' ('+usd(+ops.bal.available*btcUsd)+')':''):esc(ops.err.bal||'');
  $('o_orders').innerHTML=ops.orders.length?ops.orders.map(function(o){
    return '<div class="card opp '+(o.managed?'g':'')+'" style="background:var(--panel2)"><div class="h"><span><b class="mono">'+esc(String(o.id).slice(0,8))+'</b>'+(o.managed?'<span class="chip ok">robô gerencia</span>':'<span class="chip">manual</span>')+'</span><span class="mono">'+esc(o.status)+'</span></div>'+
      '<div class="kv"><div><small>Preço</small><span>'+o.priceEH.toFixed(4).replace('.',',')+'</span></div><div><small>Limite</small><span>'+nf(o.limitPH,2)+' PH</span></div><div><small>Entregando</small><span>'+nf(o.speedPH,2)+' PH</span></div>'+
      '<div><small>Gasto</small><span>'+o.paidBtc.toFixed(6).replace('.',',')+'</span>'+(btcUsd?'<div class="note">'+usd(o.paidBtc*btcUsd)+'</div>':'')+'</div><div><small>Disponível</small><span>'+o.availableBtc.toFixed(6).replace('.',',')+'</span>'+(btcUsd?'<div class="note">'+usd(o.availableBtc*btcUsd)+'</div>':'')+'</div><div><small>Aberta há</small><span>'+(function(){var X=ops.status&&ops.status.state&&ops.status.state.exec,e=X&&X.orders&&X.orders.filter(function(r){return r.id===o.id})[0],t=o.createdTs||(e&&e.created);return t?FDI.dur(Date.now()-t):'—'})()+'</span></div><div><small>Pool</small><span style="font-size:12px">'+esc(o.poolName||'—')+'</span></div></div>'+
      '<div class="grid2"><label>Novo preço<input data-op="'+esc(o.id)+'" type="number" inputmode="decimal" step="0.0001" value="'+o.priceEH.toFixed(4)+'"></label><label>Nova potência (PH/s)<input data-ol="'+esc(o.id)+'" type="number" inputmode="decimal" value="'+o.limitPH.toFixed(2)+'"></label></div>'+
      '<div class="row"><button class="sm pri" data-oupd="'+esc(o.id)+'">Aplicar</button><button class="sm" data-orefill="'+esc(o.id)+'">Reabastecer</button><button class="sm" data-oman="'+esc(o.id)+'" data-v="'+(o.managed?0:1)+'">'+(o.managed?'Tirar do robô':'Robô gerencia')+'</button><button class="sm" data-ocancel="'+esc(o.id)+'">Cancelar</button></div></div>';
  }).join(''):'<p class="note">'+esc(ops.err.orders||'Nenhuma ordem ativa.')+'</p>';
  // Só pools do mesmo algoritmo do robô servem para as ordens dele (a NiceHash recusa pool de outro algoritmo).
  var algo=(st&&st.algo)||'SHA256ASICBOOST',okPools=ops.pools.filter(function(p){return !p.algorithm||p.algorithm===algo});
  var popts='<option value="">—</option>'+okPools.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+' ('+esc(p.stratumHostname)+')</option>'}).join('');
  $('b_poolId').innerHTML=popts;$('n_pool').innerHTML=popts;
  if(!ops.dirty)BOT_FIELDS.forEach(function(k){var el=$('b_'+k);if(el){var v=cfg[k];el.value=v===undefined||v===null?'':(typeof v==='number'?String(v).replace('.',','):v)}});
  relCalcUI();
  (function(){var el=$('b_rules');if(!el){var anchor=$('b_minEdgePct');if(!anchor)return;var box=anchor.closest('.grid2')||anchor.parentNode;el=document.createElement('div');el.id='b_rules';el.className='box';el.style.margin='0 0 10px';box.parentNode.insertBefore(el,box)}
    var S=st.state||{},on=function(x){return x?'<span class="chip ok">ligada</span>':'<span class="chip">desligada</span>'},sn=!!cfg.sniper,rel=cfg.minEdgeMode==='relativo';
    var entry=sn?'Sniper (dificuldade '+nf(cfg.sniperDiffDropPct||10,1)+'% abaixo da média de 12 blocos ou mempool '+nf(cfg.sniperFeeX||3,1)+' vezes a média do dia'+(cfg.sniperUseAge?' ou bloco há mais de '+nf(cfg.sniperAgeMin||20,0)+' min':'')+', com margem do tiro a partir de '+pct(cfg.sniperMinEdge===undefined?-7:cfg.sniperMinEdge,1)+')':rel?'Relativa (os '+(100-(cfg.relPct||75))+'% melhores momentos das 24 h; hoje '+pct((S.minEdgeNow||{}).value,1)+')':'Fixa (margem a partir de '+pct(cfg.minEdgePct,1)+')';
    el.innerHTML='<b>Regras em vigor agora ('+(cfg.mode==='active'?'Ativo: operando':cfg.mode==='observe'?'Observar: só simula':'desligado')+')</b>'+
      '<ol class="note" style="margin:6px 0 0;padding-left:18px">'+
      '<li><b>Perda máxima em 7 dias</b> US$'+nf(cfg.weeklyLossUsd||0,0)+': passou, encerra tudo. Vale sobre todas.</li>'+
      '<li><b>Stop-loss</b> US$'+nf(cfg.sessionBudgetUsd||0,0)+' por tentativa e espera de '+nf(cfg.stopCooldownH||0,1)+' h: encerra e espera, inclusive no Sniper.</li>'+
      '<li><b>Bloco no seu endereço</b>: '+({cancel:'encerra a ordem',min:'reduz à potência de pausa',continue:'continua'}[cfg.onBlock]||cfg.onBlock)+'.</li>'+
      '<li><b>Regra de entrada (só uma vale):</b> '+entry+'.'+(sn&&rel?' A regra relativa está ligada, mas fica de lado enquanto o Sniper estiver ligado.':'')+'</li>'+
      '<li><b>Limite diário</b> US$'+nf(cfg.dailyBudgetUsd||0,0)+': passou, reduz para a potência mínima até o dia seguinte (UTC).</li>'+
      '<li><b>Regra da NiceHash:</b> o preço só baixa 10 min depois de qualquer mudança.</li></ol>'+
      (S.planOn?'<div class="note" style="margin-top:4px">Plano para o saldo aplicado: ele definiu o valor da ordem, o stop-loss e o limite diário acima.</div>':'')})();
  (function(){var f=$('b_minEdgePct');if(!f)return;var rel=(($('b_minEdgeMode')||{}).value||cfg.minEdgeMode)==='relativo',lab=f.parentNode;
    f.style.opacity=rel?'.5':'';var n=$('b_minNote');if(!n){n=document.createElement('small');n.id='b_minNote';n.className='note';n.style.display='block';lab.appendChild(n)}
    n.textContent=rel?'Guardada: não vale com a regra relativa ligada; volta a valer se escolher "Fixa".':''})();
  $('b_autoCreate').checked=!!cfg.autoCreate;if($('b_sniper'))$('b_sniper').checked=!!cfg.sniper;if($('b_sniperUseAge'))$('b_sniperUseAge').checked=!!cfg.sniperUseAge;
  if(cfg.poolId)$('n_pool').value=cfg.poolId;
  if(m.bidEH&&!$('n_price').value)$('n_price').value=m.bidEH.toFixed(4);
  if(!$('pl_user').value&&cfg.payoutAddress)$('pl_user').value=cfg.payoutAddress;
  var eh=(s.edgeHist||[]).map(function(x){return {t:x[0],v:x[1]}});
  if(eh.length>1){$('o_edge').innerHTML=chartSVG(eh,0,function(v){return pct(v,1)})+'<div class="tip" hidden></div>';bindChart($('o_edge'),eh,function(v){return pct(v,1)})}
  else $('o_edge').innerHTML='<p class="note">O histórico aparece depois de algumas horas de ciclos.</p>';
  var KC={acao:'ok',simulado:'warn',erro:'bad',bloco:'ok',config:''};
  $('o_log').innerHTML=ops.log.slice(0,40).map(function(l){return '<div><span class="note" style="flex:1"><span class="chip '+(KC[l.kind]||'')+'">'+esc(l.kind)+'</span> '+esc(l.text)+'</span><span class="mono note">'+new Date(l.t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' ('+utcHM(l.t)+' UTC)'+'</span></div>'}).join('')||'<div class="note">Sem eventos.</div>';
}
function opsMsg(id,t,bad){$(id).textContent=t;$(id).className='note'+(bad?' bad':'')}
function botForm(){
  var o={autoCreate:$('b_autoCreate').checked,sniper:!!($('b_sniper')&&$('b_sniper').checked),sniperUseAge:!!($('b_sniperUseAge')&&$('b_sniperUseAge').checked)};
  BOT_FIELDS.forEach(function(k){var el=$('b_'+k);if(!el)return;var v=String(el.value==null?'':el.value).trim();if(['mode','onBlock','payoutAddress','poolId','minEdgeMode'].indexOf(k)>=0){o[k]=v;return}
    // número: aceita vírgula (teclado em português) e ignora campo vazio (mantém o valor salvo)
    if(v==='')return;var n=parseFloat(v.replace(/\s/g,'').replace(/[−–]/g,'-').replace(',','.'));if(isFinite(n))o[k]=n});
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
  trackNeg();
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
    '<div class="legs">Short <b>'+esc(p.s)+'</b> · Long <b>'+esc(p.l)+'</b> · '+usd(p.notional)+' por perna · entrada '+new Date(p.t).toLocaleDateString('pt-BR')+' · '+nf(age,1)+(p.days?' de '+p.days:'')+' dias</div>'+
    '<div class="kv"><div><small>Spread entrada</small><span>'+pct(p.apr,1)+'</span></div>'+
    '<div><small>Spread agora</small><span class="'+(ca===null?'':al.level==='ok'?'good':al.level)+'">'+(ca===null?'—':pct(ca,1))+'</span></div>'+
    '<div><small>Break-even</small><span>'+(isFinite(p.beApr)&&p.beApr!==undefined?pct(p.beApr,1):'—')+'</span></div></div>';
    if(!p.closed)h+=positionAdvice(p,ca);
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

// Ficar ou sair, vale trocar, e funding recebido pelo histórico público (por posição aberta).
var posHist={};
function legSym(coin,venue){var r=state.rows[FD.normBase(coin)]||state.rows[coin];return r&&r[venue]?r[venue]:null}
function positionAdvice(p,ca){
  var leg=legSym(p.coin,p.s),hours=leg?leg.hours:8,now=Date.now();
  var st=FDI.stayAdvice(p,ca,{now:now,hours:hours});
  var html='<div class="box" style="margin-top:0"><b>Ficar ou sair</b>'+esc(st.text)+'</div>';
  if(ca!==null&&state.live){
    var pp=scanParams(),c=verdictCtx(pp),myKey=FD.normBase(p.coin)+'|'+p.s+'|'+p.l;
    var best=(state.ops||[]).filter(function(o){return oppKey(o)!==myKey&&FDC.fundingVerdict(o,Object.assign({stab:stabOf(o)},c)).level==='go'})[0];
    var left=p.days?Math.max(1,p.days-(now-p.t)/864e5):pp.hold;
    var sw=FDI.switchAdvice(p,ca,best,{days:Math.round(left*10)/10,aprCap:pp.aprCap<1e8?pp.aprCap:null});
    if(sw)html+='<div class="box"><b>Vale trocar?</b>'+esc(sw.text)+'</div>';
  }
  var ph=posHist[p.id];
  if(ph&&ph.usd!==null)html+='<div class="box"><b>Funding pelo histórico público</b>'+(ph.payments?usd(ph.usd)+' em '+ph.payments+' pagamentos desde a entrada (estimativa com o tamanho registrado; o extrato da exchange é o oficial). <button class="sm" data-usehist="'+esc(p.id)+'">Usar este valor</button>':'Ainda sem pagamentos desde a entrada. O valor aparece aqui depois do primeiro pagamento.')+'</div>';
  else if(!ph)loadPosHist(p);
  return html;
}
function loadPosHist(p){
  var a=legSym(p.coin,p.s),b=p.l==='Spot'?null:legSym(p.coin,p.l);
  if(!state.live||!a||(p.l!=='Spot'&&!b)){posHist[p.id]={usd:null};return}
  posHist[p.id]={pending:true,usd:null};
  Promise.all([loadHist(p.s,a.sym,a.hours),b?loadHist(p.l,b.sym,b.hours):Promise.resolve(null)]).then(function(r){
    var f=FDI.fundingFromHistory(p,r[0],r[1],Date.now());posHist[p.id]={usd:f.usd,payments:f.payments};renderPositions();
  },function(){posHist[p.id]={usd:null}});
}
// Marca desde quando o funding da posição está negativo (para "saia: negativo há N pagamentos").
function trackNeg(){
  var changed=false;
  pos.forEach(function(p){if(p.closed)return;var ca=state.live?FD.currentSpread(state.rows,p):null;if(ca===null)return;
    if(ca<=0&&!p.negSince){p.negSince=Date.now();changed=true}else if(ca>0&&p.negSince){delete p.negSince;changed=true}});
  if(changed)savePos();
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
function opCard(eyebrow,level,title,text,btns,extra){
  return '<div class="card sig '+({go:'favoravel',maybe:'neutro',no:'desfavoravel'}[level]||'')+'"><div class="row between"><div class="eyebrow">'+eyebrow+'</div>'+chip(level)+'</div>'+
    '<div class="lead">'+esc(title)+'</div><p class="why">'+esc(text)+'</p>'+(extra||'')+
    '<div class="row">'+btns.map(function(b){return '<button class="sm'+(b[2]?' pri':'')+'" data-go="'+b[0]+'"'+(b[3]?' data-setmode="'+b[3]+'"':'')+'>'+b[1]+'</button>'}).join('')+'</div></div>';
}
function renderLink(){
  var need=!settings.apiUrl||(!ops.status&&/token inválido|não respondeu como o backend/.test(ops.err.status||''));
  $('h_link').hidden=!need;
  if(need)$('h_link_txt').textContent=(STANDALONE?'Este atalho do iPhone tem memória separada do Safari. ':'')+(settings.apiUrl?'A conexão com o backend falhou. ':'')+'Copie o link de conexão (o que o Claude mandou) e toque no botão: fica salvo neste aparelho.';
}
function renderHome(){
  renderLink();
  var rows=VENUES.map(function(v){
    var s=state.src[v];
    if(s)return srcRow(v,s==='via HL'?'parcial':'ok',SRC_NAME[s]+(state.updated?' · '+hhmm(state.updated):''),s==='via HL'?'warn':'good');
    return srcRow(v,state.updated?'falhou':'…',state.srcErr[v]||'',state.updated?'bad':'mute');
  });
  rows.push(srcRow('Rede BCH',mine.blocks.length?'ok':(mine.err.blocks?'falhou':'…'),mine.blocks.length?'Blockchair · '+hhmm(mine.at):(mine.err.blocks||''),mine.blocks.length?'good':(mine.err.blocks?'bad':'mute')));
  var L=live();
  rows.push(srcRow('Cotações',L.bchUsd&&L.btcUsd?'ok':'…',L.bchUsd?'BCH '+usd(L.bchUsd)+' · BTC '+usd(L.btcUsd):'',L.bchUsd?'good':'mute'));
  rows.push(srcRow('Rede BSV',L.bsvD&&L.bsvUsd?'ok':(mine.err.bsv?'falhou':'…'),L.bsvD?'WhatsOnChain':(mine.err.bsv||''),L.bsvD&&L.bsvUsd?'good':(mine.err.bsv?'bad':'mute')));
  rows.push(srcRow('NiceHash',mine.book?(mine.bookSrc==='proxy'?'ok':'atrasado'):(mine.err.book?'falhou':'…'),mine.book?mine.bookSrc+(mine.bookAt?' · '+ago(mine.bookAt):''):(mine.err.book||''),mine.book?(mine.bookSrc==='proxy'?'good':'warn'):(mine.err.book?'bad':'mute')));
  if(settings.apiUrl){var bs=ops.status;rows.push(srcRow('Backend',bs?'ok':(ops.err.status?'falhou':'…'),bs?('robô '+MODE_TXT[bs.config.mode].toLowerCase()+' · NiceHash '+bs.nhEnv):(ops.err.status||''),bs?'good':(ops.err.status?'bad':'mute')))}
  $('h_src').innerHTML='<tr><th>Fonte</th><th>Estado</th><th>Detalhe</th></tr>'+rows.join('');
  var issues=rows.filter(function(r){return /class="(warn|bad)"/.test(r)}).length;
  $('h_srcsum').textContent=issues?'· '+issues+' com ressalva':'· tudo ok';

  var pp=fundFor('pp'),sp=fundFor('sp'),V=mineVerdict(L),coins=coinRows(L,V);
  var bestCoin=coins.filter(function(c){return c.level==='go'})[0];
  var levels=[pp.sum.level,sp.sum.level,V.v.level];
  $('h_title').textContent=levels.indexOf('go')>=0?'Há operações que compensam agora':(levels.indexOf('maybe')>=0?'Nada com folga agora; há operações no limite':'Nada compensa agora: hora de esperar');
  $('h_sub').textContent=(state.updated?'Atualizado às '+hhmm(state.updated)+'. ':'')+(state.live?'':'Funding em modo exemplo. ')+(issues?'Algumas fontes com ressalva (veja Fontes de dados). ':'')+'Valores são projeção sobre o mercado de agora.';
  var hold=num('hold')||3;
  $('h_ops').innerHTML=
    opCard('Funding · Perp × Perp',pp.sum.level,pp.sum.title,pp.sum.text+' Ciclo de '+hold+' dias.',[['fund','Ver oportunidades',true,'pp'],['fund:journey','Como funciona']])+
    opCard('Funding · Spot + Perp',sp.sum.level,sp.sum.title,sp.sum.text,[['fund','Ver oportunidades',false,'sp'],['fund:journey','Como funciona']])+
    opCard('Mineração solo · hash alugado',V.v.level,V.v.title,V.v.why,[['mine','Entender por quê',true],['mine:journey','Como funciona']],
      (V.v.when?'<div class="box" style="margin-bottom:8px"><b>Quando passa a compensar</b>'+esc(V.v.when)+'</div>':'')+staleHTML()+
      (coins.length?'<p class="note" style="margin:0 0 8px">'+(bestCoin&&bestCoin.coin!=='BCH'?'Com o mesmo hash, hoje '+bestCoin.coin+' compensa ('+pct(bestCoin.edgePct,1)+'). Veja a comparação de moedas.':'Comparando BTC, BCH e BSV: '+coins[0].coin+' rende mais por hash hoje ('+pct(coins[0].edgePct||0,1)+' vs aluguel).')+'</p>':''));
  var al=posAlerts().filter(function(x){return x.al.level==='bad'||x.al.level==='warn'});
  var ms=FDM.summarize(sessions),openN=pos.filter(function(p){return !p.closed}).length,bs2=ops.status;
  var lines=[];
  al.forEach(function(x){lines.push('<li><span class="chip '+x.al.level+'">'+esc(x.al.text)+'</span> '+esc(x.p.coin)+' ('+esc(x.p.s)+' / '+esc(x.p.l)+'): '+(x.al.level==='bad'?'avalie fechar as duas pernas.':'acompanhe de perto.')+'</li>')});
  if(bs2&&bs2.state&&(bs2.state.errors||[]).length)lines.push('<li><span class="chip bad">robô</span> '+esc(bs2.state.errors[0])+'</li>');
  if(bs2&&(bs2.state.myBlocks||[]).length)lines.push('<li><span class="chip ok">bloco</span> Seu último bloco: '+bs2.state.myBlocks[bs2.state.myBlocks.length-1].height+'.</li>');
  $('h_alerts').innerHTML='<div class="eyebrow">Suas operações</div><div class="lead">'+(al.length?plural(al.length,'posição pede atenção','posições pedem atenção'):'Nada pede atenção agora')+'</div>'+
    (lines.length?'<ul class="rules">'+lines.join('')+'</ul>':'')+
    '<p class="note">'+plural(openN,'posição de funding aberta','posições de funding abertas')+' · '+plural(ms.n,'sessão de mineração registrada','sessões de mineração registradas')+(ms.n?' (líquido '+usd(ms.net)+')':'')+(bs2?' · robô '+MODE_TXT[bs2.config.mode].toLowerCase():'')+'.</p>'+
    ((state.active||[]).length?'<p class="note" style="margin:0 0 8px">Radar agora: '+plural((state.active||[]).length,'item','itens')+' ('+esc(state.active[0].title)+(state.active.length>1?'…':'')+').</p>':'')+
    '<div class="row"><button class="sm" data-go="radar">Abrir radar</button><button class="sm" data-go="diary">Abrir diário</button>'+(settings.apiUrl?'<button class="sm" data-go="mine:ops">Operar</button>':'')+'</div>';
  renderJourneys(V);
  renderFin();
  renderPlanCard(pp,sp,V,L);
  renderReal();renderProd();
}
/* ---------- quadro financeiro (Início): simulado × real ---------- */
// Simulado = o que as regras do robô teriam feito no mercado real, sem dinheiro. Real = o que foi pago e recebido de
// fato (robô na NiceHash + o que você registra no Diário) e os aportes que você registra aqui.
var cash=(ls('fd_cash')||[]); // {id,t,usd,kind:'in'|'out',where}
function saveCash(){ls('fd_cash',cash)}
function finData(mode){
  var st=(ops.status&&ops.status.state)||{},fr=[],days={},today=new Date().toISOString().slice(0,10);
  var add=function(d,v){if(d&&isFinite(v)&&v!==0)days[d]=(days[d]||0)+v};
  var dayOf=function(t){return new Date(t).toISOString().slice(0,10)};
  if(mode==='sim'){
    var p=st.paper;
    if(p){fr.push({name:'Mineração BCH (robô)',cost:p.spendUsd||0,rev:p.wonUsd||0,exp:(p.evUsd||0)-(p.spendUsd||0),note:(p.blocks||0)+' de '+(p.draws||0)+' blocos sorteados seriam seus'});
      Object.keys(p.days||{}).forEach(function(d){var x=p.days[d];add(d,(x.wonUsd||0)-x.spendUsd)})}
    var ap=st.algoPaper;
    if(ap){var as=0,ar=0;Object.keys(ap.algos||{}).forEach(function(k){as+=ap.algos[k].spendUsd||0;ar+=ap.algos[k].revUsd||0});
      fr.push({name:'Outras moedas (PPS)',cost:as,rev:ar,exp:ar-as,note:ap.v===2?'margem realista, US$'+((ap.budgetUsdDay)||100)+'/dia enquanto compensa':'conta antiga (bruta)'});
      Object.keys(ap.days||{}).forEach(function(d){var x=ap.days[d];add(d,x.revUsd-x.spendUsd)})}
    var fp=st.fundPaper,fs=fp&&fp.summary;
    if(fs&&isFinite(fs.fundingUsd)){var fres=fs.fundingUsd-fs.feesUsd;
      fr.push({name:'Funding (robô)',cost:fs.feesUsd,rev:fs.fundingUsd,exp:fres,note:fs.closed+' fechadas, '+fs.open+' abertas'+(fs.capitalUsd?' (US$'+nf(fs.capitalUsd,0)+' de capital em uso)':'')});
      (fp.closed||[]).forEach(function(c){add(dayOf(c.closedAt),c.netUsd)});add(today,fs.openNetUsd||0)}
    var lp=st.fundPaperLT,ls=lp&&lp.summary;
    if(ls&&isFinite(ls.fundingUsd)){fr.push({name:'Funding com Lighter (robô)',cost:ls.feesUsd,rev:ls.fundingUsd,exp:ls.fundingUsd-ls.feesUsd,note:ls.closed+' fechadas, '+ls.open+' abertas · perna de taxa zero'});
      (lp.closed||[]).forEach(function(c){add(dayOf(c.closedAt),c.netUsd)});add(today,ls.openNetUsd||0)}
  }else{
    var r=st.real;
    if(r&&(r.spendUsd||r.revenueUsd)){fr.push({name:'Mineração BCH (robô)',cost:r.spendUsd||0,rev:r.revenueUsd||0,note:(r.blocks||0)+' bloco(s) pagos no seu endereço'});
      Object.keys(r.days||{}).forEach(function(d){var x=r.days[d];add(d,(x.revenueUsd||0)-(x.spendUsd||0))})}
    var ms=FDM.summarize(sessions);
    if(ms.n){fr.push({name:'Mineração (Diário)',cost:ms.cost,rev:ms.reward,note:plural(ms.n,'sessão registrada','sessões registradas')});
      sessions.forEach(function(x){add(dayOf(x.t),(+x.rewardUsd||0)-(+x.costUsd||0))})}
    if(pos.length){var fc=0,fv=0,op=0;pos.forEach(function(q){fv+=q.funding||0;fc+=(q.fee||0)+(q.closed?(q.exitFee||0):0);
        if(q.closed)add(dayOf(q.closed),q.pnl);else{op++;add(today,(q.funding||0)-(q.fee||0))}});
      fr.push({name:'Funding (Diário)',cost:fc,rev:fv,note:plural(pos.length,'posição','posições')+', '+op+' aberta'+(op===1?'':'s')})}
  }
  var tot={cost:0,rev:0,res:0,exp:0};fr.forEach(function(f){f.res=f.rev-f.cost;tot.cost+=f.cost;tot.rev+=f.rev;tot.res+=f.res;tot.exp+=(f.exp===undefined||f.exp===null?f.res:f.exp)});
  // gráfico: começa no que veio antes do histórico diário (30 dias) e termina no total de agora
  var ks=Object.keys(days).sort(),sum=ks.reduce(function(a,d){return a+days[d]},0),acc=tot.res-sum,series=[];
  if(ks.length){series.push({t:Date.parse(ks[0]+'T00:00:00Z'),v:acc});ks.forEach(function(d){acc+=days[d];series.push({t:Math.min(Date.parse(d+'T23:59:59Z'),Date.now()),v:acc,day:days[d],d:d})})}
  return {fronts:fr,tot:tot,series:series};
}
function renderFin(){
  var el=$('h_fin');if(!el)return;
  var mode=settings.finMode==='real'?'real':'sim',F=finData(mode),T=F.tot;
  var inv=cash.reduce(function(a,c){return a+(c.kind==='out'?-c.usd:c.usd)},0),ref=+settings.finRef||1000;
  var base=mode==='real'?inv:ref,roi=base>0?T.res/base*100:null;
  var resTxt='<b class="'+(T.res>=0?'good':'bad')+'">'+(T.res>=0?'Lucro ':'Prejuízo ')+signUsd(T.res)+'</b>';
  var h='<div class="row between"><div class="eyebrow">Resultado financeiro</div><div class="seg" id="finSeg"><button class="sm" data-fin="sim" aria-pressed="'+(mode==='sim')+'">Simulado</button><button class="sm" data-fin="real" aria-pressed="'+(mode==='real')+'">Real</button></div></div>'+
    '<div class="lead" style="margin-top:6px">'+(F.fronts.length?resTxt+(roi!==null?' <span class="note">('+pct(roi,1)+' sobre '+(mode==='real'?'o aportado':'o capital de referência')+')</span>':''):(mode==='sim'?'Simulação ainda sem resultado':'Nada registrado ainda'))+'</div>'+
    '<div class="kv" style="margin-top:8px"><div><small>'+(mode==='real'?'Aportado':'Capital de referência')+'</small><span>'+usd(base,0)+'</span></div>'+
    '<div><small>Gasto (aluguel e taxas)</small><span>'+usd(T.cost)+'</span></div><div><small>Receita</small><span>'+usd(T.rev)+'</span></div>'+
    '<div><small>'+(T.res>=0?'Lucro':'Prejuízo')+'</small><span class="'+(T.res>=0?'good':'bad')+'">'+signUsd(T.res)+'</span></div></div>';
  if(mode==='sim'&&F.fronts.length&&Math.abs(T.exp-T.res)>=0.5)h+='<p class="note" style="margin:6px 0 0">Sem a sorte dos blocos (média esperada): <b class="'+(T.exp>=0?'good':'bad')+'">'+signUsd(T.exp)+'</b>. Na mineração solo o resultado de cada período é sorte; a média mostra se a regra ganha no longo prazo.</p>';
  if(F.series.length>=2)h+='<div class="eyebrow" style="margin:12px 0 4px">Evolução do resultado (acumulado, US$)</div><div class="chart" id="fin_chart">'+chartSVG(F.series,NaN,function(v){return signUsd(v)},function(v){return nf(v,0)})+'<div class="tip" hidden></div></div>';
  else if(F.fronts.length)h+='<p class="note" style="margin:8px 0 0">A evolução aparece a partir do segundo dia com resultado.</p>';
  if(F.fronts.length)h+='<div class="stack" style="gap:4px;margin-top:10px">'+F.fronts.map(function(f){var ex=mode==='sim'&&f.exp!==undefined&&f.exp!==null&&Math.abs(f.exp-f.res)>=0.5;
    return '<div class="trow"><div class="row between"><b>'+esc(f.name)+'</b><b class="'+(Math.abs(f.res)<0.005?'':f.res>0?'good':'bad')+'">'+signUsd(f.res)+'</b></div>'+
      '<div class="note">gasto '+usd(f.cost)+' · receita '+usd(f.rev)+(ex?' · sem sorte: '+signUsd(f.exp):'')+'</div><div class="note">'+esc(f.note||'')+'</div></div>'}).join('')+'</div>'+
    (F.series.length>=2?'<details style="margin-top:6px"><summary class="note">Por dia</summary><div class="scroll"><table><tr><th>Dia (UTC)</th><th>Resultado</th><th>Acumulado</th></tr>'+
      F.series.filter(function(x){return x.d}).slice().reverse().map(function(x){return '<tr><td>'+x.d.slice(8,10)+'/'+x.d.slice(5,7)+'</td><td class="'+(x.day>=0?'good':'bad')+'">'+signUsd(x.day)+'</td><td>'+signUsd(x.v)+'</td></tr>'}).join('')+'</table></div></details>':'');
  if(mode==='sim'){
    h+=(settings.apiUrl?'':'<p class="note" style="margin:8px 0 0">Conecte o backend (Ajustes) para ver as simulações do robô.</p>')+
      '<p class="note" style="margin:8px 0 0">Simulado: as regras do robô aplicadas ao mercado real, sem dinheiro. Não é lucro de verdade; serve para saber se a regra merece dinheiro.</p>'+
      '<div class="row" style="margin-top:6px;align-items:end"><label class="note">Capital de referência (US$)<input id="fin_ref" type="number" inputmode="decimal" value="'+ref+'" style="width:110px"></label></div>';
  }else{
    var st=(ops.status&&ops.status.state)||{},ac=st.acct,btc=(st.market||{}).btcUsd;
    if(ac&&isFinite(ac.balanceBtc)&&btc)h+='<p class="note" style="margin:8px 0 0">Saldo na NiceHash agora: <b>'+usd(ac.balanceBtc*btc)+'</b> ('+nf(ac.balanceBtc,6)+' BTC).</p>';
    h+='<details style="margin-top:8px"'+(cash.length?'':' open')+'><summary>Aportes e retiradas ('+cash.length+')</summary>'+
      (cash.length?'<div class="stack" style="gap:4px;margin-top:6px">'+cash.slice().sort(function(a,b){return b.t-a.t}).map(function(c){return '<div class="trow row between"><span>'+new Date(c.t).toLocaleDateString('pt-BR')+' · '+(c.kind==='out'?'retirada':'aporte')+' · '+esc(c.where||'')+'</span><span><b>'+(c.kind==='out'?'−':'+')+usd(c.usd)+'</b> <button class="sm" data-cashdel="'+esc(c.id)+'">Excluir</button></span></div>'}).join('')+'</div>':'<p class="note" style="margin:6px 0">Registre aqui o dinheiro que você colocou (depósito na NiceHash, na Braiins, nas corretoras do funding) e o que tirou. Fica só neste aparelho.</p>')+
      '<div class="grid2" style="margin-top:6px"><label>Valor (US$)<input id="cash_usd" type="number" inputmode="decimal"></label><label>Tipo<select id="cash_kind"><option value="in">Aporte</option><option value="out">Retirada</option></select></label>'+
      '<label>Onde<input id="cash_where" placeholder="NiceHash, Binance…"></label><label>Data<input id="cash_t" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label></div>'+
      '<div class="row" style="margin-top:6px"><button class="sm pri" data-cashadd="1">Registrar</button></div></details>'+
      '<p class="note" style="margin:8px 0 0">Real: o que o robô pagou e recebeu na NiceHash e o que você registra no Diário (sessões e posições de funding). Rentabilidade = resultado ÷ aportado.</p>';
  }
  el.innerHTML=h;
  if(F.series.length>=2)bindChart($('fin_chart'),F.series,function(v){return signUsd(v)});
}
document.addEventListener('click',function(e){
  var b=e.target.closest('#h_fin [data-fin],#h_fin [data-cashadd],#h_fin [data-cashdel]');if(!b)return;
  if(b.dataset.fin){settings.finMode=b.dataset.fin;ls('fd_set',settings);renderFin();return}
  if(b.dataset.cashdel){if(confirm('Excluir este registro?')){cash=cash.filter(function(c){return c.id!==b.dataset.cashdel});saveCash();renderFin()}return}
  var v=parseFloat($('cash_usd').value);if(!(v>0))return;
  cash.push({id:'c'+Date.now().toString(36),t:Date.parse($('cash_t').value+'T12:00:00')||Date.now(),usd:v,kind:$('cash_kind').value,where:$('cash_where').value.trim()});
  saveCash();renderFin();
});
document.addEventListener('change',function(e){if(e.target&&e.target.id==='fin_ref'){var v=parseFloat(e.target.value);if(v>0){settings.finRef=v;ls('fd_set',settings);renderFin()}}});
function renderPlanCard(pp,sp,V,L){
  var best=pp.sum.level==='go'?pp.sum.best:(sp.sum.level==='go'?sp.sum.best:null),p=scanParams();
  var bt=best?(stabMap[oppKey(best)]||{}).bt:null;
  var f=best?{level:'go',netUsd:best.m.netUsd,hold:p.hold,capital:p.capital,winRate:bt?bt.winRate:NaN}:{level:'no'};
  var o=mineOutlookFor(L,V),a=FDI.allocation(p.capital,f,{level:V.v.level,ratio:V.v.ratio||0,favPct:o.favPct||0});
  $('h_plan').innerHTML='<div class="eyebrow">Plano combinado</div><div class="lead">Como dividir '+usd(p.capital,0)+' agora</div><p class="why">'+esc(a.summary)+'</p>'+
    a.lines.map(function(l){return '<div class="box"><b>'+esc(l.name)+' · '+pctp(l.share*100,0)+' ('+usd(l.amount,0)+')</b>'+esc(l.note)+
      (l.monthUsd?'<div style="margin-top:4px">Projeção em 30 dias: <b class="'+(l.monthUsd>=0?'good':'bad')+'">'+usd(l.monthUsd)+'</b></div>':'')+'</div>'}).join('')+
    '<p class="note" style="margin:8px 0 0">Projeção: supõe que o mercado repita o padrão de agora. Capital e ciclo vêm do cenário do Funding; orçamento de mineração, do Planejar.</p>';
}
function renderReal(){
  var st=ops.status,k=st&&st.keys,mode=st&&st.config.mode;
  var mine=!settings.apiUrl?'Backend não publicado: <b>nada é executado</b>. Planejar e Diário são simulação e registro.':
    !st?'Backend configurado, mas sem resposta agora.':
    !k?'Backend conectado, mas sem as chaves da NiceHash: <b>nada é executado</b>.':
    mode==='active'?'<b class="warn">Robô ATIVO</b> na NiceHash de '+esc(st.nhEnv)+': abre, altera e cancela <b>ordens reais</b> (as marcadas como "robô gerencia").':
    mode==='observe'?'Robô em <b>observar</b> na NiceHash de '+esc(st.nhEnv)+': calcula e registra o que faria, <b>não executa</b>. Ordens manuais em Operar são reais.':
    'Robô desligado. Ordens manuais em Operar (NiceHash de '+esc(st.nhEnv)+') são reais.';
  $('h_real').innerHTML='<div class="eyebrow">O que é real</div><div class="lead">O painel opera ou só registra?</div>'+
    '<div class="box"><b>Funding</b>Dados e recomendações: <b>reais, ao vivo</b>. Ordens: <b>você abre e fecha na exchange</b>; o painel ainda não executa funding. Diário: registro manual (o extrato da exchange é o oficial).</div>'+
    '<div class="box"><b>Mineração</b>'+mine+'</div>';
}
function renderAcct(){
  var st=ops.status,c=st&&st.creds,host='';
  try{host=new URL(apiCfg().url).host}catch(e){}
  var on=!!st;['ac_nh_save','ac_nh_del','ac_tg_go','ac_tg_del'].forEach(function(id){$(id).disabled=!on});
  if(!apiCfg().url){$('ac_state').textContent='Conecte o backend primeiro (passos acima).';$('ac_nh_st').textContent='';$('ac_tg_st').textContent='';return}
  if(!st){$('ac_state').textContent='Backend sem resposta: '+(ops.err.status||'carregando…');return}
  if(!c){$('ac_state').textContent='O backend está numa versão antiga: publique de novo para cadastrar contas por aqui.';return}
  $('ac_state').innerHTML='As chaves vão para <b>'+esc(host)+'</b>'+(c.encryption?' e ficam cifradas lá.':'. <span class="bad">Falta a chave de cifra (ENC_KEY) no backend: rode a instalação de novo antes de cadastrar.</span>')+(c.error?' <span class="bad">'+esc(c.error)+'</span>':'');
  var nh=c.nicehash,tg=c.telegram;
  $('ac_nh_st').className='chip '+(nh.set?(nh.env==='prod'?'warn':'ok'):'');
  $('ac_nh_st').textContent=nh.set?('conectada · '+(nh.env==='prod'?'produção':nh.env==='test'?'teste':nh.env)+(nh.source==='cloudflare'?' (Cloudflare)':'')):'não conectada';
  $('ac_tg_st').className='chip '+(tg.set?'ok':'');
  $('ac_tg_st').textContent=tg.set?('conectado'+(tg.bot?' · @'+tg.bot:'')):(tg.token?'falta mandar "oi"':'não conectado');
  if(nh.set&&!$('ac_env').dataset.touched)$('ac_env').value=nh.env==='prod'?'prod':'test';
}
function renderProd(){
  var st=ops.status,cfg=st&&st.config,n=Object.keys(state.src).filter(function(v){return state.src[v]==='api'||state.src[v]==='proxy'}).length;
  var items=[
    ['Painel publicado (GitHub Pages)',true,''],
    ['Dados ao vivo das exchanges',n===VENUES.length,n+' de '+VENUES.length+' diretas'],
    ['Backend publicado e conectado',!!st,settings.apiUrl?(st?'ok':'sem resposta'):(STANDALONE?'neste atalho do iPhone: Ajustes → Backend → Colar link de conexão':'Ajustes → Conectar o backend')],
    ['NiceHash conectada (chave sem saque)',!!(st&&st.keys),st&&st.keys?'':'Ajustes → Conectar contas'],
    ['Telegram para alertas 24 h',!!(st&&st.telegram),st&&st.telegram?'':'Ajustes → Conectar contas'],
    ['Endereço BCH e pool cadastrados',!!(cfg&&cfg.payoutAddress&&ops.pools.length),''],
    ['Robô validado em Observar por alguns dias',null,'confira o log em Operar'],
    ['NiceHash em produção',!!(st&&st.nhEnv==='produção'),st?(st.nhEnv==='produção'?'':'hoje: '+st.nhEnv+'. Em Conectar contas, escolha Produção e cole a chave da conta real'):''],
    ['Execução automática de funding',false,'a construir: precisa de servidor no Brasil']
  ];
  var done=items.filter(function(i){return i[1]===true}).length;
  $('prod').innerHTML='<div class="eyebrow">Produção</div><div class="lead">O que falta para operar: '+done+' de '+items.length+'</div>'+
    '<ul class="steps" style="margin-top:8px">'+items.map(function(i,ix){var c=i[1]===true?'ok':(i[1]===null?'info':'wait');
      return '<li class="'+c+'"><span class="n">'+(i[1]===true?'✓':ix+1)+'</span><div><b>'+esc(i[0])+'</b>'+(i[2]?'<p class="note">'+esc(i[2])+'</p>':'')+'</div></li>'}).join('')+'</ul>';
}
function stepsHTML(steps){
  return steps.map(function(s,i){return '<li class="'+s.status+'"><span class="n">'+(s.status==='ok'?'✓':i+1)+'</span><div><b>'+esc(s.title)+'</b>'+(s.status==='now'?' <span class="chip warn">agora</span>':'')+
    '<p class="note">'+esc(s.text)+'</p>'+(s.detail?'<div class="d">'+esc(s.detail)+'</div>':'')+'</div></li>'}).join('');
}
function renderJourneys(V){
  var sum=state.fundSummary||{},al=posAlerts().filter(function(x){return x.al.level==='bad'}).length;
  $('j_fund').innerHTML=stepsHTML(FDC.journey('funding',{goCount:sum.level==='go'?sum.count:0,best:sum.best?sum.best.coin:'',openPositions:pos.filter(function(p){return !p.closed}).length,alerts:al}));
  var cfg=ops.status&&ops.status.config;
  $('j_mine').innerHTML=stepsHTML(FDC.journey('mining',{payoutAddress:cfg&&cfg.payoutAddress,level:V?V.v.level:null,orders:ops.orders.length,mode:cfg?cfg.mode:null}));
  $('mo_fund').innerHTML=FDC.MOMENTS.funding.map(function(t){return '<li>'+esc(t)+'</li>'}).join('');
  $('mo_mine').innerHTML=FDC.MOMENTS.mining.map(function(t){return '<li>'+esc(t)+'</li>'}).join('');
  if(!$('gloss').innerHTML)$('gloss').innerHTML=FDC.GLOSSARY.map(function(g){return '<dt>'+esc(g[0])+'</dt><dd>'+esc(g[1])+'</dd>'}).join('');
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

/* ---------- radar: mapas, padrões e alertas ---------- */
var market={raw:null,map:null,at:null,src:null,err:null},marketLoading=false;
function loadMarketMap(){
  if(marketLoading||(market.map&&Date.now()-market.at<5*60e3))return;
  marketLoading=true;
  var wtmU=proxied('https://whattomine.com/asic.json');
  var live$=wtmU?Promise.all([fetchJSON(wtmU)].concat(FDR.ALGOS.map(function(a){return settle(fetchJSON(proxied('https://api2.nicehash.com/main/api/v2/hashpower/orderBook?size=1000&algorithm='+a.nh)))}))).then(function(r){
      var books={};FDR.ALGOS.forEach(function(a,i){if(r[i+1].ok)books[a.nh]=r[i+1].v});return {wtm:r[0],books:books,at:Date.now(),src:'tempo real'}})
    :Promise.reject(new Error('sem backend'));
  live$.catch(function(){return fetchJSON('data/market.json?'+Math.floor(Date.now()/60000)).then(function(d){return {wtm:d.wtm,books:d.books||{},at:Date.parse(d.at),src:'foto GitHub'}})})
    .then(function(d){marketLoading=false;market.raw=d;market.at=Date.now();market.src=d.src;market.dataAt=d.at;market.err=null;computeMarketMap();renderRadar();updateRadar();renderAlgos()},
      function(e){marketLoading=false;market.err=errMsg(e);renderRadar()});
}
function computeMarketMap(){
  if(!market.raw||!market.raw.wtm)return;
  var L=live(),extra=[];
  if(L.bsvD&&L.bsvUsd&&L.btcUsd)extra.push({tag:'BSV',name:'Bitcoin SV',algorithm:'SHA-256',block_time:600,block_reward:3.125,nethash:L.bsvD*4294967296/600,exchange_rate:L.bsvUsd/L.btcUsd,exchange_rate_vol:null});
  market.map=FDR.miningMap(market.raw.wtm,market.raw.books||{},{btcUsd:L.btcUsd||undefined,poolFeePct:poolFee(),rentFeePct:3,minEdgePct:minEdge(),extra:extra});
}
var hist=ls('fd_hist')||[],amem=ls('fd_amem')||{},alerts=ls('fd_alerts')||[];
function radarSnapshot(){
  var L=live(),V=mineVerdict(L),edges={},prices={};
  coinRows(L,V).forEach(function(c){if(c.edgePct!==null)edges[c.coin]=+c.edgePct.toFixed(2)});
  (market.map||[]).forEach(function(m){if(m.edgePct!==null&&m.algo!=='SHA256ASICBOOST')edges[m.label]=+m.edgePct.toFixed(2)});
  if(L.bchUsd)prices.BCH=L.bchUsd;if(L.btcUsd)prices.BTC=L.btcUsd;if(L.bsvUsd)prices.BSV=L.bsvUsd;
  if(market.raw&&market.raw.wtm&&L.btcUsd)FDR.wtmCoins(market.raw.wtm).forEach(function(c){if(['LTC','DOGE','KAS'].indexOf(c.tag)>=0&&c.exchange_rate>0)prices[c.tag]=c.exchange_rate*L.btcUsd});
  var best=[];
  if(state.live){var p=scanParams(),c=verdictCtx(p);(state.ops||[]).slice(0,10).forEach(function(o){
    var st=stabOf(o),v=FDC.fundingVerdict(o,Object.assign({stab:st},c));
    if(v.level==='go')best.push({key:oppKey(o),coin:o.coin,title:(o.l==='Spot'?'spot + short na '+o.s:'short '+o.s+', long '+o.l),level:'go',stab:st?st.key:null,netTxt:'~'+usd(o.m.netUsd)+' em '+p.hold+' dias'})})}
  var thin={};if(V.thin)['BCH','BSV','BTC'].forEach(function(c){thin[c]=true});(market.map||[]).forEach(function(m){if(m.thin)thin[m.label]=true});
  return {t:Date.now(),sent:state.live?FDR.sentiment(state.rows,VENUES):null,edges:edges,prices:prices,best:best.slice(0,5),thin:thin};
}
function updateRadar(){
  var snap=radarSnapshot(),prev=null;
  for(var i=hist.length-1;i>=0;i--)if(snap.t-hist[i].t>=5*60e3){prev=hist[i];break}
  var positions=posAlerts().map(function(x){return {id:x.p.id,coin:x.p.coin,s:x.p.s,l:x.p.l,level:x.al.level,text:x.al.text}});
  var r=FDR.evaluateAlerts({snap:snap,prev:prev||{},hist:hist,positions:positions,mem:amem,now:snap.t,minEdgePct:minEdge()});
  amem=r.mem;ls('fd_amem',amem);
  hist=FDR.pushHistory(hist,snap);ls('fd_hist',hist);
  var active=FDR.activeConditions({snap:snap,positions:positions,minEdgePct:minEdge()}),akeys=active.map(function(a){return a.key});
  state.active=active;since=FDR.trackSince(since,akeys,snap.t);ls('fd_since',since);aprefs=FDR.cleanDismissed(aprefs,active.map(function(a){return a.key}));ls('fd_aprefs',aprefs);
  alerts=FDR.markEnded(FDR.pruneHistory(alerts.concat(r.alerts),snap.t,7,200),akeys,snap.t);ls('fd_alerts',alerts);
  if(r.alerts.length)notifyLocal(r.alerts.filter(function(a){return HIGH[a.kind]&&!FDR.isMuted(a.key,aprefs,Date.now())}));
  renderRadar();renderBadge();
}
var since=ls('fd_since')||{},focusAlgo=null;
var aprefs=ls('fd_aprefs')||{snooze:{},dismissed:{}},HIGH={saida:1,risco:1,entrada:1},alertsOpen=false;
function notifyLocal(list){
  try{
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    navigator.serviceWorker&&navigator.serviceWorker.getRegistration?navigator.serviceWorker.getRegistration().then(function(reg){
      list.slice(0,3).forEach(function(a){if(reg)reg.showNotification(a.title,{body:a.text,icon:'icons/icon-192.png'});else new Notification(a.title,{body:a.text})})}):
      list.slice(0,3).forEach(function(a){new Notification(a.title,{body:a.text})});
  }catch(e){}
}
// Alertas do servidor (rodam 24 h) entram no histórico deste aparelho: Safari, atalho e outro celular ficam iguais.
// Mesma regra do painel: se este aparelho já registrou o mesmo alerta nas últimas 6 h, não duplica.
function mergeServerAlerts(list){
  var added=0;
  list.forEach(function(a){
    if(!a||!a.key||!a.t)return;
    if(alerts.some(function(x){return x.id===a.id||(x.key===a.key&&Math.abs(x.t-a.t)<6*3600e3)}))return;
    alerts.push(Object.assign({},a,{id:a.id||('srv:'+a.key+':'+a.t),srv:true}));added++;
  });
  if(!added)return;
  alerts.sort(function(x,y){return x.t-y.t});alerts=FDR.pruneHistory(alerts,Date.now());ls('fd_alerts',alerts);renderBadge();
}
function unseen(){var seen=+(ls('fd_aseen')||0),now=Date.now();return alerts.filter(function(a){return a.t>seen&&HIGH[a.kind]&&!FDR.isMuted(a.key,aprefs,now)}).length}
function renderBadge(){var n=unseen(),b=$('r_badge');b.hidden=!n;b.textContent=n>9?'9+':n}
var KIND={entrada:['Entrada','ok','✓'],saida:['Saída','bad','✕'],risco:['Risco','warn','!'],atencao:['Atenção','warn','!'],oportunidade:['Oportunidade','ok','↗']};
var VABBR={Binance:'BIN',Bybit:'BYB',Hyperliquid:'HL',OKX:'OKX',Bitget:'BGT',Gate:'GATE'};
function heatBg(apr){
  if(!isFinite(apr))return 'transparent';
  if(Math.abs(apr)<3)return 'rgba(128,128,128,.16)';
  var a=Math.min(.62,.12+Math.abs(apr)/120);
  return apr>0?'rgba(227,73,72,'+a.toFixed(2)+')':'rgba(57,135,229,'+a.toFixed(2)+')';
}
function fmtApr(a){return Math.abs(a)<10?nf(a,1):nf(a,0)}
var radarSel=null,plCat='funding';
function alertHTML(a,opts){opts=opts||{};var k=KIND[a.kind]||['Info','',''];
  var when=a.t?'<span class="note mono">'+(Date.now()-a.t<864e5?ago(a.t)+' atrás':new Date(a.t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))+'</span>':'';
  var resolved=opts.history&&state.active&&!state.active.some(function(x){return x.key===a.key})&&/^(fe|fs|me|sent):/.test(a.key||'');
  var body=a.items?'<details><summary>'+esc(a.title)+'</summary><div class="stack" style="gap:6px;margin-top:6px">'+a.items.map(function(x){return alertHTML(x,{nested:true})}).join('')+'</div></details>':
    '<b>'+esc(a.title)+'</b><span class="note">'+esc(a.text)+'</span>';
  var open=a.go?'<button class="sm" data-go="'+a.go+'"'+(a.focus?' data-focus="'+esc(a.focus)+'"':'')+'>Abrir</button>':'';
  var acts=opts.history?'<div class="row">'+(resolved?'':open)+'<button class="sm" data-rmalert="'+esc(a.id)+'">Remover</button></div>':
    opts.nested?(open?'<div>'+open+'</div>':''):
    '<div class="row">'+open+(a.items?'':'<button class="sm" data-dismiss="'+esc(a.key)+'">Dispensar</button><button class="sm" data-snooze="'+esc(a.key)+'">Silenciar 24 h</button>')+'</div>';
  var life='';
  if(!opts.history&&!a.items&&since[a.key])life='<span class="note">Vale há '+ago(since[a.key])+' (desde '+hhmm(since[a.key])+'). Ainda vale agora.</span>';
  if(opts.history&&a.t){var end=a.endedAt||(resolved?Date.now():null);
    life='<span class="note">Começou '+hhmm(a.t)+(end?' · acabou '+hhmm(end)+' (durou '+FDI.dur(end-a.t)+') · <b class="bad">não vale mais</b>':(/^(fe|me|fs|sent):/.test(a.key||'')?' · <b class="good">ainda vale</b>':''))+'.</span>'}
  return '<div class="alert '+a.kind+'"'+(resolved?' style="opacity:.65"':'')+'><div class="row between"><span class="chip '+k[1]+'">'+k[2]+' '+k[0]+'</span>'+when+'</div>'+body+life+acts+'</div>'}
function dayLabel(t){var d=new Date(t),n=new Date(),y=new Date(n.getTime()-864e5);
  return d.toDateString()===n.toDateString()?'Hoje':d.toDateString()===y.toDateString()?'Ontem':d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit'})}
// Panorama do mercado escrito pelo copiloto: regime, ranking de retorno anual medido e o que mudou em 7 dias.
function panoramaHTML(P,open){
  if(!P||!P.lines)return '';
  var reg={quente:'<span class="chip warn">alavancagem quente</span>',frio:'<span class="chip">alavancagem fria</span>',neutro:'<span class="chip">alavancagem neutra</span>'}[(P.regime||{}).leverage]||'';
  return '<details'+(open?' open':'')+' style="margin-top:8px"><summary>Panorama do mercado (IA) '+reg+'</summary>'+
    '<ul class="note" style="margin:6px 0 0;padding-left:18px">'+P.lines.map(function(l){return '<li>'+esc(l)+'</li>'}).join('')+'</ul>'+
    ((P.rank||[]).length?'<div class="scroll" style="margin-top:6px"><table><tr><th>Retorno anual medido agora</th><th>a.a.</th><th>vs CDI</th></tr>'+P.rank.map(function(r){
      return '<tr><td>'+esc(r.name)+(r.note?'<div class="note">'+esc(r.note)+'</div>':'')+'</td><td>'+pctp(r.apr,r.apr>=100?0:2)+'</td><td>'+(r.vsCdi===null?'—':(r.vsCdi>=0?'+':'')+nf(r.vsCdi,1)+' pts')+'</td></tr>'}).join('')+'</table></div>'+
      '<p class="note" style="margin:4px 0 0">Taxas anuais do momento (não acumuladas). Em dólar, ETH ou SOL: a variação do ativo contra o real não entra aqui.</p>':'')+
    ((P.ceilings||[]).length?'<p class="note" style="margin:6px 0 0"><b>Tetos teóricos (não são retorno medido):</b> '+P.ceilings.map(function(c){return esc(c.name)+' até '+pctp(c.apr,0)+' a.a. ('+esc(c.note)+')'}).join(' · ')+'</p>':'')+'</details>';
}
// Frentes em observação (docs/pesquisa-frentes.md): cada uma com o número de agora, a régua para valer a pena e o
// resultado simulado desde o início do acompanhamento, sempre ao lado do CDI.
function renderFronts(){
  var el=$('r_fronts');if(!el)return;
  var st=(ops.status&&ops.status.state)||{},F=st.fronts,P=st.frontsPaper,LT=st.fundPaperLT;
  var head='<div class="eyebrow">Frentes em observação</div><div class="lead">Lastro para comparar: números de cada frente, sem filtro</div>';
  if(!settings.apiUrl){el.innerHTML=head+'<p class="note">Precisa do backend conectado: ele lê as fontes a cada 15 min.</p>';return}
  if(!F){el.innerHTML=head+'<p class="note">Começa no próximo ciclo do servidor (até 15 min).</p>';return}
  var cdi=F.cdi,chipF=function(){return ''},vsCdi=function(x){return cdi&&isFinite(x)&&x!==null?'<span class="chip">'+(x-cdi>=0?'+':'')+nf(x-cdi,1)+' pts vs CDI</span>':''};
  var pctA=function(x){return isFinite(x)&&x!==null?pctp(x,1)+' a.a.':'—'};
  var pap=function(k){var f=P&&P.f&&P.f[k];if(!f||!(f.usd>0))return '';var d=(Date.now()-f.since)/864e5;
    return '<div class="note">US$1.000 aqui desde '+new Date(f.since).toLocaleDateString('pt-BR')+': <b>'+signUsd(f.usd)+'</b> ('+pctp(f.usd/10,2)+') · CDI no mesmo período: '+pctp(f.cdiPct||0,2)+(d<7?' · poucos dias ainda':'')+'</div>'};
  var h=head+panoramaHTML(st.aiPanorama,true)+'<p class="note" style="margin:8px 0">Régua: CDI hoje '+(cdi?pctp(cdi,2)+' a.a.':'—')+' (em reais). Frente em dólar se compara ao CDI somando a variação do dólar no período. Catálogo completo (todas as frentes, com e sem dado ao vivo): docs/catalogo-frentes-cripto.md.</p>';
  // 1) funding com perna de taxa zero
  var L=F.lt;
  if(L){var seenC={},top=(L.top||[]).filter(function(p){if(seenC[p.coin])return false;seenC[p.coin]=1;return true}).slice(0,3),ls=LT&&LT.summary;
    h+='<div class="trow"><div class="row between"><b>Funding com perna na Lighter (taxa zero)</b>'+chipF(L.stable>0,L.above>0)+'</div>'+
      '<div class="note">A Lighter não cobra taxa (nem a mercado): o empate cai de ~12% para ~7% a.a. e a perna a mercado deixa de custar ~US$0,60 por operação. Agora: '+L.above+' pares acima do empate, <b>'+L.stable+' estáveis 24 h</b> (regra validada).</div>'+
      (top.length?'<div class="note">Maiores agora: '+top.map(function(p){return esc(p.coin)+' (short '+esc(p.s)+', long '+esc(p.l)+') '+pctp(p.spread,0)+' a.a., empate '+pctp(p.be,1)+', '+p.hours+' h acima'}).join(' · ')+'</div>':'')+
      (ls?'<div class="note">Robô simulado (US$1.000 por operação, 2x): '+ls.closed+' fechadas, '+ls.open+' abertas · resultado <b class="'+((ls.netUsd+ls.openNetUsd)>=0?'good':'bad')+'">'+signUsd(ls.netUsd+ls.openNetUsd)+'</b> desde '+new Date(ls.since).toLocaleDateString('pt-BR')+'.</div>':'')+
      '<div class="note">Só cripto (ações, câmbio e índices da Lighter ficam fora) e mercados com US$300 mil+ em aberto. Riscos: liquidez menor que Binance/Bybit, contrato inteligente (DEX), depósito em USDC pela rede. Sem KYC.</div></div>';}
  // 2) dólar parado rendendo
  var B=F.bfx,D=F.basis,E=F.ethena,HL=F.hlp,gap=function(x){return cdi&&isFinite(x)&&x!==null?x>=cdi-2:false};
  h+='<div class="eyebrow" style="margin:12px 0 4px">Dólar parado rendendo (capital entre operações)</div>';
  h+='<div class="trow"><div class="row between"><b>Emprestar USDT na Bitfinex</b>'+vsCdi(B&&B.netApr)+'</div><div class="note">Último empréstimo: '+pctA(B&&B.lastApr)+' · líquido da taxa de 15%: <b>'+pctA(B&&B.netApr)+'</b> · taxa média (FRR) '+pctA(B&&B.frrApr)+'. Em dias de volatilidade passa de 15–50% a.a. Risco: a própria Bitfinex.</div>'+pap('bfx')+'</div>';
  h+='<div class="trow"><div class="row between"><b>Cash-and-carry BTC (Deribit)</b>'+vsCdi(D&&D.netApr)+'</div><div class="note">Compra BTC e vende o futuro '+(D?esc(D.contract)+' ('+nf(D.days,0)+' dias)':'')+': base '+pctA(D&&D.basisApr)+', líquido <b>'+pctA(D&&D.netApr)+'</b>, travado até o vencimento. Em mercado comprado já passou de 15–25% a.a.</div>'+pap('basis')+'</div>';
  h+='<div class="trow"><div class="row between"><b>Ethena sUSDe · cofre HLP (Hyperliquid)</b>'+vsCdi(E&&E.apr30)+'</div><div class="note">sUSDe (média 30 dias): <b>'+pctA(E&&E.apr30)+'</b> · HLP: <b>'+pctA(HL&&HL.apr)+'</b>. Referência de rendimento neutro em dólar; risco de protocolo.</div>'+pap('ethena')+pap('hlp')+'</div>';
  // 3) mineração: checagem de realidade
  var Z=F.zEdge||{},HM=st.hashMkts||{},M=HM.mrr,mk=st.market||{},nh=mk.bidEH?mk.bidEH*1.03:null;
  h+='<div class="eyebrow" style="margin:12px 0 4px">Mineração: o que pagou de fato</div>'+
    '<div class="trow"><div class="row between"><b>Alugar e mandar para multipool (zpool)</b>'+chipF(Z.sha256>0||Z.scrypt>0,Z.sha256>-5||Z.scrypt>-5)+'</div><div class="note">Pago nas últimas 24 h × aluguel na NiceHash com taxa: SHA-256 <b>'+(isFinite(Z.sha256)&&Z.sha256!==null?pct(Z.sha256,1):'—')+'</b> · Scrypt <b>'+(isFinite(Z.scrypt)&&Z.scrypt!==null?pct(Z.scrypt,1):'—')+'</b>. Número real (não estimativa): é a checagem das "outras moedas".</div></div>'+
    '<div class="trow"><div class="row between"><b>Revender hash na MiningRigRentals (SHA-256 AsicBoost)</b>'+chipF(false,M&&nh&&M.lowestEH/nh>1.1)+'</div><div class="note">Aluguel lá: menor anúncio '+(M&&nh&&M.lowestEH?pct((M.lowestEH/nh-1)*100,0):'—')+' e último '+(M&&nh&&M.lastEH?pct((M.lastEH/nh-1)*100,0):'—')+' sobre a NiceHash com taxa · '+(M?nf(M.rentedPH||0,0)+' PH/s alugados, '+nf((M.availPH||0)/1000,1)+' EH/s anunciados parados':'—')+'. Se o hash entregue cair, a MRR reembolsa o locatário.</div></div>';
  var A=F.asic,G=F.gpu;
  if(A||G)h+='<div class="eyebrow" style="margin:12px 0 4px">Mineração com equipamento próprio</div>';
  if(A)h+='<div class="trow"><div class="row between"><b>ASIC de bitcoin ('+esc('S21 XP')+')</b>'+chipF(false,true)+'</div><div class="note">Hashprice '+usd(A.hashpriceUsdPh)+' por PH/s/dia · receita da máquina '+usd(A.revUsdDay)+'/dia · empata com energia a '+usd(A.breakEvenKwh,3)+'/kWh. Lucro por dia (sem a compra da máquina): '+A.rows.map(function(r){return esc(r.where)+' ('+usd(r.kwh,3)+') <b class="'+(r.profitUsdDay>=0?'good':'bad')+'">'+signUsd(r.profitUsdDay)+'</b>'}).join(' · ')+'. Não inclui o preço da máquina; varia com o preço do BTC e a dificuldade.</div></div>';
  if(G&&G.top&&G.top.length)h+='<div class="trow"><div class="row between"><b>GPU: moedas que mais pagam agora</b>'+chipF(G.top[0].usdDay>=1.5,G.top[0].usdDay>=0.8)+'</div><div class="note">Por placa de referência da WhatToMine (receita bruta/dia): '+G.top.slice(0,4).map(function(c){return esc(c.tag)+' '+usd(c.usdDay)}).join(' · ')+(G.rvnUsdDay?' (Ravencoin: '+usd(G.rvnUsdDay)+')':'')+'. Moedas novas mudam de emissão e dificuldade rápido; energia de uma placa no Brasil ~US$0,8–1/dia. Esses algoritmos não estão na NiceHash: precisa da placa.</div></div>';
  // 4) câmbio
  var R=F.brl;
  if(R)h+='<div class="eyebrow" style="margin:12px 0 4px">Câmbio para os aportes</div><div class="trow"><div class="row between"><b>Real → dólar cripto</b>'+chipF(R.usdcPremPct!==null&&R.usdcPremPct<0.3,R.usdcPremPct!==null&&R.usdcPremPct<0.8)+'</div><div class="note">Comprar no Mercado Bitcoin custa, sobre o dólar oficial (PTAX '+(R.ptax?nf(R.ptax,4):'—')+'): USDC <b>'+(R.usdcPremPct!==null?pct(R.usdcPremPct,2):'—')+'</b> · USDT <b>'+(R.usdtPremPct!==null?pct(R.usdtPremPct,2):'—')+'</b>. Não é lucro: é economia em cada aporte (escolher a moeda e a hora com menor ágio).</div></div>';
  var M2=st.market2;
  if(M2){var PR=M2.prem||{},SP=M2.spot||{},PM=M2.poly,Y=M2.yields||{},pc=function(x){return isFinite(x)&&x!==null?pct(x,2):'—'};
    h+='<div class="eyebrow" style="margin:12px 0 4px">Lastro de mercado</div>'+
      '<div class="trow"><b>Ágio local sobre o dólar</b><div class="note">Coreia (Upbit, "kimchi premium"): BTC <b>'+pc(PR.kr&&PR.kr.btcPct)+'</b> · USDT <b>'+pc(PR.kr&&PR.kr.usdtPct)+'</b> · Brasil (Mercado Bitcoin): BTC <b>'+pc(PR.br&&PR.br.btcPct)+'</b> · USDT <b>'+pc(PR.br&&PR.br.usdtPct)+'</b> · Argentina (USDT × oficial): <b>'+pc(PR.ar&&PR.ar.usdtPct)+'</b>'+(PR.ar&&isFinite(PR.ar.bluePct)?' (blue '+pc(PR.ar.bluePct)+')':'')+'. Referência: BTC na Kraken e câmbio do BCE'+(PR.fxDate?' de '+esc(PR.fxDate):'')+'.</div></div>'+
      '<div class="trow"><b>Mesmo BTC em corretoras diferentes</b><div class="note">Maior diferença em USD: <b>'+(SP.usd?pct(SP.usd.pct,2)+'</b> ('+esc(SP.usd.low)+' → '+esc(SP.usd.high)+')':'—</b>')+' · em USDT: <b>'+(SP.usdt?pct(SP.usdt.pct,2)+'</b> ('+esc(SP.usdt.low)+' → '+esc(SP.usdt.high)+')':'—</b>')+'. Ida e volta a mercado custa ~0,2% mais a transferência.</div></div>'+
      (PM?'<div class="trow"><b>Polymarket: recompensa por liquidez</b><div class="note">'+PM.markets+' dos '+(PM.total||PM.markets)+' mercados de maior volume pagam <b>'+usd(PM.dailyUsd,0)+'/dia</b> a quem deixa ordens perto do meio do livro. Maior rendimento bruto possível (recompensa ÷ liquidez no livro): '+PM.top.slice(0,3).map(function(t){return esc(t.q.slice(0,48))+' <b>'+pctp(t.aprMax,0)+' a.a.</b>'}).join(' · ')+'. Acesso restrito no Brasil (CMN 5.298/2026).</div></div>':'')+
      '<div class="trow"><b>Rendimentos de referência (DefiLlama)</b><div class="note">'+[['stEth','ETH em staking (Lido)'],['jitoSol','SOL em staking (Jito)'],['aaveUsdc','Emprestar USDC (Aave)'],['aaveUsdt','Emprestar USDT (Aave)'],['sUsds','Poupança em dólar on-chain (Sky sUSDS)']].map(function(k){var y=Y[k[0]];return esc(k[1])+' <b>'+(y?pctp(y.apy,2)+' a.a.':'—')+'</b>'}).join(' · ')+'.</div></div>';}
  h+='<p class="note" style="margin:8px 0 0">Outras frentes sem leitura ao vivo aqui (armazenamento, DePIN, banda, Lightning, Bittensor, provas ZK, launchpools, vendas de tokens, airdrops, MEV, apostas, P2P, bug bounty, afiliados e mais) estão no catálogo com os números da pesquisa.</p>'+
    (F.err&&F.err.length?'<p class="note warn" style="margin:6px 0 0">Sem leitura agora: '+esc(F.err.join(' · '))+'</p>':'')+
    '<p class="note" style="margin:6px 0 0">Atualizado '+ago(F.at)+' atrás. Valores em dólar; o "papel" de US$1.000 mostra o que cada frente teria rendido desde o início do acompanhamento.</p>';
  el.innerHTML=h;
}
function renderRadar(){
  if(!$('r_alerts'))return;
  var now=Date.now();
  var act=FDR.groupConditions((state.active||[]).filter(function(a){return !FDR.isMuted(a.key,aprefs,now)}));
  var muted=(state.active||[]).length-(state.active||[]).filter(function(a){return !FDR.isMuted(a.key,aprefs,now)}).length;
  var shown=alertsOpen?act:act.slice(0,5),histList=alerts.slice().reverse(),byDay={};
  histList.forEach(function(a){var d=dayLabel(a.t);(byDay[d]=byDay[d]||[]).push(a)});
  var canNotify='Notification' in window&&Notification.permission==='default';
  $('r_alerts').innerHTML='<div class="row between"><div class="eyebrow">Alertas</div><div class="row">'+(canNotify?'<button class="sm" id="r_notify">Avisar neste aparelho</button>':'')+(unseen()?'<button class="sm" id="r_read">Marcar como lidos</button>':'')+'</div></div>'+
    '<div class="lead">Agora: '+(act.length?plural(act.length,'item pede atenção','itens pedem atenção'):'nada pede ação')+'</div>'+
    (shown.length?'<div class="stack" style="gap:8px">'+shown.map(function(a){return alertHTML(a)}).join('')+'</div>':
      '<p class="note" style="margin:0">Aqui aparecem só condições que valem neste momento, por prioridade: saída, risco, atenção, entrada. Elas somem sozinhas quando deixam de valer.</p>')+
    (act.length>5?'<div style="margin-top:6px"><button class="sm" id="r_more">'+(alertsOpen?'Mostrar menos':'Ver todos ('+act.length+')')+'</button></div>':'')+
    (muted?'<p class="note" style="margin:6px 0 0">'+plural(muted,'item silenciado ou dispensado','itens silenciados ou dispensados')+'. <button class="sm" id="r_unmute">Mostrar de novo</button></p>':'')+
    (histList.length?'<div class="eyebrow" style="margin:12px 0 6px">Últimos alertas'+(settings.apiUrl?' (deste aparelho e do servidor, 24 h)':'')+'</div><div class="stack" style="gap:6px">'+histList.slice(0,5).map(function(a){return alertHTML(a,{history:true})}).join('')+'</div>':'')+
    '<details id="r_hist" style="margin-top:10px"><summary>Histórico (7 dias): '+histList.length+' eventos</summary>'+(histList.length?'<div style="margin:6px 0"><button class="sm" id="r_clear">Limpar histórico</button></div>':'')+
      (histList.length?Object.keys(byDay).map(function(d){return '<div class="eyebrow" style="margin:8px 0 4px">'+esc(d)+'</div><div class="stack" style="gap:6px">'+byDay[d].slice(0,20).map(function(a){return alertHTML(a,{history:true})}).join('')+'</div>'}).join(''):'<p class="note">Sem eventos.</p>')+'</details>'+
    (function(){var sc=ops.status&&ops.status.state&&ops.status.state.alertScore;if(!sc)return '';var m=sc.summary;
      return '<div class="box" style="margin-top:10px"><b>Placar dos alertas de funding</b>'+(m.scored?m.hits+' de '+m.scored+' alertas terminaram no positivo depois das taxas; realizado '+signUsd(m.realUsd)+' contra '+signUsd(m.projUsd)+' projetado.':m.open+' alerta'+(m.open===1?'':'s')+' em acompanhamento; os resultados saem 3 dias depois de cada alerta.')+
        ' <button class="sm" data-go="diary:robo" data-focus="#rb_score">Ver placar</button></div>'})()+
    '<p class="note" style="margin:8px 0 0">'+(settings.apiUrl?(ops.status?'O histórico inclui os alertas do servidor, que roda 24 h e avisa no Telegram: é igual em todos os aparelhos conectados.':'Conectando ao servidor para trazer os alertas dele…'):'Sem backend, os alertas só são calculados com o painel aberto. Com o backend ligado, eles rodam 24 h e aparecem iguais em todos os aparelhos.')+'</p>';
  var sent=state.live?FDR.sentiment(state.rows,VENUES):null;
  $('r_sent').innerHTML=sent?'<span class="chip '+sent.cls+'">'+sent.label+'</span>':'';
  $('r_senttxt').textContent=sent?'Funding médio de BTC, ETH e SOL: '+pct(sent.avg,1)+' ao ano (o normal é ~11%). '+sent.text:(state.live?'':'Sem dados ao vivo de funding agora.');
  var fr=state.rows;
  if(settings.cryptoOnly!==false){fr={};Object.keys(state.rows).forEach(function(c){if(!state.kinds[c])fr[c]=state.rows[c]})}
  var mx=state.live?FDR.fundingMatrix(fr,VENUES,{extra:8,minVol:num('minvol')*1e6}):[];
  $('r_fmap').innerHTML=mx.length?'<colgroup><col style="width:58px">'+VENUES.map(function(){return '<col>'}).join('')+'</colgroup><tr><th></th>'+VENUES.map(function(v){return '<th>'+VABBR[v]+'</th>'}).join('')+'</tr>'+
    mx.map(function(r){return '<tr data-coin="'+esc(r.coin)+'"'+(radarSel===r.coin?' class="sel"':'')+'><td>'+esc(r.coin)+(r.major?'':' <span class="note">↕</span>')+'</td>'+r.cells.map(function(c){
      return c?'<td style="background:'+heatBg(c.apr)+'" title="'+esc(c.venue)+': '+pct(c.apr,1)+' a.a., paga a cada '+c.hours+' h">'+fmtApr(c.apr)+'</td>':'<td class="note">—</td>'}).join('')+'</tr>'}).join('')
    :'<tr><td class="note">Carregando funding das exchanges…</td></tr>';
  var sel=mx.filter(function(r){return r.coin===radarSel})[0];
  $('r_fsel').innerHTML=sel&&sel.hi&&sel.lo&&sel.hi!==sel.lo?'<b>'+esc(sel.coin)+'</b>: maior em '+sel.hi.venue+' ('+pct(sel.hi.apr,1)+' a.a.), menor em '+sel.lo.venue+' ('+pct(sel.lo.apr,1)+'). Diferença de '+nf(sel.spread,1)+' pontos ao ano: short na '+sel.hi.venue+', long na '+sel.lo.venue+'. <button class="sm" data-go="fund">Ver a conta no Funding</button>'
    :'Toque numa moeda para ver o melhor par. Linhas com ↕ são as de maior diferença entre exchanges agora (fora os majors).';
  var mm=market.map;
  $('r_mmap').innerHTML=mm&&mm.length?mm.map(function(m){
    return '<div class="coinrow"><div class="row between"><b>'+esc(m.label)+'</b>'+chip(m.level)+'</div>'+
      '<div>Melhor opção: <b>'+esc(m.coins.join(' + '))+'</b>'+(m.merged?' (mineradas juntas)':'')+'</div>'+
      (m.edgePct!==null?'<div>Rende <b>'+usd(m.revUsdPerUnit)+'</b> por '+m.unit+'/s ao dia · aluguel '+usd(m.rentUsdPerUnit)+' → <b class="'+(m.edgePct>=0?'good':'bad')+'">'+pct(m.edgePct,1)+'</b> (realista)</div>'+rawTxt(m):'<div class="note">Sem preço de aluguel desse algoritmo agora.</div>')+
      (m.thin?'<div class="note warn">'+thinTxt(m)+'</div>':'')+
      '<div class="note">'+esc(m.where)+(m.small.length?' · redes pequenas que rendem mais por hash, mas com pouca liquidez (o hash alugado derruba a dificuldade): '+esc(m.small.join(', ')):'')+'</div></div>'}).join('')+
    '<p class="note" style="margin:8px 0 0">Fonte: WhatToMine e NiceHash ('+esc(market.src||'')+(market.dataAt?', '+ago(market.dataAt)+' atrás':'')+'). Solo: a variação depende de quanto da rede você aluga.</p>'
    :'<p class="note">'+(market.err?'Mapa indisponível ('+esc(market.err)+'). Com o backend ligado, ele é lido em tempo real.':'Carregando mapa de mineração…')+'</p>';
  // padrões por hora: histórico local + histórico do servidor
  var h=hist.slice(),eh=ops.status&&ops.status.state&&ops.status.state.edgeHist||[];
  eh.forEach(function(x){h.push({t:x[0],edges:{BCH:x[1]}})});
  var prof=FDR.hourProfile(h,'BCH',-new Date().getTimezoneOffset()),filled=prof.filter(function(x){return x.avg!==null});
  $('r_hours').innerHTML='<div class="hours">'+prof.map(function(x){
    var c=x.avg===null?'var(--panel2)':(x.avg>=0?'rgba(79,210,138,'+Math.min(.85,.25+x.avg/10).toFixed(2)+')':'rgba(242,103,90,'+Math.min(.85,.2+Math.abs(x.avg)/15).toFixed(2)+')');
    return '<div style="background:'+c+'" title="'+x.h+'h: '+(x.avg===null?'sem dado':pct(x.avg,1)+' ('+x.n+' leituras)')+'"></div>'}).join('')+'</div>'+
    '<div class="hours-l"><span>0h</span><span>3h</span><span>6h</span><span>9h</span><span>12h</span><span>15h</span><span>18h</span><span>21h</span></div>';
  if(filled.length>=6){var b=filled.slice().sort(function(a,c){return c.avg-a.avg});
    $('r_hnote').textContent='Margem média por hora (seu fuso), com '+h.filter(function(x){return x.edges&&isFinite(x.edges.BCH)}).length+' leituras. Melhor: '+b[0].h+'h ('+pct(b[0].avg,1)+'); pior: '+b[b.length-1].h+'h ('+pct(b[b.length-1].avg,1)+'). Verde = o aluguel ficou abaixo da receita.'}
  else $('r_hnote').textContent='Juntando dados: o padrão aparece depois de algumas horas com o painel aberto ou com o backend ligado (ele registra a cada 15 min).';
  $('plSeg').innerHTML=Object.keys(FDR.PLAYER_CATS).map(function(k){return '<button class="sm" data-pl="'+k+'" aria-pressed="'+(k===plCat)+'">'+({funding:'Funding',hash:'Comprar hash',pool:'Pools solo',dados:'Dados'})[k]+'</button>'}).join('');
  $('r_players').innerHTML='<div class="note" style="margin-bottom:4px">'+esc(FDR.PLAYER_CATS[plCat])+'</div>'+FDR.PLAYERS.filter(function(p){return p.cat===plCat}).map(function(p){
    return '<div class="player"><div class="row between"><a href="'+esc(p.url)+'" target="_blank" rel="noopener"><b>'+esc(p.name)+'</b></a>'+(p.panel?'<span class="chip ok">no painel</span>':'<span class="chip">API: '+esc(p.api)+'</span>')+'</div>'+
      '<span class="note">'+esc(p.what)+(p.note?' ('+esc(p.note)+')':'')+'</span></div>'}).join('');
}
document.addEventListener('click',function(e){
  var tr=e.target.closest('#r_fmap tr[data-coin]');if(tr){radarSel=tr.dataset.coin;renderRadar();return}
  var pl=e.target.closest('[data-pl]');if(pl){plCat=pl.dataset.pl;renderRadar();return}
  if(e.target.id==='r_notify'){try{Notification.requestPermission().then(function(){renderRadar()})}catch(err){}}
  var rm=e.target.closest('[data-rmalert]');if(rm){alerts=alerts.filter(function(a){return a.id!==rm.dataset.rmalert});ls('fd_alerts',alerts);renderRadar();renderBadge();return}
  if(e.target.id==='r_clear'&&confirm('Limpar o histórico de alertas deste aparelho?')){alerts=[];ls('fd_alerts',alerts);renderRadar();renderBadge();return}
  if(e.target.id==='r_read'){ls('fd_aseen',Date.now());renderBadge();renderRadar()}
  if(e.target.id==='r_more'){alertsOpen=!alertsOpen;renderRadar()}
  if(e.target.id==='r_unmute'){aprefs={snooze:{},dismissed:{}};ls('fd_aprefs',aprefs);renderRadar();renderBadge()}
  var dm=e.target.closest('[data-dismiss]');if(dm){aprefs.dismissed=aprefs.dismissed||{};aprefs.dismissed[dm.dataset.dismiss]=Date.now();ls('fd_aprefs',aprefs);renderRadar();renderBadge()}
  var sz=e.target.closest('[data-snooze]');if(sz){aprefs.snooze=aprefs.snooze||{};aprefs.snooze[sz.dataset.snooze]=Date.now()+864e5;ls('fd_aprefs',aprefs);renderRadar();renderBadge()}
});

/* ---------- mineração: outros algoritmos ---------- */
function renderAlgos(){
  if(!$('m_algos'))return;
  var mm=market.map||[],L=live(),budget=num('iv_sess')||300,now=Date.now();
  if(!mm.length){$('m_algos').innerHTML='<div class="card note">'+(market.err?'Mapa indisponível ('+esc(market.err)+').':'Carregando os algoritmos…')+'</div>';return}
  $('m_algos').innerHTML=mm.map(function(m){
    var foc=focusAlgo===m.label,key='me:'+m.label,act=since[key];
    var pools=(FDR.POOLS[m.algo]||[]).map(function(p){return '<a href="'+esc(p[1])+'" target="_blank" rel="noopener">'+esc(p[0])+'</a>'}).join(' · ');
    var exp=m.edgePct!==null?budget*m.edgePct/100:null;
    return '<div class="card sig '+({go:'favoravel',maybe:'neutro',no:'desfavoravel'}[m.level]||'')+'" id="algo-'+esc(m.label)+'"'+(foc?' style="outline:2px solid var(--accent)"':'')+'>'+
      '<div class="row between"><b>'+esc(m.label)+'</b>'+chip(m.level)+'</div>'+
      '<div class="why">Melhor opção: <b>'+esc(m.coins.join(' + '))+'</b>'+(m.merged?' (mineradas juntas)':'')+'</div>'+
      (m.edgePct!==null?'<div>Rende <b>'+usd(m.revUsdPerUnit)+'</b> por '+m.unit+'/s ao dia · aluguel '+usd(m.rentUsdPerUnit)+' → <b class="'+(m.edgePct>=0?'good':'bad')+'">'+pct(m.edgePct,1)+'</b> (realista)</div>'+rawTxt(m):'<div class="note">Sem preço de aluguel desse algoritmo agora.</div>')+
      (act?'<p class="note good" style="margin:4px 0 0">Compensa há '+ago(act)+' (desde '+hhmm(act)+').</p>':'')+
      (m.thin?'<p class="note warn" style="margin:4px 0 0">'+thinTxt(m)+'</p>':'')+
      '<details'+(foc||m.level==='go'?' open':'')+' style="margin-top:8px"><summary>Como minerar (manual)</summary><ol class="rules note" style="margin-top:6px">'+
        '<li>Na NiceHash, <a href="https://www.nicehash.com/my/marketplace" target="_blank" rel="noopener">mercado de hashpower</a> → algoritmo <b>'+esc(m.algo)+'</b>.</li>'+
        '<li>Cadastre o pool da moeda (aceite de NiceHash conferido no site do pool): '+(pools||'pool da moeda com porta para NiceHash')+'. Usuário = sua carteira '+esc(m.coins[0])+'.</li>'+
        (m.capBtcPerUnit?'<li>Preço máximo (teto, com sua margem de '+nf(minEdge(),0)+'%): <b>'+m.capBtcPerUnit.toFixed(6)+' BTC por '+m.unit+'/s por dia</b>'+(m.fillBtcPerUnit?' (hoje o menor preço recebendo hash é '+m.fillBtcPerUnit.toFixed(6)+')':'')+'. Acima disso não compensa.</li>':'')+
        (exp!==null?'<li>Com '+usd(budget,0)+' (orçamento por sessão do Planejar), o resultado esperado em pool é <b class="'+(exp>=0?'good':'bad')+'">'+usd(exp)+'</b> (projeção, com pouca variação). Em solo, seria tudo ou nada.</li>':'')+
        '<li>Acompanhe pelo Radar: o alerta de saída avisa quando deixar de compensar. Cancele a ordem nessa hora.</li>'+
      '</ol><p class="note" style="margin:6px 0 0">O robô automático ainda não opera este algoritmo: a ordem é sua, na NiceHash.</p></details>'+
      (m.small&&m.small.length?'<p class="note" style="margin:6px 0 0">Redes pequenas com mais rendimento por hash, mas pouca liquidez: '+esc(m.small.join(', '))+'.</p>':'')+'</div>';
  }).join('')+'<p class="note">Fonte: WhatToMine e NiceHash ('+esc(market.src||'')+(market.dataAt?', '+ago(market.dataAt)+' atrás':'')+').</p>';
}

/* ---------- navegação ---------- */
var TABS=['home','radar','fund','mine','diary','set'];
function tab(t,sub){
  TABS.forEach(function(x){$('tab-'+x).hidden=x!==t});
  document.querySelectorAll('nav button').forEach(function(b){b.setAttribute('aria-current',b.dataset.tab===t?'true':'false')});
  if(sub)subTab(t,sub);
  settings.tab=t;ls('fd_set',settings);
  if(t==='radar'){if(settings.apiUrl&&Date.now()-(ops.at||0)>60000)loadOps();renderRadar();ls('fd_aseen',Date.now());renderBadge();loadMarketMap()}
  if((t==='mine'||t==='home')&&(!mine.at||Date.now()-mine.at>300000))loadMining();
  if(settings.apiUrl&&Date.now()-(ops.at||0)>60000)loadOps();
  window.scrollTo(0,0);
}
var SUBS={fund:['fundSeg',['scan','journey','calc']],mine:['mineSeg',['now','journey','plan','algos','ops','net']],diary:['diarySeg',['pos','mine','robo']]};
function subTab(t,sub){
  var cfg=SUBS[t];
  if(t==='mine'&&sub==='algos'){loadMarketMap();renderAlgos()}
  if(t==='mine'&&sub==='ops')loadOps();
  if(t==='mine'&&sub==='net'){loadBlocksLog();renderHeat();renderNext()}
  if(t==='mine'&&sub==='now'){renderWindow();renderEntry()}
  if(t==='diary'&&sub==='robo'){renderRobo();if(settings.apiUrl&&Date.now()-(ops.at||0)>60000)loadOps()}
  cfg[1].forEach(function(x){$(t+'-'+x).hidden=x!==sub});
  document.querySelectorAll('#'+cfg[0]+' button').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.sub===sub?'true':'false')});
}
Object.keys(SUBS).forEach(function(t){document.querySelectorAll('#'+SUBS[t][0]+' button').forEach(function(b){b.addEventListener('click',function(){subTab(t,b.dataset.sub)})})});
document.querySelectorAll('nav button').forEach(function(b){b.addEventListener('click',function(){tab(b.dataset.tab)})});
document.addEventListener('click',function(e){var b=e.target.closest('[data-go]');if(!b)return;var g=b.dataset.go.split(':');
  if(b.dataset.setmode){setMode(b.dataset.setmode);renderScan()}
  var fo=b.dataset.focus;
  if(fo&&fo[0]==='#')setTimeout(function(){var el=document.getElementById(fo.slice(1));if(el){if(el.tagName==='DETAILS')el.open=true;el.scrollIntoView({block:'start'})}},60);
  else if(fo){focusAlgo=fo;setTimeout(function(){var el=document.getElementById('algo-'+focusAlgo);if(el){el.scrollIntoView({block:'start'})}},60)}
  tab(g[0],g[1]||(g[0]==='fund'?'scan':g[0]==='mine'?'now':undefined))});
function setMode(m){
  state.mode=m;settings.mode=m;ls('fd_set',settings);
  document.querySelectorAll('#modeSeg button').forEach(function(x){x.setAttribute('aria-pressed',x.dataset.mode===m?'true':'false')});
}

/* ---------- eventos ---------- */
document.querySelectorAll('#modeSeg button').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.mode);renderScan();renderHome()})});
SCAN_INPUTS.forEach(function(id){$(id).addEventListener('input',function(){saveSettings();renderScan();renderHome()})});
$('f_crypto').addEventListener('change',function(){settings.cryptoOnly=this.checked;ls('fd_set',settings);renderScan();renderHome();renderRadar()});
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
$('p_list').addEventListener('click',function(e){
  var b=e.target.closest('[data-usehist]');if(!b)return;
  var p=pos.filter(function(x){return x.id===b.dataset.usehist})[0],h=posHist[b.dataset.usehist];
  if(p&&h&&h.usd!==null){p.funding=Math.round(h.usd*100)/100;savePos();renderPositions()}
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

/* ---------- eventos: investimento e operação ---------- */
['iv_total','iv_sess','iv_edge','iv_stop'].forEach(function(id){$(id).addEventListener('input',function(){saveSettings();renderInvest()})});
document.querySelectorAll('#invSeg button').forEach(function(b){b.addEventListener('click',function(){
  invScenario=b.dataset.sc;document.querySelectorAll('#invSeg button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});renderInvest()})});
// Link de conexão gerado pela instalação: #api=<endereço>&tok=<token>. Pede confirmação e some da barra de endereço.
// Aceita o link inteiro ou só o trecho depois do #. Devolve null se não for link de conexão.
function parseConnect(str){
  str=String(str||'').trim();var i=str.indexOf('#'),h=i>=0?str.slice(i+1):str;
  if(!/(^|&)tok=/.test(h))return null;
  var q=new URLSearchParams(h),u=(q.get('api')||'').trim().replace(/\/+$/,''),t=(q.get('tok')||'').trim();
  return /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?$/i.test(u)&&t.length>=24?{u:u,t:t}:{error:'Link de conexão inválido.'};
}
// No iPhone, o atalho da tela de início tem memória separada do Safari: o link aberto no Safari não conecta o atalho.
var STANDALONE=navigator.standalone===true||!!(window.matchMedia&&matchMedia('(display-mode: standalone)').matches);
var linkConnect=(function(){
  var c=parseConnect(location.hash);if(!c)return null;
  try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}
  if(c.error)return c;
  if(!confirm('Conectar este painel ao backend '+c.u.replace(/^https?:\/\//,'')+'? Só aceite se foi você quem pediu este link.'))return {error:'Conexão cancelada.'};
  settings.apiUrl=c.u;ls('fd_set',settings);ls('fd_tok',c.t);return {ok:true};
})();
$('setup').open=!settings.apiUrl;
if(STANDALONE&&!settings.apiUrl&&!linkConnect)opsMsg('api_msg','Este atalho do iPhone tem memória separada do Safari: copie o link de conexão e toque em "Colar link de conexão".');
$('api_url').value=settings.apiUrl||'';
if(ls('fd_tok'))$('api_token').placeholder='token salvo neste aparelho';
function useConnect(c){
  settings.apiUrl=c.u;ls('fd_set',settings);ls('fd_tok',c.t);
  $('api_url').value=c.u;$('api_token').value='';$('api_token').placeholder='token salvo neste aparelho';
  testBackend(true);
}
function pasteConnect(msgId){
  var manual='Não consegui ler o que foi copiado. Em Ajustes → Backend, toque e segure no campo "Endereço do backend", cole o link inteiro e toque em Salvar e testar.';
  if(!navigator.clipboard||!navigator.clipboard.readText){opsMsg(msgId,manual,true);return}
  navigator.clipboard.readText().then(function(txt){
    var c=parseConnect(txt);
    if(!c){opsMsg(msgId,'O que está copiado não é o link de conexão. Copie o link inteiro (começa com https://sr-geovani.github.io/funding-desk/#api=) e tente de novo.',true);return}
    if(c.error){opsMsg(msgId,c.error,true);return}
    useConnect(c);
  },function(){opsMsg(msgId,manual,true)});
}
$('api_paste').addEventListener('click',function(){pasteConnect('api_msg')});
$('h_paste').addEventListener('click',function(){pasteConnect('h_link_msg')});
$('api_save').addEventListener('click',function(){
  var c=parseConnect($('api_url').value);
  if(c&&c.error){opsMsg('api_msg',c.error,true);return}
  if(c){useConnect(c);return}
  var nu=$('api_url').value.trim().replace(/\/+$/,'');
  if(nu&&!/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?$/i.test(nu)){opsMsg('api_msg','Endereço inválido. Cole o link de conexão inteiro ou um endereço https://… do backend.',true);return}
  settings.apiUrl=nu;ls('fd_set',settings);
  if($('api_token').value)ls('fd_tok',$('api_token').value.trim());
  $('api_token').value='';$('api_token').placeholder=ls('fd_tok')?'token salvo neste aparelho':'';
  if(!settings.apiUrl){opsMsg('api_msg','Endereço vazio: backend desligado.');renderOps();return}
  testBackend(false);
});
function testBackend(fromLink){
  opsMsg('api_msg','Testando…');opsMsg('h_link_msg','Conectando…');
  apiCall('GET','/status').then(function(st){
    if(!st||!st.config)throw new Error('resposta inesperada do backend');
    opsMsg('h_link_msg','Conectado. Tudo o que aparece no site agora aparece aqui.');$('h_link').hidden=true;
    opsMsg('api_msg','Conectado'+(fromLink?' pelo link':'')+'. NiceHash: '+st.nhEnv+' · chaves '+(st.keys?'ok':'faltando')+' · Telegram '+(st.telegram?'ok':'—')+' · robô '+MODE_TXT[st.config.mode]+'.');cache={};loadOps();loadMining()},function(e){opsMsg('api_msg','Falhou: '+e.message,true);opsMsg('h_link_msg','Falhou: '+e.message,true)});
}
/* ---------- conectar contas (chaves vão direto para o backend, cifradas lá; nada fica no painel) ---------- */
function acctBusy(id,on){$(id).disabled=on}
$('ac_env').addEventListener('change',function(){$('ac_env').dataset.touched='1'});
$('ac_nh_save').addEventListener('click',function(){
  var env=$('ac_env').value,body={nicehash:{env:env,key:$('ac_key').value.trim(),secret:$('ac_secret').value.trim(),org:$('ac_org').value.trim()}};
  if(!body.nicehash.key||!body.nicehash.secret||!body.nicehash.org){opsMsg('ac_nh_msg','Preencha API Key, API Secret e Organization ID.',true);return}
  if(env==='prod'&&!confirm('Conta real (nicehash.com). O robô fica em Observar, sem comprar nada, até você ativar. Continuar?'))return;
  acctBusy('ac_nh_save',true);opsMsg('ac_nh_msg','Conferindo com a NiceHash…');
  apiCall('PUT','/credentials',body).then(function(r){
    $('ac_key').value='';$('ac_secret').value='';$('ac_org').value='';
    opsMsg('ac_nh_msg','Conectada ('+(r.nicehash.env==='prod'?'produção':'teste')+', chave '+r.nicehash.key+'). Saldo: '+(r.balanceBtc!=null?r.balanceBtc+' BTC':'—')+'. Próximo passo: Mineração → Operar, com o robô em Observar.');
    loadOps();
  },function(e){if(e.data&&e.data.suggestEnv){$('ac_env').value=e.data.suggestEnv;$('ac_env').dataset.touched='1'}opsMsg('ac_nh_msg',e.message,true)}).then(function(){acctBusy('ac_nh_save',false)});
});
$('ac_nh_del').addEventListener('click',function(){
  if(!confirm('Desconectar a NiceHash? As chaves salvas pelo painel são apagadas do backend e o robô volta para Observar.'))return;
  apiCall('PUT','/credentials',{remove:'nicehash'}).then(function(r){opsMsg('ac_nh_msg',r.nicehash.set?'Chaves do painel apagadas; o backend ainda tem chaves cadastradas direto no Cloudflare.':'NiceHash desconectada.');loadOps()},function(e){opsMsg('ac_nh_msg',e.message,true)});
});
$('ac_tg_go').addEventListener('click',function(){
  var tok=$('ac_tgtok').value.trim();
  acctBusy('ac_tg_go',true);opsMsg('ac_tg_msg','Conectando…');
  apiCall('POST','/telegram',tok?{token:tok}:{}).then(function(r){
    $('ac_tgtok').value='';
    if(r.connected){opsMsg('ac_tg_msg','Pronto: mandei uma mensagem de teste para '+(r.chatName||'você')+' pelo @'+r.bot+'.');loadOps();return}
    $('ac_tg_msg').className='note';
    $('ac_tg_msg').innerHTML='Token ok. Agora abra '+(r.link?'<a href="'+esc(r.link)+'" target="_blank" rel="noopener">@'+esc(r.bot)+'</a>':'o seu bot')+', toque em <b>Iniciar</b> (ou mande "oi") e volte aqui para tocar em <b>Conectar</b> de novo.';
  },function(e){opsMsg('ac_tg_msg',e.message,true)}).then(function(){acctBusy('ac_tg_go',false)});
});
$('ac_tg_del').addEventListener('click',function(){
  if(!confirm('Desconectar o Telegram? Os alertas param de chegar no celular.'))return;
  apiCall('PUT','/credentials',{remove:'telegram'}).then(function(){opsMsg('ac_tg_msg','Telegram desconectado.');loadOps()},function(e){opsMsg('ac_tg_msg',e.message,true)});
});
$('api_clear').addEventListener('click',function(){try{localStorage.removeItem('fd_tok')}catch(e){}$('api_token').placeholder='';opsMsg('api_msg','Token apagado deste aparelho.')});
$('o_refresh').addEventListener('click',loadOps);
document.addEventListener('click',function(e){if(e.target&&e.target.id==='o_paper_reset'){if(!confirm('Zerar a simulação e começar a contar de agora?'))return;
  apiCall('POST','/paper/reset').then(function(){loadOps()},function(err){alert('Erro: '+err.message)})}});
BOT_FIELDS.forEach(function(k){$('b_'+k).addEventListener('input',function(){ops.dirty=true})});
$('b_save').addEventListener('click',function(){
  var f=botForm();
  if(f.mode==='active'&&ops.status&&ops.status.config.mode!=='active'&&!confirm('Ativar o robô? Ele vai alterar e cancelar as ordens marcadas como "robô gerencia" na NiceHash ('+(ops.status?ops.status.nhEnv:'')+').'))return;
  // confere no painel antes de enviar e traduz qualquer erro do servidor para o nome do campo e a faixa aceita
  var NAMES={minEdgePct:['Margem mínima',-50,100],relFloorPct:['Piso da regra relativa',-10,20],bidPremiumPct:['Lance acima do menor',0,50],targetPh:['Potência alvo',0,null],minPh:['Potência de pausa',0,null],
    sessionBudgetUsd:['Stop-loss por tentativa',0,null],stopCooldownH:['Espera após stop-loss',0,72],dailyBudgetUsd:['Limite diário',0,null],weeklyLossUsd:['Perda máxima em 7 dias',0,null],poolFeePct:['Taxa do pool',0,20],rentFeePct:['Taxa do aluguel',0,20],
    sniperDiffDropPct:['Gatilho da dificuldade',0.1,50],sniperFeeX:['Gatilho da mempool',1,100],sniperAgeMin:['Atraso do bloco',5,120],sniperMinEdge:['Margem mínima do tiro',-20,20],sniperPh:['Potência do tiro',1,null],sniperIdlePh:['Potência de espera',0,null],sniperShotMin:['Prazo do tiro',1,60]};
  var bad=Object.keys(NAMES).filter(function(k){var v=f[k],L=NAMES[k];return v!==undefined&&(!isFinite(v)||v<L[1]||(L[2]!==null&&v>L[2]))});
  if(bad.length){opsMsg('b_msg',bad.map(function(k){var L=NAMES[k];return L[0]+': use um valor '+(L[2]===null?'a partir de '+String(L[1]).replace('.',','):'entre '+String(L[1]).replace('.',',')+' e '+String(L[2]).replace('.',','))}).join('; ')+'.',true);return}
  var friendly=function(m){return String(m).replace(/([a-zA-Z]+) fora de (-?[\d.]+)\.\.(-?[\d.]+)/g,function(_,k,a,b){var L=NAMES[k];return (L?L[0]:k)+': use um valor entre '+a.replace('.',',')+' e '+b.replace('.',',')})};
  apiCall('PUT','/config',f).then(function(){ops.dirty=false;opsMsg('b_msg','Robô salvo.');loadOps()},function(e){opsMsg('b_msg','Não salvou: '+friendly(e.message),true)});
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
  var warn=m&&m.capEH&&b.priceEH>m.capEH?'\n\nATENÇÃO: preço acima do teto ('+m.capEH.toFixed(4).replace('.',',')+'): valor esperado negativo.':'';
  if(!confirm('Criar ordem na NiceHash ('+(ops.status?ops.status.nhEnv:'')+')?\n'+b.priceEH+' BTC/EH/dia · '+b.limitPH+' PH/s · '+b.amountBtc+' BTC'+warn))return;
  apiCall('POST','/orders',b).then(function(){loadOps()},function(e){alert('Erro: '+e.message)});
});
// Conferir se o pool aceita hash da Braiins Hashpower (o servidor abre o Stratum e lê o extranonce2_size; não envia login).
$('pl_check').addEventListener('click',function(){
  var host=$('pl_host').value.trim(),port=+$('pl_port').value||3333,m=$('pl_check_msg');
  if(!settings.apiUrl){m.textContent='Precisa do backend conectado.';return}
  m.textContent='Conferindo '+host+':'+port+'…';
  apiCall('POST','/pool/check',{host:host,port:port}).then(function(r){
    if(!r.ok){m.innerHTML='<span class="bad">Não deu para conferir: '+esc(r.error||'erro')+'</span>';return}
    m.innerHTML=r.braiins?'<span class="good">Compatível com a Braiins</span>: extranonce2 = '+r.extranonce2Size+' (precisa de 7 ou mais). Dá para usar este pool com hash da Braiins Hashpower.'
      :'<span class="bad">Não compatível com a Braiins</span>: extranonce2 = '+r.extranonce2Size+' (precisa de 7 ou mais). Com a Braiins seria preciso outro pool de BCH; na NiceHash este pool funciona.';
  },function(e){m.innerHTML='<span class="bad">'+esc(e.message)+'</span>'});
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
tickClock();setInterval(tickClock,20000);
// iPhone (atalho na tela de início): ao voltar do segundo plano ou depois de muito tempo aberto, a barra fixa de baixo
// às vezes fica "flutuando". Reancora pela área visível real (visualViewport) e força o recálculo do layout.
(function(){
  var nav=document.querySelector('nav'),vv=window.visualViewport;if(!nav)return;
  // a posição da barra agora é feita por um único mecanismo (mais abaixo); aqui fica só a atualização dos dados ao voltar
  nav.style.transform='';
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')freshen()});
  window.addEventListener('pageshow',function(){freshen()});window.addEventListener('focus',function(){freshen()});
})();
load();loadMining();if(settings.apiUrl)loadOps();
renderAcct();
if(linkConnect){tab('set');opsMsg('api_msg',linkConnect.ok?'Backend conectado pelo link. Agora conecte NiceHash e Telegram logo abaixo.':linkConnect.error,!linkConnect.ok);
  if(linkConnect.ok)setTimeout(function(){$('ac_nh').open=true;$('acct').scrollIntoView({block:'start'})},80)}
if('serviceWorker' in navigator&&/^https?:/.test(location.protocol))navigator.serviceWorker.register('sw.js').catch(function(){});

// Barra inferior sempre colada no fim da parte visível da tela. No iOS, depois de o teclado abrir e fechar, os
// elementos fixos podem ficar fora do lugar. A barra é posicionada pelo topo, a partir da área visível
// (visualViewport: offsetTop + altura − altura da barra), sem depender da altura do documento. Com o teclado aberto,
// ela some para não cobrir o campo. Sem visualViewport, fica o CSS (bottom: 0).
(function(){var vv=window.visualViewport,nav=document.querySelector('nav');if(!vv||!nav)return;
  // Instalado na tela inicial (modo app) e sem teclado, a área visível é a tela inteira: usa a altura da tela, que não
  // muda quando o iOS informa uma altura errada ao voltar do segundo plano. No navegador, usa a área visível.
  var app=window.navigator.standalone===true||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches);
  function screenH(){var land=window.matchMedia&&matchMedia('(orientation: landscape)').matches;return land?Math.min(screen.width,screen.height):Math.max(screen.width,screen.height)}
  var lastY=null,navH=0,raf=0;
  function fix(){raf=0;if(document.body.classList.contains('kbd'))return;
    if(!navH)navH=nav.offsetHeight;
    var h=app?Math.max(screenH(),vv.offsetTop+vv.height):vv.offsetTop+vv.height,y=Math.round(h-navH);
    if(y===lastY)return;lastY=y;
    if(y>0){nav.style.top=y+'px';nav.style.bottom='auto'}else{nav.style.top='';nav.style.bottom=''}}
  function sched(){if(!raf)raf=requestAnimationFrame(fix)}
  function burst(){navH=0;lastY=null;[0,60,250,600,1200,2500].forEach(function(t){setTimeout(sched,t)})}
  function isField(el){return el&&(/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))&&!/^(checkbox|radio|button|submit)$/i.test(el.type||'')}
  document.addEventListener('focusin',function(e){if(isField(e.target))document.body.classList.add('kbd')});
  document.addEventListener('focusout',function(){setTimeout(function(){if(!isField(document.activeElement)){document.body.classList.remove('kbd');window.scrollTo(window.scrollX,window.scrollY);burst()}},150)});
  vv.addEventListener('resize',function(){navH=0;sched()});vv.addEventListener('scroll',sched,{passive:true});window.addEventListener('resize',function(){navH=0;sched()});
  window.addEventListener('pageshow',burst);window.addEventListener('focus',burst);window.addEventListener('orientationchange',burst);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)burst()});
  burst();})();
})();
