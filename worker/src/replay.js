// Replay de estratégias com os blocos já registrados: mesmos blocos, mesmo sorteio (número tirado do hash de cada bloco),
// preço e margem gravados no momento de cada bloco. Não apaga nem mexe nas simulações ao vivo: refaz a conta para várias
// regras ao mesmo tempo e responde "como teria sido se...". A decisão de cada trecho usa só o que se sabia no início dele
// (o bloco anterior), sem olhar o futuro. Escolher a melhor DEPOIS de ver o resultado é olhar pelo retrovisor: por isso o
// ranking separa "com a sorte" (o que aconteceu) de "sem sorte" (a média, que é o que tende a se repetir).
const TWO32 = 4294967296;
const MAX_GAP_S = 4 * 3600; // intervalo maior que isso: registro com buraco, não conta
export const RP_FILTERS = [null, -1, 0, 'min']; // null = sempre ligado; número = só com margem ≥ x%; 'min' = margem mínima da config
const u32 = (hash) => parseInt(String(hash).slice(-8), 16) / TWO32;

// list: registro de blocos (h, t, hash, D, usd, nhBid, edge); fixAt: correção do preço (31/10) — antes dela o registro
// gravou um lance ~5,8% barato demais, então o preço é corrigido e a margem também.
function prep(list, fixAt) {
  const F = 1.058;
  return (list || []).filter((r) => r && r.t && r.hash && r.D > 0).sort((a, b) => a.t - b.t).filter((r, i, a) => !i || r.h !== a[i - 1].h)
    .map((r) => {
      const old = fixAt && r.t < fixAt && r.nhBid > 0;
      return { h: r.h, t: r.t, D: r.D, u: u32(r.hash), usd: r.usd, price: r.nhBid > 0 ? r.nhBid * (old ? F : 1) : null,
        edge: r.edge !== undefined && r.edge !== null && isFinite(r.edge) ? (old ? ((1 + r.edge / 100) / F - 1) * 100 : r.edge) : null, est: !!old };
    });
}

// s: { ph, filter (null | número | 'min'), stopUsd (0 = sem), coolH, dailyUsd }
export function runStrategy(L, s, { from, to, btcUsd, blockUsd, rentFeePct = 3, poolFeePct = 2, minEdgePct = 3 }) {
  const out = { ph: s.ph, filter: s.filter, stopUsd: s.stopUsd || 0, coolH: s.coolH || 0, hours: 0, costUsd: 0, wonUsd: 0, blocks: 0, evUsd: 0, lambda: 0, draws: 0, stops: 0, wins: [] };
  const thr = s.filter === 'min' ? minEdgePct : s.filter;
  let sess = 0, stopUntil = 0, day = null, daySpend = 0;
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1], b = L[i];
    if (b.t <= from || a.t >= to) continue;
    const secs = (b.t - a.t) / 1000;
    if (!(secs > 0) || secs > MAX_GAP_S) continue;
    const d = new Date(a.t).toISOString().slice(0, 10);
    if (d !== day) { day = d; daySpend = 0; }
    if (a.t < stopUntil) continue; // esperando depois do stop-loss
    if (thr !== null && thr !== undefined && !(a.edge !== null && a.edge >= thr)) continue; // margem do momento abaixo da regra
    if (s.dailyUsd > 0 && daySpend >= s.dailyUsd) continue;
    const price = a.price || null;
    if (!(price > 0)) continue; // sem preço gravado: não dá para saber o custo
    let cost = s.ph / 1000 * price * btcUsd * (1 + rentFeePct / 100) * secs / 86400, frac = 1;
    if (s.stopUsd > 0 && sess + cost >= s.stopUsd) { frac = Math.max(0, (s.stopUsd - sess) / cost); cost *= frac; }
    const lam = s.ph * 1e15 * secs * frac / (b.D * TWO32), val = b.usd > 0 ? b.usd * (1 - poolFeePct / 100) : blockUsd || 0;
    out.hours += secs * frac / 3600; out.costUsd += cost; out.lambda += lam; out.evUsd += lam * val; sess += cost; daySpend += cost;
    if (frac < 1) { out.stops++; sess = 0; stopUntil = a.t + secs * frac * 1000 + (s.coolH || 0) * 3600e3; continue; } // parou antes do bloco
    out.draws++;
    if (b.u < Math.min(1, s.ph * 1e15 / (b.D * TWO32 / 600))) { out.blocks++; out.wonUsd += val; sess = 0; out.wins.push({ h: b.h, t: b.t, usd: val }); }
  }
  out.profitUsd = out.wonUsd - out.costUsd; out.pct = out.costUsd > 0 ? out.profitUsd / out.costUsd * 100 : null;
  out.evProfitUsd = out.evUsd - out.costUsd; out.evPct = out.costUsd > 0 ? out.evProfitUsd / out.costUsd * 100 : null;
  out.chance = 1 - Math.exp(-out.lambda);
  return out;
}

// Os 5 cenários que teriam dado mais lucro (com a sorte que saiu) na janela dos cenários acompanhados: qualquer potência,
// regra de entrada e stop-loss. Retrovisor: mostra o que teria sido melhor, não o que vai ser.
export const BEST_PH = [10, 30, 50, 100, 200, 300, 500];
export function bestScenarios(list, { now, since, fixAt, cfg, btcUsd, blockUsd }) {
  const L = prep(list, fixAt);
  if (L.length < 3 || !(btcUsd > 0)) return null;
  const from = since && since > L[0].t ? since : L[0].t, cool = cfg.stopCooldownH === undefined ? 6 : cfg.stopCooldownH;
  const stops = [0, 150, cfg.sessionBudgetUsd > 0 ? cfg.sessionBudgetUsd : 300, 600].filter((x, i, a) => a.indexOf(x) === i);
  const o = { from, to: now, btcUsd, blockUsd, rentFeePct: cfg.rentFeePct || 3, poolFeePct: cfg.poolFeePct || 2, minEdgePct: cfg.minEdgePct || 3 };
  const all = [];
  for (const ph of BEST_PH) for (const filter of RP_FILTERS) for (const stopUsd of stops) {
    const r = runStrategy(L, { ph, filter, stopUsd, coolH: stopUsd ? cool : 0 }, o);
    if (r.costUsd > 0) all.push(r);
  }
  const same = (z, r) => z.ph === r.ph && z.blocks === r.blocks && Math.abs(z.costUsd - r.costUsd) < 0.5;
  const out = (r) => ({ ph: r.ph, filter: r.filter === 'min' ? o.minEdgePct : r.filter, stopUsd: r.stopUsd, coolH: r.coolH, hours: +r.hours.toFixed(2), spendUsd: +r.costUsd.toFixed(2),
    wonUsd: +r.wonUsd.toFixed(2), evUsd: +r.evUsd.toFixed(2), blocks: r.blocks, draws: r.draws });
  const uniq = (a) => a.filter((r, i) => a.findIndex((z) => same(z, r)) === i);
  // 1) maior lucro em dólar
  const best = uniq(all.slice().sort((a, b) => b.profitUsd - a.profitUsd || a.costUsd - b.costUsd)).slice(0, 5);
  // 2) maior lucro por dólar gasto (menor custo com maior lucro), sem repetir os de cima
  const eff = uniq(all.slice().sort((a, b) => b.profitUsd / b.costUsd - a.profitUsd / a.costUsd || a.costUsd - b.costUsd))
    .filter((r) => !best.some((z) => same(z, r))).slice(0, 5);
  const top = best.map(out), effTop = eff.map(out);
  // Fora da amostra: escolhe a melhor combinação só com a 1ª metade da janela e mede na 2ª metade. Se a "melhor" foi
  // sorte, na 2ª metade ela volta para perto da média. Pela sorte (lucro) e pela média (lucro esperado).
  let oos = null;
  const mid = from + (now - from) / 2;
  if (L.filter((r) => r.t > from && r.t <= mid).length >= 30 && L.filter((r) => r.t > mid).length >= 30) {
    const o1 = Object.assign({}, o, { to: mid }), o2 = Object.assign({}, o, { from: mid });
    const first = [];
    for (const ph of BEST_PH) for (const filter of RP_FILTERS) for (const stopUsd of stops) {
      const s0 = { ph, filter, stopUsd, coolH: stopUsd ? cool : 0 }, r = runStrategy(L, s0, o1);
      if (r.costUsd > 0) first.push([s0, r]);
    }
    const judge = (f) => {
      if (!first.length) return null;
      const [s0, r1] = first.slice().sort((a, b) => f(b[1]) - f(a[1]))[0], r2 = runStrategy(L, s0, o2);
      const pk = (r) => ({ costUsd: +r.costUsd.toFixed(2), profitUsd: +r.profitUsd.toFixed(2), pct: r.pct === null ? null : +r.pct.toFixed(1), evPct: r.evPct === null ? null : +r.evPct.toFixed(2), blocks: r.blocks });
      return { ph: s0.ph, filter: s0.filter === 'min' ? o.minEdgePct : s0.filter, stopUsd: s0.stopUsd, coolH: s0.coolH, first: pk(r1), second: pk(r2) };
    };
    oos = { mid, byLuck: judge((r) => r.profitUsd), byAvg: judge((r) => (r.evPct === null ? -1e9 : r.evPct)) };
  }
  return { at: now, from, blocks: L.filter((r) => r.t > from).length, tested: all.length, top, eff: effTop, oos };
}
