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
  sessionBudgetUsd: 300,    // stop-loss: gasto máximo por tentativa (até achar bloco), somando todas as ordens (0 = desligado)
  stopCooldownH: 6,         // depois do stop-loss, horas sem criar ordem nova (a janela que comeu o orçamento passa)
  dailyBudgetUsd: 500,      // gasto máximo por dia (UTC); ao atingir, reduz para a potência de pausa
  weeklyLossUsd: 1000,
  sniper: false,            // MODO_SNIPER: tiro curto quando o bloco do BCH atrasa (substitui só a regra de entrada)
  sniperAgeMin: 20,         // sniper (opcional): gatilho por atraso do último bloco, em min (sniperUseAge)
  sniperUseAge: false,      // sniper: usar também o gatilho por atraso (sem memória: não aumenta a chance)
  sniperDiffDropPct: 10,    // sniper: dificuldade atual X% abaixo da média dos últimos 12 blocos
  sniperFeeX: 3,            // sniper: mempool X vezes acima da média das últimas 24 h
  sniperMinEdge: -7,        // sniper: e a margem é de pelo menos X% (aceita negativa)
  sniperPh: 25,             // sniper: potência do tiro (PH/s)
  sniperIdlePh: 1,          // sniper: potência de espera (PH/s)
  sniperShotMin: 4,         // sniper: duração máxima do tiro sem bloco (kill switch, min)
  minEdgeMode: 'fixo',      // 'fixo' (margem mínima da config) | 'relativo' (os X% melhores momentos das últimas 24 h, com piso)
  relPct: 75,               // regra relativa: entra quando a margem está entre os (100 − relPct)% melhores das últimas 24 h
  relFloorPct: -2,          // regra relativa: nunca entra com margem abaixo deste piso      // perda máxima em 7 dias (gasto − recebido, resultado real); ao atingir, encerra tudo e avisa (0 = desligado)
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
  if (input.sniper !== undefined) c.sniper = !!input.sniper;
  if (input.sniperUseAge !== undefined) c.sniperUseAge = !!input.sniperUseAge;
  num('sniperDiffDropPct', 0.1, 50); num('sniperFeeX', 1.1, 100);
  num('sniperAgeMin', 5, 120); num('sniperMinEdge', -20, 20); num('sniperPh', 1, limits.maxLimitPh); num('sniperIdlePh', 0, limits.maxLimitPh); num('sniperShotMin', 1, 60);
  if (input.minEdgeMode !== undefined) { if (['fixo', 'relativo'].includes(input.minEdgeMode)) c.minEdgeMode = input.minEdgeMode; else errors.push('minEdgeMode inválido'); }
  num('relPct', 50, 95); num('relFloorPct', -10, 20);
  num('poolFeePct', 0, 20); num('rentFeePct', 0, 20); num('minEdgePct', -50, 100); num('bidPremiumPct', 0, 50);
  num('targetPh', 0, limits.maxLimitPh); num('minPh', 0, limits.maxLimitPh);
  num('sessionBudgetUsd', 0, limits.maxDailyUsd); num('dailyBudgetUsd', 0, limits.maxDailyUsd); num('stopCooldownH', 0, 72); num('weeklyLossUsd', 0, limits.maxDailyUsd * 7);
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
  // Recebendo hash AGORA = velocidade aceita e máquinas trabalhando (rigsCount > 0). A velocidade aceita é uma média que
  // demora a zerar: ordens que perderam as máquinas continuam com velocidade e preço baixo por um tempo e enganam o
  // "menor preço recebendo" (31/10: 0,40 parecia recebendo, mas o hash real só ia para ordens a partir de 0,4254).
  const live = (o) => o.alive !== false && parseFloat(o.acceptedSpeed) > 0;
  const withRigs = (s.orders || []).some((o) => live(o) && +o.rigsCount > 0);
  const paying = (s.orders || []).filter((o) => live(o) && (!withRigs || +o.rigsCount > 0))
    .map((o) => ({ price: parseFloat(o.price) * toEH, speed: parseFloat(o.acceptedSpeed) * toPH }))
    .sort((a, b) => a.price - b.price);
  const tot = paying.reduce((a, o) => a + o.speed, 0);
  let acc = 0, med = null;
  for (const o of paying) { acc += o.speed; if (acc >= tot / 2) { med = o.price; break; } }
  // menor preço entre ordens FIXED (preço garantido, costuma sair mais caro que a STANDARD)
  const fixed = (s.orders || []).filter((o) => o.alive !== false && /FIXED/i.test(String((o.type && o.type.code) || o.type || ''))).map((o) => parseFloat(o.price) * toEH).filter(isFinite);
  // Profundidade: [preço, PH/s acumulados até esse preço] das ordens recebendo. Um lance acima de um nível toma o hash
  // das ordens abaixo dele: é o tamanho que dá para comprar sem subir mais o preço (usado na potência ideal).
  const depth = []; let c = 0;
  for (const o of paying) { c += o.speed; if (depth.length && depth[depth.length - 1][0] === o.price) depth[depth.length - 1][1] = c; else depth.push([o.price, c]); }
  return { market: mk, fillEH: paying.length ? paying[0].price : null, medianEH: med, totalPH: tot, payingOrders: paying.length, fixedEH: fixed.length ? Math.min(...fixed) : null,
    depth: depth.slice(0, 40), staleOrders: withRigs ? (s.orders || []).filter((o) => live(o) && !(+o.rigsCount > 0)).length : 0 };
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
    fillEH: book && book.fillEH, medianEH: book && book.medianEH, market: book && book.market, depth: (book && book.depth) || null };
  if (!m.fillEH) return Object.assign(m, { ok: false, reason: 'livro de ordens vazio' });
  // Preço pelo tamanho (01/11): a ordem mais barata recebendo hash às vezes tem só 1–2 máquinas (fração de PH/s). Um lance
  // logo acima dela só toma esse pouco; para receber a potência alvo é preciso passar do nível do livro em que o hash
  // acumulado chega nela. Sem isso o sinal ficava verde por alguns minutos por causa de uma ordem minúscula (ex.: 0,404)
  // e no ciclo seguinte voltava a 0,426 (−2,3%).
  m.fillTopEH = m.fillEH;
  return sizeMarket(m, cfg.targetPh, cfg);
}
// Mesmo mercado com o lance para receber `ph` PH/s (profundidade do livro). Usado também pelos cenários de outra potência.
export function sizeMarket(mkt, ph, cfg) {
  if (!mkt || !mkt.ok || !(mkt.fillTopEH || mkt.fillEH)) return mkt;
  const m = Object.assign({}, mkt), size = Math.max(1, ph || 0), top = m.fillTopEH || m.fillEH;
  const lv = Array.isArray(m.depth) && m.depth.length ? (m.depth.find((d) => d[1] >= size) || m.depth[m.depth.length - 1]) : null;
  m.fillTopEH = top; m.fillEH = lv ? Math.max(top, lv[0]) : top; m.sizePh = size;
  m.bidEH = ceil4(m.fillEH * (1 + cfg.bidPremiumPct / 100));
  m.edgeAtBidPct = (m.breakEvenEH / m.bidEH - 1) * 100;
  m.green = m.bidEH <= m.capEH;
  m.costPerBlockUsd = m.phDaysPerBlock * m.bidEH / 1000 * m.btcUsd * (1 + cfg.rentFeePct / 100);
  return m;
}

function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

// Decide as ações do ciclo. Não executa nada: devolve ações, notas e o novo estado.
// orders: ordens normalizadas (priceEH, limitPH, paidBtc, alive, createdTs).
// blockEvent: { height, bch } quando a recompensa de um bloco caiu no endereço desde o último ciclo.
// MODO_SNIPER: decide o tiro pela idade do último bloco do BCH. Mesma função para o robô real e para a simulação.
// prev: estado anterior; blockT: horário do último bloco da rede; edge: margem real de agora (%).
// Dispara (sniperPh) quando o bloco tem mais de sniperAgeMin min e a margem é de pelo menos sniperMinEdge; recua para
// sniperIdlePh quando sai bloco novo ou quando o tiro passa de sniperShotMin min sem bloco (um tiro por bloco atrasado).
// Observação: o sorteio dos blocos não tem memória; o tempo desde o último bloco não aumenta a chance do próximo.
const f1 = (x) => Number(x).toFixed(1).replace('.', ',');
export function sniperDecide(prev, { now, blockT, edge, cfg, diffDropPct = null, feeX = null }) {
  const s = Object.assign({ shotStart: null, shotBlockT: null, usedBlockT: null, shots: 0, endsBlock: 0, endsTime: 0 }, prev || {});
  const ageMin = cfg.sniperAgeMin === undefined ? 20 : cfg.sniperAgeMin, minE = cfg.sniperMinEdge === undefined ? -7 : cfg.sniperMinEdge;
  const dur = (cfg.sniperShotMin === undefined ? 4 : cfg.sniperShotMin) * 60e3, age = blockT ? (now - blockT) / 60e3 : null;
  let reason = null;
  if (s.shotStart) {
    if (blockT && s.shotBlockT && blockT > s.shotBlockT) { s.shotStart = null; s.endsBlock++; s.lastEnd = { t: now, why: 'bloco' }; reason = 'sniper: bloco novo na rede, recuo para a potência de espera'; }
    else if (now - s.shotStart >= dur) { s.shotStart = null; s.usedBlockT = s.shotBlockT; s.endsTime++; s.lastEnd = { t: now, why: 'tempo' }; reason = `sniper: tiro de ${Math.round(dur / 60e3)} min sem bloco, recuo (kill switch)`; }
  }
  if (!s.shotStart) {
    // gatilhos: dificuldade em queda (DAA), mempool cheia (taxas) e, opcional, atraso do bloco
    const dLim = cfg.sniperDiffDropPct === undefined ? 10 : cfg.sniperDiffDropPct, fLim = cfg.sniperFeeX === undefined ? 3 : cfg.sniperFeeX;
    const g = { dif: isFinite(diffDropPct) && diffDropPct !== null && diffDropPct >= dLim, fee: isFinite(feeX) && feeX !== null && feeX >= fLim, age: !!cfg.sniperUseAge && age !== null && age > ageMin };
    const which = [g.dif ? `dificuldade ${f1(diffDropPct)}% abaixo da média de 12 blocos (gatilho ${f1(dLim)}%)` : '', g.fee ? `mempool ${f1(feeX)} vezes a média do dia (gatilho ${f1(fLim)})` : '', g.age ? `último bloco há ${Math.round(age)} min (gatilho ${ageMin})` : ''].filter(Boolean);
    const okEdge = isFinite(edge) && edge >= minE, used = s.usedBlockT === blockT && blockT;
    // depois de um recuo, o próximo tiro só no ciclo seguinte
    if (which.length && okEdge && !used && !reason) { s.shotStart = now; s.shotBlockT = blockT; s.shots++; reason = `sniper: ${which.join(' e ')}; margem do tiro ${f1(edge)}% (limite ${f1(minE)}%): tiro`; }
    else if (!reason) reason = which.length && used ? 'sniper: já atirou neste bloco; espera o próximo bloco' : which.length && !okEdge ? `sniper: gatilho ativo (${which.join(' e ')}), mas margem ${isFinite(edge) ? f1(edge) : '—'}% abaixo do limite ${f1(minE)}%; em espera` :
      `sniper: em espera (dificuldade ${diffDropPct === null || !isFinite(diffDropPct) ? 'sem dado' : diffDropPct >= 0 ? f1(diffDropPct) + '% abaixo' : f1(-diffDropPct) + '% acima'} da média de 12 blocos, gatilho ${f1(dLim)}% abaixo; mempool ${feeX === null || !isFinite(feeX) ? 'juntando 2 h de leituras' : f1(feeX) + ' vezes a média'}, gatilho ${f1(fLim)} vezes${cfg.sniperUseAge ? `; último bloco há ${age === null ? '—' : Math.round(age)} min, gatilho ${ageMin}` : ''})`;
  }
  return { shot: !!s.shotStart, state: s, reason, ageMin: age, diffDropPct, feeX };
}

export function decide({ cfg, mkt, orders, state = {}, now, units, limits = limitsFromEnv(), blockEvent = null, weekLossUsd = 0, blockT = null, snMetrics = {} }) {
  const st = JSON.parse(JSON.stringify(state || {}));
  st.lastDecrease = st.lastDecrease || {}; st.lastPriceChange = st.lastPriceChange || {}; st.dayStart = st.dayStart || {};
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
  if (dailyHit) notes.push(`limite diário atingido (US$${dailyUsd.toFixed(2).replace('.', ',')})`);

  if (cfg.mode === 'off') return { actions, notes: notes.concat('robô desligado'), state: st };

  // Limite de perda da carteira (7 dias, resultado real): acima dele encerra todas as ordens e não cria novas até a perda
  // da semana voltar para baixo do limite (os dias mais antigos saem da conta).
  if (cfg.weeklyLossUsd > 0 && weekLossUsd >= cfg.weeklyLossUsd) {
    for (const o of managed) actions.push({ type: 'cancel', id: o.id, reason: `limite de perda semanal: perda real de US$${weekLossUsd.toFixed(2).replace('.', ',')} em 7 dias (limite US$${cfg.weeklyLossUsd}); encerrando` });
    st.weekStop = true;
    return { actions, notes: notes.concat(`limite de perda semanal atingido (US$${weekLossUsd.toFixed(2).replace('.', ',')} de US$${cfg.weeklyLossUsd})`), state: st };
  }
  st.weekStop = false;

  // Sessão = uma tentativa de achar bloco. Soma o gasto de TODAS as ordens gerenciadas, inclusive as que já acabaram
  // (orçamento da ordem esgotado ou cancelada), em BTC. Zera no bloco. No stop-loss cancela tudo e fica stopCooldownH
  // sem criar ordem: sem isso, a ordem seguinte recomeçaria a conta e o stop-loss não limitaria nada.
  delete st.sessions;
  const px = mkt.btcUsd || st.lastBtcUsd || 0; if (mkt.btcUsd) st.lastBtcUsd = mkt.btcUsd;
  const newSess = () => ({ startTs: now, carryBtc: 0, paid: Object.fromEntries(managed.map((o) => [o.id, { start: o.paidBtc, last: o.paidBtc }])) });
  if (blockEvent || !st.sess) st.sess = newSess();
  const S = st.sess;
  for (const o of managed) {
    if (!S.paid[o.id]) S.paid[o.id] = { start: o.createdTs && o.createdTs >= S.startTs ? 0 : o.paidBtc, last: o.paidBtc };
    S.paid[o.id].last = o.paidBtc;
  }
  for (const id of Object.keys(S.paid)) if (!managed.some((o) => o.id === id)) { S.carryBtc += Math.max(0, S.paid[id].last - S.paid[id].start); delete S.paid[id]; }
  const sessBtc = S.carryBtc + Object.values(S.paid).reduce((a, x) => a + Math.max(0, x.last - x.start), 0);
  const sessionUsd = sessBtc * px;
  st.sessionUsd = sessionUsd;
  const cooling = st.stopUntil && now < st.stopUntil;
  if (cfg.sessionBudgetUsd > 0 && sessionUsd >= cfg.sessionBudgetUsd && !cooling) {
    st.stopUntil = now + (cfg.stopCooldownH === undefined ? 6 : cfg.stopCooldownH) * 3600e3;
    st.sess = null;
    for (const o of managed) actions.push({ type: 'cancel', id: o.id, reason: `stop-loss: a tentativa gastou US$${sessionUsd.toFixed(2).replace('.', ',')} sem bloco (limite US$${cfg.sessionBudgetUsd}); sem ordem nova até ${new Date(st.stopUntil).toISOString().slice(11, 16)} UTC` });
    return { actions, notes: notes.concat('stop-loss da tentativa'), state: st };
  }
  if (cooling) {
    for (const o of managed) actions.push({ type: 'cancel', id: o.id, reason: `stop-loss em espera até ${new Date(st.stopUntil).toISOString().slice(11, 16)} UTC: encerrando ordem` });
    notes.push(`stop-loss: sem ordem nova até ${new Date(st.stopUntil).toISOString().slice(11, 16)} UTC`);
    return { actions, notes, state: st };
  }

  // MODO_SNIPER (opcional): a decisão do tiro sai da idade do último bloco; sem a flag, nada muda
  const mktShot = cfg.sniper && mkt.ok ? sizeMarket(mkt, Math.min(cfg.sniperPh || 25, limits.maxLimitPh), cfg) : null; // preço e margem para a potência do tiro
  const SN = mktShot ? sniperDecide(st.sniper, Object.assign({ now, blockT, edge: mktShot.edgeAtBidPct, cfg }, snMetrics)) : null;
  if (SN) st.sniper = SN.state;
  for (const o of managed) {
    if (blockEvent) {
      const why = `bloco ${blockEvent.height} pago no seu endereço`;
      if (cfg.onBlock === 'cancel') { actions.push({ type: 'cancel', id: o.id, reason: why + ': encerrando a ordem' }); continue; }
      if (cfg.onBlock === 'min') {
        if (o.limitPH > minPh + 1e-9) actions.push({ type: 'update', id: o.id, priceEH: o.priceEH, limitPH: minPh, reason: why + ': reduzindo à potência de pausa' });
        continue;
      }
    }
    if (!mkt.ok) { notes.push(`ordem ${o.id}: sem dados de mercado (${mkt.reason}), nada alterado`); continue; }

    let limit = mkt.green && !dailyHit ? target : minPh;
    let want = mkt.green ? mkt.bidEH : Math.min(o.priceEH, r4(mkt.capEH));
    const rule = `empate ${isFinite(mkt.breakEvenEH) ? mkt.breakEvenEH.toFixed(4).replace('.', ',') : '—'} − sua margem ${String(cfg.minEdgePct).replace('.', ',')}% = teto ${isFinite(mkt.capEH) ? mkt.capEH.toFixed(4).replace('.', ',') : '—'}`;
    let price = want, reason = mkt.green ? `sinal verde: margem ${mkt.edgeAtBidPct.toFixed(1).replace('.', ',')}% no lance. Por quê: lance ${mkt.bidEH.toFixed(4).replace('.', ',')} ≤ teto (${rule})`
      : `acima do teto (${mkt.capEH.toFixed(4).replace('.', ',')}): pausa. Por quê: lance ${mkt.bidEH.toFixed(4).replace('.', ',')} > teto (${rule}); comprar acima disso dá prejuízo médio`;
    if (dailyHit && mkt.green) reason = 'limite diário: pausa';
    if (SN) { // MODO_SNIPER: substitui só a regra de entrada; travas (stop-loss, limites, bloco) continuam iguais
      limit = SN.shot && !dailyHit ? Math.min(cfg.sniperPh || 25, limits.maxLimitPh) : Math.max(minPh, cfg.sniperIdlePh === undefined ? 1 : cfg.sniperIdlePh);
      want = mktShot.bidEH; reason = SN.reason + (dailyHit ? '; limite diário: espera' : '');
    }
    if (want < o.priceEH - 1e-9) {
      // A NiceHash só aceita baixar o preço 10 min depois de QUALQUER mudança de preço (subida inclusive) e da criação da
      // ordem (erro 5061 visto no teste real de 01/11). 30 s de folga para o relógio dos dois lados.
      const last = Math.max(st.lastDecrease[o.id] || 0, st.lastPriceChange[o.id] || 0, o.createdTs || 0);
      if (now - last >= DOWN_STEP_MS + 30e3) { price = Math.max(want, r4(o.priceEH - units.priceDownStepEH)); st.lastDecrease[o.id] = now; }
      else price = o.priceEH;
      if (price > mkt.capEH + 1e-9) { limit = minPh; reason += '; baixando o preço aos poucos (regra da NiceHash)'; }
    }
    if (Math.abs(price - o.priceEH) >= 0.00005 || Math.abs(limit - o.limitPH) >= 0.001) {
      if (Math.abs(price - o.priceEH) >= 0.00005) st.lastPriceChange[o.id] = now;
      actions.push({ type: 'update', id: o.id, priceEH: r4(price), limitPH: limit, reason });
    }
  }

  if (SN && cfg.autoCreate && !managed.length && mkt.ok && !dailyHit && cfg.poolId && !blockEvent) {
    const amount = Math.max(units.minOrderBtc, Math.min(cfg.orderAmountBtc, limits.maxOrderBtc));
    actions.push({ type: 'create', priceEH: mktShot.bidEH, limitPH: SN.shot ? Math.min(cfg.sniperPh || 25, limits.maxLimitPh) : Math.max(minPh, cfg.sniperIdlePh === undefined ? 1 : cfg.sniperIdlePh), amountBtc: amount, poolId: cfg.poolId,
      market: mkt.market, reason: 'sniper: ordem de espera criada. ' + SN.reason });
  } else if (!SN && cfg.autoCreate && !managed.length && mkt.ok && mkt.green && !dailyHit && cfg.poolId && !blockEvent) {
    const amount = Math.max(units.minOrderBtc, Math.min(cfg.orderAmountBtc, limits.maxOrderBtc));
    actions.push({ type: 'create', priceEH: mkt.bidEH, limitPH: target, amountBtc: amount, poolId: cfg.poolId,
      market: mkt.market, reason: `sinal verde sem ordem ativa: criando (margem ${mkt.edgeAtBidPct.toFixed(1).replace('.', ',')}%)` });
  }
  return { actions, notes, state: st };
}
