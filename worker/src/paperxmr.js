// Operação Monero "como se fosse real" (simulada): aluguel de RandomX na NiceHash apontado para um pool PPS de XMR
// (padrão: Kryptex PPS+, taxa 1%, saque a partir de 0,01 XMR) com pagamento na carteira cadastrada (ex.: Kraken).
// Diferente do mapa de outras moedas: tem carteira virtual em BTC, ordem com valor mínimo e taxa de ordem nova da
// NiceHash, regra de entrada e saída (entra com margem a partir de +2%, sai abaixo de 0%), saldo no pool em XMR e
// saques quando passa do mínimo. A margem vem do mapa (receita do pool PPS ÷ aluguel típico do livro, já com 3% da
// NiceHash, taxa do pool e perdas de share e venda), a mesma conta das outras moedas.
// Como um operador faz: uma ordem fica aberta (paga a taxa de ordem nova uma vez) e só a potência sobe na janela e desce
// para o mínimo quando ela fecha; sem isso a taxa fixa (0,00001 BTC, ~US$0,77) come o lucro de janelas de 15 a 30 min.
// Gasto por dia na janela: até budgetUsdDay, sem passar de 10% do que o mercado inteiro do algoritmo gasta por dia
// (mercado pequeno não absorve uma ordem grande sem subir o preço).
export const XMR_RULES = { walletBtc: 0.002, enterPct: 2, exitPct: 0, budgetUsdDay: 300, marketShare: 0.1, minOrderBtc: 0.001, newOrderFeeBtc: 0.00001, payoutXmr: 0.01, maxGap: 20 * 60e3, winMin: 30, minExpUsd: 0.05 };
const usd2 = (x) => (x < 0 ? '−' : '') + 'US$' + Math.abs(x).toFixed(2).replace('.', ',');

export function xmrPaperStep(px, { m, now, btcUsd, xmrUsd, rules = XMR_RULES }) {
  const p = px && px.since ? JSON.parse(JSON.stringify(px)) : { since: now, lastTs: now, walletBtc: rules.walletBtc, startBtc: rules.walletBtc, orderBtc: 0,
    spentBtc: 0, feesBtc: 0, revUsd: 0, poolXmr: 0, paidXmr: 0, payouts: [], runs: [], run: null, on: false, edgePct: null, hoursOn: 0, days: {} };
  if (p.orderOpen === undefined && p.orderBtc > 1e-8) p.orderOpen = true; // estado antigo: a ordem já estava aberta (sem isso a conta cobrava a taxa de novo)
  const events = [], dt = Math.min(Math.max(0, now - (p.lastTs || now)), rules.maxGap), day = new Date(now).toISOString().slice(0, 10);
  // 1) o intervalo que passou, com a decisão anterior
  if (p.on && dt > 0 && btcUsd > 0) {
    const rate = p.rateUsdDay || rules.budgetUsdDay, want = rate * dt / 864e5 / btcUsd, spend = Math.min(want, p.orderBtc), frac = want > 0 ? spend / want : 0;
    const revUsd = spend * btcUsd * (1 + (p.edgePct || 0) / 100);
    p.orderBtc -= spend; p.spentBtc += spend; p.revUsd += revUsd; p.hoursOn += dt * frac / 3600e3;
    if (xmrUsd > 0) p.poolXmr += revUsd / xmrUsd;
    if (p.run) { p.run.spentBtc += spend; p.run.revUsd += revUsd; }
    const d = p.days[day] || (p.days[day] = { spentUsd: 0, revUsd: 0 }); d.spentUsd += spend * btcUsd; d.revUsd += revUsd;
    if (p.orderBtc < 1e-8) { close('acabou o valor da ordem'); p.orderOpen = false; events.push('Monero (simulado): a ordem acabou o valor e foi encerrada; a próxima janela abre outra se houver saldo'); }
  }
  // saque do pool para a carteira quando passa do mínimo
  if (p.poolXmr >= rules.payoutXmr) { p.payouts.push({ t: now, xmr: +p.poolXmr.toFixed(6), usd: xmrUsd ? +(p.poolXmr * xmrUsd).toFixed(2) : null }); p.paidXmr += p.poolXmr; events.push(`Monero (simulado): saque de ${p.poolXmr.toFixed(4).replace('.', ',')} XMR do pool para a carteira`); p.poolXmr = 0; p.payouts = p.payouts.slice(-30); }
  // 2) decisão de agora
  const e = m && isFinite(m.edgePct) && m.edgePct <= 100 ? m.edgePct : null;
  if (e !== null) {
    if (!p.on && e >= rules.enterPct && m && m.thin) { if (!p.thinAt || now - p.thinAt > 6 * 3600e3) { p.thinAt = now; events.push(`Monero (simulado): margem de ${e.toFixed(1).replace('.', ',')}%, mas o livro é raso (pouca ordem recebendo hash): não daria para comprar de verdade`); } }
    else if (!p.on && e >= rules.enterPct) {
      const mk = m && m.marketUsdDay > 0 ? m.marketUsdDay * rules.marketShare : Infinity;
      p.rateUsdDay = Math.max(1, Math.min(rules.budgetUsdDay, mk));
      // como numa arbitragem: só entra se a janela típica paga a taxa de entrada e sobra lucro
      const ds = p.runs.map((r) => (r.end - r.start) / 60e3).sort((a, b) => a - b), winMin = ds.length >= 3 ? ds[ds.length >> 1] : rules.winMin;
      // a taxa de ordem nova é paga uma vez e se divide pelas janelas que o valor da ordem cobre (a ordem fica aberta)
      const winSpend = p.rateUsdDay / 1440 * winMin, orderUsd = (p.orderOpen ? p.orderBtc : Math.max(0, p.walletBtc - rules.newOrderFeeBtc)) * (btcUsd || 0);
      const nWin = Math.max(1, orderUsd / Math.max(1e-9, winSpend)), feeAll = p.orderOpen ? 0 : rules.newOrderFeeBtc * (btcUsd || 0), feeUsd = feeAll / nWin;
      const expUsd = winSpend * e / 100 - feeUsd, beMin = e > 0 && feeAll ? feeAll / (p.rateUsdDay / 1440 * e / 100) : null;
      if (expUsd < rules.minExpUsd) {
        if (!p.skipAt || now - p.skipAt > 3600e3) { p.skipAt = now; events.push(`Monero (simulado): margem de ${e.toFixed(1).replace('.', ',')}%, mas não entra: numa janela típica de ~${Math.round(winMin)} min renderia ~${usd2(expUsd + feeUsd)} (mínimo para valer: ${usd2(rules.minExpUsd + feeUsd)})`); }
      } else {
      p.expect = { usd: expUsd, winMin, beMin };
      if (!p.orderOpen) {
        const amt = Math.floor((p.walletBtc - rules.newOrderFeeBtc) * 1e8) / 1e8;
        if (amt >= rules.minOrderBtc) {
          p.walletBtc -= amt + rules.newOrderFeeBtc; p.feesBtc += rules.newOrderFeeBtc; p.orderBtc = amt; p.orderOpen = true;
          events.push(`Monero (simulado): abriria ordem de ${amt.toFixed(6).replace('.', ',')} BTC no RandomX com margem de ${e.toFixed(1).replace('.', ',')}% (taxa de ordem nova paga uma vez)`);
        } else if (!p.noFunds) { p.noFunds = now; events.push('Monero (simulado): margem boa, mas a carteira virtual não tem o mínimo de 0,001 BTC'); }
      } else events.push(`Monero (simulado): subiria a potência no RandomX com margem de ${e.toFixed(1).replace('.', ',')}% (ordem já aberta, sem taxa nova)`);
      if (p.orderOpen) {
        const fee = p.feesBtc - (p.feesPrev || 0); p.feesPrev = p.feesBtc;
        p.on = true; p.edgePct = e; p.run = { start: now, edgePct: e, spentBtc: 0, revUsd: 0, feeBtc: fee, orderBtc: p.orderBtc, rateUsdDay: p.rateUsdDay };
        events[events.length - 1] += `. Lucro esperado ~${usd2(expUsd)} se a janela durar ~${Math.round(winMin)} min${beMin ? `; a taxa de ordem nova (${usd2(feeAll)}) se paga em ~${Math.round(beMin)} min de mineração e serve para as próximas janelas` : ''}; gasto de até ${usd2(p.rateUsdDay / 24)} por hora`;
      }
      }
    } else if (p.on && (e < rules.exitPct || (m && m.thin))) {
      const why = m && m.thin ? 'mercado ficou raso (pouca ordem recebendo hash)' : `margem caiu para ${e.toFixed(1).replace('.', ',')}%`;
      const R0 = p.run; close(why);
      const res = R0 ? R0.revUsd - (R0.spentBtc + (R0.feeBtc || 0)) * (btcUsd || 0) : 0, mins = R0 ? Math.round((now - R0.start) / 60e3) : 0;
      const tot = p.revUsd - (p.spentBtc + p.feesBtc) * (btcUsd || 0);
      events.push(`Monero (simulado): baixaria a potência para o mínimo (${why}); a ordem fica aberta para a próxima janela. Resultado desta operação: ${R0 ? `gasto ${usd2(R0.spentBtc * (btcUsd || 0))}${R0.feeBtc ? ` + taxa ${usd2(R0.feeBtc * (btcUsd || 0))}` : ''}, receita ${usd2(R0.revUsd)}, ${res >= 0 ? 'lucro' : 'prejuízo'} ${usd2(res)} em ${mins} min` : '—'}. Acumulado: ${usd2(tot)}`);
    } else if (p.on) p.edgePct = e;
  }
  for (const k of Object.keys(p.days).sort().slice(0, -30)) delete p.days[k];
  p.lastTs = now; p.edgeNow = e;
  return { px: p, events };

  function close(reason) { // fim da janela: a ordem continua aberta (o saldo dela fica para a próxima janela)
    if (p.run) { p.runs.push(Object.assign(p.run, { end: now, reason })); p.runs = p.runs.slice(-40); }
    p.run = null; p.on = false;
  }
}

const now0 = (p) => p.lastTs || Date.now();
// Resumo para o painel e o relatório: resultado em dólar (receita do pool contra o gasto em BTC e taxas).
export function xmrSummary(p, btcUsd, xmrUsd) {
  if (!p) return null;
  const costUsd = (p.spentBtc + p.feesBtc) * (btcUsd || 0), resUsd = p.revUsd - costUsd;
  const days = Math.max(1 / 24, (p.lastTs - p.since) / 864e5);
  // janelas: quantas e quanto duram (para saber se dá para pegar e com que frequência aparecem)
  const R = p.runs.filter((r) => r.end > now0(p) - 7 * 864e5), mins = R.map((r) => (r.end - r.start) / 60e3).sort((a, b) => a - b);
  const obsDays = Math.min(7, (p.lastTs - p.since) / 864e5);
  const win = { n7d: R.length, perDay: obsDays >= 1 ? R.length / obsDays : null, obsH: obsDays * 24, medMin: mins.length ? mins[mins.length >> 1] : null,
    avgEdgePct: R.length ? R.reduce((a, r) => a + r.edgePct, 0) / R.length : null };
  return { win, since: p.since, on: p.on, edgeNow: p.edgeNow, hoursOn: p.hoursOn, runs: p.runs.length + (p.run ? 1 : 0), spentUsd: costUsd, revUsd: p.revUsd, resultUsd: resUsd,
    retPct: costUsd > 0 ? resUsd / costUsd * 100 : null, perDayUsd: resUsd / days, walletBtc: p.walletBtc + p.orderBtc, poolXmr: p.poolXmr, paidXmr: p.paidXmr,
    paidUsd: xmrUsd ? p.paidXmr * xmrUsd : null, payouts: p.payouts.length, lastRuns: p.runs.slice(-5).reverse().map((r) => Object.assign({}, r, { resultUsd: r.revUsd - (r.spentBtc + (r.feeBtc || 0)) * (btcUsd || 0) })), run: p.run, expect: p.expect || null };
}
