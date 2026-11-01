// Replay de estratégias com os blocos já registrados: mesmos blocos, mesmo sorteio (número tirado do hash de cada bloco),
// preço e margem gravados no momento de cada bloco. Não apaga nem mexe nas simulações ao vivo: refaz a conta para várias
// regras ao mesmo tempo e responde "como teria sido se...". A decisão de cada trecho usa só o que se sabia no início dele
// (o bloco anterior), sem olhar o futuro. Escolher a melhor DEPOIS de ver o resultado é olhar pelo retrovisor: por isso o
// ranking separa "com a sorte" (o que aconteceu) de "sem sorte" (a média, que é o que tende a se repetir).
const TWO32 = 4294967296;
const MAX_GAP_S = 4 * 3600; // intervalo maior que isso: registro com buraco, não conta
export const RP_PH = [10, 30, 50, 100, 200];
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

const key = (s) => s.ph + '|' + (s.filter === null || s.filter === undefined ? 'n' : s.filter) + '|' + (s.stopUsd || 0);
export function strategies(cfg) {
  const T = cfg.targetPh || 10, stop = cfg.sessionBudgetUsd > 0 ? cfg.sessionBudgetUsd : 300, cool = cfg.stopCooldownH === undefined ? 6 : cfg.stopCooldownH;
  const fixed = [
    { id: 'always', label: 'Sempre ligado', ph: T, filter: null, stopUsd: 0, coolH: 0 },
    { id: 'alwaysStop', label: 'Ligado + stop-loss + espera', ph: T, filter: null, stopUsd: stop, coolH: cool },
    { id: 'edge0', label: 'Só com margem ≥ 0', ph: T, filter: 0, stopUsd: stop, coolH: cool },
    { id: 'rules', label: 'Todas as regras (sua config)', ph: T, filter: 'min', stopUsd: stop, coolH: cool, dailyUsd: cfg.dailyBudgetUsd || 0 }
  ];
  const grid = [];
  for (const ph of RP_PH) for (const filter of RP_FILTERS) for (const stopUsd of [0, stop]) grid.push({ ph, filter, stopUsd, coolH: stopUsd ? cool : 0 });
  return { fixed, grid };
}

// Janelas: a atual (desde que as simulações ao vivo começaram), 24 h e tudo que o registro tem.
export function replayBoard(list, { now, since, fixAt, cfg, btcUsd, blockUsd }) {
  const L = prep(list, fixAt);
  if (L.length < 3 || !(btcUsd > 0)) return null;
  const { fixed, grid } = strategies(cfg), base = { btcUsd, blockUsd, rentFeePct: cfg.rentFeePct || 3, poolFeePct: cfg.poolFeePct || 2, minEdgePct: cfg.minEdgePct || 3 };
  const wins = [];
  if (since && since > L[0].t) wins.push({ id: 'atual', label: 'Janela atual', from: since });
  wins.push({ id: '24h', label: '24 h', from: now - 24 * 3600e3 }, { id: 'tudo', label: 'Tudo (' + Math.round((now - L[0].t) / 3600e3) + ' h)', from: L[0].t });
  const priced = L.filter((r) => r.price > 0);
  return {
    at: now, from: L[0].t, blocks: L.length, priced: priced.length, estimated: L.filter((r) => r.est).length, cfg: { ph: cfg.targetPh, stopUsd: fixed[1].stopUsd, coolH: fixed[1].coolH, minEdgePct: base.minEdgePct },
    windows: wins.map((w) => {
      const o = Object.assign({}, base, { from: w.from, to: now });
      const rows = fixed.map((s) => Object.assign(runStrategy(L, s, o), { id: s.id, label: s.label }));
      const g = grid.map((s) => Object.assign(runStrategy(L, s, o), { key: key(s) })).filter((r) => r.costUsd > 0);
      const sel = L.filter((r) => r.t > w.from);
      const pick = (f) => g.slice().sort((x, y) => f(y) - f(x) || y.costUsd - x.costUsd).filter((r, i, a) => a.findIndex((z) => z.ph === r.ph && Math.abs(z.costUsd - r.costUsd) < 0.01 && z.blocks === r.blocks) === i).slice(0, 5).map((r) => ({ key: r.key, ph: r.ph, filter: r.filter, stopUsd: r.stopUsd, coolH: r.coolH, hours: r.hours, costUsd: r.costUsd, wonUsd: r.wonUsd, blocks: r.blocks, profitUsd: r.profitUsd, pct: r.pct, evProfitUsd: r.evProfitUsd, evPct: r.evPct, chance: r.chance }));
      return { id: w.id, label: w.label, from: w.from, blocks: sel.length, rows: rows.map((r) => Object.assign(r, { wins: r.wins.slice(-5) })),
        bestLuck: pick((r) => r.profitUsd), bestAvg: pick((r) => r.evPct), anyAvgUp: g.some((r) => r.evProfitUsd > 0), gridN: g.length };
    })
  };
}

// Livro diário: no fim de cada dia (UTC) grava o resultado de cada estratégia da grade naquele dia. O registro de blocos
// guarda ~4 dias; o livro guarda 120 dias, para juntar estatística de qual regra funciona (stop-loss reinicia por dia).
export function replayDay(list, { dayStart, fixAt, cfg, btcUsd, blockUsd }) {
  const L = prep(list, fixAt), { fixed, grid } = strategies(cfg);
  const o = { from: dayStart, to: dayStart + 864e5, btcUsd, blockUsd, rentFeePct: cfg.rentFeePct || 3, poolFeePct: cfg.poolFeePct || 2, minEdgePct: cfg.minEdgePct || 3 };
  const blocks = L.filter((r) => r.t > o.from && r.t <= o.to).length;
  if (blocks < 100) return null; // dia incompleto no registro
  const r = {};
  for (const s of grid.concat(fixed.slice(3))) {
    const x = runStrategy(L, s, o);
    r[s.id || key(s)] = [+x.costUsd.toFixed(2), +x.wonUsd.toFixed(2), +x.evUsd.toFixed(2), +x.hours.toFixed(2), x.blocks];
  }
  return { blocks, r };
}
export function ledgerSummary(days) {
  const ks = Object.keys(days || {}).sort();
  if (!ks.length) return null;
  const acc = {};
  for (const d of ks) for (const [k, v] of Object.entries(days[d].r || {})) {
    const a = acc[k] || (acc[k] = { key: k, days: 0, costUsd: 0, wonUsd: 0, evUsd: 0, hours: 0, blocks: 0, upDays: 0 });
    a.days++; a.costUsd += v[0]; a.wonUsd += v[1]; a.evUsd += v[2]; a.hours += v[3]; a.blocks += v[4]; if (v[1] - v[0] > 0) a.upDays++;
  }
  const rows = Object.values(acc).filter((a) => a.costUsd > 0).map((a) => Object.assign(a, { profitUsd: a.wonUsd - a.costUsd, pct: (a.wonUsd / a.costUsd - 1) * 100, evPct: (a.evUsd / a.costUsd - 1) * 100 }));
  return { days: ks.length, from: ks[0], to: ks[ks.length - 1], rows: rows.sort((a, b) => b.evPct - a.evPct) };
}
