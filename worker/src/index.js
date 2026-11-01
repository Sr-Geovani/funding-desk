// Funding Desk — backend (Cloudflare Worker).
// - Rotas públicas /binance, /bybit, /nicehash: proxy só de leitura de dados de mercado.
// - Rotas /api/*: exigem o token do painel. As chaves da NiceHash e do Telegram são cadastradas pelo painel
//   e guardadas cifradas no KV (ENC_KEY), ou como segredos do Worker. Nunca voltam para o painel.
// - Agendamento (cron): robô de mineração. Começa em modo "observe" (só registra o que faria).
import { createClient, NH_HOSTS, DEFAULT_ALGO } from './nicehash.js';
import { createChain, paidTo, DEFAULT_BCH_REST, DEFAULT_PRICE_URL } from './chain.js';
import { DEFAULT_CONFIG, sanitizeConfig, parseBook, computeMarket, decide, limitsFromEnv } from './bot.js';
import { fundingSnapshot, runAlerts } from './alerts.js';
import { paperStep, realStep } from './paper.js';
import { fundPaperStep, fundPaperSummary, alertScoreStep, alertScoreSummary } from './paperfund.js';
import FD from '../../core.js';
import FDR from '../../radar.js';
import { algoPaperStep } from './paperalgo.js';
import { braiinsOf, mrrOf, stratumCheck } from './hashmarkets.js';
import { macroOf, marketPanorama } from './panorama.js';
import { entryChecklist } from './entry.js';
import { bestScenarios } from './replay.js';
import { bitfinexOf, deribitBasisOf, ethenaOf, hlpOf, zpoolOf, brlOf, cdiOf, lighterTable, lighterRows, lighterOi, lighterPairs, streakStep, frontsPaperStep, asicOf, gpuOf, premiumsOf, spotSpreadOf, polymarketOf, llamaOf, LLAMA_POOLS, LT_FEES } from './fronts.js';
import { FUND_MODEL } from './fundmodel.js';
import { updateHistory, pickCoins, scorePairs, stablePairs, pairStatsOf } from './fundai.js';
import { blockRecord, blockSummary, poolOf, luckBoard } from './blocks.js';
import { darrOf, retargetOf, momentumOf, windowMeter, weekAdd } from './signals.js';
import { brainStep, analysis, levelOf, TYPES, actionPlan } from './brain.js';
import FDI from '../../insights.js';
import { withCreds, reloadCreds, saveCreds, credStatus, parseNiceHash, TG_TOKEN_RE, chatFromUpdates } from './creds.js';

export const VERSION = '1.0.0';
const UPSTREAM = { binance: 'https://fapi.binance.com', bybit: 'https://api.bybit.com', nicehash: 'https://api2.nicehash.com', wtm: 'https://whattomine.com' };
const ALLOW = {
  binance: /^\/fapi\/v1\/(premiumIndex|ticker\/24hr|fundingInfo|fundingRate|exchangeInfo)$/,
  bybit: /^\/v5\/market\/(tickers|instruments-info|funding\/history)$/,
  nicehash: /^\/main\/api\/v2\/(hashpower\/orderBook|public\/stats\/global\/current|mining\/algorithms)$/,
  wtm: /^\/(asic|coins)\.json$/
};
const LOG_MAX = 300;

/* ---------- utilidades HTTP ---------- */
function allowedOrigin(env, origin) {
  const list = String(env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return origin || '*';
  return origin && list.includes(origin) ? origin : null;
}
function cors(env, req) {
  const o = allowedOrigin(env, req.headers.get('Origin'));
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (o) h['Access-Control-Allow-Origin'] = o;
  return h;
}
function json(data, status, extra) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra) });
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function authOk(req, env) {
  const t = env.PANEL_TOKEN;
  if (!t || t.length < 24) return false; // token curto demais conta como não configurado
  const h = req.headers.get('Authorization') || '';
  return safeEqual(h.replace(/^Bearer\s+/i, ''), t);
}

/* ---------- armazenamento (KV) ---------- */
async function kvGet(env, key, def) {
  if (!env.FD_KV) throw new Error('KV FD_KV não configurado no Worker');
  const v = await env.FD_KV.get(key);
  return v ? JSON.parse(v) : def;
}
async function kvPut(env, key, val) { await env.FD_KV.put(key, JSON.stringify(val)); }
async function getConfig(env) { return Object.assign({}, DEFAULT_CONFIG, await kvGet(env, 'config', {})); }
async function appendLog(env, entries) {
  if (!entries.length) return;
  const log = await kvGet(env, 'log', []);
  const next = log.concat(entries).slice(-LOG_MAX);
  await kvPut(env, 'log', next);
}

/* ---------- clientes ---------- */
function nhClient(env, fetchFn) {
  const base = env.NH_BASE || NH_HOSTS[env.NH_ENV === 'prod' ? 'prod' : 'test'];
  return createClient({ base, key: env.NH_API_KEY, secret: env.NH_API_SECRET, org: env.NH_ORG_ID, algorithm: env.NH_ALGO || DEFAULT_ALGO, fetchFn: fetchFn || fetch });
}
function chainClient(env, fetchFn) {
  return createChain({ base: env.BCH_REST || DEFAULT_BCH_REST, priceUrl: env.PRICE_URL || DEFAULT_PRICE_URL, fetchFn: fetchFn || fetch });
}
function hasKeys(env) { return !!(env.NH_API_KEY && env.NH_API_SECRET && env.NH_ORG_ID); }

async function notify(env, text, fetchFn) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await (fetchFn || fetch)((env.TG_BASE || 'https://api.telegram.org') + '/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: 'Funding Desk: ' + text })
    });
  } catch (e) { /* aviso é opcional */ }
}

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e.message || e) }));

/* ---------- ciclo do robô ---------- */
export async function tick(env, opts = {}) {
  env = await withCreds(env);
  const fetchFn = opts.fetchFn || fetch, now = opts.now || Date.now();
  const cfg = await getConfig(env), limits = limitsFromEnv(env);
  const state = await kvGet(env, 'state', {});
  const nh = nhClient(env, fetchFn), chain = chainClient(env, fetchFn);
  const log = [], errors = [];

  const hlUrl = env.HL_URL || 'https://api.hyperliquid.xyz/info';
  const predicted = fetchFn(hlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'predictedFundings' }) })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  const [info, prices, bookR, unitsR, predR, mpR] = await Promise.all([chain.info(), chain.prices(), nh.orderBook(), nh.units(), predicted, chain.mempool()].map(settle));
  if (!info.ok) errors.push('rede BCH: ' + info.e);
  if (!prices.ok) errors.push('cotações: ' + prices.e);
  if (!bookR.ok) errors.push('livro NiceHash: ' + bookR.e);
  if (!unitsR.ok) errors.push('unidades NiceHash: ' + unitsR.e);
  const book = bookR.ok ? parseBook(bookR.v) : null;
  const units = unitsR.ok ? unitsR.v : { minLimitPH: 1, priceDownStepEH: 0.002, minOrderBtc: 0.001 }; // valores do SHA256ASICBOOST

  // Blocos novos: confere se a recompensa caiu no endereço configurado.
  let blockEvent = null;
  const newBlocks = []; // blocos novos da rede (para o sorteio da simulação)
  if (info.ok) {
    if (state.lastHeight == null || info.v.height - state.lastHeight > 50) state.lastHeight = info.v.height;
    const upto = Math.min(info.v.height, state.lastHeight + 5);
    for (let h = state.lastHeight + 1; h <= upto; h++) {
      const cb = await settle(chain.coinbase(h));
      if (!cb.ok) { errors.push('coinbase ' + h + ': ' + cb.e); break; }
      newBlocks.push(cb.v);
      const total = cb.v.outs.reduce((s, o) => s + o.value, 0);
      state.feesBch = state.feesBch == null ? Math.max(0, total - 3.125) : state.feesBch * 0.9 + Math.max(0, total - 3.125) * 0.1;
      const mine = cfg.payoutAddress ? paidTo(cb.v, cfg.payoutAddress) : 0;
      cb.v.mine = mine;
      if (mine > 0) {
        blockEvent = { height: h, bch: mine, time: cb.v.time, txid: cb.v.txid };
        state.myBlocks = (state.myBlocks || []).concat(blockEvent).slice(-50);
        log.push({ t: now, kind: 'bloco', text: `Bloco ${h} pago no seu endereço: ${mine.toFixed(8)} BCH` });
        await notify(env, `bloco ${h} encontrado! ${mine.toFixed(4)} BCH no seu endereço`, fetchFn);
      }
      state.lastHeight = h;
    }
  }

  const mkt = computeMarket({
    D: info.ok ? info.v.difficulty : null, bchUsd: prices.ok ? prices.v.bchUsd : null, btcUsd: prices.ok ? prices.v.btcUsd : null,
    feesBch: state.feesBch || 0, book, cfg
  });

  let orders = [];
  if (hasKeys(env) && book) {
    const r = await settle(nh.myOrders(book.market));
    if (r.ok) orders = r.v; else errors.push('ordens: ' + r.e);
  }
  const dec = decide({ cfg, mkt, orders, state, now, units, limits, blockEvent });

  // Simulação (só no modo Observar) e resultado real (ordens gerenciadas + blocos).
  // Preço v2 (31/10): o lance simulado passou a sair do preço que de fato recebe hash (ordens com máquinas). Até aqui as
  // simulações compravam ~6% mais barato que o possível (0,402 em vez de ~0,4255): ficam arquivadas e recomeçam.
  let paperArchive = state.paperArchive || null;
  if (state.paperPriceV !== 2) {
    const sm = (p) => (p ? { since: p.since, ph: p.ph, spendUsd: p.spendUsd || 0, evUsd: p.evUsd || 0, wonUsd: p.wonUsd || 0, blocks: p.blocks || 0, draws: p.draws || 0,
      hoursOn: p.hoursOn || 0, wins: (p.wins || []).slice(-5), lastPriceEH: p.priceEH || null } : null);
    if (state.paper || state.paperAlways || state.paperPlan || state.paperBurst) {
      paperArchive = { at: now, paper: sm(state.paper), burst: sm(state.paperBurst), plan: sm(state.paperPlan), always: sm(state.paperAlways),
        why: 'preço de compra otimista: usava a menor ordem com velocidade média > 0, mesmo sem máquinas (0,40), em vez do preço que recebe hash (~0,4254)' };
      log.push({ t: now, kind: 'simulado', text: 'Simulações de mineração recomeçaram com o preço real (ordens com máquinas); as anteriores compravam ~6% mais barato que o possível e foram arquivadas' });
    }
    state.paper = null; state.paperBurst = null; state.paperPlan = null; state.paperAlways = null; state.paperPriceV = 2;
  }
  let paper = state.paper || null;
  if (cfg.mode === 'observe') {
    const ps = paperStep(paper, { cfg, mkt, now, units, limits, blocks: newBlocks });
    paper = ps.paper;
    for (const e of ps.events) log.push({ t: now, kind: 'simulado', text: e });
  } else if (paper) paper.lastTs = now; // fora do Observar a simulação fica parada
  // Registro dos blocos da rede com o contexto do momento (padrões e coincidências). Grava no KV a cada 20 min.
  let blockBuf = state.blockBuf || [], blockFlush = state.blockFlush || 0, lastBlockT = state.lastBlockT || null;
  {
    const won = new Set(((paper && paper.wins) || []).map((w) => w.height)), sp = state.paper;
    for (const b of newBlocks) {
      const on = cfg.mode === 'observe' && !!(sp && sp.on && sp.ph > 0);
      const prob = on && b.difficulty ? Math.min(1, sp.ph * 1e15 / (b.difficulty * 4294967296 / 600)) : 0; // mesma conta da simulação
      const realPH = orders.filter((o) => o.alive && (cfg.managed || []).includes(o.id)).reduce((x, o) => x + (o.speedPH || 0), 0);
      blockBuf.push(blockRecord(b, { prevT: lastBlockT, mkt, book, sim: { ph: on ? sp.ph : 0, prob, won: won.has(b.height) }, mineBch: b.mine, realPH }));
      lastBlockT = b.time;
    }
    if (blockBuf.length && now - blockFlush >= 20 * 60e3) {
      const merged = (await kvGet(env, 'blocks', [])).concat(blockBuf).sort((a, b) => a.h - b.h).filter((b, i, a) => !i || b.h !== a[i - 1].h);
      for (let i = 1; i < merged.length; i++) if (merged[i].dt == null && merged[i].h === merged[i - 1].h + 1) merged[i].dt = Math.round((merged[i].t - merged[i - 1].t) / 1000);
      await kvPut(env, 'blocks', merged.slice(-600));
      blockBuf = []; blockFlush = now;
    }
  }
  // Sinais além da sorte (docs/pesquisa-mineracao.md): dados do BTC e BCH/BTC a cada 15 min; DARR, gravador e medidor a cada ciclo.
  let msig = state.msig || {}, recentBlocks = state.recentBlocks, nhWeek = state.nhWeek;
  if (now - (msig.at || 0) >= 15 * 60e3) {
    const mp = (env.MEMPOOL_URL || 'https://mempool.space').replace(/\/$/, ''), kr = (env.KRAKEN_URL || 'https://api.kraken.com').replace(/\/$/, '');
    const getJ = (u) => fetchFn(u, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    const [adj, hr, rw, oh] = await Promise.all([getJ(mp + '/api/v1/difficulty-adjustment'), getJ(mp + '/api/v1/mining/hashrate/3d'), getJ(mp + '/api/v1/mining/reward-stats/144'),
      getJ(kr + '/0/public/OHLC?pair=BCHXBT&interval=60')].map(settle));
    const closes = oh.ok && oh.v.result ? (Object.entries(oh.v.result).find(([k]) => k !== 'last') || [null, []])[1].map((c) => +c[4]) : null;
    msig = { at: now, adj: adj.ok ? adj.v : msig.adj, dBtc: hr.ok ? hr.v.currentDifficulty : msig.dBtc,
      feesBtc: rw.ok ? (+rw.v.totalFee / Math.max(1, rw.v.endBlock - rw.v.startBlock + 1)) / 1e8 : msig.feesBtc,
      mom: closes ? momentumOf(closes) : msig.mom };
    if (!adj.ok || !hr.ok) errors.push('dados do BTC (mempool.space): ' + (adj.ok ? hr.e : adj.e));
  }
  const bchBtc = prices.ok && prices.v.btcUsd ? prices.v.bchUsd / prices.v.btcUsd : null;
  const dr = info.ok ? darrOf({ dBch: info.v.difficulty, feesBch: state.feesBch || 0, bchBtc, dBtc: msig.dBtc, feesBtc: msig.feesBtc || 0 }) : null;
  const darr = dr ? { v: dr.darr, hpBch: dr.hpBch, hpBtc: dr.hpBtc, nhRatio: mkt.ok && mkt.bidEH ? mkt.bidEH / dr.hpBtc : null, at: now } : state.darr || null;
  if (recentBlocks === undefined) recentBlocks = (await kvGet(env, 'blocks', [])).slice(-200).map((b) => ({ t: b.t, pool: poolOf(b.tag).pool, solo: poolOf(b.tag).solo }));
  for (const b of newBlocks) { const p = poolOf(b.tag); recentBlocks.push({ t: b.time, pool: p.pool, solo: p.solo }); }
  recentBlocks = recentBlocks.filter((b) => now - b.t <= 26 * 3600e3);
  if (mkt.ok) nhWeek = weekAdd(nhWeek, now, { edge: mkt.edgeAtBidPct, price: mkt.bidEH, ph: book ? book.totalPH : 0, darr: dr ? dr.darr : NaN });

  // Variante "rajada" (método do vídeo): 50 PH/s, para no bloco; mesmos blocos reais, mesmo sorteio, mesmos limites.
  let paperBurst = state.paperBurst || null;
  if (cfg.mode === 'observe') paperBurst = paperStep(paperBurst, { cfg: Object.assign({}, cfg, { targetPh: 50, onBlock: 'cancel' }), mkt, now, units, limits, blocks: newBlocks }).paper;
  else if (paperBurst) paperBurst.lastTs = now;
  // Cenário "sugestão do copiloto": potência e orçamento do plano, mesmos blocos e sorteio (compara com a sua configuração).
  let paperPlan = state.paperPlan || null;
  const pmS = state.plan && state.plan.mining;
  if (cfg.mode === 'observe' && pmS) paperPlan = paperStep(paperPlan, { cfg: Object.assign({}, cfg, { targetPh: pmS.ph, sessionBudgetUsd: pmS.budgetUsd, onBlock: 'cancel' }), mkt, now, units, limits, blocks: newBlocks }).paper;
  else if (paperPlan) paperPlan.lastTs = now;
  // Cenário "sempre ligado": sua potência sem pausar pelo preço e sem stop-loss, mesmos blocos e sorteio. Responde
  // "se ficasse ligado direto teria mais bloco?": mais chance, mas paga também as horas com aluguel acima do teto.
  let paperAlways = state.paperAlways || null;
  if (cfg.mode === 'observe') paperAlways = paperStep(paperAlways, { cfg: Object.assign({}, cfg, { sessionBudgetUsd: 0, dailyBudgetUsd: 0, onBlock: 'continue' }),
    mkt: mkt.ok ? Object.assign({}, mkt, { green: true }) : mkt, now, units, limits, blocks: newBlocks }).paper;
  else if (paperAlways) paperAlways.lastTs = now;
  // Os 5 cenários que teriam dado mais lucro na janela dos cenários acompanhados (worker/src/replay.js), a cada 15 min.
  let bestScen = state.bestScen || null;
  if (mkt.ok && now - ((bestScen && bestScen.at) || 0) >= 15 * 60e3) {
    try {
      const list = (await kvGet(env, 'blocks', [])).concat(blockBuf);
      bestScen = bestScenarios(list, { now, since: (paperAlways && paperAlways.since) || (paper && paper.since) || null, fixAt: paperArchive && paperArchive.at, cfg, btcUsd: mkt.btcUsd, blockUsd: mkt.blockNetUsd }) || bestScen;
    } catch (e) { errors.push('melhores cenários: ' + (e.message || e)); }
  }
  const real = realStep(state.real, { orders, managedIds: cfg.managed, blockEvent, now,
    btcUsd: mkt.btcUsd || (prices.ok ? prices.v.btcUsd : 0), bchUsd: mkt.bchUsd || (prices.ok ? prices.v.bchUsd : 0) });

  // Execução: só no modo ativo. No modo observar, registra o que faria.
  const results = [];
  for (const a of dec.actions) {
    if (cfg.mode !== 'active' || !hasKeys(env)) { results.push(Object.assign({ executed: false }, a)); continue; }
    try {
      if (a.type === 'cancel') await nh.cancelOrder(a.id);
      if (a.type === 'update') await nh.updateOrder(a.id, { priceEH: a.priceEH, limitPH: a.limitPH });
      if (a.type === 'create') {
        const o = await nh.createOrder(a);
        a.id = o.id;
        cfg.managed = (cfg.managed || []).concat(o.id);
        await kvPut(env, 'config', cfg);
      }
      results.push(Object.assign({ executed: true }, a));
      if (a.type !== 'update') await notify(env, `${a.type === 'cancel' ? 'ordem encerrada' : 'ordem criada'}: ${a.reason}`, fetchFn);
    } catch (e) {
      results.push(Object.assign({ executed: false, error: String(e.message || e) }, a));
      errors.push(`${a.type} ${a.id || ''}: ${e.message || e}`);
    }
  }

  // Log sem repetir a mesma decisão a cada ciclo.
  const sig = JSON.stringify(results.map((r) => [r.type, r.id, r.priceEH, r.limitPH, r.executed]));
  if (results.length && (sig !== state.lastSig || cfg.mode === 'active')) {
    for (const r of results) log.push({ t: now, kind: r.executed ? 'acao' : (r.error ? 'erro' : 'simulado'), text: `${r.type}${r.id ? ' ' + r.id : ''}: ${r.reason}${r.priceEH ? ` · preço ${r.priceEH}` : ''}${r.limitPH !== undefined ? ` · ${r.limitPH} PH/s` : ''}${r.error ? ' · ' + r.error : ''}` });
  }
  const errSig = errors.join('|');
  if (errors.length && errSig !== state.lastErrSig) {
    log.push({ t: now, kind: 'erro', text: errors.join('; ') });
    await notify(env, 'erro: ' + errors[0], fetchFn);
  }

  // Alertas (entrada/saída/risco) com aviso no Telegram; não dependem do modo do robô.
  let newAlerts = [], alertState = { alertPrev: state.alertPrev, alertMem: state.alertMem, alerts: state.alerts };
  // Estável = histórico próprio do servidor (24 h) OU conferido pelo painel no histórico pago das corretoras (últimas 6 h,
  // com a meia-vida pagando as taxas).
  const verified = state.verified || {}, stableNow = Object.assign({}, state.stable24 || {});
  for (const [k, x] of Object.entries(verified)) if (now - x.at <= 6 * 3600e3 && x.stable24 && !(x.expNet !== null && x.expNet <= 0)) stableNow[k] = true;
  const funding = predR.ok ? fundingSnapshot(predR.v, cfg, now, cfg.fundStable24 !== false ? stableNow : null) : null;
  if (!predR.ok) errors.push('funding (Hyperliquid): ' + predR.e);
  // Operações simuladas de funding: rodam sempre (o funding ainda é manual; isto mostra o que um robô com regras fixas faria).
  let fundPaper = state.fundPaper || null;
  if (funding) {
    const fp = fundPaperStep(fundPaper, { rows: funding.rows, best: funding.best, now, fees: FD.DEFAULT_FEES });
    fundPaper = fp.pf;
    for (const e of fp.events) log.push({ t: now, kind: 'simulado', text: e });
  }
  // IA (modo sombra): histórico horário próprio + nota dos pares; robô "Regras + IA" ao lado do "Regras".
  let aiScores = state.aiScores || {}, fundPaperAI = state.fundPaperAI || null, fhistHour = state.fhistHour, stable24 = state.stable24 || {}, pairStats = state.pairStats || {};
  if (funding && FUND_MODEL) {
    const hour = Math.floor(now / 3600e3);
    if (hour !== fhistHour) {
      const extra = (funding.best || []).map((b) => b.coin).concat(((fundPaper && fundPaper.open) || []).map((o) => o.coin), ((fundPaperAI && fundPaperAI.open) || []).map((o) => o.coin));
      const fh = updateHistory(await kvGet(env, 'fhist', null), { rows: funding.rows, selected: pickCoins(funding.rows, extra), hour });
      await kvPut(env, 'fhist', fh);
      aiScores = scorePairs(fh, { model: FUND_MODEL, fees: FD.DEFAULT_FEES });
      stable24 = stablePairs(fh, { fees: FD.DEFAULT_FEES });
      pairStats = pairStatsOf(fh, FDI);
      fhistHour = hour;
    }
    const okBest = (funding.best || []).filter((b) => aiScores[b.key] && aiScores[b.key].p >= FUND_MODEL.threshold);
    const fa = fundPaperStep(fundPaperAI, { rows: funding.rows, best: okBest, now, fees: FD.DEFAULT_FEES, label: 'IA' });
    fundPaperAI = fa.pf;
    for (const e of fa.events) log.push({ t: now, kind: 'simulado', text: e });
  }
  if (cfg.alerts !== false) {
    const ra = runAlerts({ state, funding, edges: mkt.ok ? { BCH: mkt.edgeAtBidPct } : {}, now, minEdgePct: cfg.minEdgePct });
    newAlerts = ra.alerts; alertState = ra.state;
    for (const a of newAlerts) log.push({ t: now, kind: 'alerta', text: a.title + ': ' + a.text });
    // Saída e risco vão na hora; entradas e oportunidades viram um resumo a cada 30 min (menos ruído no celular).
    const urgent = newAlerts.filter((a) => a.kind === 'saida' || a.kind === 'risco');
    for (const a of urgent.slice(0, 3)) await notify(env, a.title + '. ' + a.text, fetchFn);
    let queue = (state.digest || []).concat(newAlerts.filter((a) => urgent.indexOf(a) < 0).map((a) => a.title));
    let lastDigest = state.lastDigest || 0;
    if (queue.length && now - lastDigest >= 30 * 60e3) {
      await notify(env, 'resumo: ' + queue.length + (queue.length > 1 ? ' alertas novos' : ' alerta novo') + ': ' + queue.slice(0, 6).join('; ') + (queue.length > 6 ? '…' : ''), fetchFn);
      queue = []; lastDigest = now;
    }
    alertState.digest = queue.slice(-30); alertState.lastDigest = lastDigest;
  }

  // Outras moedas (simulado, pool PPS): a cada 15 min, com o mapa de mineração (a mesma conta do painel).
  let algoPaper = state.algoPaper || null, algoTs = state.algoTs || 0, algoMap = state.algoMap || [], algoRan = false;
  if (cfg.algoPaper !== false && prices.ok && now - algoTs >= 15 * 60e3) {
    const pub = (env.NH_BASE || 'https://api2.nicehash.com').replace(/\/$/, '');
    const getJ = (u) => fetchFn(u, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    const algos = FDR.ALGOS.map((a) => a.nh);
    const res = await Promise.all([getJ(env.WTM_URL || 'https://whattomine.com/asic.json')].concat(algos.map((a) =>
      a === nh.algorithm && bookR.ok ? Promise.resolve(bookR.v) : getJ(pub + '/main/api/v2/hashpower/orderBook?algorithm=' + a + '&size=1000'))).map(settle));
    if (res[0].ok) {
      const books = {};
      algos.forEach((a, i) => { if (res[i + 1].ok) books[a] = res[i + 1].v; });
      const map = FDR.miningMap(res[0].v, books, { btcUsd: prices.v.btcUsd, minEdgePct: cfg.minEdgePct, rentFeePct: cfg.rentFeePct, poolFeePct: cfg.poolFeePct });
      algoMap = map.map((m) => ({ algo: m.algo, label: m.label, coins: m.coins, edgePct: m.edgePct, level: m.level, capBtcPerUnit: m.capBtcPerUnit, unit: m.unit, rentBtcPerH: m.rentBtcPerH }));
      algoRan = true;
      const ap = algoPaperStep(algoPaper, { map, now });
      algoPaper = ap.pa; algoTs = now;
      for (const e of ap.events) log.push({ t: now, kind: 'simulado', text: e });
    } else errors.push('WhatToMine: ' + res[0].e);
  }

  // Outros fornecedores de hash (Braiins Hashpower, MiningRigRentals): preço para receber hash, a cada 15 min, só leitura.
  let hashMkts = state.hashMkts || null;
  if (cfg.hashMarkets !== false && (!hashMkts || now - (hashMkts.at || 0) >= 15 * 60e3)) {
    const hp = (env.HP_URL || 'https://hashpower.braiins.com').replace(/\/$/, ''), mr = (env.MRR_URL || 'https://www.miningrigrentals.com').replace(/\/$/, '');
    const getJ = (u) => fetchFn(u, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    const [hb, hs, mi] = await Promise.all([getJ(hp + '/v1/spot/orderbook'), getJ(hp + '/v1/spot/stats'), getJ(mr + '/api/v2/info/algos/sha256ab?currency=BTC')].map(settle));
    hashMkts = { at: now, braiins: hb.ok ? braiinsOf(hb.v, hs.ok ? hs.v : null) : (hashMkts && hashMkts.braiins) || null,
      mrr: mi.ok ? mrrOf(mi.v) : (hashMkts && hashMkts.mrr) || null, err: [hb.ok ? null : 'Braiins: ' + hb.e, mi.ok ? null : 'MRR: ' + mi.e].filter(Boolean) };
  }

  // Frentes em observação (docs/pesquisa-frentes.md): dados públicos a cada 15 min, fora do ciclo que já leu o mapa de
  // mineração (limite de 50 chamadas externas por ciclo). Funding com perna na Lighter (taxa zero) vira um robô simulado.
  let fronts = state.fronts || null, frontsPaper = state.frontsPaper || null, ltStreak = state.ltStreak || null, fundPaperLT = state.fundPaperLT || null, frontsRan = false;
  if (cfg.fronts !== false && !algoRan && (!fronts || now - (fronts.at || 0) >= 15 * 60e3)) {
    frontsRan = true;
    const getJ = (u, o) => fetchFn(u, Object.assign({ headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }, o || {})).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    const U = (k, d) => (env[k] || d).replace(/\/$/, '');
    const day = (t) => { const d = new Date(t); return String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0') + '-' + d.getUTCFullYear(); };
    const [lt, lo, bf, db, et, hl, zp, mb, px, cd, wg] = await Promise.all([
      getJ(U('LIGHTER_URL', 'https://mainnet.zklighter.elliot.ai') + '/api/v1/funding-rates'),
      getJ(U('LIGHTER_URL', 'https://mainnet.zklighter.elliot.ai') + '/api/v1/orderBooks'),
      getJ(U('BFX_URL', 'https://api-pub.bitfinex.com') + '/v2/tickers?symbols=fUST,fUSD'),
      getJ(U('DERIBIT_URL', 'https://www.deribit.com') + '/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=future'),
      getJ(U('ETHENA_URL', 'https://ethena.fi') + '/api/yields/protocol-and-staking-yield'),
      getJ(U('HL_INFO_URL', 'https://api.hyperliquid.xyz') + '/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'vaultDetails', vaultAddress: '0xdfc24b077bc1425ad1dea75bcb6f8158e10df303' }) }),
      getJ(U('ZPOOL_URL', 'https://www.zpool.ca') + '/api/status'),
      getJ(U('MB_URL', 'https://api.mercadobitcoin.net') + '/api/v4/tickers?symbols=USDT-BRL,USDC-BRL'),
      getJ(U('BCB_PTAX_URL', 'https://olinda.bcb.gov.br') + "/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='" + day(now - 7 * 864e5) + "'&@dataFinalCotacao='" + day(now) + "'&$format=json&$select=cotacaoVenda,dataHoraCotacao"),
      getJ(U('BCB_SGS_URL', 'https://api.bcb.gov.br') + '/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json'),
      getJ(env.WTM_GPU_URL || 'https://whattomine.com/coins.json')
    ].map(settle));
    const old = fronts || {}, v = (r, f, k) => (r.ok ? f(r.v) : old[k] || null);
    fronts = { at: now, bfx: v(bf, bitfinexOf, 'bfx'), basis: db.ok ? deribitBasisOf(db.v && db.v.result, now) : old.basis || null, ethena: v(et, ethenaOf, 'ethena'), hlp: v(hl, hlpOf, 'hlp'),
      zpool: v(zp, zpoolOf, 'zpool'), brl: mb.ok || px.ok ? brlOf(mb.ok ? mb.v : null, px.ok ? px.v : null) : old.brl || null, cdi: cd.ok ? cdiOf(cd.v) : old.cdi || null,
      asic: asicOf({ dBtc: msig.dBtc, feesBtc: msig.feesBtc || 0, btcUsd: prices.ok ? prices.v.btcUsd : null }) || old.asic || null,
      gpu: wg.ok ? gpuOf(wg.v, prices.ok ? prices.v.btcUsd : null) : old.gpu || null,
      err: [['WhatToMine GPU', wg], ['Lighter', lt], ['Bitfinex', bf], ['Deribit', db], ['Ethena', et], ['Hyperliquid', hl], ['zpool', zp], ['Mercado Bitcoin', mb], ['PTAX', px], ['CDI', cd]].filter(([, r]) => !r.ok).map(([n, r]) => n + ': ' + r.e) };
    // checagem de realidade da mineração: o que o multipool pagou de fato × o aluguel na NiceHash (com a taxa)
    const sc = (algoMap || []).find((m) => m.algo === 'SCRYPT');
    const sane = (x) => (isFinite(x) && Math.abs(x) <= 300 ? x : null); // acima de 300%: unidade ou dado errado
    fronts.zEdge = { sha256: sane(fronts.zpool && fronts.zpool.sha256PerH && mkt.ok ? (fronts.zpool.sha256PerH * 1e18 / (mkt.bidEH * (1 + cfg.rentFeePct / 100)) - 1) * 100 : NaN),
      scrypt: sane(fronts.zpool && fronts.zpool.scryptPerH && sc && sc.rentBtcPerH ? (fronts.zpool.scryptPerH / sc.rentBtcPerH - 1) * 100 : NaN) };
    // funding com a Lighter: pares, horas seguidas acima do empate e robô simulado
    if (lt.ok) {
      const rows = lighterRows(lighterTable(lt.v), now, lo.ok ? lighterOi(lo.v) : null);
      let pairs = lighterPairs(rows, ltStreak && ltStreak.s);
      ltStreak = streakStep(ltStreak, pairs, Math.floor(now / 3600e3));
      pairs = lighterPairs(rows, ltStreak.s);
      const best = pairs.filter((x) => x.hours >= 24 && x.spread >= x.be);
      const fl = fundPaperStep(fundPaperLT, { rows, best, now, fees: LT_FEES, label: 'Lighter' });
      fundPaperLT = fl.pf;
      for (const e of fl.events) log.push({ t: now, kind: 'simulado', text: e });
      fronts.lt = { above: pairs.filter((x) => x.spread >= x.be).length, stable: best.length, pairs: pairs.length, top: pairs.slice(0, 8) };
    } else fronts.lt = old.lt || null;
    // papel: US$1.000 em cada frente passiva, com o CDI ao lado
    frontsPaper = frontsPaperStep(frontsPaper, { now, cdi: fronts.cdi, rates: { bfx: fronts.bfx && fronts.bfx.netApr, basis: fronts.basis && fronts.basis.netApr, ethena: fronts.ethena && fronts.ethena.apr30, hlp: fronts.hlp && fronts.hlp.apr } });
    // histórico diário (último valor do dia) para ver a tendência de cada frente
    const d = new Date(now).toISOString().slice(0, 10), H = old.hist || {};
    H[d] = { bfx: fronts.bfx && fronts.bfx.netApr, basis: fronts.basis && fronts.basis.netApr, ethena: fronts.ethena && fronts.ethena.apr30, hlp: fronts.hlp && fronts.hlp.apr,
      zSha: fronts.zEdge.sha256, zScrypt: fronts.zEdge.scrypt, usdt: fronts.brl && fronts.brl.usdtPremPct, cdi: fronts.cdi, ltAbove: fronts.lt && fronts.lt.above, ltStable: fronts.lt && fronts.lt.stable };
    for (const k of Object.keys(H).sort().slice(0, -60)) delete H[k];
    fronts.hist = H;
  }

  // Lastro de mercado (a cada 30 min, num ciclo sem as outras leituras): ágio por país, BTC entre corretoras, recompensas
  // de liquidez da Polymarket e rendimentos de referência (DefiLlama). Só dados, sem filtro: a análise é do usuário.
  let market2 = state.market2 || null;
  if (cfg.fronts !== false && !algoRan && !frontsRan && (!market2 || now - (market2.at || 0) >= 30 * 60e3)) {
    const getJ = (u) => fetchFn(u, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    const getT = (u) => fetchFn(u, { headers: { 'user-agent': 'funding-desk/1.0' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
    const E = (k, d) => (env[k] || d).replace(/\/$/, '');
    const llamaKeys = Object.keys(LLAMA_POOLS);
    const R = await Promise.all([
      getJ(E('UPBIT_URL', 'https://api.upbit.com') + '/v1/ticker?markets=KRW-BTC,KRW-USDT'),
      getJ(E('MB_URL', 'https://api.mercadobitcoin.net') + '/api/v4/tickers?symbols=BTC-BRL,USDT-BRL'),
      getJ(E('KRAKEN_URL', 'https://api.kraken.com') + '/0/public/Ticker?pair=XBTUSD'),
      getJ(E('FX_URL', 'https://api.frankfurter.dev') + '/v1/latest?base=USD&symbols=KRW,BRL'),
      getJ(E('CRIPTOYA_URL', 'https://criptoya.com') + '/api/dolar'),
      getJ(E('COINBASE_URL', 'https://api.exchange.coinbase.com') + '/products/BTC-USD/ticker'),
      getJ(E('BFX_URL', 'https://api-pub.bitfinex.com') + '/v2/tickers?symbols=tBTCUSD,tBTCUST'),
      getJ(E('OKX_URL', 'https://www.okx.com') + '/api/v5/market/ticker?instId=BTC-USDT'),
      getJ(E('GATE_URL', 'https://api.gateio.ws') + '/api/v4/spot/tickers?currency_pair=BTC_USDT'),
      getJ(E('BITGET_URL', 'https://api.bitget.com') + '/api/v2/spot/market/tickers?symbol=BTCUSDT'),
      getJ(E('GAMMA_URL', 'https://gamma-api.polymarket.com') + '/markets?active=true&closed=false&limit=20&order=volume24hr&ascending=false')
    ].concat(llamaKeys.map((k) => getJ(E('LLAMA_URL', 'https://yields.llama.fi') + '/poolsEnriched?pool=' + LLAMA_POOLS[k]))).concat([
      // referências fora de cripto: Selic (meta), IPCA 12 meses, expectativa Focus e T-bill de 13 semanas
      getJ(E('BCB_SGS_URL', 'https://api.bcb.gov.br') + '/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json'),
      getJ(E('BCB_SGS_URL', 'https://api.bcb.gov.br') + '/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json'),
      getJ(E('BCB_FOCUS_URL', 'https://olinda.bcb.gov.br') + "/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$top=8&$filter=Indicador%20eq%20'IPCA'&$orderby=Data%20desc&$format=json&$select=Indicador,Data,DataReferencia,Mediana"),
      getT(E('UST_URL', 'https://home.treasury.gov') + '/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/' + new Date(now).getUTCFullYear() + '/all?type=daily_treasury_bill_rates&_format=csv')
    ]).map(settle));
    const [up, mb2, kr, fx, ar, cb, bf2, ok2, gt, bg, gm] = R, ll = R.slice(11, 11 + llamaKeys.length), [sl, ip, fo, tb] = R.slice(11 + llamaKeys.length), old = market2 || {}, V = (r) => (r.ok ? r.v : null);
    const krPx = V(kr) && V(kr).result ? +Object.values(V(kr).result)[0].c[0] : null, bfx2 = V(bf2) || [];
    const bfPx = (sym) => { const t = bfx2.find((x) => Array.isArray(x) && x[0] === sym); return t ? +t[7] : null; };
    const quotes = [{ ex: 'Kraken', quote: 'USD', px: krPx }, { ex: 'Coinbase', quote: 'USD', px: V(cb) ? +V(cb).price : null }, { ex: 'Bitfinex', quote: 'USD', px: bfPx('tBTCUSD') },
      { ex: 'Bitfinex', quote: 'USDT', px: bfPx('tBTCUST') }, { ex: 'OKX', quote: 'USDT', px: V(ok2) && V(ok2).data ? +V(ok2).data[0].last : null },
      { ex: 'Gate', quote: 'USDT', px: V(gt) && V(gt)[0] ? +V(gt)[0].last : null }, { ex: 'Bitget', quote: 'USDT', px: V(bg) && V(bg).data ? +V(bg).data[0].lastPr : null }];
    const yields = {}; llamaKeys.forEach((k, i) => { yields[k] = ll[i].ok ? llamaOf(ll[i].v) : (old.yields || {})[k] || null; });
    market2 = { at: now, prem: up.ok || mb2.ok ? premiumsOf({ upbit: V(up), mb: V(mb2), kraken: V(kr), fx: V(fx), ars: V(ar) }) : old.prem || null,
      spot: spotSpreadOf(quotes), poly: gm.ok ? polymarketOf(V(gm)) : old.poly || null, yields,
      macro: sl.ok || tb.ok ? macroOf({ selic: V(sl), ipca12: V(ip), focus: V(fo), tbillCsv: V(tb) }) : old.macro || null,
      err: [['Upbit', up], ['Mercado Bitcoin', mb2], ['Kraken', kr], ['Câmbio', fx], ['CriptoYa', ar], ['Polymarket', gm]].filter(([, r]) => !r.ok).map(([n, r]) => n + ': ' + r.e) };
  }

  // Panorama do mercado (copiloto): o que todas as frentes dizem juntas. Barato: roda a cada ciclo com o que já foi lido.
  const aiPanorama = marketPanorama({ fronts, market2, mkt, darr: darr ? darr.v : null, now,
    sentiment: funding && funding.rows ? FDR.sentiment(funding.rows, ['Binance', 'Bybit', 'Hyperliquid']) : null });

  // Placar: cada alerta de entrada de funding vira uma posição hipotética acompanhada pelo prazo projetado.
  const byKey = {}; for (const b of (funding && funding.best) || []) byKey[b.key] = b;
  const entries = newAlerts.filter((a) => a.area === 'funding' && a.kind === 'entrada' && /^fe:/.test(a.key || '')).map((a) => {
    const b = byKey[a.key.slice(3)]; return b ? { key: b.key, coin: b.coin, s: b.s, l: b.l, projUsd: b.netUsd, ai: aiScores[b.key] ? aiScores[b.key].p : null } : null;
  }).filter(Boolean);
  const alertScore = alertScoreStep(state.alertScore, { rows: funding && funding.rows, entries, now, fees: FD.DEFAULT_FEES, holdDays: cfg.alertHold || 3 });

  // Copiloto IA: analisa tudo e registra previsões conferíveis (XP e maturidade).
  const snap = { now, edge: mkt.ok ? mkt.edgeAtBidPct : NaN, green: !!(mkt.ok && mkt.green), minEdge: cfg.minEdgePct, darr: darr ? darr.v : NaN,
    D: info.ok ? info.v.difficulty : null, mom: msig.mom, ret: retargetOf(msig.adj, darr ? darr.v : NaN), win: windowMeter(recentBlocks, now),
    fund: ((funding && funding.best) || []).map((b) => ({ key: b.key, coin: b.coin, netUsd: b.netUsd })), rows: funding ? funding.rows : null, fees: FD.DEFAULT_FEES, stable24,
    algos: algoPaper ? Object.entries(algoPaper.algos).map(([k, a]) => ({ k, label: a.label, edge: a.edgeNow, level: a.level })) : [],
    scoreDone: (alertScore && alertScore.done) || [] };
  const br = brainStep(state.ai, snap);
  for (const ev of br.events.slice(0, 6)) log.push({ t: now, kind: 'ia', text: ev });
  const aiAnalysis = analysis(snap, br.ai);
  // Conta da NiceHash (saldo e pools) a cada 15 min, para o plano de ação saber o que trava.
  let acct = state.acct || null;
  if (hasKeys(env) && (!acct || now - (acct.at || 0) >= 15 * 60e3)) {
    const [bal, pl] = await Promise.all([nh.balance(), nh.pools()].map(settle));
    acct = { at: now, balanceBtc: bal.ok ? +(bal.v.available || 0) : (acct ? acct.balanceBtc : null),
      pools: pl.ok ? ((pl.v && pl.v.list) || []).map((p) => ({ id: p.id, name: p.name, algorithm: p.algorithm })) : (acct ? acct.pools : []) };
  }
  const plan = actionPlan({ cfg, limits, mkt: mkt.ok ? Object.assign({}, mkt, { bookTotalPH: book ? book.totalPH : 0 }) : mkt, acct,
    fund: ((funding && funding.best) || []), algoMap, capital: cfg.alertCapital || 1000, pools: FDR.POOLS });
  const mempool = mpR.ok ? Object.assign({ at: now }, mpR.v) : state.mempool || null;
  // Cartilha de entrada: a sequência de fatores (margem real, sem taxa, DARR, preço × dificuldade, hash, reajuste do BTC,
  // horário, tamanho, tentativa) avaliada agora, com veredito. docs/cartilha-mineracao.md.
  const entryCheck = entryChecklist({ mkt, darr: darr ? darr.v : null, mom: msig.mom, ret: snap.ret, win: snap.win, nhWeek, hashMkts,
    power: plan && plan.mining ? plan.mining.power : null, cfg, now });

  const next = Object.assign({}, dec.state, alertState, {
    lastTick: now, verified: Object.fromEntries(Object.entries(verified).filter(([, x]) => now - x.at <= 6 * 3600e3)), ai: br.ai, aiAnalysis, plan, acct, algoMap, mempool, stable24, pairStats, msig, darr, recentBlocks, nhWeek, paper, paperBurst, paperPlan, paperAlways, hashMkts, fronts, frontsPaper, ltStreak, fundPaperLT, market2, aiPanorama, entryCheck, bestScen, paperArchive, paperPriceV: 2, blockBuf, blockFlush, lastBlockT, real, fundPaper, alertScore, algoPaper, algoTs, aiScores, fundPaperAI, fhistHour, lastHeight: state.lastHeight, feesBch: state.feesBch, myBlocks: state.myBlocks || [], lastSig: sig, lastErrSig: errSig,
    market: mkt.ok ? { breakEvenEH: mkt.breakEvenEH, capEH: mkt.capEH, fillEH: mkt.fillEH, medianEH: mkt.medianEH, bidEH: mkt.bidEH,
      edgeAtBidPct: mkt.edgeAtBidPct, green: mkt.green, D: mkt.D, bookTotalPH: book ? book.totalPH : 0, bchUsd: mkt.bchUsd, btcUsd: mkt.btcUsd, costPerBlockUsd: mkt.costPerBlockUsd,
      hashpriceNet: mkt.hashpriceNet, blockNetUsd: mkt.blockNetUsd, phDaysPerBlock: mkt.phDaysPerBlock, market: mkt.market } : { ok: false, reason: mkt.reason },
    errors
  });
  // Histórico curto da margem (para achar horários baratos), um ponto a cada ~15 min.
  const hist = next.edgeHist = (state.edgeHist || []);
  if (mkt.ok && (!hist.length || now - hist[hist.length - 1][0] >= 15 * 60e3)) hist.push([now, +mkt.edgeAtBidPct.toFixed(2), +mkt.bidEH.toFixed(4), darr ? +darr.v.toFixed(4) : null, book ? Math.round(book.totalPH) : null, book && book.fixedEH ? +book.fixedEH.toFixed(4) : null]);
  next.edgeHist = hist.slice(-672); // 7 dias
  await kvPut(env, 'state', next);
  await appendLog(env, log);
  return { market: next.market, actions: results, notes: dec.notes, errors, blockEvent, mode: cfg.mode, alerts: newAlerts, paper };
}

/* ---------- contas conectadas pelo painel ---------- */
// NiceHash: confere a chave lendo o saldo antes de salvar. Trocar de ambiente volta o robô para Observar.
async function putCredentials(env, body, fetchFn) {
  if (body.remove === 'nicehash' || body.remove === 'telegram') {
    const tg = body.remove === 'telegram';
    await saveCreds(env, tg ? { TELEGRAM_BOT_TOKEN: null, TELEGRAM_CHAT_ID: null, botName: null } : { NH_API_KEY: null, NH_API_SECRET: null, NH_ORG_ID: null, NH_ENV: null });
    const msgs = [tg ? 'Telegram desconectado' : 'NiceHash desconectada'];
    if (!tg) {
      const cfg = await getConfig(env);
      if (cfg.mode === 'active') { cfg.mode = 'observe'; await kvPut(env, 'config', cfg); msgs.push('robô voltou para Observar'); }
    }
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: msgs.join('; ') }]);
    return json(credStatus(await reloadCreds(env)));
  }
  const { patch, errors } = parseNiceHash(body.nicehash || {});
  if (errors.length) return json({ error: errors.join('; ') }, 400);
  const base = env.NH_BASE || NH_HOSTS[patch.NH_ENV];
  const probe = createClient({ base, key: patch.NH_API_KEY, secret: patch.NH_API_SECRET, org: patch.NH_ORG_ID, fetchFn: fetchFn || fetch });
  let bal;
  try { bal = await probe.balance(); } catch (e) {
    const where = patch.NH_ENV === 'prod' ? 'nicehash.com (produção)' : 'test.nicehash.com (teste)';
    const auth = /\b(401|403)\b/.test(String(e.message));
    // Chave do outro ambiente (ex.: conta real com "Teste" escolhido)? Testa lá e sugere a troca, sem salvar nada.
    if (auth && !env.NH_BASE) {
      const other = patch.NH_ENV === 'prod' ? 'test' : 'prod';
      const alt = createClient({ base: NH_HOSTS[other], key: patch.NH_API_KEY, secret: patch.NH_API_SECRET, org: patch.NH_ORG_ID, fetchFn: fetchFn || fetch });
      const ok = await alt.balance().then(() => true, () => false);
      if (ok) return json({ suggestEnv: other, error: other === 'prod'
        ? 'Essa chave é da sua conta real (nicehash.com). Troque o Ambiente para Produção e toque em Salvar de novo.'
        : 'Essa chave é do ambiente de teste (test.nicehash.com). Troque o Ambiente para Teste e toque em Salvar de novo.' }, 400);
    }
    return json({ error: auth
      ? `A NiceHash não aceitou as chaves (ambiente ${where}). Confira: chave confirmada pelo e-mail da NiceHash; API Key, API Secret e Organization ID cada um no seu campo; permissão para ver saldo.`
      : `Não consegui falar com a NiceHash agora (${String(e.message).slice(0, 120)}). Tente de novo em instantes.` }, 400);
  }
  const prevEnv = env.NH_ENV === 'prod' ? 'prod' : 'test';
  await saveCreds(env, patch);
  const log = [{ t: Date.now(), kind: 'config', text: `NiceHash conectada pelo painel (ambiente ${patch.NH_ENV === 'prod' ? 'produção' : 'teste'}, chave …${patch.NH_API_KEY.slice(-4)})` }];
  if (prevEnv !== patch.NH_ENV) {
    const cfg = await getConfig(env);
    if (cfg.mode === 'active') cfg.mode = 'observe';
    cfg.managed = []; cfg.autoCreate = false; cfg.poolId = '';
    await kvPut(env, 'config', cfg);
    log.push({ t: Date.now(), kind: 'config', text: 'ambiente trocado: robô em Observar, ordens e pool do ambiente anterior esquecidos' });
  }
  await appendLog(env, log);
  const st = credStatus(await reloadCreds(env));
  return json(Object.assign(st, { balanceBtc: bal && (bal.available ?? bal.totalBalance) }));
}

// Telegram: valida o token do bot, acha o seu chat pela última mensagem enviada ao bot e manda um teste.
async function connectTelegram(env, body, fetchFn) {
  const f = fetchFn || fetch, tgBase = env.TG_BASE || 'https://api.telegram.org';
  const token = String(body.token || '').trim() || env.TELEGRAM_BOT_TOKEN || '';
  if (!TG_TOKEN_RE.test(token)) return json({ error: 'token do bot inválido: ele vem do @BotFather e parece com 123456789:AAH...' }, 400);
  const tg = async (method, payload) => {
    const r = await f(tgBase + '/bot' + token + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || 'HTTP ' + r.status);
    return j.result;
  };
  let me;
  try { me = await tg('getMe'); } catch (e) { return json({ error: 'O Telegram recusou o token (' + e.message + '). Copie de novo no @BotFather.' }, 400); }
  const bot = me.username || '';
  await saveCreds(env, { TELEGRAM_BOT_TOKEN: token, botName: bot });
  let chat = null;
  try { chat = chatFromUpdates(await tg('getUpdates', { limit: 50, timeout: 0 })); } catch (e) { /* sem mensagens ainda */ }
  if (!chat) return json({ connected: false, bot, needMessage: true, link: bot ? 'https://t.me/' + bot : null });
  try { await tg('sendMessage', { chat_id: chat.id, text: 'Funding Desk conectado ✅ Aqui chegam saídas, riscos e blocos na hora; entradas e oportunidades num resumo a cada 30 min.' }); }
  catch (e) { return json({ error: 'Achei o chat, mas não consegui enviar a mensagem de teste (' + e.message + ').' }, 400); }
  await saveCreds(env, { TELEGRAM_CHAT_ID: chat.id });
  await appendLog(env, [{ t: Date.now(), kind: 'config', text: `Telegram conectado (@${bot}, conversa com ${chat.name || chat.type})` }]);
  return json({ connected: true, bot, chatName: chat.name });
}

/* ---------- rotas ---------- */
async function proxy(kind, path, search) {
  if (!ALLOW[kind].test(path)) return json({ error: 'rota não permitida' }, 404);
  const ttl = kind === 'wtm' ? 300 : 15; // WhatToMine atualiza devagar: 5 min de cache
  const up = await fetch(UPSTREAM[kind] + path + search, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' }, cf: { cacheTtl: ttl, cacheEverything: true } });
  return new Response(up.body, { status: up.status, headers: { 'content-type': up.headers.get('content-type') || 'application/json', 'cache-control': 'public, max-age=15' } });
}

async function api(req, env, url, fetchFn) {
  const p = url.pathname.replace(/^\/api/, ''), m = req.method;
  const body = m === 'GET' || m === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const nh = nhClient(env, fetchFn), limits = limitsFromEnv(env);
  const need = () => { if (!hasKeys(env)) throw Object.assign(new Error('NiceHash não conectada: cadastre as chaves em Ajustes → Conectar contas'), { status: 412 }); };

  if (p === '/status' && m === 'GET') {
    const [cfg, state] = await Promise.all([getConfig(env), kvGet(env, 'state', {})]);
    return json({ version: VERSION, algo: nh.algorithm, nhEnv: env.NH_BASE ? 'personalizado' : (env.NH_ENV === 'prod' ? 'produção' : 'teste'), keys: hasKeys(env),
      telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), creds: credStatus(env), limits, config: cfg,
      state: { lastTick: state.lastTick, lastHeight: state.lastHeight, market: state.market, myBlocks: state.myBlocks || [], dailyUsd: state.dailyUsd || 0,
        errors: state.errors || [], edgeHist: state.edgeHist || [], alerts: (state.alerts || []).slice(-30).reverse(),
        paper: state.paper || null, paperBurst: state.paperBurst || null, paperPlan: state.paperPlan || null, paperAlways: state.paperAlways || null, paperArchive: state.paperArchive || null, entryCheck: state.entryCheck || null, bestScen: state.bestScen || null, hashMkts: state.hashMkts || null, fronts: state.fronts || null, frontsPaper: state.frontsPaper || null, market2: state.market2 || null, aiPanorama: state.aiPanorama || null,
        fundPaperLT: state.fundPaperLT ? { summary: fundPaperSummary(state.fundPaperLT, LT_FEES), open: state.fundPaperLT.open, closed: state.fundPaperLT.closed.slice(-50).reverse() } : null, opLog: (state.opLog || []).slice(-20).reverse(), real: state.real ? Object.assign({}, state.real, { paid: undefined }) : null,
        fundPaper: state.fundPaper ? { summary: fundPaperSummary(state.fundPaper, FD.DEFAULT_FEES), open: state.fundPaper.open, closed: state.fundPaper.closed.slice(-100).reverse() } : null,
        algoPaper: state.algoPaper || null,
        fundPaperAI: state.fundPaperAI ? { summary: fundPaperSummary(state.fundPaperAI, FD.DEFAULT_FEES), open: state.fundPaperAI.open, closed: state.fundPaperAI.closed.slice(-100).reverse() } : null,
        aiScores: state.aiScores || {}, stable24: Object.keys(state.stable24 || {}), pairStats: state.pairStats || {},
        ai: state.ai ? Object.assign({ xp: state.ai.xp, since: state.ai.since, stats: state.ai.stats, ctrl: (state.ai.ctrl || {}).stats || {}, unscoredBy: state.ai.unscored || {}, open: state.ai.open.slice(-30).reverse(), done: state.ai.done.slice(-60).reverse() }, levelOf(state.ai)) : null,
        aiTypes: TYPES, aiAnalysis: state.aiAnalysis || null, plan: state.plan || null, mempool: state.mempool || null, lastBlockT: state.lastBlockT || null,
        darr: state.darr || null, retarget: state.msig && state.darr ? retargetOf(state.msig.adj, state.darr.v) : null, momentum: state.msig ? state.msig.mom : null,
        window: windowMeter(state.recentBlocks || [], Date.now()), nhWeek: state.nhWeek || null,
        model: FUND_MODEL ? { threshold: FUND_MODEL.threshold, report: FUND_MODEL.report } : null,
        alertScore: state.alertScore ? { summary: alertScoreSummary(state.alertScore, FUND_MODEL ? FUND_MODEL.threshold : 0.5), open: state.alertScore.open.map((o) => Object.assign({}, o, { legs: undefined })), done: state.alertScore.done.slice(-100).reverse() } : null } });
  }
  if (p === '/config' && m === 'PUT') {
    const { config, errors } = sanitizeConfig(body, await getConfig(env), limits);
    if (errors.length) return json({ error: errors.join('; ') }, 400);
    if (config.mode === 'active' && !hasKeys(env)) return json({ error: 'modo ativo exige a NiceHash conectada (Ajustes → Conectar contas)' }, 400);
    const before = await getConfig(env);
    await kvPut(env, 'config', config);
    const st = await kvGet(env, 'state', {}), now = Date.now();
    const keys = { targetPh: 'potência alvo', sessionBudgetUsd: 'stop-loss por tentativa', stopCooldownH: 'espera após stop-loss', dailyBudgetUsd: 'limite diário', minEdgePct: 'margem mínima', mode: 'modo', poolId: 'pool', autoCreate: 'criar ordem sozinho', onBlock: 'ao achar bloco' };
    const changes = Object.keys(keys).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(config[k])).map((k) => ({ k, label: keys[k], from: before[k], to: config[k] }));
    const logs = [{ t: now, kind: 'config', text: `configuração salva (modo ${config.mode})` }];
    if (changes.length) {
      const pm = st.plan && st.plan.mining;
      st.opLog = (st.opLog || []).concat({ t: now, changes, plan: pm ? { ph: pm.ph, budgetUsd: pm.budgetUsd } : null }).slice(-50);
      logs.push({ t: now, kind: 'operador', text: 'Ajuste do operador: ' + changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join('; ') + (pm ? ` (copiloto sugeria ${pm.ph} PH/s e US$${pm.budgetUsd} por sessão)` : '') });
    }
    if (st.market && st.market.bidEH) {
      const mk = Object.assign({ ok: true }, st.market);
      st.plan = Object.assign({}, actionPlan({ cfg: config, limits, mkt: mk, acct: st.acct || null, fund: [], algoMap: st.algoMap || [], capital: config.alertCapital || 1000, pools: FDR.POOLS }),
        { funding: st.plan ? st.plan.funding : null, others: st.plan ? st.plan.others : [] });
    }
    await kvPut(env, 'state', st);
    await appendLog(env, logs);
    return json({ config });
  }
  if (p === '/tick' && m === 'POST') return json(await tick(env, { fetchFn }));
  if (p === '/blocks/backfill' && m === 'POST') {
    // Busca blocos anteriores ao registro (só dados da blockchain; o contexto de mercado não existe para o passado).
    const count = Math.max(1, Math.min(20, +body.count || 20)), chain = chainClient(env, fetchFn);
    const st = await kvGet(env, 'state', {}), list = await kvGet(env, 'blocks', []);
    const all = list.concat(st.blockBuf || []);
    let top = all.length ? Math.min(...all.map((b) => b.h)) - 1 : (st.lastHeight || 0);
    const got = [];
    for (let h = top; h > top - count && h > 0; h--) {
      const cb = await settle(chain.coinbase(h));
      if (!cb.ok) break;
      got.push(Object.assign(blockRecord(cb.v, {}), { backfill: true }));
    }
    const merged = list.concat(got).sort((a, b) => a.h - b.h).filter((b, i, a) => !i || b.h !== a[i - 1].h);
    for (let i = 1; i < merged.length; i++) if (merged[i].dt == null && merged[i].h === merged[i - 1].h + 1) merged[i].dt = Math.round((merged[i].t - merged[i - 1].t) / 1000);
    await kvPut(env, 'blocks', merged.slice(-600));
    return json({ added: got.length, from: got.length ? got[got.length - 1].h : null, to: got.length ? got[0].h : null });
  }
  if (p === '/blocks' && m === 'GET') {
    const st = await kvGet(env, 'state', {});
    const list = (await kvGet(env, 'blocks', [])).concat(st.blockBuf || []).map((b) => Object.assign(b, poolOf(b.tag))); // nomes sempre com a regra atual
    const mk = st.market || {};
    return json({ blocks: list.slice(-300).reverse(), summary: blockSummary(list),
      luck: luckBoard(list, { now: Date.now(), priceEH: mk.bidEH, btcUsd: mk.btcUsd, blockUsd: mk.blockNetUsd, rentFeePct: 3 }) });
  }
  if (p === '/pool/check' && m === 'POST') {
    // Compatibilidade do pool com a Braiins Hashpower (extranonce2_size ≥ 7). Só abre o Stratum e lê a resposta.
    const host = String(body.host || '').trim().toLowerCase().replace(/^stratum\+(tcp|ssl):\/\//, ''), port = +body.port || 3333;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || !(port >= 1 && port <= 65535)) return json({ error: 'host ou porta inválidos' }, 400);
    try { return json(await stratumCheck(host, port, env.CONNECT)); } catch (e) { return json({ ok: false, host, port, error: String(e.message || e) }); }
  }
  if (p === '/funding/verified' && m === 'POST') {
    // Pares conferidos pelo painel no histórico pago de 72 h das corretoras (valem 6 h). Ajuda o robô a decidir igual ao painel
    // até o servidor ter 24 h de histórico próprio do par.
    const st = await kvGet(env, 'state', {}), now = Date.now(), v = st.verified || {};
    for (const x of (Array.isArray(body.pairs) ? body.pairs : []).slice(0, 40)) {
      if (typeof x.key !== 'string' || !/^[A-Za-z0-9.]{1,20}\|[A-Za-z]{2,12}\|[A-Za-z]{2,12}$/.test(x.key)) continue;
      v[x.key] = { stable24: !!x.stable24, expNet: isFinite(x.expNet) ? +x.expNet : null, halfLifeH: isFinite(x.halfLifeH) ? +x.halfLifeH : null, at: now };
    }
    for (const k of Object.keys(v)) if (now - v[k].at > 6 * 3600e3) delete v[k];
    st.verified = v; await kvPut(env, 'state', st);
    return json({ ok: true, pairs: Object.keys(v).length });
  }
  if (p === '/paper/reset' && m === 'POST') {
    const st = await kvGet(env, 'state', {});
    if (body.what === 'funding') { st.fundPaper = null; st.fundPaperAI = null; st.alertScore = null; }
    else if (body.what === 'mining') { st.paper = null; st.paperBurst = null; st.paperPlan = null; st.paperAlways = null; } else if (body.what === 'algos') { st.algoPaper = null; st.algoTs = 0; }
    else if (body.what === 'all') { st.paper = null; st.paperBurst = null; st.paperPlan = null; st.paperAlways = null; st.fundPaper = null; st.fundPaperAI = null; st.algoPaper = null; st.algoTs = 0; } else st.paper = null;
    await kvPut(env, 'state', st);
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: 'simulação reiniciada (' + ({ funding: 'funding', algos: 'outras moedas', all: 'tudo' }[body.what] || 'mineração') + ')' }]);
    return json({ ok: true });
  }
  if (p === '/credentials' && m === 'GET') return json(credStatus(env));
  if (p === '/credentials' && m === 'PUT') return putCredentials(env, body, fetchFn);
  if (p === '/telegram' && m === 'POST') return connectTelegram(env, body, fetchFn);
  if (p === '/log' && m === 'GET') return json({ log: (await kvGet(env, 'log', [])).slice().reverse() });
  if (p === '/kill' && m === 'POST') {
    const cfg = await getConfig(env), done = [], fail = [];
    cfg.mode = 'off'; cfg.autoCreate = false;
    await kvPut(env, 'config', cfg);
    if (hasKeys(env)) for (const id of cfg.managed || []) {
      try { await nh.cancelOrder(id); done.push(id); } catch (e) { fail.push(id + ': ' + e.message); }
    }
    await appendLog(env, [{ t: Date.now(), kind: 'acao', text: `EMERGÊNCIA: robô desligado; ${done.length} ordens canceladas${fail.length ? '; falhas: ' + fail.join(', ') : ''}` }]);
    await notify(env, `emergência acionada: ${done.length} ordens canceladas`, fetchFn);
    return json({ cancelled: done, failed: fail });
  }
  if (p === '/balance' && m === 'GET') { need(); return json(await nh.balance()); }
  if (p === '/pools' && m === 'GET') { need(); return json(await nh.pools()); }
  if (p === '/pools' && m === 'POST') {
    need();
    if (!body.name || !body.host || !(+body.port > 0) || !body.username) return json({ error: 'nome, host, porta e usuário são obrigatórios' }, 400);
    return json(await nh.createPool(body));
  }
  if (p === '/orders' && m === 'GET') {
    need();
    const book = parseBook(await nh.orderBook());
    const [orders, cfg] = await Promise.all([nh.myOrders(book.market), getConfig(env)]);
    return json({ market: book.market, orders: orders.map((o) => Object.assign(o, { managed: (cfg.managed || []).includes(o.id) })) });
  }
  if (p === '/orders' && m === 'POST') {
    need();
    const u = await nh.units();
    const amount = +body.amountBtc, price = +body.priceEH, limit = +body.limitPH;
    if (!(amount >= u.minOrderBtc && amount <= limits.maxOrderBtc)) return json({ error: `valor da ordem deve ficar entre ${u.minOrderBtc} e ${limits.maxOrderBtc} BTC` }, 400);
    if (!(limit >= u.minLimitPH && limit <= limits.maxLimitPh)) return json({ error: `limite deve ficar entre ${u.minLimitPH} e ${limits.maxLimitPh} PH/s` }, 400);
    if (!(price > 0) || !body.poolId) return json({ error: 'preço e pool são obrigatórios' }, 400);
    const market = body.market || parseBook(await nh.orderBook()).market;
    const o = await nh.createOrder({ market, priceEH: price, limitPH: limit, amountBtc: amount, poolId: body.poolId });
    const cfg = await getConfig(env);
    if (body.managed !== false) { cfg.managed = (cfg.managed || []).concat(o.id); await kvPut(env, 'config', cfg); }
    await appendLog(env, [{ t: Date.now(), kind: 'acao', text: `ordem criada manualmente ${o.id}: ${price} BTC/EH/dia · ${limit} PH/s · ${amount} BTC` }]);
    return json(o);
  }
  const mo = /^\/orders\/([\w-]+)(\/refill|\/manage)?$/.exec(p);
  if (mo) {
    const id = mo[1];
    if (mo[2] === '/manage' && m === 'POST') {
      const cfg = await getConfig(env), set = new Set(cfg.managed || []);
      if (body.managed) set.add(id); else set.delete(id);
      cfg.managed = [...set]; await kvPut(env, 'config', cfg);
      return json({ managed: cfg.managed });
    }
    need();
    if (mo[2] === '/refill' && m === 'POST') {
      const amount = +body.amountBtc;
      if (!(amount > 0 && amount <= limits.maxOrderBtc)) return json({ error: `reabastecer entre 0 e ${limits.maxOrderBtc} BTC` }, 400);
      const r = await nh.refillOrder(id, amount);
      await appendLog(env, [{ t: Date.now(), kind: 'acao', text: `ordem ${id} reabastecida com ${amount} BTC` }]);
      return json(r || {});
    }
    if (!mo[2] && m === 'POST') {
      const upd = {};
      if (body.priceEH !== undefined) { if (!(+body.priceEH > 0)) return json({ error: 'preço inválido' }, 400); upd.priceEH = +body.priceEH; }
      if (body.limitPH !== undefined) {
        const u = await nh.units();
        if (!(+body.limitPH >= u.minLimitPH && +body.limitPH <= limits.maxLimitPh)) return json({ error: `limite deve ficar entre ${u.minLimitPH} e ${limits.maxLimitPh} PH/s` }, 400);
        upd.limitPH = +body.limitPH;
      }
      const r = await nh.updateOrder(id, upd);
      await appendLog(env, [{ t: Date.now(), kind: 'acao', text: `ordem ${id} alterada manualmente${upd.priceEH ? ' · preço ' + upd.priceEH : ''}${upd.limitPH !== undefined ? ' · ' + upd.limitPH + ' PH/s' : ''}` }]);
      return json(r || {});
    }
    if (!mo[2] && m === 'DELETE') {
      const r = await nh.cancelOrder(id);
      await appendLog(env, [{ t: Date.now(), kind: 'acao', text: `ordem ${id} cancelada manualmente` }]);
      return json(r || {});
    }
  }
  return json({ error: 'rota não encontrada' }, 404);
}

export default {
  async fetch(req, env, ctx, fetchFn) {
    const url = new URL(req.url), h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    try {
      if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 'funding-desk-api', version: VERSION }, 200, h);
      const pm = /^\/(binance|bybit|nicehash|wtm)(\/.*)$/.exec(url.pathname);
      if (pm) {
        if (req.method !== 'GET') return json({ error: 'só GET' }, 405, h);
        const r = await proxy(pm[1], pm[2], url.search);
        const hh = new Headers(r.headers);
        hh.set('Access-Control-Allow-Origin', '*');
        return new Response(r.body, { status: r.status, headers: hh });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!allowedOrigin(env, req.headers.get('Origin')) && req.headers.get('Origin')) return json({ error: 'origem não permitida' }, 403, h);
        if (!authOk(req, env)) return json({ error: 'token inválido ou PANEL_TOKEN não configurado (mínimo 24 caracteres)' }, 401, h);
        const r = await api(req, await withCreds(env), url, fetchFn);
        for (const [k, v] of Object.entries(h)) r.headers.set(k, v);
        return r;
      }
      return json({ error: 'não encontrado' }, 404, h);
    } catch (e) {
      return json({ error: String(e.message || e) }, e.status || 500, h);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).catch((e) => appendLog(env, [{ t: Date.now(), kind: 'erro', text: 'ciclo falhou: ' + (e.message || e) }])));
  }
};
