// Robô de mineração solo com hashrate alugado — lógica pura (sem rede, sem armazenamento).
// Princípio: só comprar hash quando o preço com taxas fica abaixo da receita esperada menos uma margem.
// Parar no bloco e stop-loss controlam risco e caixa; não mudam o retorno esperado por dólar.

export const DEFAULT_CONFIG = {
  mode: 'observe',          // 'off' | 'observe' (calcula e registra, não executa) | 'active'
  payoutAddress: '',        // endereço BCH que recebe a recompensa (coinbase)
  poolId: '',               // pool cadastrado na NiceHash para ordens novas
  poolFeePct: 2,
  rentFeePct: 3,            // taxa da NiceHash sobre o gasto
  minEdgePct: 3,            // margem mínima sobre o preço de empate
  bidPremiumPct: 0.5,       // lance acima do menor preço que está recebendo hash
  targetPh: 10,             // potência com sinal verde
  minPh: 0,                 // potência de pausa (0 = mínimo da NiceHash)
  onBlock: 'cancel',        // 'cancel' | 'min' | 'continue'
  sessionBudgetUsd: 300,    // stop-loss: gasto máximo por sessão sem bloco (0 = desligado)
  dailyBudgetUsd: 500,      // gasto máximo por dia (UTC); ao atingir, reduz para a potência de pausa
  autoCreate: false,        // criar ordem quando o sinal ficar verde e não houver ordem gerenciada
  orderAmountBtc: 0.002,
  managed: [],              // ids das ordens que o robô pode alterar ou cancelar
  alerts: true,             // alertas de entrada/saída/risco (funding e mineração) a cada ciclo, com Telegram
  fundStable24: true,       // funding: só "Compensa" com 24 h seguidas acima do empate (regra validada em 90 dias)
  alertCapital: 1000,       // capital usado para calcular os alertas de funding
  alertHold: 3              // ciclo (dias) usado nos alertas de funding
};

export const DOWN_STEP_MS = 10 * 60 * 1000; // NiceHash: uma redução de preço (priceDownStep) a cada ~10 min
const TWO32 = 4294967296;

export function limitsFromEnv(env = {}) {
  const n = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
  return { maxOrderBtc: n(env.MAX_ORDER_BTC, 0.01), maxLimitPh: n(env.MAX_LIMIT_PH, 100), maxDailyUsd: n(env.MAX_DAILY_USD, 1000) };
}

const ADDR = /^(bitcoincash:)?[qp][a-z0-9]{41}$/;
// Valida e mescla a configuração enviada pelo painel. Nunca confia no cliente.
export function sanitizeConfig(input = {}, prev = DEFAULT_CONFIG, limits = limitsFromEnv()) {
  const c = Object.assign({}, DEFAULT_CONFIG, prev), errors = [];
  const num = (k, lo, hi) => {
    if (input[k] === undefined) return;
    const v = parseFloat(input[k]);
    if (!isFinite(v) || v < lo || v > hi) errors.push(`${k} fora de ${lo}..${hi}`);
    else c[k] = v;
  };
  if (input.mode !== undefined) {
    if (['off', 'observe', 'active'].includes(input.mode)) c.mode = input.mode; else errors.push('mode inválido');
  }
  if (input.onBlock !== undefined) {
    if (['cancel', 'min', 'continue'].includes(input.onBlock)) c.onBlock = input.onBlock; else errors.push('onBlock inválido');
  }
  if (input.payoutAddress !== undefined) {
    const a = String(input.payoutAddress).trim().toLowerCase();
    if (a === '' || ADDR.test(a)) c.payoutAddress = a; else errors.push('endereço BCH inválido (use o formato cashaddr)');
  }
  if (input.poolId !== undefined) c.poolId = String(input.poolId).slice(0, 64);
  num('poolFeePct', 0, 20); num('rentFeePct', 0, 20); num('minEdgePct', -50, 100); num('bidPremiumPct', 0, 50);
  num('targetPh', 0, limits.maxLimitPh); num('minPh', 0, limits.maxLimitPh);
  num('sessionBudgetUsd', 0, limits.maxDailyUsd); num('dailyBudgetUsd', 0, limits.maxDailyUsd);
  num('orderAmountBtc', 0, limits.maxOrderBtc);
  if (input.autoCreate !== undefined) c.autoCreate = !!input.autoCreate;
  if (input.alerts !== undefined) c.alerts = !!input.alerts;
  if (input.fundStable24 !== undefined) c.fundStable24 = !!input.fundStable24;
  num('alertCapital', 10, 1e7); num('alertHold', 1, 30);
  if (input.managed !== undefined) {
    if (Array.isArray(input.managed)) c.managed = input.managed.map(String).slice(0, 50); else errors.push('managed deve ser lista');
  }
  return { config: c, errors };
}

// Livro de ordens público → preços em BTC/EH/dia e velocidade em PH/s (as unidades variam por ambiente).
export function parseBook(d) {
  const mk = Object.keys((d && d.stats) || {})[0];
  if (!mk) return null;
  const s = d.stats[mk], pf = parseFloat(s.priceFactor) || 1e18, mf = parseFloat(s.marketFactor) || 1e18;
  const toEH = 1e18 / pf, toPH = mf / 1e15;
  const paying = (s.orders || []).filter((o) => o.alive !== false && parseFloat(o.acceptedSpeed) > 0)
    .map((o) => ({ price: parseFloat(o.price) * toEH, speed: parseFloat(o.acceptedSpeed) * toPH }))
    .sort((a, b) => a.price - b.price);
  const tot = paying.reduce((a, o) => a + o.speed, 0);
  let acc = 0, med = null;
  for (const o of paying) { acc += o.speed; if (acc >= tot / 2) { med = o.price; break; } }
  // menor preço entre ordens FIXED (preço garantido, costuma sair mais caro que a STANDARD)
  const fixed = (s.orders || []).filter((o) => o.alive !== false && /FIXED/i.test(String((o.type && o.type.code) || o.type || ''))).map((o) => parseFloat(o.price) * toEH).filter(isFinite);
  return { market: mk, fillEH: paying.length ? paying[0].price : null, medianEH: med, totalPH: tot, payingOrders: paying.length, fixedEH: fixed.length ? Math.min(...fixed) : null };
}

const ceil4 = (x) => Math.ceil(x * 1e4 - 1e-9) / 1e4;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// Receita esperada, preço de empate e sinal. Preços em BTC/EH/dia.
export function computeMarket({ D, bchUsd, btcUsd, feesBch = 0, book, cfg }) {
  if (!(D > 0 && bchUsd > 0 && btcUsd > 0)) return { ok: false, reason: 'sem dificuldade ou cotação' };
  const phDaysPerBlock = D * TWO32 / 1e15 / 86400;
  const blockNetUsd = (3.125 + feesBch) * bchUsd * (1 - cfg.poolFeePct / 100);
  const hashpriceNet = blockNetUsd / phDaysPerBlock;                       // US$/PH/dia após taxa do pool
  const breakEvenEH = hashpriceNet / (1 + cfg.rentFeePct / 100) / btcUsd * 1000;
  const capEH = breakEvenEH * (1 - cfg.minEdgePct / 100);
  const m = { ok: true, D, bchUsd, btcUsd, phDaysPerBlock, blockNetUsd, hashpriceNet, breakEvenEH, capEH,
    fillEH: book && book.fillEH, medianEH: book && book.medianEH, market: book && book.market };
  if (!m.fillEH) return Object.assign(m, { ok: false, reason: 'livro de ordens vazio' });
  m.bidEH = ceil4(m.fillEH * (1 + cfg.bidPremiumPct / 100));
  m.edgeAtBidPct = (breakEvenEH / m.bidEH - 1) * 100;
  m.green = m.bidEH <= capEH;
  m.costPerBlockUsd = phDaysPerBlock * m.bidEH / 1000 * btcUsd * (1 + cfg.rentFeePct / 100);
  return m;
}

function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

// Decide as ações do ciclo. Não executa nada: devolve ações, notas e o novo estado.
// orders: ordens normalizadas (priceEH, limitPH, paidBtc, alive, createdTs).
// blockEvent: { height, bch } quando a recompensa de um bloco caiu no endereço desde o último ciclo.
export function decide({ cfg, mkt, orders, state = {}, now, units, limits = limitsFromEnv(), blockEvent = null }) {
  const st = JSON.parse(JSON.stringify(state || {}));
  st.sessions = st.sessions || {}; st.lastDecrease = st.lastDecrease || {}; st.dayStart = st.dayStart || {};
  const actions = [], notes = [];
  const today = utcDay(now);
  if (st.day !== today) { st.day = today; st.dayStart = {}; }
  const managed = orders.filter((o) => o.alive && (cfg.managed || []).includes(o.id));
  const minPh = Math.max(cfg.minPh || 0, units.minLimitPH);
  const target = Math.min(Math.max(cfg.targetPh, minPh), limits.maxLimitPh);

  // gasto do dia (UTC) nas ordens gerenciadas
  let dailyBtc = 0;
  for (const o of managed) {
    if (st.dayStart[o.id] === undefined) st.dayStart[o.id] = o.createdTs && utcDay(o.createdTs) === today ? 0 : o.paidBtc;
    dailyBtc += Math.max(0, o.paidBtc - st.dayStart[o.id]);
  }
  const dailyUsd = mkt.btcUsd ? dailyBtc * mkt.btcUsd : 0;
  st.dailyUsd = dailyUsd;
  const dailyHit = cfg.dailyBudgetUsd > 0 && dailyUsd >= cfg.dailyBudgetUsd;
  if (dailyHit) notes.push(`limite diário atingido (US$${dailyUsd.toFixed(2)})`);

  if (cfg.mode === 'off') return { actions, notes: notes.concat('robô desligado'), state: st };

  for (const o of managed) {
    const sess = st.sessions[o.id] || (st.sessions[o.id] = { startPaid: o.paidBtc, startTs: now });
    if (blockEvent) {
      const why = `bloco ${blockEvent.height} pago no seu endereço`;
      if (cfg.onBlock === 'cancel') { actions.push({ type: 'cancel', id: o.id, reason: why + ': encerrando a ordem' }); continue; }
      st.sessions[o.id] = { startPaid: o.paidBtc, startTs: now };
      if (cfg.onBlock === 'min') {
        if (o.limitPH > minPh + 1e-9) actions.push({ type: 'update', id: o.id, priceEH: o.priceEH, limitPH: minPh, reason: why + ': reduzindo à potência de pausa' });
        continue;
      }
    }
    const sessionUsd = mkt.btcUsd ? (o.paidBtc - st.sessions[o.id].startPaid) * mkt.btcUsd : 0;
    if (cfg.sessionBudgetUsd > 0 && sessionUsd >= cfg.sessionBudgetUsd) {
      actions.push({ type: 'cancel', id: o.id, reason: `stop-loss: sessão gastou US$${sessionUsd.toFixed(2)} sem bloco` });
      continue;
    }
    if (!mkt.ok) { notes.push(`ordem ${o.id}: sem dados de mercado (${mkt.reason}), nada alterado`); continue; }

    let limit = mkt.green && !dailyHit ? target : minPh;
    const want = mkt.green ? mkt.bidEH : Math.min(o.priceEH, r4(mkt.capEH));
    const rule = `empate ${isFinite(mkt.breakEvenEH) ? mkt.breakEvenEH.toFixed(4) : '—'} − sua margem ${cfg.minEdgePct}% = teto ${isFinite(mkt.capEH) ? mkt.capEH.toFixed(4) : '—'}`;
    let price = want, reason = mkt.green ? `sinal verde: margem ${mkt.edgeAtBidPct.toFixed(1)}% no lance. Por quê: lance ${mkt.bidEH.toFixed(4)} ≤ teto (${rule})`
      : `acima do teto (${mkt.capEH.toFixed(4)}): pausa. Por quê: lance ${mkt.bidEH.toFixed(4)} > teto (${rule}); comprar acima disso dá prejuízo médio`;
    if (dailyHit && mkt.green) reason = 'limite diário: pausa';
    if (want < o.priceEH - 1e-9) {
      const last = st.lastDecrease[o.id] || 0;
      if (now - last >= DOWN_STEP_MS) { price = Math.max(want, r4(o.priceEH - units.priceDownStepEH)); st.lastDecrease[o.id] = now; }
      else price = o.priceEH;
      if (price > mkt.capEH + 1e-9) { limit = minPh; reason += '; baixando o preço aos poucos (regra da NiceHash)'; }
    }
    if (Math.abs(price - o.priceEH) >= 0.00005 || Math.abs(limit - o.limitPH) >= 0.001) {
      actions.push({ type: 'update', id: o.id, priceEH: r4(price), limitPH: limit, reason });
    }
  }

  if (cfg.autoCreate && !managed.length && mkt.ok && mkt.green && !dailyHit && cfg.poolId) {
    const amount = Math.max(units.minOrderBtc, Math.min(cfg.orderAmountBtc, limits.maxOrderBtc));
    actions.push({ type: 'create', priceEH: mkt.bidEH, limitPH: target, amountBtc: amount, poolId: cfg.poolId,
      market: mkt.market, reason: `sinal verde sem ordem ativa: criando (margem ${mkt.edgeAtBidPct.toFixed(1)}%)` });
  }
  for (const id of Object.keys(st.sessions)) if (!managed.some((o) => o.id === id)) delete st.sessions[id];
  return { actions, notes, state: st };
}
