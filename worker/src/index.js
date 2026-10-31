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
  const [info, prices, bookR, unitsR, predR] = await Promise.all([chain.info(), chain.prices(), nh.orderBook(), nh.units(), predicted].map(settle));
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
      newBlocks.push({ height: h, hash: cb.v.hash, difficulty: cb.v.difficulty, time: cb.v.time });
      const total = cb.v.outs.reduce((s, o) => s + o.value, 0);
      state.feesBch = state.feesBch == null ? Math.max(0, total - 3.125) : state.feesBch * 0.9 + Math.max(0, total - 3.125) * 0.1;
      const mine = cfg.payoutAddress ? paidTo(cb.v, cfg.payoutAddress) : 0;
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
  let paper = state.paper || null;
  if (cfg.mode === 'observe') {
    const ps = paperStep(paper, { cfg, mkt, now, units, limits, blocks: newBlocks });
    paper = ps.paper;
    for (const e of ps.events) log.push({ t: now, kind: 'simulado', text: e });
  } else if (paper) paper.lastTs = now; // fora do Observar a simulação fica parada
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
  const funding = predR.ok ? fundingSnapshot(predR.v, cfg, now) : null;
  if (!predR.ok) errors.push('funding (Hyperliquid): ' + predR.e);
  // Operações simuladas de funding: rodam sempre (o funding ainda é manual; isto mostra o que um robô com regras fixas faria).
  let fundPaper = state.fundPaper || null;
  if (funding) {
    const fp = fundPaperStep(fundPaper, { rows: funding.rows, best: funding.best, now, fees: FD.DEFAULT_FEES });
    fundPaper = fp.pf;
    for (const e of fp.events) log.push({ t: now, kind: 'simulado', text: e });
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
  let algoPaper = state.algoPaper || null, algoTs = state.algoTs || 0;
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
      const ap = algoPaperStep(algoPaper, { map, now });
      algoPaper = ap.pa; algoTs = now;
      for (const e of ap.events) log.push({ t: now, kind: 'simulado', text: e });
    } else errors.push('WhatToMine: ' + res[0].e);
  }

  // Placar: cada alerta de entrada de funding vira uma posição hipotética acompanhada pelo prazo projetado.
  const byKey = {}; for (const b of (funding && funding.best) || []) byKey[b.key] = b;
  const entries = newAlerts.filter((a) => a.area === 'funding' && a.kind === 'entrada' && /^fe:/.test(a.key || '')).map((a) => {
    const b = byKey[a.key.slice(3)]; return b ? { key: b.key, coin: b.coin, s: b.s, l: b.l, projUsd: b.netUsd } : null;
  }).filter(Boolean);
  const alertScore = alertScoreStep(state.alertScore, { rows: funding && funding.rows, entries, now, fees: FD.DEFAULT_FEES, holdDays: cfg.alertHold || 3 });

  const next = Object.assign({}, dec.state, alertState, {
    lastTick: now, paper, real, fundPaper, alertScore, algoPaper, algoTs, lastHeight: state.lastHeight, feesBch: state.feesBch, myBlocks: state.myBlocks || [], lastSig: sig, lastErrSig: errSig,
    market: mkt.ok ? { breakEvenEH: mkt.breakEvenEH, capEH: mkt.capEH, fillEH: mkt.fillEH, medianEH: mkt.medianEH, bidEH: mkt.bidEH,
      edgeAtBidPct: mkt.edgeAtBidPct, green: mkt.green, D: mkt.D, bchUsd: mkt.bchUsd, btcUsd: mkt.btcUsd, costPerBlockUsd: mkt.costPerBlockUsd,
      hashpriceNet: mkt.hashpriceNet, blockNetUsd: mkt.blockNetUsd, phDaysPerBlock: mkt.phDaysPerBlock, market: mkt.market } : { ok: false, reason: mkt.reason },
    errors
  });
  // Histórico curto da margem (para achar horários baratos), um ponto a cada ~15 min.
  const hist = next.edgeHist = (state.edgeHist || []);
  if (mkt.ok && (!hist.length || now - hist[hist.length - 1][0] >= 15 * 60e3)) hist.push([now, +mkt.edgeAtBidPct.toFixed(2), +mkt.bidEH.toFixed(4)]);
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
        paper: state.paper || null, real: state.real ? Object.assign({}, state.real, { paid: undefined }) : null,
        fundPaper: state.fundPaper ? { summary: fundPaperSummary(state.fundPaper), open: state.fundPaper.open, closed: state.fundPaper.closed.slice(-100).reverse() } : null,
        algoPaper: state.algoPaper || null,
        alertScore: state.alertScore ? { summary: alertScoreSummary(state.alertScore), open: state.alertScore.open.map((o) => Object.assign({}, o, { legs: undefined })), done: state.alertScore.done.slice(-100).reverse() } : null } });
  }
  if (p === '/config' && m === 'PUT') {
    const { config, errors } = sanitizeConfig(body, await getConfig(env), limits);
    if (errors.length) return json({ error: errors.join('; ') }, 400);
    if (config.mode === 'active' && !hasKeys(env)) return json({ error: 'modo ativo exige a NiceHash conectada (Ajustes → Conectar contas)' }, 400);
    await kvPut(env, 'config', config);
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: `configuração salva (modo ${config.mode})` }]);
    return json({ config });
  }
  if (p === '/tick' && m === 'POST') return json(await tick(env, { fetchFn }));
  if (p === '/paper/reset' && m === 'POST') {
    const st = await kvGet(env, 'state', {});
    if (body.what === 'funding') st.fundPaper = null; else if (body.what === 'algos') { st.algoPaper = null; st.algoTs = 0; }
    else if (body.what === 'all') { st.paper = null; st.fundPaper = null; st.algoPaper = null; st.algoTs = 0; } else st.paper = null;
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
