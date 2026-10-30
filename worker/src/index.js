// Funding Desk — backend (Cloudflare Worker).
// - Rotas públicas /binance, /bybit, /nicehash: proxy só de leitura de dados de mercado.
// - Rotas /api/*: exigem o token do painel. Guardam as chaves da NiceHash como segredos do Worker.
// - Agendamento (cron): robô de mineração. Começa em modo "observe" (só registra o que faria).
import { createClient, NH_HOSTS } from './nicehash.js';
import { createChain, paidTo, DEFAULT_BCH_REST, DEFAULT_PRICE_URL } from './chain.js';
import { DEFAULT_CONFIG, sanitizeConfig, parseBook, computeMarket, decide, limitsFromEnv } from './bot.js';
import { fundingSnapshot, runAlerts } from './alerts.js';

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
  return createClient({ base, key: env.NH_API_KEY, secret: env.NH_API_SECRET, org: env.NH_ORG_ID, fetchFn: fetchFn || fetch });
}
function chainClient(env, fetchFn) {
  return createChain({ base: env.BCH_REST || DEFAULT_BCH_REST, priceUrl: env.PRICE_URL || DEFAULT_PRICE_URL, fetchFn: fetchFn || fetch });
}
function hasKeys(env) { return !!(env.NH_API_KEY && env.NH_API_SECRET && env.NH_ORG_ID); }

async function notify(env, text, fetchFn) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await (fetchFn || fetch)('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: 'Funding Desk: ' + text })
    });
  } catch (e) { /* aviso é opcional */ }
}

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e.message || e) }));

/* ---------- ciclo do robô ---------- */
export async function tick(env, opts = {}) {
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
  const units = unitsR.ok ? unitsR.v : { minLimitPH: 0.1, priceDownStepEH: 0.01, minOrderBtc: 0.001 };

  // Blocos novos: confere se a recompensa caiu no endereço configurado.
  let blockEvent = null;
  if (info.ok) {
    if (state.lastHeight == null || info.v.height - state.lastHeight > 50) state.lastHeight = info.v.height;
    const upto = Math.min(info.v.height, state.lastHeight + 5);
    for (let h = state.lastHeight + 1; h <= upto; h++) {
      const cb = await settle(chain.coinbase(h));
      if (!cb.ok) { errors.push('coinbase ' + h + ': ' + cb.e); break; }
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
  if (cfg.alerts !== false) {
    const funding = predR.ok ? fundingSnapshot(predR.v, cfg, now) : null;
    if (!predR.ok) errors.push('funding (Hyperliquid): ' + predR.e);
    const ra = runAlerts({ state, funding, edges: mkt.ok ? { BCH: mkt.edgeAtBidPct } : {}, now, minEdgePct: cfg.minEdgePct });
    newAlerts = ra.alerts; alertState = ra.state;
    for (const a of newAlerts) log.push({ t: now, kind: 'alerta', text: a.title + ': ' + a.text });
    for (const a of newAlerts.slice(0, 3)) await notify(env, a.title + '. ' + a.text, fetchFn);
  }

  const next = Object.assign({}, dec.state, alertState, {
    lastTick: now, lastHeight: state.lastHeight, feesBch: state.feesBch, myBlocks: state.myBlocks || [], lastSig: sig, lastErrSig: errSig,
    market: mkt.ok ? { breakEvenEH: mkt.breakEvenEH, capEH: mkt.capEH, fillEH: mkt.fillEH, medianEH: mkt.medianEH, bidEH: mkt.bidEH,
      edgeAtBidPct: mkt.edgeAtBidPct, green: mkt.green, D: mkt.D, bchUsd: mkt.bchUsd, btcUsd: mkt.btcUsd, costPerBlockUsd: mkt.costPerBlockUsd,
      hashpriceNet: mkt.hashpriceNet, market: mkt.market } : { ok: false, reason: mkt.reason },
    errors
  });
  // Histórico curto da margem (para achar horários baratos), um ponto a cada ~15 min.
  const hist = next.edgeHist = (state.edgeHist || []);
  if (mkt.ok && (!hist.length || now - hist[hist.length - 1][0] >= 15 * 60e3)) hist.push([now, +mkt.edgeAtBidPct.toFixed(2), +mkt.bidEH.toFixed(4)]);
  next.edgeHist = hist.slice(-672); // 7 dias
  await kvPut(env, 'state', next);
  await appendLog(env, log);
  return { market: next.market, actions: results, notes: dec.notes, errors, blockEvent, mode: cfg.mode, alerts: newAlerts };
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
  const need = () => { if (!hasKeys(env)) throw Object.assign(new Error('Chaves da NiceHash não configuradas no servidor (NH_API_KEY, NH_API_SECRET, NH_ORG_ID)'), { status: 412 }); };

  if (p === '/status' && m === 'GET') {
    const [cfg, state] = await Promise.all([getConfig(env), kvGet(env, 'state', {})]);
    return json({ version: VERSION, nhEnv: env.NH_BASE ? 'personalizado' : (env.NH_ENV === 'prod' ? 'produção' : 'teste'), keys: hasKeys(env),
      telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), limits, config: cfg,
      state: { lastTick: state.lastTick, lastHeight: state.lastHeight, market: state.market, myBlocks: state.myBlocks || [], dailyUsd: state.dailyUsd || 0,
        errors: state.errors || [], edgeHist: state.edgeHist || [], alerts: (state.alerts || []).slice(-20).reverse() } });
  }
  if (p === '/config' && m === 'PUT') {
    const { config, errors } = sanitizeConfig(body, await getConfig(env), limits);
    if (errors.length) return json({ error: errors.join('; ') }, 400);
    if (config.mode === 'active' && !hasKeys(env)) return json({ error: 'modo ativo exige as chaves da NiceHash no servidor' }, 400);
    await kvPut(env, 'config', config);
    await appendLog(env, [{ t: Date.now(), kind: 'config', text: `configuração salva (modo ${config.mode})` }]);
    return json({ config });
  }
  if (p === '/tick' && m === 'POST') return json(await tick(env, { fetchFn }));
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
        const r = await api(req, env, url, fetchFn);
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
