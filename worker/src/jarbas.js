// Jarbas: o assistente que conversa pelo Telegram e escreve o relatório do dia. Responde com os dados do próprio
// servidor (estado, simulações, placar). Com uma chave da API da Anthropic cadastrada (AI_API_KEY + AI_MODEL, cifradas
// em Ajustes), perguntas livres são respondidas pela IA usando o mesmo resumo como contexto; sem a chave, responde pelos
// comandos. Ações que mudam o robô (modo, Sniper) só valem vindas do chat cadastrado.
import Anthropic from '@anthropic-ai/sdk';

const money = (x) => (x === null || x === undefined || !isFinite(x) ? '—' : (x < 0 ? '−' : '') + 'US$' + Math.abs(x).toFixed(2).replace('.', ','));
const pc = (x, d = 1) => (x === null || x === undefined || !isFinite(x) ? '—' : (x > 0 ? '+' : '') + x.toFixed(d).replace('.', ',') + '%');
const ago = (t, now) => { if (!t) return '—'; const m = Math.round((now - t) / 60e3); return m < 60 ? m + ' min' : (m / 60).toFixed(1).replace('.', ',') + ' h'; };

// Resumo compacto de tudo o que o servidor sabe agora (vai para a IA como contexto e para as respostas por comando).
export function brainContext(state, cfg, now) {
  const s = state || {}, m = s.market || {}, sn = s.sniper || {}, ps = s.paperSniper || {}, ai = s.ai || {}, X = s.xmrSum || null;
  const days = (s.real && s.real.days) || {}, today = new Date(now).toISOString().slice(0, 10);
  const realSpent = Object.values(days).reduce((a, d) => a + (d.spendUsd || 0), 0);
  const stats = Object.entries(ai.stats || {}).map(([k, v]) => ({ tipo: k, conferidas: v.n, acertos: v.hits, acertoPct: v.n ? Math.round(v.hits / v.n * 100) : null }));
  const fp = s.fundPaperSum || null, sc = s.alertScoreSum || null, mm = s.mktMargin || {};
  return {
    agora: new Date(now).toISOString(),
    robo: { modo: cfg.mode, sniper: !!cfg.sniper, potenciaTiro: cfg.sniperPh, travaMargemTiro: cfg.sniperMinEdge, gatilhoDificuldade: cfg.sniperDiffDropPct, gatilhoMempool: cfg.sniperFeeX,
      gatilhoAtrasoMin: cfg.sniperUseAge ? cfg.sniperAgeMin : null, prazoTiroMin: cfg.sniperShotMin, stopLossUsd: cfg.sessionBudgetUsd, limiteDiarioUsd: cfg.dailyBudgetUsd, planoParaOSaldo: !!s.planBackup },
    bch: { ultimoBloco: s.lastHeight, blocoHa: ago(s.lastBlockT, now), margemAgoraPct: isFinite(m.edgeAtBidPct) ? +m.edgeAtBidPct.toFixed(2) : null, lance: m.bidEH, empate: m.breakEvenEH,
      margem24h: mm.h24 ? { media: mm.h24.avg, positivaPctDoTempo: mm.h24.pctPos } : null, margem7d: mm.d7 ? { media: mm.d7.avg, positivaPctDoTempo: mm.d7.pctPos, max: mm.d7.max } : null,
      tiroAgora: !!sn.shotStart, tiros: sn.shots, ultimosTiros: (s.snLog || []).slice(-3).map((x) => ({ hora: new Date(x.start).toISOString().slice(11, 16), mira: x.h + 1, gatilho: x.why, ordem: x.order, recebidoPH: x.maxPH, fim: x.endWhy || 'andamento' })) },
    dinheiroReal: { gastoTotalUsd: +realSpent.toFixed(2), gastoHojeUsd: days[today] ? +(days[today].spendUsd || 0).toFixed(2) : 0, blocos: (s.myBlocks || []).length,
      saldoCarteiraBtc: s.acct ? s.acct.balanceBtc : null, ultimoFimDeOrdem: (s.orderEnds || []).slice(-1)[0] ? s.orderEnds.slice(-1)[0].text : null },
    simulacoes: {
      sniper: ps.spendUsd ? { gastoUsd: +ps.spendUsd.toFixed(2), valorEsperadoUsd: +(ps.evUsd || 0).toFixed(2), blocosEsperados: ps.lambda ? +ps.lambda.toFixed(2) : null } : null,
      oportunidades: (s.algoMap || []).concat((s.scan && s.scan.extra) || []).filter((a) => isFinite(a.edgePct) && a.edgePct <= 100).sort((a, b) => b.edgePct - a.edgePct).map((a) => ({ algo: a.label, moedas: a.coins, margemPct: +a.edgePct.toFixed(1), tipo: a.algo === 'SHA256ASICBOOST' ? 'solo' : 'PPS', livroRaso: !!a.thin })),
      ppsComoReal: (s.ppsSum || []).map((x) => ({ algo: x.label, resultadoUsd: +(x.resultUsd || 0).toFixed(2), horasLigado: +(x.hoursOn || 0).toFixed(1), ligado: x.on, janelas7d: x.win && x.win.n7d, janelasPorDia: x.win && x.win.perDay ? +x.win.perDay.toFixed(1) : null, duracaoMediaMin: x.win && x.win.medMin ? Math.round(x.win.medMin) : null })),
      miningRigRentals: Object.entries((s.scan && s.scan.mrr) || {}).map(([k, v]) => ({ algo: k, margemPrecoSugeridoPct: v.sugEdgePct === null ? null : +v.sugEdgePct.toFixed(1), margemMenorPrecoPct: v.lowEdgePct === null ? null : +v.lowEdgePct.toFixed(1), maquinas: v.availRigs })),
      rendimentos: Object.assign({}, Object.fromEntries(Object.entries((s.frontsPaper && s.frontsPaper.f) || {}).map(([k, v]) => [k, v.rate]).filter(([, r]) => isFinite(r))),
        Object.fromEntries(Object.entries((s.market2 && s.market2.yields) || {}).map(([k, v]) => [k, v && v.apy]).filter(([, r]) => isFinite(r))), { cdiReaisAnual: s.fronts && s.fronts.cdi }),
      laboratorioRef: true,
      lastro: { margemHoraAHora: s.marginLastro || {}, precoHashVsAno: Object.fromEntries(Object.entries((s.scan && s.scan.hist) || {}).filter(([, h]) => h && isFinite(h.pct)).map(([k, h]) => [k, { percentil: Math.round(h.pct), vsMedianaPct: +h.vsMedPct.toFixed(1), dias: h.days }])) },
      monero: X ? { resultadoUsd: +X.resultUsd.toFixed(2), retornoPct: X.retPct !== null ? +X.retPct.toFixed(1) : null, horasLigado: +X.hoursOn.toFixed(1), ligadoAgora: X.on, margemAgoraPct: X.edgeNow, xmrRecebido: +X.paidXmr.toFixed(4) } : null,
      funding: fp ? { operacoes: fp.closed, positivas: fp.wins, resultadoUsd: +(fp.netUsd || 0).toFixed(2), taxasUsd: fp.feesUsd, fundingRecebidoUsd: fp.fundingUsd, horasMedias: fp.avgHours } : null,
      placarSinaisFunding: sc ? { sinais: sc.scored, acertos: sc.hits, projetadoUsd: +(sc.projUsd || 0).toFixed(2), realUsd: +(sc.realUsd || 0).toFixed(2) } : null,
      outrasMoedas: Object.entries((s.algoPaper && s.algoPaper.algos) || {}).filter(([, a]) => a.spendUsd > 0).map(([k, a]) => ({ algo: a.label || k, gastoUsd: +a.spendUsd.toFixed(2), retornoPct: +((a.revUsd / a.spendUsd - 1) * 100).toFixed(1), margemAgoraPct: isFinite(a.edgeNow) ? +a.edgeNow.toFixed(1) : null }))
    },
    laboratorio: s.lab || null,
    copiloto: { nivel: ai.level && ai.level.name, acertoGeralPct: ai.rate ? Math.round(ai.rate * 100) : null, porTipo: stats, manchete: s.aiReport && s.aiReport.headline },
    erros: (s.errors || []).slice(0, 3)
  };
}

const HELP = 'Sou o Jarbas, o sócio que acompanha a operação. Pergunte do jeito que quiser ou use:\n' +
  '/status – resumo de tudo\n/laboratorio – novas frentes (base, P2P, Boros, Pendle, Bitfinex)\n/placar – resultado e lastro de cada frente\n/oportunidades – onde entrar agora\n/rendimentos – juros e CDI\n/mrr – preços da MiningRigRentals\n/bch – mineração BCH e Sniper\n/monero – operação Monero (PPS)\n/funding – funding e placar dos sinais\n/saldo – dinheiro real e carteira\n/copiloto – onde a IA acerta e erra\n/relatorio – relatório do dia\n' +
  '/modo observar | ativo | desligado – muda o modo do robô\n/sniper ligar | desligar';

function reportText(c) {
  const L = [];
  L.push(`Relatório do Jarbas (${c.agora.slice(0, 10)})`);
  L.push(`Robô: ${c.robo.modo}${c.robo.sniper ? ', Sniper ligado' : ''}. Dinheiro real gasto até hoje: ${money(c.dinheiroReal.gastoTotalUsd)} (${c.dinheiroReal.blocos} blocos). Hoje: ${money(c.dinheiroReal.gastoHojeUsd)}.`);
  if (c.bch.margemAgoraPct !== null) L.push(`BCH: margem agora ${pc(c.bch.margemAgoraPct)}${c.bch.margem7d ? `; em 7 dias média ${pc(c.bch.margem7d.media)} e positiva em ${Math.round(c.bch.margem7d.positivaPctDoTempo)}% do tempo` : ''}.`);
  const S = c.simulacoes;
  if (S.monero) L.push(`Monero (simulado como real): ${money(S.monero.resultadoUsd)} (${pc(S.monero.retornoPct)}) em ${S.monero.horasLigado} h ligado; ${S.monero.ligadoAgora ? 'minerando agora' : 'parado agora'}.`);
  if (S.sniper) L.push(`Sniper simulado: gasto ${money(S.sniper.gastoUsd)}, valor esperado ${money(S.sniper.valorEsperadoUsd)} (${S.sniper.blocosEsperados} bloco esperado).`);
  if (S.funding) L.push(`Funding simulado: ${S.funding.operacoes} operações, ${S.funding.positivas} positivas, ${money(S.funding.resultadoUsd)}.`);
  const pr = (S.ppsComoReal || []).reduce((a, x) => a + x.resultadoUsd, 0) + (S.monero ? S.monero.resultadoUsd : 0);
  L.push(`Moedas PPS como se fosse real (todas): ${money(pr)}.`);
  const top = (S.oportunidades || []).filter((o) => o.tipo === 'PPS' && o.margemPct >= 2 && !o.livroRaso);
  if (top.length) L.push(`Oportunidade agora: ${top.map((o) => `${o.algo} ${pc(o.margemPct)}`).join(', ')}.`);
  const good = (S.outrasMoedas || []).filter((a) => a.retornoPct > 0).sort((a, b) => b.retornoPct - a.retornoPct);
  if (good.length) L.push(`Outras moedas positivas no acumulado: ${good.slice(0, 3).map((a) => `${a.algo} ${pc(a.retornoPct)}`).join(', ')}.`);
  const weak = (c.copiloto.porTipo || []).filter((t) => t.conferidas >= 8 && t.acertoPct < 40);
  if (weak.length) L.push(`Copiloto ainda erra em: ${weak.map((t) => `${t.tipo} (${t.acertoPct}%)`).join(', ')}.`);
  // direção do dia, pelos números
  const dir = S.monero && S.monero.retornoPct > 0 && S.monero.horasLigado >= 6 ? 'A frente com resultado positivo medido é a do Monero (PPS). Próximo passo: teste real pequeno quando houver saldo.'
    : c.bch.margemAgoraPct !== null && c.bch.margemAgoraPct > 0 ? 'Margem do BCH positiva agora: é uma das raras janelas.' : 'Sem vantagem medida no BCH agora: manter em Observar e não depositar para tiros.';
  L.push(`Direção: ${dir}`);
  if (c.erros.length) L.push(`Atenção: ${c.erros.join('; ')}.`);
  return L.join('\n');
}

// Resposta por comando/palavra-chave. Devolve { text, action? }.
export function ruleReply(text, c) {
  const t = String(text || '').trim().toLowerCase();
  const mode = /^\/?modo\s+(observar|ativo|desligado|desligar)/.exec(t), snp = /^\/?sniper\s+(ligar|ligado|on|desligar|desligado|off)/.exec(t);
  if (mode) { const v = { observar: 'observe', ativo: 'active', desligado: 'off', desligar: 'off' }[mode[1]]; return { text: `Feito: robô em ${mode[1]}.`, action: { mode: v } }; }
  if (snp) { const on = /ligar|ligado|on/.test(snp[1]) && !/desl/.test(snp[1]); return { text: `Feito: Sniper ${on ? 'ligado' : 'desligado'}.`, action: { sniper: on } }; }
  if (/^\/(start|ajuda|help)|^ajuda/.test(t)) return { text: HELP };
  if (/relat/.test(t) || /^\/status|como estamos|resumo|status/.test(t)) return { text: reportText(c) };
  if (/laborat|novas frentes|basis|base|p2p|boros|pendle|bitfinex/.test(t)) { const B = c.laboratorio; if (!B) return { text: 'O laboratório coleta a cada 15 min; a primeira leitura sai na próxima varredura.' };
    const n = B.now || {}, b = (n.basis || [])[0], p = n.p2p, bo = (n.boros || [])[0], pe = (n.pendle || [])[0];
    return { text: [`Laboratório de novas frentes (${(B.days || 0).toFixed(1).replace('.', ',')} dias, ${B.samples} leituras; papel, sem capital):`,
      `• Base (Deribit): melhor agora ${b ? b.inst + ' ' + pc(b.netApr) + ' ao ano líquido' : '—'}; média ${pc(B.avg.basisNetApr)}; acima de 10% em ${B.hitPct.basis !== null ? Math.round(B.hitPct.basis) : '—'}% das leituras.`,
      `• P2P USDT/BRL (Bybit): compra ${p ? p.ask : '—'}, venda ${p ? p.bid : '—'}, diferença ${p ? pc(p.spreadPct, 2) : '—'}; ágio sobre a PTAX ${p ? pc(p.premPtaxPct, 2) : '—'}. Arbitragem direta (vender acima de onde se compra) apareceu em ${B.hitPct.p2p !== null ? Math.round(B.hitPct.p2p) : '—'}% das leituras.`,
      `• Boros: ${bo ? bo.sym + ' fixa ' + pc(bo.fixed) + ' × flutuante ' + pc(bo.floating) : '—'}.`,
      `• Pendle PT (stablecoin): ${pe ? pe.name + ' ' + pc(pe.apy) + ' fixo por ' + pe.days + ' dias' : '—'}; Aave USDC ${pc(n.aaveApy)}; CDI ${pc(n.cdiPct)} (reais).`,
      `• P2P como comerciante (compra no bid, revende no ask depois): ${(B.p2pMerchant || []).map((m) => m.n ? `em ${m.hours} h ${pc(m.avgPct, 2)} em média, positivo ${m.winPct}% das vezes (pior ${pc(m.worstPct, 2)})` : `em ${m.hours} h: juntando dados`).join('; ')}. Fora da conta: golpe, devolução de Pix e trabalho manual.`,
      `• Boros, a pergunta certa (o fixo erra o funding que vem depois?): ${(B.borosRealized || []).map((r) => r.n ? `${r.days} dias: flutuante realizado − fixo = ${pc(r.avgPp)} (quem pagou fixo ganhou ${r.payWinPct}% das vezes)` : `${r.days} dias: precisa de ${r.days} dias de história`).join('; ')}.`,
      `• Bitfinex (empréstimo de dólar): agora ${n.bfx ? pc(n.bfx.lastApr) + ' (pico recente ' + pc(n.bfx.hiApr) + ')' : '—'}. Papel US$500: sempre emprestado ${B.bfxPaper && B.bfxPaper.sempre ? pc(B.bfxPaper.sempre.aprRealized) + ' realizado' : '—'}; só nos picos (≥16%) ${B.bfxPaper && B.bfxPaper.picos ? pc(B.bfxPaper.picos.aprRealized) + ' realizado, ' + B.bfxPaper.picos.loans + ' empréstimos' : '—'}.`,
      `Régua: CDB 100% CDI rende ${pc(B.bar && B.bar.cdbNetPct)} depois do IR; em dólar no exterior precisa de ${pc(B.bar && B.bar.usdGrossNeedPct)} bruto para empatar (sem contar o câmbio).`,
      `Papel: ${(B.paper.open || []).length} posições abertas, ${money(B.paper.lockedUsd)} travados.`].join('\n') }; }
  if (/placar|lastro|hist[oó]ric/.test(t)) { const S = c.simulacoes, Lm = S.lastro.margemHoraAHora || {}, Hp = S.lastro.precoHashVsAno || {};
    const ln = [`Placar das frentes (real e simulado):`, `• BCH solo, real: gasto ${money(c.dinheiroReal.gastoTotalUsd)}, ${c.dinheiroReal.blocos} blocos. Margem em 7 dias: média ${pc(c.bch.margem7d && c.bch.margem7d.media)}, positiva em ${c.bch.margem7d ? Math.round(c.bch.margem7d.positivaPctDoTempo) : '—'}% do tempo.`];
    if (S.sniper) ln.push(`• Sniper, simulado: gasto ${money(S.sniper.gastoUsd)}, valor esperado ${money(S.sniper.valorEsperadoUsd)}.`);
    const pr = (S.ppsComoReal || []).reduce((a, x) => a + x.resultadoUsd, 0) + (S.monero ? S.monero.resultadoUsd : 0); ln.push(`• Moedas PPS, como real: ${money(pr)}.`);
    if (S.funding) ln.push(`• Funding, simulado: ${S.funding.operacoes} operações, ${S.funding.positivas} positivas, ${money(S.funding.resultadoUsd)}.`);
    const lk = Object.entries(Lm).filter(([, v]) => v.horas >= 6).sort((a, b) => b[1].acima2Pct - a[1].acima2Pct).slice(0, 4);
    if (lk.length) ln.push('Lastro (margem hora a hora): ' + lk.map(([k, v]) => `${k} acima de +2% em ${Math.round(v.acima2Pct)}% das ${v.horas} h`).join('; ') + '.');
    const hk = Object.entries(Hp).sort((a, b) => a[1].percentil - b[1].percentil).slice(0, 4);
    if (hk.length) ln.push('Preço do hash hoje contra o último ano: ' + hk.map(([k, v]) => `${k} no percentil ${v.percentil} (${pc(v.vsMedianaPct)} da mediana)`).join('; ') + '.');
    return { text: ln.join('\n') }; }
  if (/rendiment|cdi|juros|stable/.test(t)) { const Y = c.simulacoes.rendimentos || {}; const ks = Object.keys(Y).filter((k) => k !== 'cdiReaisAnual').sort((a, b) => Y[b] - Y[a]); return { text: 'Rendimentos ao ano (dólar): ' + ks.map((k) => `${k} ${pc(Y[k])}`).join(', ') + (Y.cdiReaisAnual ? `. CDI em reais: ${pc(Y.cdiReaisAnual)} (sem risco de cripto).` : '.') }; }
  if (/mrr|rig ?rentals|miningrig/.test(t)) { const M = c.simulacoes.miningRigRentals || []; return { text: M.length ? 'MiningRigRentals (aluguel por máquina, mínimo de algumas horas):\n' + M.sort((a, b) => (b.margemMenorPrecoPct ?? -1e9) - (a.margemMenorPrecoPct ?? -1e9)).map((x) => `• ${x.algo}: ${pc(x.margemMenorPrecoPct)} no menor preço, ${pc(x.margemPrecoSugeridoPct)} no sugerido (${x.maquinas} máquinas)`).join('\n') : 'A varredura da MRR roda a cada 15 min.' }; }
  if (/oportunidad|onde entrar|o que fazer/.test(t)) { const O = c.simulacoes.oportunidades || []; return { text: O.length ? 'Oportunidades agora (margem já com taxas):\n' + O.map((o) => `• ${o.algo} (${o.moedas.join('+')}, ${o.tipo}): ${pc(o.margemPct)}${o.tipo === 'PPS' ? (o.livroRaso && o.margemPct >= 0 ? ' → livro raso, não dá para comprar' : o.margemPct >= 2 ? ' → ENTRAR' : o.margemPct >= 0 ? ' → perto' : '') : ''}`).join('\n') : 'O mapa de moedas atualiza a cada 15 min.' }; }
  if (/monero|xmr|pps|randomx/.test(t)) { const X = c.simulacoes.monero; return { text: X ? `Monero (simulado como real): ${money(X.resultadoUsd)} (${pc(X.retornoPct)}), ${X.horasLigado} h ligado, ${X.ligadoAgora ? 'minerando agora' : 'parado'} (margem agora ${pc(X.margemAgoraPct)}). Recebido: ${X.xmrRecebido} XMR.` : 'A operação Monero começa no próximo cálculo do mapa de moedas (até 15 min).' }; }
  if (/funding/.test(t)) { const F = c.simulacoes.funding, P = c.simulacoes.placarSinaisFunding; return { text: `Funding simulado: ${F ? `${F.operacoes} operações, ${F.positivas} positivas, ${money(F.resultadoUsd)} (taxas ${money(F.taxasUsd)}, funding recebido ${money(F.fundingRecebidoUsd)}, ${(+F.horasMedias || 0).toFixed(0)} h em média)` : 'sem operações'}. ${P ? `Placar dos sinais: ${P.acertos} acertos em ${P.sinais}; projetado ${money(P.projetadoUsd)}, real ${money(P.realUsd)}.` : ''} O spread de altcoin some em horas: não vale entrar contando 3 dias.` }; }
  if (/saldo|carteira|dinheiro|gast/.test(t)) { const D = c.dinheiroReal; return { text: `Dinheiro real: gasto total ${money(D.gastoTotalUsd)}, hoje ${money(D.gastoHojeUsd)}, ${D.blocos} blocos. Saldo livre na NiceHash: ${D.saldoCarteiraBtc === null ? '—' : D.saldoCarteiraBtc.toFixed(6).replace('.', ',') + ' BTC'}.${D.ultimoFimDeOrdem ? ' Última ordem: ' + D.ultimoFimDeOrdem : ''}` }; }
  if (/copiloto|ia\b|acert/.test(t)) return { text: 'Copiloto, acerto por tipo:\n' + (c.copiloto.porTipo || []).map((x) => `• ${x.tipo}: ${x.acertos} de ${x.conferidas} (${x.acertoPct ?? '—'}%)`).join('\n') };
  if (/bch|sniper|tiro|bloco|margem/.test(t)) { const B = c.bch; return { text: `BCH: último bloco ${B.ultimoBloco} há ${B.blocoHa}; margem agora ${pc(B.margemAgoraPct)}. Sniper ${c.robo.sniper ? 'ligado' : 'desligado'} (${B.tiroAgora ? 'em tiro' : 'em espera'}), trava ${pc(c.robo.travaMargemTiro)}. Últimos tiros: ${(B.ultimosTiros || []).map((x) => `${x.hora} mirando ${x.mira} (${x.ordem}, ${x.fim})`).join('; ') || '—'}.` }; }
  return null;
}

const SYSTEM = 'Você é o Jarbas, sócio e gerente da operação Funding Desk (mineração com hash alugado, arbitragem de funding, rendimentos). ' +
  'Fale em português do Brasil, claro, sem jargão e sem símbolos matemáticos, como um sócio experiente que respeita o dinheiro do outro. ' +
  'Use só os números do contexto (JSON do servidor); se faltar dado, diga que falta. Separe o que é real do que é simulado. ' +
  'Seja honesto sobre perdas e sobre o que não tem vantagem comprovada; recomende o próximo passo concreto, com valor e prazo quando fizer sentido. ' +
  'Nunca prometa lucro, nunca sugira contornar bloqueios de país e nunca peça chaves ou senhas. Responda em até 12 linhas.';

// Pergunta livre para a IA (só com chave e modelo cadastrados). Devolve texto ou null.
export async function aiReply(env, question, ctx, fetchFn) {
  if (!env.AI_API_KEY || !env.AI_MODEL) return null;
  const client = new Anthropic({ apiKey: env.AI_API_KEY, fetch: fetchFn || fetch, maxRetries: 1, timeout: 45000 });
  const params = { model: env.AI_MODEL, max_tokens: 2000, system: SYSTEM, output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'Contexto (dados do servidor agora):\n' + JSON.stringify(ctx) + '\n\nPergunta do sócio: ' + String(question).slice(0, 2000) }] };
  try {
    const r = env.AI_FALLBACK === 'default'
      ? await client.beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, params))
      : await client.messages.create(params);
    if (r.stop_reason === 'refusal') return 'Não consigo responder isso. Tente perguntar de outro jeito.';
    const txt = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return txt || null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return 'A chave da IA foi recusada. Confira em Ajustes → Jarbas.';
    if (e instanceof Anthropic.RateLimitError) return 'A IA está no limite de uso agora; tente em alguns minutos (os comandos /status, /monero etc. continuam funcionando).';
    if (e instanceof Anthropic.BadRequestError) return 'A IA recusou o pedido (' + String(e.message).slice(0, 120) + '). Confira o modelo em Ajustes → Jarbas.';
    if (e instanceof Anthropic.APIError) return 'A IA falhou (' + e.status + '). Os comandos continuam funcionando.';
    return 'Não consegui falar com a IA agora. Os comandos continuam funcionando.';
  }
}

export { reportText };
