// Operação Monero "como se fosse real" (simulada): aluguel de RandomX na NiceHash apontado para um pool PPS de XMR
// (padrão: Kryptex PPS+, taxa 1%, saque a partir de 0,01 XMR) com pagamento na carteira cadastrada (ex.: Kraken).
// Diferente do mapa de outras moedas: tem carteira virtual em BTC, ordem com valor mínimo e taxa de ordem nova da
// NiceHash, regra de entrada e saída (entra com margem a partir de +2%, sai abaixo de 0%), saldo no pool em XMR e
// saques quando passa do mínimo. A margem vem do mapa (receita do pool PPS ÷ aluguel típico do livro, já com 3% da
// NiceHash, taxa do pool e perdas de share e venda), a mesma conta das outras moedas.
export const XMR_RULES = { walletBtc: 0.002, enterPct: 2, exitPct: 0, budgetUsdDay: 100, minOrderBtc: 0.001, newOrderFeeBtc: 0.00001, payoutXmr: 0.01, maxGap: 20 * 60e3 };

export function xmrPaperStep(px, { m, now, btcUsd, xmrUsd, rules = XMR_RULES }) {
  const p = px && px.since ? JSON.parse(JSON.stringify(px)) : { since: now, lastTs: now, walletBtc: rules.walletBtc, startBtc: rules.walletBtc, orderBtc: 0,
    spentBtc: 0, feesBtc: 0, revUsd: 0, poolXmr: 0, paidXmr: 0, payouts: [], runs: [], run: null, on: false, edgePct: null, hoursOn: 0, days: {} };
  const events = [], dt = Math.min(Math.max(0, now - (p.lastTs || now)), rules.maxGap), day = new Date(now).toISOString().slice(0, 10);
  // 1) o intervalo que passou, com a decisão anterior
  if (p.on && dt > 0 && btcUsd > 0) {
    const want = rules.budgetUsdDay * dt / 864e5 / btcUsd, spend = Math.min(want, p.orderBtc), frac = want > 0 ? spend / want : 0;
    const revUsd = spend * btcUsd * (1 + (p.edgePct || 0) / 100);
    p.orderBtc -= spend; p.spentBtc += spend; p.revUsd += revUsd; p.hoursOn += dt * frac / 3600e3;
    if (xmrUsd > 0) p.poolXmr += revUsd / xmrUsd;
    if (p.run) { p.run.spentBtc += spend; p.run.revUsd += revUsd; }
    const d = p.days[day] || (p.days[day] = { spentUsd: 0, revUsd: 0 }); d.spentUsd += spend * btcUsd; d.revUsd += revUsd;
    if (p.orderBtc < 1e-8) { close('acabou o valor da ordem'); events.push('Monero (simulado): ordem acabou o valor; sem saldo para outra'); }
  }
  // saque do pool para a carteira quando passa do mínimo
  if (p.poolXmr >= rules.payoutXmr) { p.payouts.push({ t: now, xmr: +p.poolXmr.toFixed(6), usd: xmrUsd ? +(p.poolXmr * xmrUsd).toFixed(2) : null }); p.paidXmr += p.poolXmr; events.push(`Monero (simulado): saque de ${p.poolXmr.toFixed(4).replace('.', ',')} XMR do pool para a carteira`); p.poolXmr = 0; p.payouts = p.payouts.slice(-30); }
  // 2) decisão de agora
  const e = m && isFinite(m.edgePct) && m.edgePct <= 100 ? m.edgePct : null;
  if (e !== null) {
    if (!p.on && e >= rules.enterPct) {
      const amt = Math.floor((p.walletBtc - rules.newOrderFeeBtc) * 1e8) / 1e8;
      if (amt >= rules.minOrderBtc) {
        p.walletBtc -= amt + rules.newOrderFeeBtc; p.feesBtc += rules.newOrderFeeBtc; p.orderBtc = amt; p.on = true; p.edgePct = e;
        p.run = { start: now, edgePct: e, spentBtc: 0, revUsd: 0, orderBtc: amt };
        events.push(`Monero (simulado): abriria ordem de ${amt.toFixed(6).replace('.', ',')} BTC no RandomX com margem de ${e.toFixed(1).replace('.', ',')}%`);
      } else if (!p.noFunds) { p.noFunds = now; events.push('Monero (simulado): margem boa, mas a carteira virtual não tem o mínimo de 0,001 BTC'); }
    } else if (p.on && e < rules.exitPct) {
      close(`margem caiu para ${e.toFixed(1).replace('.', ',')}%`);
      events.push(`Monero (simulado): encerraria a ordem (margem ${e.toFixed(1).replace('.', ',')}%); o que sobrou volta para a carteira`);
    } else if (p.on) p.edgePct = e;
  }
  for (const k of Object.keys(p.days).sort().slice(0, -30)) delete p.days[k];
  p.lastTs = now; p.edgeNow = e;
  return { px: p, events };

  function close(reason) {
    p.walletBtc += p.orderBtc; p.orderBtc = 0;
    if (p.run) { p.runs.push(Object.assign(p.run, { end: now, reason })); p.runs = p.runs.slice(-40); }
    p.run = null; p.on = false;
  }
}

// Resumo para o painel e o relatório: resultado em dólar (receita do pool contra o gasto em BTC e taxas).
export function xmrSummary(p, btcUsd, xmrUsd) {
  if (!p) return null;
  const costUsd = (p.spentBtc + p.feesBtc) * (btcUsd || 0), resUsd = p.revUsd - costUsd;
  const days = Math.max(1 / 24, (p.lastTs - p.since) / 864e5);
  return { since: p.since, on: p.on, edgeNow: p.edgeNow, hoursOn: p.hoursOn, runs: p.runs.length + (p.run ? 1 : 0), spentUsd: costUsd, revUsd: p.revUsd, resultUsd: resUsd,
    retPct: costUsd > 0 ? resUsd / costUsd * 100 : null, perDayUsd: resUsd / days, walletBtc: p.walletBtc + p.orderBtc, poolXmr: p.poolXmr, paidXmr: p.paidXmr,
    paidUsd: xmrUsd ? p.paidXmr * xmrUsd : null, payouts: p.payouts.length, lastRuns: p.runs.slice(-5).reverse(), run: p.run };
}
