// Simulação do modo Observar ("papel"): o que o robô teria comprado, quanto teria gasto e a receita MÉDIA esperada.
// Não sorteia blocos: com hash alugado o resultado real depende de sorte; aqui fica a média (λ = blocos esperados)
// e a chance de ter achado pelo menos um bloco (1 − e^−λ).
// Resultado real (modo Ativo): gasto pago nas ordens gerenciadas e blocos que pagaram o seu endereço.
const TWO32 = 4294967296;
const MAX_GAP = 15 * 60e3; // intervalo maior que isso (backend parado) não conta
const KEEP_DAYS = 30;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function trimDays(days) {
  const keys = Object.keys(days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
  return days;
}

// paper: estado anterior (ou nada); devolve { paper, events } com eventos só quando liga, pausa ou para.
export function paperStep(paper, { cfg, mkt, now, units, limits }) {
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

  // 2) o que o robô faria agora
  const minPh = Math.max(cfg.minPh || 0, units.minLimitPH || 0);
  const target = Math.min(Math.max(cfg.targetPh || 0, minPh), limits.maxLimitPh || Infinity);
  if (p.sess && cfg.sessionBudgetUsd > 0 && p.sess.spendUsd >= cfg.sessionBudgetUsd) {
    p.stops++;
    events.push(`Simulação: stop-loss da sessão (US$${p.sess.spendUsd.toFixed(2)} gastos; chance de ter achado bloco nela: ${((1 - Math.exp(-p.sess.lambda)) * 100).toFixed(0)}%)`);
    p.sess = null;
    closeRun('stop-loss da sessão'); p.on = false; // como cancelar a ordem: se continuar verde, abre outra
  }
  const dailyHit = cfg.dailyBudgetUsd > 0 && d.spendUsd >= cfg.dailyBudgetUsd;
  const want = !!(mkt && mkt.ok && mkt.green && !dailyHit);
  if (want) {
    if (!p.sess) { p.sess = { start: now, spendUsd: 0, lambda: 0 }; p.sessions++; }
    if (!p.on) {
      events.push(`Simulação: compraria ${target} PH/s a ${mkt.bidEH.toFixed(4)} BTC/EH/dia (margem ${mkt.edgeAtBidPct.toFixed(1)}%)`);
      p.run = { start: now, ph: target, priceEH: mkt.bidEH, edgePct: mkt.edgeAtBidPct, spendUsd: 0, evUsd: 0, lambda: 0, hours: 0 };
    }
    Object.assign(p, { on: true, ph: target, priceEH: mkt.bidEH, D: mkt.D, btcUsd: mkt.btcUsd, blockNetUsd: mkt.blockNetUsd });
  } else {
    if (p.on) {
      const why = dailyHit ? `limite diário de US$${cfg.dailyBudgetUsd} atingido`
        : mkt && mkt.ok ? `aluguel ${mkt.bidEH.toFixed(4)} acima do teto ${mkt.capEH.toFixed(4)}` : 'sem dados de mercado';
      events.push(`Simulação: pausaria (${why})`);
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
