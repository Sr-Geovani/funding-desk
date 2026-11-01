// Outras moedas/algoritmos (simulado): aluguel na NiceHash apontado para pool PPS, que paga por share.
// Com PPS não há sorte de bloco: o que entra é a receita esperada (já sem a taxa do pool), então a simulação é o
// próprio resultado. Para comparar algoritmos de unidades diferentes, cada um usa o mesmo orçamento de aluguel
// (US$/dia) enquanto o mapa diz "Compensa" (margem ≥ mínima e livro com ordens suficientes).
// Margem = receita por hash ÷ aluguel típico (mediana do livro + taxa da NiceHash) − 1, a mesma do mapa do painel.
// Versão 2 (31/10): margem realista (dificuldade média de 24 h, pool PPS 4%, perdas de share e venda 2,5%). A v1 usava a
// dificuldade do momento da WhatToMine e mostrava lucro que não existe; ao trocar de versão a simulação recomeça.
export const ALGO_RULES = { budgetUsdDay: 100, maxGap: 20 * 60e3, keepRuns: 30, maxEdgePct: 100 }; // margem > 100%: dado suspeito

export function algoPaperStep(pa, { map, now, rules = ALGO_RULES }) {
  const fresh = !(pa && pa.since && pa.v === 2);
  const p = !fresh ? JSON.parse(JSON.stringify(pa)) : { v: 2, since: now, lastTs: now, budgetUsdDay: rules.budgetUsdDay, algos: {} };
  const events = fresh && pa && pa.since ? ['Outras moedas: simulação recomeçou com a margem realista (dificuldade média de 24 h, pool PPS 4%, perdas 2,5%); a anterior usava a dificuldade do momento e exagerava o lucro'] : [];
  const dt = Math.min(Math.max(0, now - (p.lastTs || now)), rules.maxGap);
  // 1) o intervalo que passou, com a decisão anterior (e o total do dia UTC, para a evolução no Início)
  p.days = p.days || {};
  const day = new Date(now).toISOString().slice(0, 10);
  for (const a of Object.values(p.algos)) {
    if (!a.on || !(dt > 0)) continue;
    const spend = p.budgetUsdDay * dt / 864e5, rev = spend * (1 + a.edgePct / 100);
    a.spendUsd += spend; a.revUsd += rev; a.hoursOn += dt / 3600e3;
    if (a.run) { a.run.spendUsd += spend; a.run.revUsd += rev; }
    const d = p.days[day] || (p.days[day] = { spendUsd: 0, revUsd: 0 }); d.spendUsd += spend; d.revUsd += rev;
  }
  for (const k of Object.keys(p.days).sort().slice(0, -30)) delete p.days[k];
  // 2) decisão de agora, algoritmo por algoritmo
  const seen = {};
  for (const m of map || []) {
    seen[m.algo] = 1;
    const a = p.algos[m.algo] || (p.algos[m.algo] = { label: m.label, on: false, spendUsd: 0, revUsd: 0, hoursOn: 0, runs: [], run: null });
    a.label = m.label; a.coins = m.coins; a.edgeNow = m.edgePct; a.level = m.level;
    const sus = isFinite(m.edgePct) && m.edgePct > rules.maxEdgePct;
    const want = m.level === 'go' && isFinite(m.edgePct) && !sus;
    if (want) {
      if (!a.on) { a.run = { start: now, edgePct: m.edgePct, coins: m.coins, spendUsd: 0, revUsd: 0 }; events.push(`Outras moedas: compraria ${m.label} (${m.coins.join('+')}) com margem de ${m.edgePct.toFixed(1).replace('.', ',')}%`); }
      a.on = true; a.edgePct = m.edgePct;
    } else if (a.on) {
      const why = sus ? 'margem acima de 100% (dado suspeito)' : m.level === 'maybe' ? (m.thin ? 'livro raso (poucas ordens recebendo hash)' : 'margem abaixo do mínimo') : m.level === 'no' ? 'aluguel acima da receita' : 'sem preço de aluguel';
      close(a, why);
      events.push(`Outras moedas: pausaria ${m.label} (${why})`);
    }
  }
  for (const [k, a] of Object.entries(p.algos)) if (!seen[k] && a.on) { close(a, 'saiu dos dados'); events.push(`Outras moedas: pausaria ${a.label} (saiu dos dados)`); }
  p.lastTs = now;
  return { pa: p, events };

  function close(a, reason) {
    if (a.run) { a.runs.push(Object.assign(a.run, { end: now, reason })); a.runs = a.runs.slice(-rules.keepRuns); }
    a.run = null; a.on = false;
  }
}
