// Simulação do modo Observar ("papel"): o que o robô teria comprado, quanto teria gasto e se teria achado bloco.
// Sorteio honesto: cada bloco REAL da rede BCH achado enquanto o robô estaria comprando seria seu com chance
// = sua potência ÷ (potência da rede + a sua). O número sorteado vem do próprio hash do bloco (ninguém controla),
// então o resultado não pode ser escolhido depois. Também guarda a média (λ = blocos esperados) para comparação.
// Resultado real (modo Ativo): gasto pago nas ordens gerenciadas e blocos que pagaram o seu endereço.
const TWO32 = 4294967296;
const MAX_GAP = 15 * 60e3; // intervalo maior que isso (backend parado) não conta
const DOWN_STEP_MS = 10 * 60e3; // NiceHash: o preço da ordem só desce um degrau (priceDownStep) a cada ~10 min
const KEEP_DAYS = 30;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function trimDays(days) {
  const keys = Object.keys(days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
  return days;
}

// paper: estado anterior (ou nada); devolve { paper, events } com eventos só quando liga, pausa ou para.
export function paperStep(paper, { cfg, mkt, now, units, limits, blocks }) {
  const p = paper && paper.since ? JSON.parse(JSON.stringify(paper))
    : { since: now, lastTs: now, on: false, spendUsd: 0, evUsd: 0, lambda: 0, hoursOn: 0, sessions: 0, stops: 0, sess: null, days: {} };
  p.runs = p.runs || [];
  // Operação simulada = trecho em que o robô estaria comprando, do "compraria" ao "pausaria" (ou stop-loss).
  const closeRun = (reason) => {
    if (!p.run) return;
    p.runs.push(Object.assign(p.run, { end: now, reason }));
    p.runs = p.runs.slice(-100); p.run = null;
  };
  const events = [];
  const dt = Math.min(Math.max(0, now - (p.lastTs || now)), MAX_GAP);
  const day = utcDay(now);
  const d = p.days[day] || (p.days[day] = { spendUsd: 0, evUsd: 0, lambda: 0, hoursOn: 0 });

  // 1) o intervalo que passou, com a decisão do ciclo anterior
  if (p.on && dt > 0 && p.ph > 0 && p.priceEH > 0 && p.D > 0 && p.btcUsd > 0) {
    const secs = dt / 1000;
    const cost = p.ph * p.priceEH / 1000 * p.btcUsd * (1 + (cfg.rentFeePct || 0) / 100) * secs / 86400;
    const lam = p.ph * 1e15 * secs / (p.D * TWO32);
    const ev = lam * (p.blockNetUsd || 0);
    for (const t of [p, d]) { t.spendUsd += cost; t.evUsd += ev; t.lambda += lam; t.hoursOn += secs / 3600; }
    if (p.sess) { p.sess.spendUsd += cost; p.sess.lambda += lam; }
    if (p.run) { p.run.spendUsd += cost; p.run.evUsd += ev; p.run.lambda += lam; p.run.hours += secs / 3600; }
  }

  // 1b) sorteio com os blocos reais achados pela rede enquanto o robô estaria comprando
  // Só entram blocos do trecho que foi cobrado (dt): se o servidor ficou parado, os blocos daquele buraco não
  // ganham sorteio de graça. Tolerância de 20 min para o relógio que o minerador grava no bloco.
  // Chance por bloco real = seu hash ÷ hash da rede (D·2³²/600): na média dá exatamente λ (seu hash ÷ trabalho por bloco).
  if (p.on && p.ph > 0) for (const b of blocks || []) {
    const D = b.difficulty || p.D;
    if (!b.hash || !(D > 0)) continue;
    if (b.time && b.time < now - dt - 20 * 60e3) continue;
    const mine = p.ph * 1e15, prob = Math.min(1, mine / (D * TWO32 / 600));
    const u = parseInt(String(b.hash).slice(-8), 16) / TWO32;
    p.draws = (p.draws || 0) + 1; d.draws = (d.draws || 0) + 1;
    if (p.run) p.run.draws = (p.run.draws || 0) + 1;
    if (!(u < prob)) continue;
    const usd = p.blockNetUsd || 0;
    for (const t of [p, d]) { t.blocks = (t.blocks || 0) + 1; t.wonUsd = (t.wonUsd || 0) + usd; }
    if (p.run) { p.run.blocks = (p.run.blocks || 0) + 1; p.run.wonUsd = (p.run.wonUsd || 0) + usd; }
    p.wins = (p.wins || []).concat({ height: b.height, t: b.time || now, usd, prob }).slice(-50);
    events.push(`Simulação: o bloco ${b.height} seria seu (sorteio pelo hash do bloco; chance era ${(prob * 100).toFixed(2).replace('.', ',')}%): +US$${usd.toFixed(0).replace('.', ',')}`);
    if (p.sess) p.sess = { start: now, spendUsd: 0, lambda: 0 }; // bloco zera a sessão do stop-loss
    if (cfg.onBlock === 'cancel' || cfg.onBlock === 'min') {
      closeRun(cfg.onBlock === 'cancel' ? 'bloco achado: encerraria a ordem' : 'bloco achado: reduziria à potência de pausa');
      p.on = false; // se o mercado seguir favorável, a próxima linha abre outra (como "criar ordem sozinho")
    }
  }

  // 2) o que o robô faria agora
  const minPh = Math.max(cfg.minPh || 0, units.minLimitPH || 0);
  const target = Math.min(Math.max(cfg.targetPh || 0, minPh), limits.maxLimitPh || Infinity);
  if (p.sess && cfg.sessionBudgetUsd > 0 && p.sess.spendUsd >= cfg.sessionBudgetUsd) {
    p.stops++;
    p.stopUntil = now + (cfg.stopCooldownH === undefined ? 6 : cfg.stopCooldownH) * 3600e3;
    events.push(`Simulação: stop-loss da tentativa (US$${p.sess.spendUsd.toFixed(2).replace('.', ',')} gastos sem bloco; chance de ter achado bloco nela: ${((1 - Math.exp(-p.sess.lambda)) * 100).toFixed(0).replace('.', ',')}%); sem compra até ${new Date(p.stopUntil).toISOString().slice(11, 16)} UTC`);
    p.sess = null;
    closeRun('stop-loss da tentativa'); p.on = false; // como o robô: cancela e espera stopCooldownH antes de comprar de novo
  }
  const dailyHit = cfg.dailyBudgetUsd > 0 && d.spendUsd >= cfg.dailyBudgetUsd;
  // limite de perda semanal (mesma regra do robô): gasto − blocos dos últimos 7 dias da simulação
  const wkFrom = utcDay(now - 6 * 864e5), wkLoss = Object.entries(p.days).filter(([k]) => k >= wkFrom).reduce((a, [, x]) => a + (x.spendUsd || 0) - (x.wonUsd || 0), 0);
  const weekHit = cfg.weeklyLossUsd > 0 && wkLoss >= cfg.weeklyLossUsd;
  const cooling = !!(p.stopUntil && now < p.stopUntil);
  const want = !!(mkt && mkt.ok && mkt.green && !dailyHit && !cooling && !weekHit);
  if (want) {
    if (!p.sess) { p.sess = { start: now, spendUsd: 0, lambda: 0 }; p.sessions++; }
    if (!p.on) events.push(`Simulação: compraria ${target} PH/s a ${mkt.bidEH.toFixed(4).replace('.', ',')} BTC/EH/dia (margem ${mkt.edgeAtBidPct.toFixed(1).replace('.', ',')}%). Por quê: lance ≤ teto ${mkt.capEH.toFixed(4).replace('.', ',')} (empate ${mkt.breakEvenEH ? mkt.breakEvenEH.toFixed(4) : '—'} − margem mínima ${cfg.minEdgePct}%); potência = sua potência alvo`);
    // !p.run com p.on: simulação criada antes do diário de operações; a operação passa a contar daqui
    if (!p.on || !p.run) p.run = { start: now, ph: target, priceEH: mkt.bidEH, edgePct: mkt.edgeAtBidPct, spendUsd: 0, evUsd: 0, lambda: 0, hours: 0 };
    // Preço como a NiceHash deixa (igual ao robô real): sobe na hora; desce só um degrau a cada 10 min. Quando o mercado
    // cai, a ordem fica alguns minutos pagando acima do lance de agora.
    let price = mkt.bidEH;
    const step = units.priceDownStepEH || 0;
    if (p.on && step > 0 && p.priceEH > mkt.bidEH) {
      if (now - (p.lastDec || 0) >= DOWN_STEP_MS) { price = Math.max(mkt.bidEH, p.priceEH - step); p.lastDec = now; } else price = p.priceEH;
    }
    Object.assign(p, { on: true, ph: target, priceEH: price, D: mkt.D, btcUsd: mkt.btcUsd, blockNetUsd: mkt.blockNetUsd });
  } else {
    if (p.on) {
      const why = weekHit ? `limite de perda semanal de US$${cfg.weeklyLossUsd} atingido` : dailyHit ? `limite diário de US$${cfg.dailyBudgetUsd} atingido` : cooling ? 'espera depois do stop-loss'
        : mkt && mkt.ok ? `aluguel ${mkt.bidEH.toFixed(4).replace('.', ',')} acima do teto ${mkt.capEH.toFixed(4).replace('.', ',')}` : 'sem dados de mercado';
      events.push(`Simulação: pausaria (${why}). Por quê: ${dailyHit ? 'o gasto do dia chegou ao seu limite' : cooling ? 'o stop-loss limita a perda por tentativa' : mkt && mkt.ok ? 'cada hash comprado acima do teto custa mais do que rende em média' : 'sem preço não dá para saber se compensa'}`);
      closeRun(why);
    }
    p.on = false;
  }
  p.lastTs = now;
  trimDays(p.days);
  return { paper: p, events };
}

// Resultado real: soma o que as ordens gerenciadas pagaram desde o último ciclo e os blocos que caíram no endereço.
export function realStep(real, { orders, managedIds, btcUsd, bchUsd, blockEvent, now }) {
  const r = real && real.since ? JSON.parse(JSON.stringify(real)) : { since: now, spendUsd: 0, blocks: 0, revenueUsd: 0, paid: {}, days: {} };
  const day = utcDay(now);
  const d = r.days[day] || (r.days[day] = { spendUsd: 0, blocks: 0, revenueUsd: 0 });
  const seen = {};
  for (const o of orders || []) {
    if (!(managedIds || []).includes(o.id)) continue;
    seen[o.id] = 1;
    const last = r.paid[o.id] !== undefined ? r.paid[o.id] : (o.createdTs && o.createdTs >= r.since ? 0 : o.paidBtc);
    if (btcUsd > 0 && o.paidBtc > last) { const usd = (o.paidBtc - last) * btcUsd; r.spendUsd += usd; d.spendUsd += usd; }
    r.paid[o.id] = o.paidBtc;
  }
  for (const id of Object.keys(r.paid)) if (!seen[id]) delete r.paid[id];
  if (blockEvent) {
    const usd = (blockEvent.bch || 0) * (bchUsd || 0);
    r.blocks++; r.revenueUsd += usd; d.blocks++; d.revenueUsd += usd;
  }
  trimDays(r.days);
  return r;
}

// Registro de execução (modo Ativo): o que de fato aconteceu com cada ordem do robô, para comparar com a simulação.
// Por ordem: preço e potência pedidos, tempo até o hash chegar, entrega média (recebido ÷ pedido) e preço efetivo
// (BTC pago ÷ hash entregue). É a base do teste de calibração antes de escalar.
export function execStep(log, { orders, managedIds, now, keep = 30 }) {
  const L = log && log.orders ? JSON.parse(JSON.stringify(log)) : { orders: {} };
  for (const o of orders || []) {
    if (!(managedIds || []).includes(o.id)) continue;
    const e = L.orders[o.id] || (L.orders[o.id] = { id: o.id, created: o.createdTs || now, firstSeen: now, priceEH: o.priceEH, limitPH: o.limitPH, firstHash: null, n: 0, ratioSum: 0, ehDays: 0, paid0: o.paidBtc || 0, paidBtc: 0, lastTs: now });
    const dt = Math.min(Math.max(0, now - e.lastTs), 15 * 60e3);
    if (o.alive && o.limitPH > 0) {
      if (o.speedPH > 0 && !e.firstHash) e.firstHash = now;
      e.n++; e.ratioSum += Math.min(2, (o.speedPH || 0) / o.limitPH);
      e.ehDays += (o.speedPH || 0) / 1000 * dt / 864e5;
    }
    e.priceEH = o.priceEH; e.limitPH = o.limitPH; e.paidBtc = Math.max(0, (o.paidBtc || 0) - e.paid0); e.alive = !!o.alive; e.lastTs = now;
  }
  const ids = Object.keys(L.orders).sort((a, b) => L.orders[b].lastTs - L.orders[a].lastTs);
  for (const id of ids.slice(keep)) delete L.orders[id];
  return L;
}
export function execSummary(L) {
  const v = Object.values((L && L.orders) || {});
  if (!v.length) return null;
  const rows = v.map((e) => ({ id: e.id, created: e.created, priceEH: e.priceEH, limitPH: e.limitPH, alive: e.alive,
    toHashMin: e.firstHash ? Math.round((e.firstHash - Math.max(e.created, e.firstSeen - 5 * 60e3)) / 60e3) : null,
    delivered: e.n ? e.ratioSum / e.n : null, effEH: e.ehDays > 0 ? e.paidBtc / e.ehDays : null, paidBtc: e.paidBtc }));
  const with_ = (k) => rows.filter((r) => r[k] !== null && isFinite(r[k]));
  const avg = (k) => { const a = with_(k); return a.length ? a.reduce((s, r) => s + r[k], 0) / a.length : null; };
  return { orders: rows.sort((a, b) => b.created - a.created).slice(0, 10), avgToHashMin: avg('toHashMin'), avgDelivered: avg('delivered'),
    avgEffVsBid: with_('effEH').length ? with_('effEH').reduce((s, r) => s + r.effEH / r.priceEH, 0) / with_('effEH').length : null };
}
