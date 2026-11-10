// Auditor automático (05/11): confere de hora em hora se as contas das simulações fecham, antes de qualquer robô com
// dinheiro. Nasceu dos erros que só apareceram olhando as mensagens: taxa cobrada em dobro, gasto remarcado pelo BTC de
// hoje, espera entre janelas fora da conta e um livro com preço absurdo (margem de 40.152%).
// Só lê o estado; não muda nada. Erro = conta que não fecha ou valor impossível; aviso = dado suspeito ou parado.
const fin = (x) => typeof x === 'number' && isFinite(x);
const money = (x) => (x < 0 ? '−' : '') + 'US$' + Math.abs(x).toFixed(2).replace('.', ',');

export function auditState(state, opts = {}) {
  const { now = Date.now(), lab = null, arb = null } = opts;
  const s = state || {}, out = [];
  let checks = 0;
  const add = (sev, area, key, text) => out.push({ sev, area, key: area + ':' + key, text });
  const chk = (cond, sev, area, key, text) => { checks++; if (!cond) add(sev, area, key, text); };

  // 1) valores vazios ou infinitos nas simulações (um NaN se espalha pelas contas sem aparecer)
  const scanNum = (area, o, path = '', depth = 0) => {
    if (!o || depth > 4) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number') { checks++; if (!isFinite(v)) add('erro', area, 'nan:' + path + k, `${area}: valor inválido em ${path}${k}`); }
      else if (v && typeof v === 'object' && !Array.isArray(v)) scanNum(area, v, path + k + '.', depth + 1);
    }
  };
  const ops = Object.assign({ Monero: s.paperXmr }, Object.fromEntries(Object.entries(s.ppsOps || {}).map(([k, v]) => [(v && v.label) || k, v])));
  for (const [name, p] of Object.entries(ops)) {
    if (!p || !p.since) continue;
    const area = 'PPS ' + name;
    scanNum(area, p);
    // 2) o dinheiro fecha: BTC do início + reposições = carteira + ordem + gasto + taxas
    const inBtc = (p.startBtc || 0) + (p.refillBtc || 0), outBtc = (p.walletBtc || 0) + (p.orderBtc || 0) + (p.spentBtc || 0) + (p.feesBtc || 0);
    chk(Math.abs(inBtc - outBtc) < 2e-8, 'erro', area, 'btc', `${area}: o BTC não fecha (entrou ${inBtc.toFixed(8)}, está em ${outBtc.toFixed(8)})`);
    chk((p.walletBtc || 0) > -1e-9 && (p.orderBtc || 0) > -1e-9 && (p.poolXmr || 0) > -1e-12, 'erro', area, 'neg', `${area}: saldo negativo na carteira, na ordem ou no pool`);
    // 3) as janelas somam o gasto das janelas (enquanto o histórico não foi cortado em 40)
    if (p.spentUsd !== undefined && (p.runs || []).length < 40) {
      const R = (p.runs || []).concat(p.run ? [p.run] : []), sp = R.reduce((a, r) => a + (r.spentUsd || 0), 0), rv = R.reduce((a, r) => a + (r.revUsd || 0), 0);
      chk(Math.abs(sp - p.spentUsd) < 0.01 && Math.abs(rv - p.revUsd) < 0.01, 'erro', area, 'runs', `${area}: a soma das janelas (${money(rv - sp)}) não bate com o total (${money(p.revUsd - p.spentUsd)})`);
    }
    // 4) margem que rendeu dentro do possível (−50% a +100%)
    for (const r of (p.runs || []).slice(-10)) {
      if (!(r.spentUsd > 0)) continue;
      const e = (r.revUsd / r.spentUsd - 1) * 100;
      chk(e > -50 && e < 100, 'erro', area, 'edge:' + r.start, `${area}: janela de ${new Date(r.start).toISOString().slice(5, 16).replace('T', ' ')} UTC rendeu ${e.toFixed(0)}% (impossível: dado com defeito)`);
      // margem alta demais para durar horas: aluguel de hash é mercado aberto; acima de 15% por janela pede conferência antes de contar como lucro
      if (e >= 15 && e < 100) { checks++; add('aviso', area, 'high:' + r.start, `${area}: janela de ${new Date(r.start).toISOString().slice(5, 16).replace('T', ' ')} UTC rendeu ${e.toFixed(0)}%: alto demais para ser comum; não contar como lucro até conferir a receita (preço da moeda e dificuldade)`); }
    }
    // 5) uma ordem aberta por vez e sem janela ligada com a ordem fechada
    chk(!(p.on && !p.orderOpen), 'erro', area, 'on', `${area}: janela ligada sem ordem aberta`);
  }

  // 6) margem do BCH dentro do possível; mapa sem margem absurda
  const eh = s.edgeHist || [];
  chk(!eh.some((x) => !(x[1] <= 100)), 'erro', 'BCH', 'edgeHist', 'BCH: histórico de margem com leitura acima de 100% (livro com defeito)');
  for (const a of s.algoMap || []) { checks++; if (fin(a.edgePct) && a.edgePct > 100) add('aviso', 'Mapa', 'sus:' + a.algo, `Mapa: ${a.label || a.algo} com margem de ${Math.round(a.edgePct)}% (dado suspeito, fica de fora das simulações)`); }

  // 7) simulações do BCH: gasto e valor esperado não negativos, preço das janelas perto do mercado
  for (const k of ['paper', 'paperBurst', 'paperPlan', 'paperAlways', 'paperSniper']) {
    const P = s[k]; if (!P) continue;
    scanNum('BCH ' + k, { spendUsd: P.spendUsd, evUsd: P.evUsd, hoursOn: P.hoursOn });
    chk((P.spendUsd || 0) >= 0 && (P.evUsd || 0) >= 0, 'erro', 'BCH ' + k, 'neg', `BCH ${k}: gasto ou valor esperado negativo`);
    const pr = (P.runs || []).map((r) => r.priceEH).filter((x) => x > 0).sort((a, b) => a - b), med = pr.length ? pr[pr.length >> 1] : null;
    for (const r of (P.runs || []).slice(-20)) { checks++; if (med && r.priceEH > 0 && r.priceEH < med * 0.5) add('erro', 'BCH ' + k, 'price:' + r.start, `BCH ${k}: janela com aluguel a ${r.priceEH} (mediana ${med}): preço com defeito`); }
  }

  // 8) funding: ganhos não passam do número de operações; cada operação fechada tem conta
  for (const k of ['fundPaper', 'fundPaperLT', 'fundPaperAI']) {
    const F = s[k]; if (!F) continue;
    for (const c of (F.closed || []).slice(-30)) { checks++; if (!fin(c.netUsd)) add('erro', 'Funding', k + ':' + c.openedAt, `Funding (${k}): operação sem resultado válido`); }
  }

  // 9) laboratório: posições em papel com valor travado não negativo
  if (lab && lab.paper) for (const o of (lab.paper.open || [])) { checks++; if (!(o.lockedUsd >= 0)) add('erro', 'Laboratório', 'locked:' + o.key, `Laboratório: posição ${o.kind} com valor travado inválido`); }

  // 9b) arbitragem: papel sem valor inválido, nenhuma oportunidade acima de 3% (cotação com defeito) e dados atualizados
  if (arb) {
    if (arb.paper) scanNum('Arbitragem', { netUsd: arb.paper.netUsd, grossUsd: arb.paper.grossUsd, feesUsd: arb.paper.feesUsd });
    for (const o of ((arb.now && arb.now.ops) || []).slice(0, 5)) { checks++; if (o.netPct > 3) add('aviso', 'Arbitragem', 'sus:' + o.id, `Arbitragem: ${o.id} com ${o.netPct.toFixed(2)}% líquido — alto demais para stablecoin (cotação parada ou com defeito?)`); }
    chk((now - (arb.lastTs || 0)) / 60e3 < 12, 'aviso', 'Dados', 'arb', `Dados: a arbitragem não lê o mercado há ${Math.round((now - (arb.lastTs || 0)) / 60e3)} min`);
    if (arb.exec && arb.exec.halted) add('erro', 'Arbitragem', 'halted', `Arbitragem: o robô se desligou sozinho — ${arb.exec.halted.why}`);
  }
  // 9c) DeFi: papel sem operação com ganho impossível (acima de 1% em stable / 3% em ETH)
  if (opts.defi && opts.defi.paper) for (const x of (opts.defi.paper.last || []).slice(0, 10)) { checks++; if (x.pct > 1) add('erro', 'DeFi', 'pct:' + x.t, `DeFi: operação em papel de ${x.k} com ${x.pct.toFixed(2)}% (impossível para resgate: cotação com defeito)`); }
  // 10) dados parados (sem leitura nova, a simulação decide com dado velho)
  const age = (t) => (t ? (now - t) / 60e3 : Infinity);
  chk(age(s.algoTs) < 35, 'aviso', 'Dados', 'map', `Dados: o mapa de moedas não atualiza há ${Math.round(age(s.algoTs))} min`);
  if (s.scan) chk(age(s.scan.at) < 40, 'aviso', 'Dados', 'scan', `Dados: a varredura não roda há ${Math.round(age(s.scan.at))} min`);
  if (lab) chk(age(lab.lastTs) < 40, 'aviso', 'Dados', 'lab', `Dados: o laboratório não coleta há ${Math.round(age(lab.lastTs))} min`);

  return { at: now, checks, errors: out.filter((x) => x.sev === 'erro').length, warnings: out.filter((x) => x.sev === 'aviso').length, findings: out.slice(0, 30) };
}

// O que mandar no Telegram: só problema novo (e o aviso de que voltou a fechar).
export function auditNews(prev, cur) {
  const old = new Set(((prev && prev.findings) || []).map((x) => x.key)), msgs = [];
  const fresh = cur.findings.filter((x) => x.sev === 'erro' && !old.has(x.key));
  if (fresh.length) msgs.push('Auditor: ' + fresh.length + (fresh.length === 1 ? ' conta não fecha' : ' contas não fecham') + ' — ' + fresh.slice(0, 4).map((x) => x.text).join('; '));
  if (prev && prev.errors > 0 && cur.errors === 0) msgs.push(`Auditor: tudo voltou a fechar (${cur.checks} conferências).`);
  return msgs;
}
