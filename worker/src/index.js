// Funding Desk — backend (Cloudflare Worker).
// - Rotas públicas /binance, /bybit, /nicehash: proxy só de leitura de dados de mercado.
// - Rotas /api/*: exigem o token do painel. As chaves da NiceHash e do Telegram são cadastradas pelo painel
//   e guardadas cifradas no KV (ENC_KEY), ou como segredos do Worker. Nunca voltam para o painel.
// - Agendamento (cron): robô de mineração. Começa em modo "observe" (só registra o que faria).
import { createClient, NH_HOSTS, DEFAULT_ALGO } from './nicehash.js';
import { createChain, paidTo, DEFAULT_BCH_REST, DEFAULT_HASKOIN, DEFAULT_PRICE_URL } from './chain.js';
import { DEFAULT_CONFIG, sanitizeConfig, parseBook, computeMarket, sizeMarket, decide, limitsFromEnv, sniperDecide, orderAmount } from './bot.js';
import { fundingSnapshot, runAlerts } from './alerts.js';
import { paperStep, realStep, execStep, execSummary } from './paper.js';
import { fundPaperStep, fundPaperSummary, alertScoreStep, alertScoreSummary } from './paperfund.js';
import FD from '../../core.js';
import FDR from '../../radar.js';
import { algoPaperStep } from './paperalgo.js';
import { xmrPaperStep, xmrSummary, XMR_RULES } from './paperxmr.js';
import { brainContext, ruleReply, aiReply, reportText } from './jarbas.js';
import { runScan, scanHistory } from './scan.js';
import { labStep, labSummary } from './lab.js';
import { repairBookGlitch, repairXmrOutbid } from './repair.js';
import { auditState, auditNews } from './audit.js';
import { arbSources, arbQuotes, arbStep, arbSummary, VENUES as ARB_VENUES } from './arb.js';
import { execStep as arbExecStep, checkKey, ADAPTERS as ARB_ADAPTERS, EXEC_VENUES } from './arbexec.js';
import { braiinsOf, mrrOf, stratumCheck } from './hashmarkets.js';
import { macroOf, marketPanorama } from './panorama.js';
import { entryChecklist } from './entry.js';
import { aiReport } from './report.js';
import { bestScenarios } from './replay.js';
import { bitfinexOf, deribitBasisOf, ethenaOf, hlpOf, zpoolOf, brlOf, cdiOf, lighterTable, lighterRows, lighterOi, lighterPairs, streakStep, frontsPaperStep, asicOf, gpuOf, premiumsOf, spotSpreadOf, polymarketOf, llamaOf, LLAMA_POOLS, LT_FEES } from './fronts.js';
import { FUND_MODEL } from './fundmodel.js';
import { updateHistory, pickCoins, scorePairs, stablePairs, pairStatsOf } from './fundai.js';
import { blockRecord, blockSummary, poolOf, luckBoard, needPH } from './blocks.js';
import { darrOf, retargetOf, momentumOf, windowMeter, weekAdd, marginStats, asertForecast, relativeMinEdge, nextDifficulty, diffVsAvg, triggerFreq } from './signals.js';
import { brainStep, analysis, levelOf, TYPES, actionPlan, bandThreshold, plain, balancePlan } from './brain.js';
import FDI from '../../insights.js';
import { withCreds, reloadCreds, saveCreds, credStatus, parseNiceHash, TG_TOKEN_RE, chatFromUpdates, arbKeys } from './creds.js';

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

// Token só de leitura (para suporte): derivado do PANEL_TOKEN (HMAC), não precisa de segredo novo. Só abre GET /api/status
// e /api/blocks, sem endereço, chaves ou Telegram; não muda nada nem opera. Para revogar, troque o PANEL_TOKEN.
async function readToken(env) {
  const t = env.PANEL_TOKEN;
  if (!t || t.length < 24) return null;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(t), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('funding-desk/leitura/v1')));
  return 'leitura-' + Array.from(sig.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function readOk(req, env, url) {
  if (req.method !== 'GET' || !['/api/status', '/api/blocks'].includes(url.pathname)) return false;
  const rt = await readToken(env), h = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return !!rt && safeEqual(h, rt);
}

/* ---------- armazenamento (KV) ---------- */
// Armazenamento: o KV do plano gratuito aceita só 1.000 gravações por dia (estourou em 04/11 com o vigia a cada minuto).
// Com o Durable Object FD_STORE (SQLite, ~100 mil gravações por dia no gratuito), tudo é lido e gravado nele; o KV fica
// só como origem na primeira leitura de cada chave (migração automática). Sem FD_STORE (testes), usa o KV como antes.
const CHUNK = 120000;
function store(env) { return env.FD_STORE.get(env.FD_STORE.idFromName('main')); }
async function storeGet(env, key) {
  const r = await store(env).fetch('https://store/get?k=' + encodeURIComponent(key));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('armazenamento: HTTP ' + r.status);
  return r.text();
}
async function storePut(env, key, text) {
  const r = await store(env).fetch('https://store/put?k=' + encodeURIComponent(key), { method: 'PUT', body: text });
  if (!r.ok) throw new Error('armazenamento: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
}
async function kvGet(env, key, def) {
  if (env.FD_STORE) {
    let v = await storeGet(env, key);
    if (v === null && env.FD_KV) { v = await env.FD_KV.get(key); if (v) await storePut(env, key, v); } // migração da chave
    return v ? JSON.parse(v) : def;
  }
  if (!env.FD_KV) throw new Error('KV FD_KV não configurado no Worker');
  const v = await env.FD_KV.get(key);
  return v ? JSON.parse(v) : def;
}
async function kvPut(env, key, val) {
  if (env.FD_STORE) return storePut(env, key, JSON.stringify(val));
  await env.FD_KV.put(key, JSON.stringify(val));
}
// Durable Object do armazenamento: guarda cada chave em pedaços de 120 KB (limite de valor do armazenamento).
export class StoreDO {
  constructor(state) { this.st = state.storage; }
  async fetch(req) {
    const u = new URL(req.url), k = u.searchParams.get('k');
    if (!k) return new Response('sem chave', { status: 400 });
    if (u.pathname === '/get') {
      const n = await this.st.get('n:' + k);
      if (n === undefined) return new Response('', { status: 404 });
      const keys = Array.from({ length: n }, (_, i) => 'c:' + k + ':' + i), parts = await this.st.get(keys);
      return new Response(keys.map((x) => parts.get(x) || '').join(''));
    }
    if (u.pathname === '/put' && req.method === 'PUT') {
      const text = await req.text(), n = Math.max(1, Math.ceil(text.length / CHUNK)), obj = { ['n:' + k]: n };
      for (let i = 0; i < n; i++) obj['c:' + k + ':' + i] = text.slice(i * CHUNK, (i + 1) * CHUNK);
      const old = await this.st.get('n:' + k);
      await this.st.put(obj);
      if (old > n) await this.st.delete(Array.from({ length: old - n }, (_, i) => 'c:' + k + ':' + (n + i)));
      return new Response('ok');
    }
    return new Response('rota', { status: 404 });
  }
}
async function getConfig(env) { return Object.assign({}, DEFAULT_CONFIG, await kvGet(env, 'config', {})); }
async function appendLog(env, entries) {
  if (!entries.length) return;
  const log = await kvGet(env, 'log', []);
  const next = log.concat(entries.map((x) => (x && typeof x.text === 'string' ? Object.assign({}, x, { text: plain(x.text) }) : x))).slice(-LOG_MAX); // texto claro, sem símbolos
  await kvPut(env, 'log', next);
}

/* ---------- clientes ---------- */
function nhClient(env, fetchFn) {
  const base = env.NH_BASE || NH_HOSTS[env.NH_ENV === 'prod' ? 'prod' : 'test'];
  return createClient({ base, key: env.NH_API_KEY, secret: env.NH_API_SECRET, org: env.NH_ORG_ID, algorithm: env.NH_ALGO || DEFAULT_ALGO, fetchFn: fetchFn || fetch });
}
function chainClient(env, fetchFn) {
  return createChain({ base: env.BCH_REST || DEFAULT_BCH_REST, haskoin: env.HASKOIN_URL === 'off' ? null : (env.HASKOIN_URL ? env.HASKOIN_URL.split(',') : (env.BCH_REST ? null : DEFAULT_HASKOIN)), priceUrl: env.PRICE_URL || DEFAULT_PRICE_URL, fetchFn: fetchFn || fetch });
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
// Arbitragem de stablecoins: lê ~30 fontes públicas, calcula as oportunidades líquidas, simula em papel e, se o robô
// estiver em ensaio ou real, passa a melhor oportunidade direta confirmada para o executor. Roda nos minutos 2, 5, 8...
export async function arbScan(env, opts = {}) {
  env = await withCreds(env);
  const fetchFn = opts.fetchFn || fetch, now = opts.now || Date.now(), cfg = await getConfig(env), st = await kvGet(env, 'state', {});
  const get = async (src) => {
    try {
      const init = src.body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(src.body) } : { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } };
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(8000);
      const r = await fetchFn(src.url, init); if (!r.ok) return { src, ok: false, err: 'HTTP ' + r.status };
      return { src, ok: true, json: await r.json() };
    } catch (e) { return { src, ok: false, err: String(e.message || e).slice(0, 60) }; }
  };
  const res = await Promise.all(arbSources().map(get)), errs = {};
  const quotes = arbQuotes(res); for (const r of res) if (!r.ok) errs[r.src.v.split(':')[0]] = r.err;
  const brl = st.fronts && st.fronts.brl && st.fronts.brl.ptax, prev = await kvGet(env, 'arb', null);
  const r = arbStep(prev, { now, quotes, errs, brlUsd: brl || null });
  const A = r.arb, events = [];
  // Telegram: só a primeira vez em 6 h que uma rota se confirma acima da margem mínima (o resto fica no painel)
  A.told = A.told || {};
  for (const o of r.confirmed.slice(0, 3)) if (!A.told[o.id] || now - A.told[o.id] > 6 * 3600e3) { A.told[o.id] = now; events.push(`Arbitragem: ${o.type} ${o.pair} — ${o.route || `compra na ${(ARB_VENUES[o.buy] || {}).name || o.buy} a ${o.buyPx}, vende na ${(ARB_VENUES[o.sell] || {}).name || o.sell} a ${o.sellPx}`}: ${o.netPct.toFixed(3).replace('.', ',')}% líquido de taxas (bruto ${o.grossPct.toFixed(3).replace('.', ',')}%), confirmada em duas leituras.`); }
  for (const k of Object.keys(A.told)) if (now - A.told[k] > 864e5) delete A.told[k];
  // robô: a melhor direta confirmada entre corretoras que ele sabe operar
  const cand = r.confirmed.find((o) => o.type === 'direta' && !o.dex && EXEC_VENUES.includes(o.buy) && EXEC_VENUES.includes(o.sell)) || null;
  try { const x = await arbExecStep(A.exec, { opp: cand, cfg, keys: arbKeys(env), fetchFn, now }); A.exec = x.exec; events.push(...x.events); }
  catch (e) { A.exec = Object.assign({}, A.exec, { lastErr: { t: now, msg: String(e.message || e).slice(0, 120) } }); }
  await kvPut(env, 'arb', A);
  for (const e of events) await notify(env, e, fetchFn);
  if (events.length) await appendLog(env, events.map((text) => ({ t: now, kind: /REAL|ensaio/.test(text) ? 'acao' : 'simulado', text })));
  return A;
}

export async function tick(env, opts = {}) {
  env = await withCreds(env);
  const fetchFn = opts.fetchFn || fetch, now = opts.now || Date.now();
  const cfg = await getConfig(env), limits = limitsFromEnv(env);
  const state = await kvGet(env, 'state', {});
  const nh = nhClient(env, fetchFn), chain = chainClient(env, fetchFn);
  const log = [], errors = [];
  { const rp = repairBookGlitch(state); for (const n of rp.notes) log.push({ t: now, kind: 'acao', text: 'Correção do histórico (livro com preço absurdo em 04/11 18:06): ' + n }); }

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
        log.push({ t: now, kind: 'bloco', text: `Bloco ${h} pago no seu endereço: ${mine.toFixed(8).replace('.', ',')} BCH` });
        await notify(env, `bloco ${h} encontrado! ${mine.toFixed(4).replace('.', ',')} BCH no seu endereço`, fetchFn);
      }
      state.lastHeight = h;
    }
  }

  // Pool apagado ao salvar a configuração com a lista de pools sem carregar (04/11): volta o último pool escolhido, uma vez.
  if (!cfg.poolId && !state.poolFix1) {
    const ch = (state.opLog || []).map((x) => (x.changes || []).find((c) => c.k === 'poolId')).filter(Boolean).pop();
    if (ch && ch.from && !ch.to) {
      cfg.poolId = ch.from;
      await kvPut(env, 'config', Object.assign(await kvGet(env, 'config', {}), { poolId: ch.from }));
      log.push({ t: now, kind: 'config', text: 'Pool das ordens do robô restaurado (tinha sido apagado ao salvar a configuração com a lista de pools sem carregar)' });
    }
    state.poolFix1 = true;
  }
  // Calibração do Sniper v3 (03/11): aplica uma vez os parâmetros pedidos à configuração salva (o usuário pode mudar depois).
  // v4 (03/11): gatilho de dificuldade em 0,5% (com a dificuldade do próximo bloco, 1% disparava em 2,4% das viradas; 0,5% em ~14%).
  if (cfg.sniperCalV === 3) {
    cfg.sniperDiffDropPct = 0.5; cfg.sniperCalV = 4;
    await kvPut(env, 'config', Object.assign(await kvGet(env, 'config', {}), { sniperDiffDropPct: 0.5, sniperCalV: 4 }));
    log.push({ t: now, kind: 'config', text: 'Sniper: dificuldade agora é a do bloco em mineração (fórmula da rede) e o gatilho passou para 0,5% abaixo da média de 12 blocos' });
  }
  if (cfg.sniperCalV !== 3 && cfg.sniperCalV !== 4) {
    Object.assign(cfg, { sniperDiffDropPct: 0.5, sniperUseAge: true, sniperAgeMin: 15, sniperFeeX: 100, sniperMinEdge: -7, sniperShotMin: 7, sniperCalV: 4 });
    const saved = await kvGet(env, 'config', {});
    await kvPut(env, 'config', Object.assign(saved, { sniperDiffDropPct: 0.5, sniperUseAge: true, sniperAgeMin: 15, sniperFeeX: 100, sniperMinEdge: -7, sniperShotMin: 7, sniperCalV: 4 }));
    log.push({ t: now, kind: 'config', text: 'Sniper recalibrado: dificuldade 0,5% abaixo da média de 12 blocos, atraso de 15 min, mempool 100 (desligada), trava de margem −7%, prazo do tiro 7 min, um tiro por bloco' });
  }
  // Regra relativa de entrada (opcional): troca a margem mínima pela dos melhores momentos das últimas 24 h, com piso.
  if (cfg.minEdgeMode === 'relativo') {
    const r = relativeMinEdge(state.edgeHist, { now, fixAt: state.paperArchive && state.paperArchive.at, pct: cfg.relPct || 75, floor: cfg.relFloorPct === undefined ? -2 : cfg.relFloorPct });
    if (r !== null) { cfg.minEdgeBase = cfg.minEdgePct; cfg.minEdgePct = r; cfg.minEdgeRel = true; }
  }
  const saveCfg = () => Object.assign({}, cfg, cfg.minEdgeRel ? { minEdgePct: cfg.minEdgeBase } : {}, { minEdgeBase: undefined, minEdgeRel: undefined });
  const mkt = computeMarket({
    D: info.ok ? info.v.difficulty : null, bchUsd: prices.ok ? prices.v.bchUsd : null, btcUsd: prices.ok ? prices.v.btcUsd : null,
    feesBch: state.feesBch || 0, book, cfg
  });

  let orders = [], ordersOk = false;
  if (hasKeys(env) && book) {
    const r = await settle(nh.myOrders(book.market));
    if (r.ok) { orders = r.v; ordersOk = true; } else errors.push('ordens: ' + r.e);
  }
  // perda real dos últimos 7 dias (UTC): gasto − recebido das ordens gerenciadas e blocos pagos
  const weekLossUsd = (() => { const d = (state.real && state.real.days) || {}, from = new Date(now - 6 * 864e5).toISOString().slice(0, 10);
    return Object.entries(d).filter(([k]) => k >= from).reduce((a, [, x]) => a + (x.spendUsd || 0) - (x.revenueUsd || 0), 0); })();
  // horário do último bloco da rede (para o MODO_SNIPER): o mais novo entre o registro e os blocos deste ciclo
  const tipInfo = info.ok && info.v.time && info.v.height > (state.lastHeight || 0) ? [info.v.time] : []; // bloco que a reserva viu e o detalhe ainda não
  const lastNetBlockT = Math.max(state.lastBlockT || 0, ...newBlocks.map((b) => b.time || 0), ...tipInfo) || null;
  const lastNetHeight = Math.max(state.lastHeight || 0, ...newBlocks.map((b) => b.height || 0), info.ok ? info.v.height || 0 : 0) || null; // ID do último bloco (altura)
  const tipSeen = state.tipSeen && state.tipSeen.h >= (lastNetHeight || 0) ? state.tipSeen : { h: lastNetHeight, at: (state.tipSeen && state.tipSeen.h) ? now : null }; // quando o servidor viu este bloco pela primeira vez
  // MODO_SNIPER: sinais de dificuldade (DAA) e de mempool.
  // dHist: dificuldade dos últimos 12 blocos; queda = dificuldade de agora abaixo da média deles.
  let dHist = Array.isArray(state.dHist) ? state.dHist.slice() : (await kvGet(env, 'blocks', [])).slice(-12).map((b) => b.D).filter((x) => x > 0);
  for (const b of newBlocks) if (b.difficulty > 0) dHist.push(b.difficulty);
  dHist = dHist.slice(-12);
  // Dificuldade de AGORA = a do bloco que está sendo minerado (ASERT a partir do último bloco e do intervalo dele).
  // Antes usava a do último bloco minerado, que ainda não reflete a demora dele (atrasava um bloco).
  let tHist = Array.isArray(state.tHist) ? state.tHist.slice() : (await kvGet(env, 'blocks', [])).slice(-2).map((b) => [b.h, b.t]);
  for (const b of newBlocks) if (b.time) tHist.push([b.height, b.time]);
  tHist = tHist.sort((a, b) => a[0] - b[0]).filter((x, i, a) => !i || x[0] !== a[i - 1][0]).slice(-3);
  const tipD = info.ok ? info.v.difficulty : null, tip = tHist[tHist.length - 1], pre = tHist[tHist.length - 2];
  const tipDt = info.ok && tip && pre && tip[0] === info.v.height && pre[0] === tip[0] - 1 ? (tip[1] - pre[1]) / 1000 : null;
  const dNow = tipD ? nextDifficulty(tipD, tipDt) : null, dAvg = dHist.length >= 6 ? dHist.reduce((a, x) => a + x, 0) / dHist.length : null;
  const diffDropPct = dNow && dAvg ? (1 - dNow / dAvg) * 100 : null;
  // mpHist: tamanho da mempool a cada 15 min nas últimas 24 h; cheia = tamanho de agora dividido pela média.
  let mpHist = Array.isArray(state.mpHist) ? state.mpHist.filter((x) => now - x[0] <= 864e5) : [];
  const mpBytes = mpR.ok && mpR.v ? +mpR.v.bytes || 0 : null;
  if (mpBytes !== null && (!mpHist.length || now - mpHist[mpHist.length - 1][0] >= 15 * 60e3)) mpHist.push([now, mpBytes]);
  const mpAvg = mpHist.length >= 8 ? mpHist.reduce((a, x) => a + x[1], 0) / mpHist.length : null;
  const feeX = mpBytes !== null && mpAvg > 0 ? mpBytes / mpAvg : null;
  const snMetrics = { diffDropPct, feeX };
  const snInfo = { at: now, dNow, dTip: tipD, tipDt, dAvg, diffDropPct, mpBytes, mpAvg, feeX, feeBchMin: mpBytes !== null ? mpBytes * 1e-8 : null };
  // saldo da carteira a cada ciclo (para criar a ordem com o máximo disponível e reabastecer quando entra saldo)
  const balR = hasKeys(env) ? await settle(nh.balance()) : null, walletBtc = balR && balR.ok ? +(balR.v.available || 0) : null;
  const dec = decide({ cfg, mkt, orders, state, now, units, limits, blockEvent, weekLossUsd, blockT: lastNetBlockT, blockId: lastNetHeight, snMetrics, walletBtc });
  // Fora do modo Ativo o robô real não atira: o Sniper real fica parado (o simulado continua no cenário Sniper).
  if (cfg.mode !== 'active' && dec.state.sniper) dec.state.sniper = Object.assign({}, state.sniper || {}, { shotStart: null });
  if (dec.state.weekStop && !state.weekStop) await notify(env, `limite de perda semanal atingido (perda real de US$${weekLossUsd.toFixed(2).replace('.', ',')} em 7 dias; limite US$${cfg.weeklyLossUsd}). Robô encerrou as ordens e não cria novas até a perda da semana baixar.`, fetchFn);

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
  // As simulações rodam sempre, em qualquer modo (antes paravam no Ativo e o lastro dos cenários ficava com buraco).
  {
    const ps = paperStep(paper, { cfg, mkt, now, units, limits, blocks: newBlocks });
    paper = ps.paper;
    for (const e of ps.events) log.push({ t: now, kind: 'simulado', text: e });
  }
  // Registro dos blocos da rede com o contexto do momento (padrões e coincidências). Grava no KV a cada 20 min.
  let blockBuf = state.blockBuf || [], blockFlush = state.blockFlush || 0, lastBlockT = state.lastBlockT || null;
  {
    const won = new Set(((paper && paper.wins) || []).map((w) => w.height)), sp = state.paper;
    for (const b of newBlocks) {
      const on = !!(sp && sp.on && sp.ph > 0);
      const prob = on && b.difficulty ? Math.min(1, sp.ph * 1e15 / (b.difficulty * 4294967296 / 600)) : 0; // mesma conta da simulação
      const realPH = orders.filter((o) => o.alive && (cfg.managed || []).includes(o.id)).reduce((x, o) => x + (o.speedPH || 0), 0);
      blockBuf.push(blockRecord(b, { prevT: lastBlockT, mkt, book, sim: { ph: on ? sp.ph : 0, prob, won: won.has(b.height), priceEH: on ? sp.priceEH : null }, mineBch: b.mine, realPH }));
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
  paperBurst = paperStep(paperBurst, { cfg: Object.assign({}, cfg, { targetPh: 50, onBlock: 'cancel' }), mkt: sizeMarket(mkt, 50, cfg), now, units, limits, blocks: newBlocks }).paper;
  // Cenário "sugestão do copiloto": potência e orçamento do plano, mesmos blocos e sorteio (compara com a sua configuração).
  let paperPlan = state.paperPlan || null;
  const pmS = state.plan && state.plan.mining;
  if (pmS) paperPlan = paperStep(paperPlan, { cfg: Object.assign({}, cfg, { targetPh: pmS.ph, sessionBudgetUsd: pmS.budgetUsd, onBlock: 'cancel' }), mkt: sizeMarket(mkt, pmS.ph, cfg), now, units, limits, blocks: newBlocks }).paper;
  else if (paperPlan) paperPlan.lastTs = now;
  // Cenário "sempre ligado": sua potência sem pausar pelo preço e sem stop-loss, mesmos blocos e sorteio. Responde
  // "se ficasse ligado direto teria mais bloco?": mais chance, mas paga também as horas com aluguel acima do teto.
  let paperAlways = state.paperAlways || null;
  paperAlways = paperStep(paperAlways, { cfg: Object.assign({}, cfg, { sessionBudgetUsd: 0, dailyBudgetUsd: 0, onBlock: 'continue' }),
    mkt: mkt.ok ? Object.assign({}, mkt, { green: true }) : mkt, now, units, limits, blocks: newBlocks }).paper;
  // Cenário Sniper (simulado, sempre ligado para comparar): mesma regra do robô (sniperDecide), mesmos blocos e sorteio.
  let paperSniper = state.paperSniper || null;
  if (mkt.ok) {
    const sd = sniperDecide(paperSniper && paperSniper.sn, Object.assign({ now, blockT: lastNetBlockT, blockId: lastNetHeight, edge: sizeMarket(mkt, Math.min(cfg.sniperPh || 25, limits.maxLimitPh), cfg).edgeAtBidPct, cfg }, snMetrics));
    const php = sd.shot ? Math.min(cfg.sniperPh || 25, limits.maxLimitPh) : Math.max(cfg.sniperIdlePh === undefined ? 1 : cfg.sniperIdlePh, units.minLimitPH || 1);
    const ps = paperStep(paperSniper, { cfg: Object.assign({}, cfg, { targetPh: php, minPh: php, onBlock: 'continue', dailyBudgetUsd: 0 }), mkt: Object.assign({}, sizeMarket(mkt, php, cfg), { green: true }), now, units, limits, blocks: newBlocks });
    paperSniper = Object.assign(ps.paper, { sn: sd.state, shot: sd.shot, reason: sd.reason, ageMin: sd.ageMin });
  } else if (paperSniper) paperSniper.lastTs = now;
  // Os 5 cenários que teriam dado mais lucro na janela dos cenários acompanhados (worker/src/replay.js), a cada 15 min.
  let bestScen = state.bestScen || null, luck24 = state.luck24 || null;
  if (mkt.ok && now - ((bestScen && bestScen.at) || 0) >= 15 * 60e3) {
    try {
      const list = (await kvGet(env, 'blocks', [])).concat(blockBuf);
      // blocos das últimas 24 h por potência (contexto para minerar): quantos sairiam com cada potência
      const lb = luckBoard(list, { now, priceEH: mkt.bidEH, btcUsd: mkt.btcUsd, blockUsd: mkt.blockNetUsd, rentFeePct: cfg.rentFeePct || 3, windows: [24] });
      const W24 = lb && lb.windows && lb.windows[0];
      if (W24) { const needs = list.filter((r) => r.t >= now - 864e5).map(needPH).filter((x) => x !== null).sort((a, b) => a - b);
        luck24 = { at: now, blocks: W24.blocks, minNeedPH: W24.minNeedPH, medNeedPH: needs.length ? needs[Math.floor(needs.length / 2)] : null,
          rows: W24.rows.map((r) => ({ ph: r.ph, won: r.won, expected: +r.expected.toFixed(2), profitUsd: +r.profitUsd.toFixed(0), expPct: r.expPct === null ? null : +r.expPct.toFixed(1) })) }; }
      bestScen = bestScenarios(list, { now, since: (paperAlways && paperAlways.since) || (paper && paper.since) || null, fixAt: paperArchive && paperArchive.at, cfg, btcUsd: mkt.btcUsd, blockUsd: mkt.blockNetUsd }) || bestScen;
    } catch (e) { errors.push('melhores cenários: ' + (e.message || e)); }
  }
  // Registro de execução em qualquer modo (o teste de calibração roda em Observar) e o teste de calibração em si:
  // ordem pequena fora do controle do robô, encerrada sozinha no prazo, com o resultado comparado à simulação.
  let calib = state.calib || null;
  const calibId = calib && !calib.done ? calib.id : null;
  const execLog = orders.length ? execStep(state.execLog, { orders, managedIds: (cfg.managed || []).concat(calib ? [calib.id] : []), now }) : (state.execLog || null);
  if (calibId && hasKeys(env)) {
    const o = orders.find((x) => x.id === calibId), over = now >= calib.until;
    // quanto do tempo o mercado esteve acima do preço da ordem (sem hash por causa do mercado, não por falha)
    if (book && book.fillEH && now < calib.until) calib = Object.assign({}, calib, { ticks: (calib.ticks || 0) + 1, outbid: (calib.outbid || 0) + (book.fillEH > calib.priceEH ? 1 : 0) });
    if (over && o && o.alive) { const r = await settle(nh.cancelOrder(calibId)); if (!r.ok) errors.push('calibração: ' + r.e); }
    if (over || (o && !o.alive) || (!o && now - calib.start > 15 * 60e3)) {
      // valor final pago (a NiceHash lança o pagamento com atraso; depois de encerrar, a ordem some da lista)
      const fin = await settle(nh.getOrder(calibId));
      if (fin.ok && execLog && execLog.orders && execLog.orders[calibId]) { const x = execLog.orders[calibId]; x.paidBtc = Math.max(x.paidBtc, (fin.v.paidBtc || 0) - (x.paid0 || 0)); }
      const e = execLog && execLog.orders && execLog.orders[calibId], btc = mkt.ok ? mkt.btcUsd : (state.market && state.market.btcUsd) || 0;
      const hours = Math.max(0, ((e && e.lastTs) || now) - calib.start) / 3600e3;
      const paidUsd = e ? e.paidBtc * btc : 0, simUsd = calib.ph / 1000 * calib.priceEH * btc * hours / 24; // sem a taxa de 3%: compara com o pago na ordem
      const delivered = e && e.n ? e.ratioSum / e.n : null, toHashMin = e && e.firstHash ? Math.round((e.firstHash - calib.start) / 60e3) : null;
      const effEH = e && e.ehDays > 0 ? e.paidBtc / e.ehDays : null;
      calib = Object.assign({}, calib, { done: now, result: { hours, paidUsd, simUsd, diffPct: simUsd > 0 ? (paidUsd / simUsd - 1) * 100 : null, delivered, toHashMin,
        effEH, effVsPricePct: effEH ? (effEH / calib.priceEH - 1) * 100 : null, outbidPct: calib.ticks ? calib.outbid / calib.ticks * 100 : null } });
      const R = calib.result;
      log.push({ t: now, kind: 'acao', text: `Teste de calibração encerrado: ${R.hours.toFixed(1).replace('.', ',')} h, gasto real US$${R.paidUsd.toFixed(2).replace('.', ',')} contra US$${R.simUsd.toFixed(2).replace('.', ',')} simulados; entrega média ${delivered !== null ? (delivered * 100).toFixed(0) + '%' : 'sem dado'}; hash chegou em ${toHashMin !== null ? toHashMin + ' min' : 'sem dado'}` });
      await notify(env, `teste de calibração encerrado. Duração ${R.hours.toFixed(1).replace('.', ',')} h; gasto real US$${R.paidUsd.toFixed(2).replace('.', ',')}; gasto simulado US$${R.simUsd.toFixed(2).replace('.', ',')} (diferença US$${(R.paidUsd - R.simUsd).toFixed(2).replace('.', ',')}); entrega média ${delivered !== null ? (delivered * 100).toFixed(0) + '%' : 'sem dado'}; hash chegou em ${toHashMin !== null ? toHashMin + ' min' : 'sem dado'}. Detalhes em Mineração → Operar.`, fetchFn);
    }
  }
  const real = realStep(state.real, { orders, managedIds: (cfg.managed || []).concat(calib ? [calib.id] : []), blockEvent, now,
    btcUsd: mkt.btcUsd || (prices.ok ? prices.v.btcUsd : 0), bchUsd: mkt.bchUsd || (prices.ok ? prices.v.bchUsd : 0) });

  // Execução: só no modo ativo. No modo observar, registra o que faria.
  const results = [];
  // Teste do robô: quando a espera depois do stop-loss termina, o teste acaba neste ciclo; não cria ordem nova.
  { const RT = state.robotTest, su = dec.state.stopUntil || state.stopUntil;
    if (RT && !RT.done && RT.checks && RT.checks.stop && su && now >= su) dec.actions = dec.actions.filter((a) => a.type !== 'create'); }
  for (const a of dec.actions) {
    if (cfg.mode !== 'active' || !hasKeys(env)) { results.push(Object.assign({ executed: false }, a)); continue; }
    try {
      if (a.type === 'cancel') await nh.cancelOrder(a.id);
      if (a.type === 'update') {
        try { await nh.updateOrder(a.id, { priceEH: a.priceEH, limitPH: a.limitPH }); }
        catch (e) {
          // 5061: a NiceHash só deixa baixar o preço 10 min depois da última mudança (a dela pode não bater com a nossa:
          // criação da ordem, ciclo em outro datacenter). Aplica a potência com o preço atual e agenda a baixa para quando ela libera.
          const m = /Seconds till available: (\d+)/.exec(String(e.message || ''));
          const cur = orders.find((o) => o.id === a.id);
          if (!/5061/.test(String(e.message || '')) || !cur) throw e;
          const secs = m ? +m[1] : 600;
          dec.state.lastPriceChange = dec.state.lastPriceChange || {}; dec.state.lastDecrease = dec.state.lastDecrease || {};
          dec.state.lastPriceChange[a.id] = now - Math.max(0, 600 - secs) * 1000; dec.state.lastDecrease[a.id] = 0;
          if (Math.abs(cur.limitPH - a.limitPH) >= 0.001) await nh.updateOrder(a.id, { priceEH: cur.priceEH, limitPH: a.limitPH });
          a.priceEH = cur.priceEH; a.reason += `; preço só baixa em ${Math.round(secs / 60)} min (regra da NiceHash)`;
          log.push({ t: now, kind: 'acao', text: `NiceHash ainda não deixa baixar o preço da ordem ${a.id.slice(0, 8)} (faltam ${secs} s): potência ajustada para ${a.limitPH} PH/s com o preço atual` });
        }
      }
      if (a.type === 'refill') await nh.refillOrder(a.id, a.amountBtc);
      if (a.type === 'create') {
        const o = await nh.createOrder(a);
        a.id = o.id;
        dec.state.lastPriceChange = dec.state.lastPriceChange || {}; dec.state.lastPriceChange[o.id] = now; // criar conta como mudança de preço na NiceHash
        cfg.managed = (cfg.managed || []).concat(o.id);
        await kvPut(env, 'config', saveCfg());
      }
      results.push(Object.assign({ executed: true }, a));
      if (a.type !== 'update') await notify(env, plain(`${a.type === 'cancel' ? 'ordem encerrada' : a.type === 'refill' ? 'ordem reabastecida' : 'ordem criada'}: ${a.reason}`), fetchFn);
    } catch (e) {
      results.push(Object.assign({ executed: false, error: String(e.message || e) }, a));
      errors.push(`${a.type} ${a.id || ''}: ${e.message || e}`);
    }
  }

  // Fim de ordem, sem ambiguidade: a NiceHash tira da lista as ordens que acabaram. Para cada ordem gerenciada que sumiu,
  // pergunta o status final e diz o motivo (acabou o saldo da ordem, encerrada pelo robô, encerrada fora do robô), o que
  // acontece agora (nova ordem com o saldo da carteira ou falta saldo) e tira a ordem da lista do robô.
  let ordSeen = Object.assign({}, state.ordSeen || {}), orderEnds = Array.isArray(state.orderEnds) ? state.orderEnds.slice(-19) : [];
  if (ordersOk) {
    const aliveIds = new Set(orders.filter((o) => o.alive).map((o) => o.id)), cancelledNow = new Set(results.filter((r) => r.type === 'cancel' && r.executed).map((r) => r.id));
    for (const o of orders) if (o.alive && (cfg.managed || []).includes(o.id)) ordSeen[o.id] = { amount: o.amountBtc, paid: o.paidBtc, avail: o.availableBtc, at: now, by: (ordSeen[o.id] || {}).by || null };
    for (const id of cancelledNow) if (ordSeen[id]) ordSeen[id].by = 'robo';
    const createdNow = new Set(results.filter((r) => r.type === 'create' && r.executed).map((r) => r.id));
    const gone = [...new Set(Object.keys(ordSeen).concat(cfg.managed || []))].filter((id) => !aliveIds.has(id) && !createdNow.has(id) && !(calib && calib.id === id));
    for (const id of gone.slice(0, 3)) {
      const was = ordSeen[id] || { legacy: true }, fin = await settle(nh.getOrder(id)), f = fin.ok ? fin.v : null;
      if (!f && was.legacy) { cfg.managed = (cfg.managed || []).filter((x) => x !== id); await kvPut(env, 'config', Object.assign(await kvGet(env, 'config', {}), { managed: cfg.managed })); continue; } // sem dado nenhum: só limpa
      if (f && f.alive && !/COMPLET|CANCEL|EXPIRED|DEAD/i.test(String(f.status || ''))) continue; // ainda viva (só não veio na lista)
      const paid = f ? f.paidBtc : was.paid, amount = f ? f.amountBtc : was.amount, st = f ? String(f.status || '') : '';
      const why = was.by === 'robo' || /CANCEL/i.test(st) && was.by === 'robo' ? 'robo' : (/COMPLET|EXPIRED/i.test(st) || (amount > 0 && amount - paid < 0.00005)) ? 'saldo' : 'fora';
      const nextAmt = orderAmount(cfg, units, limits, walletBtc), btc = mkt.btcUsd || 0, f6 = (x) => (x || 0).toFixed(6).replace('.', ',');
      const after = why === 'robo' ? '' : nextAmt !== null && cfg.autoCreate && cfg.poolId ? ` O robô cria a próxima ordem com ${f6(nextAmt)} BTC do saldo da carteira.` : ` Saldo livre na carteira: ${f6(walletBtc)} BTC; não dá para abrir outra ordem (mínimo 0,00101 BTC). Deposite na NiceHash para o robô continuar.`;
      const text = why === 'saldo' ? `Ordem ${id.slice(0, 8)} encerrada: acabou o saldo da ordem (gastou ${f6(paid)} de ${f6(amount)} BTC${btc ? ', US$' + (paid * btc).toFixed(2).replace('.', ',') : ''}).${after}`
        : why === 'robo' ? `Ordem ${id.slice(0, 8)} encerrada pelo robô (gastou ${f6(paid)} BTC).` : `Ordem ${id.slice(0, 8)} encerrada fora do robô${st ? ' (status na NiceHash: ' + st + ')' : ''}; gastou ${f6(paid)} de ${f6(amount)} BTC.${after}`;
      orderEnds.push({ t: now, id, why, paid, amount, status: st, text });
      log.push({ t: now, kind: 'acao', text });
      if (why !== 'robo' && !(was.legacy && !(f && f.createdTs && now - f.createdTs < 24 * 3600e3))) await notify(env, text, fetchFn); // ordens antigas: só registra
      delete ordSeen[id];
      if ((cfg.managed || []).includes(id)) { cfg.managed = cfg.managed.filter((x) => x !== id); await kvPut(env, 'config', Object.assign(await kvGet(env, 'config', {}), { managed: cfg.managed })); }
    }
    // saldo da ordem acabando: avisa uma vez por ordem quando não cobre o próximo tiro e a carteira não tem como reabastecer
    if (cfg.sniper) for (const o of orders.filter((x) => x.alive && (cfg.managed || []).includes(x.id))) {
      const shotBtc = Math.min(cfg.sniperPh || 25, limits.maxLimitPh) / 1000 * (o.priceEH || 0) * (cfg.sniperShotMin || 7) / 1440 * 1.03;
      if (shotBtc > 0 && o.availableBtc < shotBtc && !(walletBtc > 0.0002) && !(ordSeen[o.id] || {}).lowWarn) {
        ordSeen[o.id].lowWarn = now;
        const t2 = `Ordem ${o.id.slice(0, 8)} com pouco saldo: restam ${o.availableBtc.toFixed(6).replace('.', ',')} BTC, menos que um tiro de ${Math.min(cfg.sniperPh || 25, limits.maxLimitPh)} PH/s por ${cfg.sniperShotMin || 7} min (~${shotBtc.toFixed(6).replace('.', ',')} BTC). Quando acabar a ordem encerra; deposite para o robô reabastecer.`;
        log.push({ t: now, kind: 'acao', text: t2 }); await notify(env, t2, fetchFn);
      }
    }
  }
  // Jarbas: mantém o webhook do Telegram apontado para este servidor e manda o relatório do dia (08h de Brasília).
  let tgHook = state.tgHook || null, dailyRep = state.dailyRep || null;
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID && !opts.watch) {
    const self = await kvGet(env, 'self', {}), sec = await tgSecret(env);
    if (self.url && sec) {
      const tag = self.url + '#' + sec.slice(0, 6);
      if (!tgHook || tgHook.tag !== tag || (!tgHook.ok && now - tgHook.at > 30 * 60e3) || now - tgHook.at > 24 * 3600e3) {
        const r = await settle(fetchFn((env.TG_BASE || 'https://api.telegram.org') + '/bot' + env.TELEGRAM_BOT_TOKEN + '/setWebhook', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: self.url + '/tg/' + sec, secret_token: sec, allowed_updates: ['message', 'edited_message'] }) }).then((x) => x.json()));
        tgHook = { tag, at: now, ok: !!(r.ok && r.v && r.v.ok), err: r.ok ? (r.v && r.v.description) || null : r.e };
        if (tgHook.ok && !(state.tgHook && state.tgHook.ok)) await notify(env, 'Jarbas no ar: pode conversar comigo por aqui. Mande /ajuda para ver o que eu sei fazer.', fetchFn);
      }
    }
    const day = new Date(now).toISOString().slice(0, 10);
    if (new Date(now).getUTCHours() >= 11 && dailyRep !== day) {
      dailyRep = day;
      try { const { ctx } = await jarbasContext(env, now); await notify(env, reportText(ctx), fetchFn); } catch (e) { errors.push('relatório do Jarbas: ' + (e.message || e)); }
    }
  }
  // Registro de cada tiro (para conferir atraso e entrega): gatilho, horário do bloco, atraso, potência recebida, fim.
  let snLog = Array.isArray(state.snLog) ? state.snLog.slice(-99) : [];
  if (cfg.sniper) {
    const a0 = state.sniper || {}, a1 = dec.state.sniper || {}, mine = orders.filter((o) => o.alive && (cfg.managed || []).includes(o.id));
    const got = mine.reduce((x, o) => x + (o.speedPH || 0), 0), cr = results.find((r) => r.type === 'create'), up = results.find((r) => r.type === 'update' && /tiro/.test(r.reason || ''));
    if (a1.shotStart && a1.shotStart !== a0.shotStart) {
      const why = a1.shotWhy || [], ageMin = cfg.sniperAgeMin === undefined ? 15 : cfg.sniperAgeMin;
      const due = why.includes('age') && !why.includes('dif') && !why.includes('fee') && lastNetBlockT ? lastNetBlockT + ageMin * 60e3 : lastNetBlockT; // quando o gatilho passou a valer
      const seenAt = tipSeen && tipSeen.h === a1.shotBlockId && tipSeen.at ? tipSeen.at : null, from = due && seenAt ? Math.max(due, seenAt) : due;
      snLog.push({ start: now, h: a1.shotBlockId, blockT: lastNetBlockT, why, edge: a1.shotEdge !== undefined && isFinite(a1.shotEdge) ? +a1.shotEdge.toFixed(2) : null,
        lagS: from ? Math.round((now - from) / 1000) : null, netLagS: seenAt && lastNetBlockT ? Math.round((seenAt - lastNetBlockT) / 1000) : null, by: opts.watch ? 'vigia' : 'ciclo', ph: Math.min(cfg.sniperPh || 25, limits.maxLimitPh),
        order: mine.length || (cr && cr.executed) ? (up && up.error) || (cr && cr.error) ? 'erro: ' + ((up && up.error) || cr.error).slice(0, 80) : (up || cr) ? 'ajustada' : 'sem ajuste' : 'sem ordem',
        priceEH: up ? up.priceEH : cr ? cr.priceEH : null, gotPH: got, maxPH: got });
    }
    for (const E of snLog) if (!E.end && E.start !== a1.shotStart && E.start !== snLog[snLog.length - 1].start) { E.end = E.endT || now; E.endWhy = E.endWhy || 'bloco'; E.mins = +((E.end - E.start) / 60e3).toFixed(1); } // tiros seguidos: fecha o anterior
    const L = snLog[snLog.length - 1];
    if (L && !L.end && L.start === (a1.shotStart || a0.shotStart)) {
      L.maxPH = Math.max(L.maxPH || 0, got);
      if (!a1.shotStart) {
        L.end = now; L.endWhy = (a1.endsBlock || 0) > (a0.endsBlock || 0) ? 'bloco' : 'prazo'; L.mins = +((now - L.start) / 60e3).toFixed(1);
        // tiro que pagou e não recebeu hash: avisa (pool fora, dificuldade do pool baixa demais, preço fora do mercado)
        if (L.order === 'ajustada' && L.mins >= 4 && (L.maxPH || 0) < 0.2 * (L.ph || 1)) {
          const t3 = `Sniper: o tiro mirando o bloco ${L.h + 1} terminou recebendo só ${(L.maxPH || 0).toFixed(1).replace('.', ',')} de ${L.ph} PH/s em ${String(L.mins).replace('.', ',')} min. Confira o pool (conexão e dificuldade na senha, mínimo d=500000 na NiceHash) e o preço da ordem.`;
          log.push({ t: now, kind: 'acao', text: t3 }); await notify(env, t3, fetchFn);
        }
      }
    }
  }
  // MODO_SNIPER: avisa no Telegram cada tiro e cada recuo (são ajustes da ordem, que não geram o aviso de criar/encerrar)
  if (cfg.sniper && cfg.mode === 'active' && hasKeys(env)) {
    const a0 = state.sniper || {}, a1 = dec.state.sniper || {}, executed = results.some((r) => r.executed && r.type !== 'cancel'), fx = (x) => String(x).replace('.', ',');
    const shotPh = Math.min(cfg.sniperPh || 25, limits.maxLimitPh), idlePh = cfg.sniperIdlePh === undefined ? 1 : cfg.sniperIdlePh;
    const hasOrder = orders.some((o) => o.alive && (cfg.managed || []).includes(o.id)) || results.some((r) => r.executed && r.type === 'create');
    const whyNo = !cfg.poolId ? 'nenhum pool escolhido (Mineração → Robô → Pool para ordens novas)' : !cfg.autoCreate ? '"criar ordem sozinho" desligado' : orderAmount(cfg, units, limits, walletBtc) === null ? `saldo insuficiente na NiceHash (${walletBtc === null ? 'sem leitura' : walletBtc.toFixed(6).replace('.', ',') + ' BTC'}; uma ordem precisa de pelo menos 0,00101 BTC)` : (results.find((r) => r.type === 'create' && r.error) || {}).error || 'a ordem anterior acabou e a nova ainda não foi criada';
    if (!a0.shotStart && a1.shotStart && !hasOrder) await notify(env, plain(`Sniper: gatilho de tiro mirando o bloco ${(a1.shotBlockId || 0) + 1}, mas sem ordem aberta: nada foi comprado. Motivo: ${whyNo}.`), fetchFn);
    else if (!a0.shotStart && a1.shotStart) await notify(env, plain(`Sniper: tiro de ${shotPh} PH/s${executed ? '' : ' (ordem ainda sem ajuste confirmado)'}. ${(results.find((r) => /sniper/.test(r.reason || '')) || {}).reason || ''}. Recua no bloco novo ou em ${cfg.sniperShotMin || 4} min. Tiro nº ${a1.shots || 1}.`), fetchFn);
    else if (a0.shotStart && !a1.shotStart && hasOrder) {
      const min = Math.round((now - a0.shotStart) / 60e3), why = (a1.endsBlock || 0) > (a0.endsBlock || 0) ? 'saiu bloco novo na rede' : `${cfg.sniperShotMin || 4} min sem bloco (kill switch)`;
      await notify(env, `Sniper: recuo para ${fx(idlePh)} PH/s depois de ${min} min de tiro: ${why}. Tiros até agora: ${a1.shots || 0} (por bloco ${a1.endsBlock || 0}, por prazo ${a1.endsTime || 0}).`, fetchFn);
    }
  }

  // Teste do robô (modo Ativo com limites mínimos): registra cada ação real, confere o que foi exercitado (criar,
  // ajustar, stop-loss, espera) e, no fim, encerra as ordens do teste e devolve a configuração original.
  let robotTest = state.robotTest || null;
  if (robotTest && !robotTest.done) {
    const ev = (robotTest.events || []).slice(), chk = Object.assign({}, robotTest.checks), ids = (robotTest.ids || []).slice();
    for (const r of results) {
      if (r.executed) { ev.push({ t: now, type: r.type, reason: plain(r.reason || ''), priceEH: r.priceEH, limitPH: r.limitPH }); if (r.type === 'create' && r.id) ids.push(r.id); }
      if (r.error) ev.push({ t: now, type: 'erro', reason: r.error });
    }
    if (results.some((r) => r.executed && r.type === 'create')) chk.create = chk.create || now;
    if (results.some((r) => r.executed && r.type === 'update')) chk.update = chk.update || now;
    if (results.some((r) => r.executed && r.type === 'cancel' && /stop-loss/.test(r.reason || ''))) chk.stop = chk.stop || now;
    if ((dec.notes || []).some((x) => /stop-loss: sem ordem nova/.test(x))) chk.cooling = chk.cooling || now;
    if (chk.stop && dec.state.stopUntil && now >= dec.state.stopUntil) chk.cooldownEnd = chk.cooldownEnd || now;
    if ((dec.notes || []).some((x) => /limite diário/.test(x))) chk.daily = chk.daily || now;
    robotTest = Object.assign({}, robotTest, { events: ev.slice(-60), checks: chk, ids });
    if (now >= robotTest.until || (chk.stop && chk.cooldownEnd)) {
      // encerra todas as ordens do teste, inclusive as criadas neste mesmo ciclo (não estão na lista lida no início)
      for (const id of ids) { const o = orders.find((x) => x.id === id); if (o && !o.alive) continue; const r = await settle(nh.cancelOrder(id)); if (!r.ok && !/not found|cancel|closed|status/i.test(r.e)) errors.push('teste do robô: ' + r.e); }
      const cur = await getConfig(env);
      await kvPut(env, 'config', Object.assign({}, cur, robotTest.backup, { managed: (cur.managed || []).filter((id) => !ids.includes(id)) }));
      const btc = mkt.ok ? mkt.btcUsd : 0, paidBtc = ids.reduce((a, id) => a + ((execLog && execLog.orders && execLog.orders[id] && execLog.orders[id].paidBtc) || 0), 0);
      dec.state.stopUntil = null; dec.state.sess = null; // a espera do teste não vale depois dele
      robotTest = Object.assign({}, robotTest, { done: now, spentUsd: paidBtc * btc, orders: ids.length });
      const ok = (k) => (chk[k] ? 'sim' : 'não');
      log.push({ t: now, kind: 'acao', text: `Teste do robô encerrado: criou ordem ${ok('create')}, ajustou ${ok('update')}, stop-loss ${ok('stop')}, espera ${ok('cooling')}; gasto ~US$${(paidBtc * btc).toFixed(2).replace('.', ',')}; configuração original devolvida` });
      await notify(env, `teste do robô encerrado. Criou ordem: ${ok('create')}; ajustou preço/potência: ${ok('update')}; stop-loss: ${ok('stop')}; espera depois do stop: ${ok('cooling')}. Gasto ~US$${(paidBtc * btc).toFixed(2).replace('.', ',')}. Configuração original devolvida (modo ${robotTest.backup.mode}). Detalhes em Mineração → Operar.`, fetchFn);
    }
  }

  // Log sem repetir a mesma decisão a cada ciclo.
  const sig = JSON.stringify(results.map((r) => [r.type, r.id, r.priceEH, r.limitPH, r.executed]));
  if (results.length && (sig !== state.lastSig || cfg.mode === 'active')) {
    for (const r of results) log.push({ t: now, kind: r.executed ? 'acao' : (r.error ? 'erro' : 'simulado'), text: `${r.type}${r.id ? ' ' + r.id : ''}: ${r.reason}${r.priceEH ? ` · preço ${r.priceEH}` : ''}${r.limitPH !== undefined ? ` · ${r.limitPH} PH/s` : ''}${r.error ? ' · ' + r.error : ''}` });
  }
  const errSig = errors.join('|');
  if (errors.length && errSig !== state.lastErrSig) log.push({ t: now, kind: 'erro', text: errors.join('; ') });
  // Telegram só para erro que afeta a operação (rede BCH, cotações, livro e ordens da NiceHash, testes), que se repetiu
  // no ciclo seguinte, e no máximo uma vez a cada 6 h por fonte. Fontes auxiliares (mempool.space, frentes) ficam só no painel.
  const errNotified = Object.assign({}, state.errNotified);
  const CRIT = /^(rede BCH|cotações|livro NiceHash|unidades NiceHash|ordens|calibração|teste do robô|create|update|cancel)/;
  const prevErr = String(state.lastErrSig || '').split('|');
  for (const e of errors) {
    const key = e.split(':')[0];
    if (!CRIT.test(e) || !prevErr.some((x) => x.split(':')[0] === key) || now - (errNotified[key] || 0) < 6 * 3600e3) continue;
    errNotified[key] = now;
    await notify(env, 'problema que afeta a operação, há pelo menos 3 min: ' + e + '. O painel mostra o andamento; se continuar, o robô não compra no escuro.', fetchFn);
  }

  // Alertas (entrada/saída/risco) com aviso no Telegram; não dependem do modo do robô.
  let newAlerts = [], alertState = { alertPrev: state.alertPrev, alertMem: state.alertMem, alerts: state.alerts };
  // Estável = histórico próprio do servidor (24 h) OU conferido pelo painel no histórico pago das corretoras (últimas 6 h,
  // com a meia-vida pagando as taxas).
  const verified = state.verified || {}, stableNow = Object.assign({}, state.stable24 || {});
  for (const [k, x] of Object.entries(verified)) if (now - x.at <= 6 * 3600e3 && x.stable24 && !(x.expNet !== null && x.expNet <= 0)) stableNow[k] = true;
  const funding = predR.ok ? fundingSnapshot(predR.v, cfg, now, cfg.fundStable24 !== false ? stableNow : null, state.alertScore ? alertScoreSummary(state.alertScore) : null) : null;
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
    const ra = runAlerts({ state, funding, edges: mkt.ok ? { BCH: mkt.edgeAtBidPct } : {}, now, minEdgePct: cfg.minEdgeRel ? cfg.minEdgeBase : cfg.minEdgePct }); // alerta de "compensa" usa a meta fixa
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
  let algoPaper = state.algoPaper || null, algoTs = state.algoTs || 0, algoMap = state.algoMap || [], algoRan = false, paperXmr = state.paperXmr || null, xmrUsd = state.xmrUsd || null, ppsOps = state.ppsOps || null;
  if (paperXmr && prices.ok) { const rx = repairXmrOutbid(JSON.parse(JSON.stringify(paperXmr)), { btcUsd: prices.v.btcUsd, xmrUsd }); paperXmr = rx.p; for (const n of rx.notes) log.push({ t: now, kind: 'acao', text: 'Correção do histórico: ' + n }); }
  if (cfg.algoPaper !== false && prices.ok && now - algoTs >= 15 * 60e3) {
    const pub = (env.NH_BASE || 'https://api2.nicehash.com').replace(/\/$/, '');
    const getJ = (u) => fetchFn(u, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    const algos = FDR.ALGOS.map((a) => a.nh);
    const res = await Promise.all([getJ(env.WTM_URL || 'https://whattomine.com/asic.json')].concat(algos.map((a) =>
      a === nh.algorithm && bookR.ok ? Promise.resolve(bookR.v) : getJ(pub + '/main/api/v2/hashpower/orderBook?algorithm=' + a + '&size=1000'))).map(settle));
    if (res[0].ok) {
      const books = {};
      algos.forEach((a, i) => { if (res[i + 1].ok) books[a] = res[i + 1].v; });
      const map = FDR.miningMap(res[0].v, books, { btcUsd: prices.v.btcUsd, minEdgePct: cfg.minEdgeRel ? cfg.minEdgeBase : cfg.minEdgePct, // outras moedas seguem a meta fixa (a regra relativa é só do robô de BCH)
      rentFeePct: cfg.rentFeePct, poolFeePct: cfg.poolFeePct });
      algoMap = map.map((m) => ({ algo: m.algo, label: m.label, coins: m.coins, edgePct: m.edgePct, level: m.level, capBtcPerUnit: m.capBtcPerUnit, unit: m.unit, rentBtcPerH: m.rentBtcPerH, revBtcPerH: m.revBtcPerH, thin: !!m.thin, marketUsdDay: m.marketUsdDay }));
      algoRan = true;
      const ap = algoPaperStep(algoPaper, { map, now });
      algoPaper = ap.pa; algoTs = now;
      for (const e of ap.events) log.push({ t: now, kind: 'simulado', text: e });
      // Operação Monero simulada como real (carteira virtual, ordem, pool PPS e saques)
      const xc = Object.values((res[0].v && res[0].v.coins) || {}).find((c) => c && c.tag === 'XMR');
      xmrUsd = xc && +xc.exchange_rate > 0 ? +xc.exchange_rate * prices.v.btcUsd : (state.xmrUsd || null);
      const xr = xmrPaperStep(paperXmr, { m: map.find((x) => x.algo === 'RANDOMXMONERO'), now, btcUsd: prices.v.btcUsd, xmrUsd,
        rules: Object.assign({}, XMR_RULES, cfg.xmrSimBtc > 0 ? { walletBtc: cfg.xmrSimBtc } : {}, isFinite(cfg.xmrEnterPct) ? { enterPct: cfg.xmrEnterPct } : {}) });
      paperXmr = xr.px;
      for (const e of xr.events) { log.push({ t: now, kind: 'simulado', text: e }); if (cfg.xmrAlerts !== false && !/saque de|não entra|livro é raso/.test(e)) await notify(env, e, fetchFn); }
      // Mesma operação "como real" para todos os algoritmos de pool PPS (cada um com a sua carteira virtual): pega toda
      // janela que abre, em qualquer moeda, e mostra quanto teria rendido de verdade.
      ppsOps = Object.assign({}, ppsOps || {});
      // lastro próprio: margem de cada algoritmo hora a hora, 60 dias (base para janelas, horários e frequência)
      { const MH = await kvGet(env, 'marginHist', {}), hr = Math.floor(now / 3600e3) * 3600e3; let ch = false;
        for (const mm of map) if (isFinite(mm.edgePct) && mm.edgePct <= 100) { const a = MH[mm.algo] || (MH[mm.algo] = []); if (!a.length || a[a.length - 1][0] !== hr) { a.push([hr, +mm.edgePct.toFixed(2)]); ch = true; if (a.length > 1440) a.splice(0, a.length - 1440); } }
        if (ch) await kvPut(env, 'marginHist', MH); }
      const scanNow = await kvGet(env, 'scan', null), extraMap = scanNow && now - scanNow.at < 40 * 60e3 ? scanNow.extra || [] : [];
      for (const mm of map.filter((x) => x.pps && x.algo !== 'RANDOMXMONERO').concat(extraMap)) {
        const r2 = xmrPaperStep(ppsOps[mm.algo], { m: mm, now, btcUsd: prices.v.btcUsd, xmrUsd: null,
          rules: Object.assign({}, XMR_RULES, cfg.xmrSimBtc > 0 ? { walletBtc: cfg.xmrSimBtc } : {}, isFinite(cfg.xmrEnterPct) ? { enterPct: cfg.xmrEnterPct } : {}) });
        ppsOps[mm.algo] = Object.assign(r2.px, { label: mm.label, coins: mm.coins });
        for (const e of r2.events) { const t2 = e.replace(/^Monero \(simulado\)/, mm.label + ' (' + mm.coins.join('+') + ', simulado)').replace(' no RandomX', ''); log.push({ t: now, kind: 'simulado', text: t2 }); if (cfg.xmrAlerts !== false && /abriria|subiria|baixaria|acabou|venderia/.test(t2)) await notify(env, t2, fetchFn); }
      }
    } else errors.push('WhatToMine: ' + res[0].e);
  } else if (cfg.algoPaper !== false && prices.ok && paperXmr) {
    // Monero entre os cálculos do mapa: a receita por hash muda devagar (dificuldade e preço), o aluguel muda rápido.
    // A cada ciclo (3 min) relê só o livro do RandomX e refaz a margem com a receita do último mapa: entra e sai perto da
    // hora certa, em vez de esperar até 15 min (a margem caía no meio da janela e a saída vinha tarde).
    const mx = (algoMap || []).find((x) => x.algo === 'RANDOMXMONERO');
    if (mx && mx.revBtcPerH > 0) {
      const pub = (env.NH_BASE || 'https://api2.nicehash.com').replace(/\/$/, '');
      const bk = await settle(fetchFn(pub + '/main/api/v2/hashpower/orderBook?algorithm=RANDOMXMONERO&size=1000', { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }));
      const b = bk.ok ? FDR.bookPerHash(bk.v) : null, fee = (cfg.rentFeePct === undefined ? 3 : cfg.rentFeePct) / 100;
      const rent = b && (b.median || b.fill) ? (b.median || b.fill) * (1 + fee) : null;
      if (rent) {
        const mkUsd = b.btcDay * prices.v.btcUsd, m3 = Object.assign({}, mx, { edgePct: (mx.revBtcPerH / rent - 1) * 100, rentBtcPerH: rent, marketUsdDay: mkUsd, thin: b.paying < 5 || mkUsd < 1000, fast: true });
        const xr = xmrPaperStep(paperXmr, { m: m3, now, btcUsd: prices.v.btcUsd, xmrUsd,
          rules: Object.assign({}, XMR_RULES, cfg.xmrSimBtc > 0 ? { walletBtc: cfg.xmrSimBtc } : {}, isFinite(cfg.xmrEnterPct) ? { enterPct: cfg.xmrEnterPct } : {}) });
        paperXmr = xr.px;
        for (const e of xr.events) { log.push({ t: now, kind: 'simulado', text: e }); if (cfg.xmrAlerts !== false && !/saque de|não entra|livro é raso/.test(e)) await notify(env, e, fetchFn); }
      }
    }
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

  // Margem média do mercado (24 h e 7 dias): o "normal" contra o qual a IA, a cartilha e o painel comparam o momento.
  const asertF = asertForecast({ recentBlocks, now, edgeNow: mkt.ok ? mkt.edgeAtBidPct : null });
  const mktMargin = marginStats(state.edgeHist, { now, fixAt: paperArchive && paperArchive.at, minEdge: cfg.minEdgePct, edgeNow: mkt.ok ? mkt.edgeAtBidPct : null });
  // Copiloto IA: analisa tudo e registra previsões conferíveis (XP e maturidade).
  const snap = { asert: asertF, mm: mktMargin, hist: state.edgeHist || [], fixAt: paperArchive && paperArchive.at, limits: { stopUsd: cfg.sessionBudgetUsd, coolH: cfg.stopCooldownH, dailyUsd: cfg.dailyBudgetUsd, weekUsd: cfg.weeklyLossUsd }, now, edge: mkt.ok ? mkt.edgeAtBidPct : NaN, green: !!(mkt.ok && mkt.green), minEdge: cfg.minEdgePct, darr: darr ? darr.v : NaN,
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
    const [pl] = await Promise.all([nh.pools()].map(settle));
    acct = { at: now, balanceBtc: walletBtc !== null ? walletBtc : (acct ? acct.balanceBtc : null),
      pools: pl.ok ? ((pl.v && pl.v.list) || []).map((p) => ({ id: p.id, name: p.name, algorithm: p.algorithm })) : (acct ? acct.pools : []) };
  }
  if (acct && walletBtc !== null) { acct.balanceBtc = walletBtc; acct.balAt = now; } // saldo sempre o do ciclo
  const plan = actionPlan({ cfg, limits, mkt: mkt.ok ? Object.assign({}, mkt, { bookTotalPH: book ? book.totalPH : 0 }) : mkt, acct,
    fund: ((funding && funding.best) || []), algoMap, capital: cfg.alertCapital || 1000, pools: FDR.POOLS });
  const mempool = mpR.ok ? Object.assign({ at: now }, mpR.v) : state.mempool || null;
  // Cartilha de entrada: a sequência de fatores (margem real, sem taxa, DARR, preço × dificuldade, hash, reajuste do BTC,
  // horário, tamanho, tentativa) avaliada agora, com veredito. docs/cartilha-mineracao.md.
  const balPlan = acct && isFinite(acct.balanceBtc) ? balancePlan({ balanceBtc: acct.balanceBtc, mkt, mm: marginStats(state.edgeHist, { now, fixAt: paperArchive && paperArchive.at, minEdge: cfg.minEdgePct, edgeNow: null }), cfg: state.planBackup ? Object.assign({}, cfg, state.planBackup) : cfg, units, limits }) : (state.balPlan || null);
  const entryCheck = entryChecklist({ mkt, darr: darr ? darr.v : null, mom: msig.mom, ret: snap.ret, win: snap.win, nhWeek, hashMkts,
    power: plan && plan.mining ? plan.mining.power : null, cfg, now, mm: mktMargin, band: bandThreshold(br.ai.band), bins: br.ai.band && br.ai.band.bins });
  const aiRep = aiReport({ now, mkt, cfg, asert: asertF, mm: mktMargin, ai: br.ai, mom: msig.mom, ret: snap.ret, win: snap.win, darr: darr ? darr.v : null,
    power: plan && plan.mining ? plan.mining.power : null, algos: snap.algos,
    sniper: paperSniper ? { shot: paperSniper.shot, reason: paperSniper.reason } : null, fund: { passing: ((funding && funding.best) || []).length, sim: fundPaper ? fundPaperSummary(fundPaper, FD.DEFAULT_FEES) : null } });

  const next = Object.assign({}, dec.state, alertState, {
    lastTick: now, verified: Object.fromEntries(Object.entries(verified).filter(([, x]) => now - x.at <= 6 * 3600e3)), ai: br.ai, aiAnalysis, plan, acct, algoMap, mempool, stable24, pairStats, msig, darr, recentBlocks, nhWeek, paper, paperBurst, paperPlan, paperAlways, paperSniper, dHist, tHist, mpHist, snInfo, snLog, tipSeen, ordSeen, orderEnds, tgHook, dailyRep, hashMkts, fronts, frontsPaper, ltStreak, fundPaperLT, market2, aiPanorama, entryCheck, calib, robotTest, luck24, balPlan, minEdgeNow: { value: cfg.minEdgePct, relative: !!cfg.minEdgeRel, base: cfg.minEdgeRel ? cfg.minEdgeBase : cfg.minEdgePct, sniper: !!cfg.sniper }, aiReport: aiRep, mktMargin, asertF, execLog, bestScen, paperArchive, paperPriceV: 2, blockBuf, blockFlush, lastBlockT, real, fundPaper, alertScore, algoPaper, paperXmr, ppsOps, xmrUsd, algoTs, aiScores, fundPaperAI, fhistHour, lastHeight: state.lastHeight, poolFix1: state.poolFix1, feesBch: state.feesBch, myBlocks: state.myBlocks || [], lastSig: sig, lastErrSig: errSig, errNotified,
    market: mkt.ok ? { breakEvenEH: mkt.breakEvenEH, capEH: mkt.capEH, fillEH: mkt.fillEH, medianEH: mkt.medianEH, bidEH: mkt.bidEH,
      edgeAtBidPct: mkt.edgeAtBidPct, green: mkt.green, D: mkt.D, bookTotalPH: book ? book.totalPH : 0, bchUsd: mkt.bchUsd, btcUsd: mkt.btcUsd, costPerBlockUsd: mkt.costPerBlockUsd,
      hashpriceNet: mkt.hashpriceNet, blockNetUsd: mkt.blockNetUsd, phDaysPerBlock: mkt.phDaysPerBlock, market: mkt.market } : { ok: false, reason: mkt.reason },
    errors
  });
  // Histórico curto da margem (para achar horários baratos), um ponto a cada ~15 min.
  const hist = next.edgeHist = (state.edgeHist || []);
  if (mkt.ok && (!hist.length || now - hist[hist.length - 1][0] >= 15 * 60e3)) hist.push([now, +mkt.edgeAtBidPct.toFixed(2), +mkt.bidEH.toFixed(4), darr ? +darr.v.toFixed(4) : null, book ? Math.round(book.totalPH) : null, book && book.fixedEH ? +book.fixedEH.toFixed(4) : null]);
  next.edgeHist = hist.slice(-672); // 7 dias
  // Auditor automático, de hora em hora: confere se as contas das simulações fecham; avisa só problema novo
  if (!state.audit || now - state.audit.at >= 3600e3) {
    try {
      const au = auditState(Object.assign({}, next, { scan: await kvGet(env, 'scan', null) }), { now, lab: await kvGet(env, 'lab', null), arb: await kvGet(env, 'arb', null) });
      for (const msg of auditNews(state.audit, au)) { log.push({ t: now, kind: 'acao', text: msg }); await notify(env, msg, fetchFn); }
      next.audit = au;
    } catch (e) { errors.push('auditor: ' + (e.message || e)); }
  }
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
  try { await tg('deleteWebhook', {}); } catch (e) { /* sem webhook */ } // o Jarbas recoloca no próximo ciclo
  try { chat = chatFromUpdates(await tg('getUpdates', { limit: 50, timeout: 0 })); } catch (e) { /* sem mensagens ainda */ }
  if (!chat) return json({ connected: false, bot, needMessage: true, link: bot ? 'https://t.me/' + bot : null });
  try { await tg('sendMessage', { chat_id: chat.id, text: 'Funding Desk conectado ✅ Aqui chegam saídas, riscos e blocos na hora; entradas e oportunidades num resumo a cada 30 min.' }); }
  catch (e) { return json({ error: 'Achei o chat, mas não consegui enviar a mensagem de teste (' + e.message + ').' }, 400); }
  await saveCreds(env, { TELEGRAM_CHAT_ID: chat.id });
  await appendLog(env, [{ t: Date.now(), kind: 'config', text: `Telegram conectado (@${bot}, conversa com ${chat.name || chat.type})` }]);
  return json({ connected: true, bot, chatName: chat.name });
}

// Lastro da margem gravada hora a hora: quanto tempo cada algoritmo fica positivo, acima de +2% e em que horários.
function marginLastroOf(MH) {
  return Object.fromEntries(Object.entries(MH || {}).map(([k, a]) => {
    const v = a.map((x) => x[1]), n = v.length, hrs = Array(24).fill(0).map(() => [0, 0]);
    a.forEach((x) => { const h = new Date(x[0]).getUTCHours(); hrs[h][0]++; if (x[1] >= 2) hrs[h][1]++; });
    const best = hrs.map((x, h) => [h, x[0] ? x[1] / x[0] : 0]).sort((p, q) => q[1] - p[1]).slice(0, 3).filter((x) => x[1] > 0).map((x) => x[0]);
    return [k, { horas: n, desde: a[0] && a[0][0], positivoPct: n ? v.filter((x) => x > 0).length / n * 100 : null, acima2Pct: n ? v.filter((x) => x >= 2).length / n * 100 : null,
      media: n ? v.reduce((p, x) => p + x, 0) / n : null, melhoresHorasUtc: best }];
  }));
}

/* ---------- Jarbas (Telegram) ---------- */
async function tgSecret(env) {
  const t = env.PANEL_TOKEN; if (!t || t.length < 24) return null;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(t), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('funding-desk/telegram/v1')));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function tgSend(env, chatId, text, fetchFn) {
  const parts = String(text).match(/[\s\S]{1,3800}/g) || [''];
  for (const p of parts) await (fetchFn || fetch)((env.TG_BASE || 'https://api.telegram.org') + '/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: p }) });
}
async function jarbasContext(env, now) {
  const [state, cfg] = await Promise.all([kvGet(env, 'state', {}), getConfig(env)]);
  const st = Object.assign({}, state, { xmrSum: xmrSummary(state.paperXmr, (state.market || {}).btcUsd, state.xmrUsd),
    fundPaperSum: state.fundPaper ? fundPaperSummary(state.fundPaper, FD.DEFAULT_FEES) : null, ppsSum: Object.entries(state.ppsOps || {}).map(([k, v]) => Object.assign(xmrSummary(v, (state.market || {}).btcUsd, null), { label: v.label })), alertScoreSum: state.alertScore ? alertScoreSummary(state.alertScore) : null });
  st.arb = arbSummary(await kvGet(env, 'arb', null));
  st.lab = labSummary(await kvGet(env, 'lab', null)); st.scan = await kvGet(env, 'scan', null); st.marginLastro = marginLastroOf(await kvGet(env, 'marginHist', {}));
  return { ctx: brainContext(st, cfg, now), cfg };
}
// Mensagem recebida no Telegram (webhook). Só o chat cadastrado conversa e manda ações.
export async function handleTelegram(env, update, fetchFn) {
  const msg = update && (update.message || update.edited_message);
  if (!msg || !msg.chat || !msg.text) return 'ignorado';
  if (!env.TELEGRAM_CHAT_ID || String(msg.chat.id) !== String(env.TELEGRAM_CHAT_ID)) return 'chat não autorizado';
  const now = Date.now(), { ctx, cfg } = await jarbasContext(env, now);
  let r = ruleReply(msg.text, ctx), out;
  if (r && r.action) {
    const { config, errors } = sanitizeConfig(r.action, cfg, limitsFromEnv(env));
    if (errors.length) out = 'Não deu: ' + errors.join('; ');
    else if (config.mode === 'active' && !hasKeys(env)) out = 'Não dá para ir para Ativo: a NiceHash não está conectada.';
    else { await kvPut(env, 'config', config); await appendLog(env, [{ t: now, kind: 'config', text: 'Jarbas (Telegram): ' + r.text }]); out = r.text; }
  } else if (r) {
    out = r.text;
    // pergunta que caiu num comando, mas é longa: a IA (se houver) comenta em cima dos números
    if (msg.text.length > 40 && !/^\//.test(msg.text)) { const a = await aiReply(env, msg.text, ctx, fetchFn); if (a) out = a; }
  } else {
    out = (await aiReply(env, msg.text, ctx, fetchFn)) || 'Não entendi. Tente /status, /monero, /bch, /funding, /saldo, /copiloto ou /relatorio. Para conversar livremente, cadastre a chave da IA em Ajustes → Jarbas.';
  }
  await tgSend(env, msg.chat.id, out, fetchFn);
  return 'respondido';
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

  if (p === '/readtoken' && m === 'GET') return json({ token: await readToken(env) });
  // Pendle entregue pela tarefa de hora em hora do GitHub (a API do Pendle limita o IP da Cloudflare): só nome, rede, vencimento, taxa e liquidez
  if (p === '/lab/pendle' && m === 'POST') {
    const L = Array.isArray(body.markets) ? body.markets.slice(0, 400) : null;
    if (!L || !L.length) return json({ error: 'sem mercados' }, 400);
    const g = {};
    for (const x of L) { const c = String(x.chain || 'rede').slice(0, 20); (g[c] || (g[c] = { markets: [] })).markets.push({ name: String(x.name || '').slice(0, 40), expiry: String(x.expiry || ''), details: { impliedApy: +x.impliedApy || 0, liquidity: +x.liquidity || 0 } }); }
    await kvPut(env, 'pendleFeed', { at: Date.now(), lists: Object.entries(g), via: 'github' });
    return json({ ok: true, markets: L.length });
  }
  if (p === '/status' && m === 'GET') {
    const [cfg, state, watch] = await Promise.all([getConfig(env), kvGet(env, 'state', {}), kvGet(env, 'watch', null)]);
    return json({ watch, version: VERSION, algo: nh.algorithm, nhEnv: env.NH_BASE ? 'personalizado' : (env.NH_ENV === 'prod' ? 'produção' : 'teste'), keys: hasKeys(env),
      telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), creds: credStatus(env), limits, config: cfg,
      state: { lastTick: state.lastTick, lastHeight: state.lastHeight, market: state.market, myBlocks: state.myBlocks || [], dailyUsd: state.dailyUsd || 0,
        errors: state.errors || [], edgeHist: state.edgeHist || [], alerts: (state.alerts || []).slice(-30).reverse(),
        paper: state.paper || null, paperBurst: state.paperBurst || null, paperPlan: state.paperPlan || null, paperAlways: state.paperAlways || null, paperSniper: state.paperSniper || null, sniper: state.sniper || null, snInfo: state.snInfo || null, snLog: (state.snLog || []).slice(-40).reverse(), jarbas: { telegram: !!(state.tgHook && state.tgHook.ok), hookErr: state.tgHook && !state.tgHook.ok ? state.tgHook.err : null, lastReport: state.dailyRep || null }, orderEnds: (state.orderEnds || []).slice(-10).reverse(), wallet: state.acct ? { btc: state.acct.balanceBtc, at: state.acct.balAt || state.acct.at } : null, paperArchive: state.paperArchive || null, entryCheck: state.entryCheck || null, calib: state.calib || null, minEdgeNow: state.minEdgeNow || null, luck24: state.luck24 || null, balPlan: state.balPlan || null, planOn: !!state.planBackup, calibPrev: state.calibPrev || null, robotTest: state.robotTest || null, aiReport: state.aiReport || null, mktMargin: state.mktMargin || null, asertF: state.asertF || null, exec: execSummary(state.execLog), bestScen: state.bestScen || null, hashMkts: state.hashMkts || null, fronts: state.fronts || null, frontsPaper: state.frontsPaper || null, market2: state.market2 || null, aiPanorama: state.aiPanorama || null,
        fundPaperLT: state.fundPaperLT ? { summary: fundPaperSummary(state.fundPaperLT, LT_FEES), open: state.fundPaperLT.open, closed: state.fundPaperLT.closed.slice(-50).reverse() } : null, opLog: (state.opLog || []).slice(-20).reverse(), real: state.real ? Object.assign({}, state.real, { paid: undefined }) : null,
        fundPaper: state.fundPaper ? { summary: fundPaperSummary(state.fundPaper, FD.DEFAULT_FEES), open: state.fundPaper.open, closed: state.fundPaper.closed.slice(-100).reverse() } : null,
        algoPaper: state.algoPaper || null, xmr: xmrSummary(state.paperXmr, (state.market || {}).btcUsd, state.xmrUsd), xmrUsd: state.xmrUsd || null, ppsOps: Object.fromEntries(Object.entries(state.ppsOps || {}).map(([k, v]) => [k, Object.assign(xmrSummary(v, (state.market || {}).btcUsd, null), { label: v.label, coins: v.coins })])), algoMapNow: state.algoMap || [], audit: state.audit || null, arb: await (async () => { const A = await kvGet(env, 'arb', null); const S = arbSummary(A); return S ? Object.assign(S, { exec: A.exec || null }) : null; })(), lab: labSummary(await kvGet(env, 'lab', null)), marginLastro: marginLastroOf(await kvGet(env, 'marginHist', {})), scan: await (async () => { const sc = await kvGet(env, 'scan', null); return sc ? { at: sc.at, extra: sc.extra, mrr: sc.mrr, err: sc.err, hist: sc.hist || null } : null; })(),
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
    const mk = st.market || {}, cfg = await getConfig(env), dd = diffVsAvg(list);
    for (const b of list) if (dd[b.h] !== undefined) b.dd = dd[b.h]; // dificuldade do bloco seguinte × média de 12 (positivo = abaixo)
    const sorted = list.filter((b) => dd[b.h] !== undefined).map((b) => b.t).sort((a, b) => a - b);
    const days = sorted.length > 1 ? (sorted[sorted.length - 1] - sorted[0]) / 864e5 : null;
    return json({ snFreq: triggerFreq(dd, { current: cfg.sniperDiffDropPct, days }), blocks: list.slice(-300).reverse(), summary: blockSummary(list, { fixAt: st.paperArchive && st.paperArchive.at }),
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
  if (p === '/arb/keys' && m === 'POST') {
    // chave de negociação de uma corretora (sem saque): testa lendo o saldo e guarda cifrada; nada volta para o painel
    const v = String(body.venue || ''), A = ARB_ADAPTERS[v];
    if (!A) return json({ error: 'corretora sem robô (disponíveis: ' + EXEC_VENUES.join(', ') + ')' }, 400);
    const k = { key: String(body.key || '').trim(), secret: String(body.secret || '').trim(), passphrase: String(body.passphrase || '').trim() || undefined, at: Date.now() };
    const t = await checkKey(v, k, fetchFn);
    if (!t.ok) return json({ error: t.error }, 400);
    const all = arbKeys(env); all[v] = k; await saveCreds(env, { ARB_KEYS: JSON.stringify(all) });
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: 'Arbitragem: chave da ' + v + ' conectada (só negociação)' }]);
    return json({ ok: true, venue: v, saldo: Object.fromEntries(Object.entries(t.bal || {}).filter(([c]) => ['USDT', 'USDC', 'BRL'].includes(c))) });
  }
  if (p === '/arb/keys' && m === 'DELETE') {
    const v = String(url.searchParams.get('venue') || ''), all = arbKeys(env); delete all[v];
    await saveCreds(env, { ARB_KEYS: Object.keys(all).length ? JSON.stringify(all) : null });
    return json({ ok: true });
  }
  if (p === '/arb/reset' && m === 'POST') { const A = await kvGet(env, 'arb', null); if (A && A.exec) { A.exec.halted = null; await kvPut(env, 'arb', A); } return json({ ok: true }); }
  if (p === '/credentials' && m === 'GET') return json(credStatus(env));
  if (p === '/credentials' && m === 'PUT') return putCredentials(env, body, fetchFn);
  if (p === '/telegram' && m === 'POST') return connectTelegram(env, body, fetchFn);
  if (p === '/ai' && m === 'POST') {
    // chave e modelo da IA do Jarbas: ficam cifrados junto com as outras credenciais
    if (body.clear) { await saveCreds(env, { AI_API_KEY: null, AI_MODEL: null }); return json({ ok: true, cleared: true }); }
    const key = String(body.key || '').trim(), model = String(body.model || '').trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return json({ error: 'chave inválida: ela começa com sk-ant- (console da Anthropic → API Keys)' }, 400);
    if (!/^[a-z0-9][a-z0-9.-]{2,60}$/.test(model)) return json({ error: 'informe o ID do modelo (ex.: o indicado no chat)' }, 400);
    const e2 = Object.assign(Object.create(env), { AI_API_KEY: key, AI_MODEL: model });
    const test = await aiReply(e2, 'Responda só: ok', { teste: true }, fetchFn);
    if (!test || /recusad|falhou|Não consegui|limite/.test(test)) return json({ error: 'a IA não respondeu ao teste: ' + (test || 'sem resposta') }, 400);
    await saveCreds(env, { AI_API_KEY: key, AI_MODEL: model });
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: 'Jarbas: IA conectada (modelo ' + model + ')' }]);
    return json({ ok: true, model });
  }
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
  if (p === '/calib/start' && m === 'POST') {
    // Teste de calibração: ordem pequena (mínimo da NiceHash) na potência pedida, no preço que entrega essa potência
    // (profundidade do livro + 0,5%), fora do controle do robô; o servidor encerra sozinho no prazo.
    need();
    const st = await kvGet(env, 'state', {}), cfg = await getConfig(env);
    if (st.calib && !st.calib.done) return json({ error: 'já existe um teste de calibração em andamento' }, 400);
    const u = await nh.units(), ph = Math.max(u.minLimitPH, Math.min(+body.ph || 10, limits.maxLimitPh)), hours = Math.max(0.5, Math.min(+body.hours || 2, 6));
    const poolId = body.poolId || cfg.poolId; if (!poolId) return json({ error: 'escolha o pool (Mineração → Robô → Pool para ordens novas)' }, 400);
    const book = parseBook(await nh.orderBook()), d = (book && book.depth) || [];
    const lv = d.find((x) => x[1] >= ph) || d[d.length - 1]; if (!lv) return json({ error: 'livro da NiceHash vazio agora' }, 400);
    const priceEH = Math.ceil(lv[0] * (1 + (cfg.bidPremiumPct || 0.5) / 100) * 1e4) / 1e4, amount = Math.max(u.minOrderBtc, +body.amountBtc || 0);
    if (amount > limits.maxOrderBtc) return json({ error: 'valor acima do teto do servidor' }, 400);
    const o = await nh.createOrder({ market: book.market, priceEH, limitPH: ph, amountBtc: amount, poolId });
    const now = Date.now();
    st.calib = { id: o.id, start: now, until: now + hours * 3600e3, ph, priceEH, amountBtc: amount, poolId, hours };
    await kvPut(env, 'state', st);
    await appendLog(env, [{ t: now, kind: 'acao', text: `Teste de calibração iniciado: ${ph} PH/s a ${priceEH.toFixed(4).replace('.', ',')} BTC/EH/dia por ${hours} h, ordem de ${amount} BTC (o que sobrar volta para a carteira ao encerrar)` }]);
    return json(st.calib);
  }
  if (p === '/robottest/start' && m === 'POST') {
    need();
    const st = await kvGet(env, 'state', {}), cfg = await getConfig(env);
    if (st.robotTest && !st.robotTest.done) return json({ error: 'já existe um teste do robô em andamento' }, 400);
    if (st.calib && !st.calib.done) return json({ error: 'espere o teste de calibração terminar' }, 400);
    const poolId = body.poolId || cfg.poolId; if (!poolId) return json({ error: 'escolha o pool (Mineração → Robô → Pool para ordens novas)' }, 400);
    const u = await nh.units(), now = Date.now(), hours = Math.max(0.5, Math.min(+body.hours || 2, 4));
    const keys = ['mode', 'sniper', 'minEdgePct', 'minEdgeMode', 'targetPh', 'sessionBudgetUsd', 'stopCooldownH', 'dailyBudgetUsd', 'orderAmountBtc', 'orderAmountMax', 'autoCreate', 'onBlock', 'poolId'];
    const backup = Object.fromEntries(keys.map((k) => [k, cfg[k]]));
    const test = { mode: 'active', sniper: false, minEdgeMode: 'fixo', minEdgePct: -5, targetPh: 10, sessionBudgetUsd: 8, stopCooldownH: 0.25, dailyBudgetUsd: 20, orderAmountBtc: u.minOrderBtc, orderAmountMax: false, autoCreate: true, onBlock: 'cancel', poolId };
    await kvPut(env, 'config', Object.assign({}, cfg, test));
    st.robotTest = { start: now, until: now + hours * 3600e3, backup, test, events: [], checks: {}, ids: [] };
    st.stopUntil = null; st.sess = null;
    await kvPut(env, 'state', st);
    await appendLog(env, [{ t: now, kind: 'config', text: `Teste do robô iniciado por ${hours} h: modo Ativo, 10 PH/s, margem mínima −5% (temporária), stop-loss US$8, espera 15 min, limite diário US$20; a configuração original volta no fim` }]);
    return json(st.robotTest);
  }
  if (p === '/balanceplan/apply' && m === 'POST') {
    // aplica o plano para o saldo, guardando a configuração atual para desfazer depois
    const st = await kvGet(env, 'state', {}), cfg = await getConfig(env), P = st.balPlan;
    if (!P || !P.ok) return json({ error: (P && P.why) || 'plano ainda não calculado (aguarde um ciclo)' }, 400);
    if (!cfg.poolId) return json({ error: 'escolha o pool (Mineração → Robô → Pool para ordens novas)' }, 400);
    if (!hasKeys(env)) return json({ error: 'NiceHash não conectada' }, 412);
    if (!st.planBackup) st.planBackup = Object.fromEntries(Object.keys(P.config).map((k) => [k, cfg[k]]));
    await kvPut(env, 'config', Object.assign({}, cfg, P.config));
    st.planAt = Date.now(); await kvPut(env, 'state', st);
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: `Plano para o saldo aplicado: ${P.ph} PH/s nos 25% melhores momentos das últimas 24 h (margem mínima de hoje ${String(P.threshold).replace('.', ',')}%, piso ${P.floor}%), ordem de ${String(P.amountBtc).replace('.', ',')} BTC, stop-loss US$${Math.ceil(P.budgetUsd)}` }]);
    return json({ ok: true });
  }
  if (p === '/balanceplan/undo' && m === 'POST') {
    const st = await kvGet(env, 'state', {}), cfg = await getConfig(env);
    if (!st.planBackup) return json({ error: 'nenhum plano aplicado' }, 400);
    await kvPut(env, 'config', Object.assign({}, cfg, st.planBackup));
    st.planBackup = null; await kvPut(env, 'state', st);
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: 'Plano para o saldo desfeito: configuração anterior devolvida' }]);
    return json({ ok: true });
  }
  if (p === '/robottest/fast' && m === 'POST') {
    // Concluir mais rápido: stop-loss logo acima do gasto da tentativa atual e espera de 10 min, para exercitar os dois
    // mecanismos que faltam sem gastar mais.
    const st = await kvGet(env, 'state', {}), cfg = await getConfig(env);
    if (!st.robotTest || st.robotTest.done) return json({ error: 'nenhum teste do robô em andamento' }, 400);
    const spent = st.sessionUsd || 0, stop = Math.max(1, Math.ceil(spent + 1));
    await kvPut(env, 'config', Object.assign({}, cfg, { sessionBudgetUsd: stop, stopCooldownH: 1 / 6 }));
    st.robotTest.fast = { at: Date.now(), stopUsd: stop, coolMin: 10 };
    await kvPut(env, 'state', st);
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: `Teste do robô acelerado: stop-loss em US$${stop} (gasto da tentativa US$${spent.toFixed(2).replace('.', ',')}) e espera de 10 min` }]);
    return json({ stopUsd: stop, spentUsd: spent });
  }
  if (p === '/robottest/stop' && m === 'POST') {
    const st = await kvGet(env, 'state', {});
    if (!st.robotTest || st.robotTest.done) return json({ error: 'nenhum teste do robô em andamento' }, 400);
    st.robotTest.until = Date.now(); await kvPut(env, 'state', st);
    return json({ ok: true });
  }
  if (p === '/robottest/clear' && m === 'POST') { const st = await kvGet(env, 'state', {}); if (st.robotTest && st.robotTest.done) { st.robotTestPrev = st.robotTest; st.robotTest = null; await kvPut(env, 'state', st); } return json({ ok: true }); }
  if (p === '/calib/stop' && m === 'POST') {
    need();
    const st = await kvGet(env, 'state', {});
    if (!st.calib || st.calib.done) return json({ error: 'nenhum teste em andamento' }, 400);
    st.calib.until = Date.now(); await kvPut(env, 'state', st); // o próximo ciclo encerra a ordem e calcula o resultado
    return json({ ok: true });
  }
  if (p === '/calib/clear' && m === 'POST') { const st = await kvGet(env, 'state', {}); if (st.calib && st.calib.done) { st.calibPrev = st.calib; st.calib = null; await kvPut(env, 'state', st); } return json({ ok: true }); }
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

// Vigia de bloco do MODO_SNIPER: o ciclo completo continua a cada 3 min; nos minutos entre eles, com o Sniper ligado,
// o servidor confere só a altura da rede a cada poucos segundos. Quando nasce um bloco novo, roda o ciclo na hora
// (mesma decisão do ciclo normal: recuo do tiro, trava zerada e novo tiro se o gatilho de 1% já valer).
export async function blockWatch(env, opts = {}) {
  const fetchFn = opts.fetchFn || fetch, clock = opts.clock || Date.now, sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const budget = opts.budgetMs === undefined ? 35e3 : opts.budgetMs, every = opts.everyMs || 6e3, start = clock();
  const cfg = await getConfig(env);
  if (!cfg.sniper || !(env.FD_KV || env.FD_STORE)) return { fired: false, why: 'sniper desligado' };
  const chain = chainClient(env, fetchFn);
  let state = await kvGet(env, 'state', {}), known = state.lastHeight || 0, polls = 0, seen = known, fired = 0, last = null;
  // Também dispara o ciclo na hora dos eventos de tempo do Sniper (antes só no ciclo de 3 min, com até ~4 min de atraso):
  // bloco passou do gatilho de atraso (ainda sem tiro neste bloco) e tiro chegou ao prazo (kill switch).
  // Depois de um disparo continua vigiando até o fim da janela (um bloco logo em seguida não espera o próximo ciclo).
  const ageMs = (cfg.sniperAgeMin === undefined ? 15 : cfg.sniperAgeMin) * 60e3, durMs = (cfg.sniperShotMin === undefined ? 7 : cfg.sniperShotMin) * 60e3;
  const timeEvent = () => {
    const t = clock(), sn = state.sniper || {}, bt = state.lastBlockT || null;
    if (sn.shotStart && t >= sn.shotStart + durMs + 2e3) return 'prazo:' + sn.shotStart;
    if (!sn.shotStart && cfg.sniperUseAge && bt && t >= bt + ageMs + 2e3 && sn.shotBlockId !== known && sn.usedBlockId !== known) return 'atraso:' + known;
    return null;
  };
  const run = async (patch) => {
    const t0 = clock();
    await kvPut(env, 'watch', Object.assign(await kvGet(env, 'watch', {}), patch, { at: t0, firedAt: t0, polls, every, tookMs: null }));
    await tick(env, { fetchFn, watch: true });
    await kvPut(env, 'watch', Object.assign(await kvGet(env, 'watch', {}), { at: clock(), tookMs: clock() - t0 }));
    fired++; state = await kvGet(env, 'state', {}); known = Math.max(known, state.lastHeight || 0);
  };
  while (clock() - start <= budget) {
    const ev = timeEvent();
    if (ev) {
      const lock = await kvGet(env, 'watch', {});
      if (lock.ev !== ev) { await run({ ev, evAt: clock() }); last = { ev }; continue; }
    }
    const r = await settle(chain.info()); polls++;
    if (r.ok && r.v.seen) { // registra a primeira vez que cada fonte mostrou cada bloco (lastro de qual é a mais rápida)
      const w = await kvGet(env, 'watch', {}), race = w.race && w.race.h >= r.v.height - 1 ? w.race : { h: r.v.height, first: {} };
      let ch = false;
      for (const [src, h] of Object.entries(r.v.seen)) if (h > (race.h || 0) || (h === race.h && !race.first[src])) {
        if (h > race.h) { race.h = h; race.first = {}; race.blockT = null; }
        race.first[src] = clock(); ch = true;
      }
      if (r.v.time && r.v.height === race.h) race.blockT = r.v.time;
      if (ch) await kvPut(env, 'watch', Object.assign(w, { race }));
    }
    if (r.ok && r.v.height > known) {
      seen = r.v.height;
      const lock = await kvGet(env, 'watch', {}); // outra execução já disparou este bloco: não repete
      if (!(lock.firedH >= seen && clock() - (lock.firedAt || 0) < 150e3)) { await run({ h: seen, firedH: seen }); last = { h: seen }; continue; }
      if (!fired) return { fired: false, why: 'já disparado', h: seen };
    }
    if (clock() - start + every > budget) break;
    await sleep(every);
  }
  await kvPut(env, 'watch', Object.assign(await kvGet(env, 'watch', {}), { at: clock(), h: Math.max(seen, known), polls, every }));
  return fired ? Object.assign({ fired: true, n: fired, polls }, last) : { fired: false, polls };
}

// Endereço público do servidor (para o webhook do Telegram): anotado quando o painel chama, sem gravar se não mudou.
let selfMem = null;
function selfUrlSeen(env, origin, ctx) {
  if (!/^https:\/\//.test(origin) || selfMem === origin) return;
  selfMem = origin;
  const w = kvGet(env, 'self', {}).then((x) => (x.url !== origin ? kvPut(env, 'self', { url: origin, at: Date.now() }) : null)).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(w);
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
      if (url.pathname.startsWith('/tg/') && req.method === 'POST') {
        const e2 = await withCreds(env), sec = await tgSecret(e2);
        if (!sec || url.pathname !== '/tg/' + sec || req.headers.get('x-telegram-bot-api-secret-token') !== sec) return json({ error: 'não encontrado' }, 404);
        const upd = await req.json().catch(() => null), work = handleTelegram(e2, upd, fetchFn).catch((er) => appendLog(e2, [{ t: Date.now(), kind: 'erro', text: 'Jarbas: ' + (er.message || er) }]));
        if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
        return json({ ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/status' && env.FD_STORE) { const o = url.origin; selfUrlSeen(env, o, ctx); }
        if (!allowedOrigin(env, req.headers.get('Origin')) && req.headers.get('Origin')) return json({ error: 'origem não permitida' }, 403, h);
        const full = authOk(req, env), ro = !full && await readOk(req, env, url);
        if (!full && !ro) return json({ error: 'token inválido ou PANEL_TOKEN não configurado (mínimo 24 caracteres)' }, 401, h);
        let r = await api(req, await withCreds(env), url, fetchFn);
        if (ro && url.pathname === '/api/status') { // leitura: sem endereço, chaves e Telegram
          const j = await r.json();
          if (j.config) j.config = Object.assign({}, j.config, { payoutAddress: j.config.payoutAddress ? '(oculto)' : '', xmrAddress: j.config.xmrAddress ? '(oculto)' : '' });
          j.creds = null; j.readOnly = true;
          r = json(j);
        }
        for (const [k, v] of Object.entries(h)) r.headers.set(k, v);
        return r;
      }
      return json({ error: 'não encontrado' }, 404, h);
    } catch (e) {
      return json({ error: String(e.message || e) }, e.status || 500, h);
    }
  },
  async scheduled(event, env, ctx) {
    // cron a cada minuto: no minuto múltiplo de 3 roda o ciclo completo (como antes); nos outros, só o vigia de bloco do Sniper.
    const min = new Date(event.scheduledTime || Date.now()).getUTCMinutes(), fail = (w) => (e) => appendLog(env, [{ t: Date.now(), kind: 'erro', text: w + ' falhou: ' + (e.message || e) }]);
    const full = async () => { // se o vigia ainda está rodando um ciclo disparado por bloco, espera ele terminar (não gravam juntos)
      const w = await kvGet(env, 'watch', {}).catch(() => ({}));
      if (w.firedAt && !w.tookMs && Date.now() - w.firedAt < 45e3) await new Promise((r) => setTimeout(r, 25e3));
      return tick(env);
    };
    // minutos 1, 16, 31 e 46: varredura de oportunidades (mais algoritmos e MiningRigRentals), numa chamada só dela
    const scan = async () => {
      const e2 = await withCreds(env), cfg = await getConfig(e2), st = await kvGet(e2, 'state', {});
      const r = await runScan({ env: e2, now: Date.now(), cfg, btcUsd: (st.market || {}).btcUsd || null });
      const old = await kvGet(e2, 'scan', {});
      r.hist = await scanHistory({ env: e2, now: Date.now(), prev: old.hist });
      await kvPut(e2, 'scan', r);
      // laboratório das novas frentes (base, P2P, Boros, Pendle PT): coleta pública, papel, sem capital
      try {
        const f = (u, o) => fetch(u, Object.assign({ headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'funding-desk/1.0' } }, o || {})).then((x) => { if (!x.ok) throw new Error('HTTP ' + x.status); return x.json(); });
        const errs = {}, names = ['deribitBTC', 'deribitETH', 'p2pVenda', 'p2pCompra', 'boros', 'pendle', 'bitfinex', 'bitfinexVelas'], S2 = (pr, i) => pr.then((v) => v, (e) => { errs[names[i]] = String((e && e.message) || e).slice(0, 80); return null; }), p2pq = (side) => f('https://api2.bybit.com/fiat/otc/item/online', { method: 'POST', body: JSON.stringify({ tokenId: 'USDT', currencyId: 'BRL', side, size: '20', page: '1', amount: '500', authMaker: true, canTrade: false }) });
        const [db, de, ps, pb, bo, pa, bx, bxc] = await Promise.all([f('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=future'), f('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=future'),
          p2pq('1'), p2pq('0'), f('https://api.boros.finance/open-api/v1/markets'), f('https://api-v2.pendle.finance/core/v1/markets/all?isActive=true'),
          f('https://api-pub.bitfinex.com/v2/ticker/fUSD'), f('https://api-pub.bitfinex.com/v2/candles/trade:15m:fUSD:a30:p2:p30/hist?limit=2')].map(S2));
        const y = (st.market2 && st.market2.yields) || {}, prevLab = await kvGet(e2, 'lab', null);
        // Pendle: uma chamada só com todas as redes (a API limita por IP e o IP da Cloudflare é dividido com outros);
        // se negar, usa a última leitura boa de até 6 h (marcada como atrasada)
        const CH = { 1: 'Ethereum', 42161: 'Arbitrum', 8453: 'Base', 56: 'BNB', 5000: 'Mantle', 146: 'Sonic', 999: 'HyperEVM', 9745: 'Plasma', 10: 'Optimism', 143: 'Monad', 196: 'X Layer' };
        let pendle = null;
        if (pa && Array.isArray(pa.markets)) { const g = {}; for (const m of pa.markets) { const id = +(m.chainId || String(m.pt || '').split('-')[0]) || 0, c = CH[id] || ('rede ' + id); (g[c] || (g[c] = { markets: [] })).markets.push({ name: m.name, expiry: m.expiry, details: { impliedApy: m.details && m.details.impliedApy, liquidity: m.details && m.details.liquidity } }); } pendle = { at: Date.now(), lists: Object.entries(g) }; }
        else { const feed = await kvGet(e2, 'pendleFeed', null); if (feed && Date.now() - feed.at < 3 * 3600e3) { pendle = feed; delete errs.pendle; } else if (prevLab && prevLab.pendleCache && Date.now() - prevLab.pendleCache.at < 6 * 3600e3) pendle = prevLab.pendleCache; }
        const lr = labStep(prevLab, { now: Date.now(), deribit: [].concat((db && db.result) || [], (de && de.result) || []), p2p: ps && pb ? { sell: ps.result && ps.result.items, buy: pb.result && pb.result.items } : null,
          boros: bo, pendle: pendle ? pendle.lists : [], pendleCache: pendle, aaveApy: y.aaveUsdc && isFinite(y.aaveUsdc.apy) ? y.aaveUsdc.apy : null,
          ptax: st.fronts && st.fronts.brl && st.fronts.brl.ptax, cdiPct: st.fronts && st.fronts.cdi, errs, bfx: bx, bfxCandles: bxc });
        await kvPut(e2, 'lab', lr.lab);
        for (const ev of lr.events) await notify(e2, ev);
      } catch (e) { await appendLog(e2, [{ t: Date.now(), kind: 'erro', text: 'laboratório: ' + (e.message || e) }]); }
    };
    ctx.waitUntil(min % 3 === 0 ? full().catch(fail('ciclo')) : min % 15 === 1 ? scan().catch(fail('varredura')) : blockWatch(env).catch(fail('vigia de bloco')));
    if (min % 3 === 2) ctx.waitUntil(arbScan(env).catch(fail('arbitragem')));
  }
};
