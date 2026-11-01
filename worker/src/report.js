// Relatório do copiloto no padrão das notas de mercado (mesa de operações e relatório semanal de hashprice):
// manchete com a conclusão, números que movem o resultado, por que está assim, o que esperar, níveis de decisão
// concretos, o que fazer e ajustes sugeridos, riscos (o que tornaria a leitura errada) e a confiança da própria IA.
// A regra é do usuário: a IA lê o mercado, explica e sugere. Texto sem símbolos.
import { plain, bandThreshold, wilson, levelOf } from './brain.js';
const f = (x, d = 1) => Number(x).toFixed(d).replace('.', ',');
const ok = (x) => x !== null && x !== undefined && isFinite(x);
const sg = (x, d = 1) => (x > 0 ? '+' : '') + f(x, d) + '%';
const word = (x) => (x > 0 ? 'positiva' : x < 0 ? 'negativa' : 'zero');

export function aiReport({ now, mkt, cfg, asert, mm, ai, mom, ret, win, darr, power, fund, algos, entry }) {
  const S = [], add = (id, title, items) => { const it = items.filter(Boolean).map(plain); if (it.length) S.push({ id, title, items: it }); };
  if (!(mkt && mkt.ok)) return { at: now, tone: 'neutro', headline: 'Sem dados de mercado da NiceHash neste ciclo: nada a recomendar até a próxima leitura.', sections: [] };
  const e = mkt.edgeAtBidPct, minE = cfg.minEdgePct, W = mm && (mm.d7 || mm.h24), T = bandThreshold(ai && ai.band), L = ai ? levelOf(ai) : null;
  const m1 = asert && asert.h1, m6 = asert && asert.h6;

  // 1) manchete
  let tone, headline;
  if (mkt.green) { tone = 'favoravel'; headline = `Janela aberta: a margem real é ${word(e)} (${sg(e)}), acima do seu mínimo de ${minE}%. ${m1 && m1.edge < minE ? `Atenção: pelo ritmo de blocos, em 1 hora ela deve ir para ${sg(m1.edge)}.` : (m1 ? `Pelo ritmo de blocos, em 1 hora ela deve ficar perto de ${sg(m1.edge)}, ainda acima do mínimo.` : '')}`; }
  else if (e >= 0) { tone = 'neutro'; headline = `Quase: a margem real é positiva (${sg(e)}), mas abaixo do seu mínimo de ${minE}%. Faltam ${f(minE - e)} pontos.`; }
  else { tone = 'desfavoravel'; headline = `Não é hora de alugar: a margem real é negativa (${sg(e)}), ${f(minE - e)} pontos abaixo do seu mínimo de ${minE}%.${W ? ` É ${W.rankNow !== null && W.rankNow <= 30 ? 'pior que o normal' : W.rankNow !== null && W.rankNow >= 70 ? 'melhor que o normal' : 'um momento comum'} para o mercado (${W.label}: média ${sg(W.avg)}).` : ''}`; }

  // 2) números que movem o resultado
  const dTxt = (x) => `${x.dPct >= 0 ? 'sobe' : 'cai'} ${f(Math.abs(x.dPct), 2)}%`;
  add('numeros', 'Números do momento', [
    `Margem real: ${sg(e)} (lance ${f(mkt.bidEH, 4)} contra empate ${f(mkt.breakEvenEH, 4)} BTC por EH/s por dia). Cada US$100 gastos voltam, em média, US$${f(100 + e, 2)}.`,
    ok(darr) ? `DARR ${f(darr, 3)}: o BCH paga ${f(Math.abs((darr - 1) * 100))}% ${darr >= 1 ? 'a mais' : 'a menos'} que o BTC por hash. Como o aluguel acompanha o BTC, só sobra lucro com DARR acima de cerca de 1,05 (3% da NiceHash e 2% do pool).` : null,
    asert ? `Ritmo de blocos: ${asert.last6h} nas últimas 6 horas (normal: 36) e ${asert.last1h} na última hora. Pela fórmula do ASERT, se esse ritmo continuar a dificuldade ${dTxt(m1)} em 1 hora e ${dTxt(m6)} em 6 horas.` : null,
    mom && ok(mom.vsEmaPct) ? `Preço BCH contra BTC: ${sg(mom.vsEmaPct)} sobre a média de 2 dias${ok(mom.ret24Pct) ? ` (${sg(mom.ret24Pct)} em 24 h)` : ''}. Preço subindo antes da dificuldade abre janela; caindo, fecha.` : null,
    ret && ok(ret.changePct) ? `Reajuste do BTC em ${ret.remainingBlocks} blocos (cerca de ${f(ret.remainingBlocks / 144)} dias): ${sg(ret.changePct)}, o que leva o DARR para cerca de ${f(ret.darrAfter, 3)}.` : null,
    W ? `Mercado (${W.label}): margem média ${sg(W.avg)}, positiva em ${f(W.pctPos, 0)}% do tempo e acima de ${minE}% em ${f(W.pctMin, 1)}% (cerca de ${f(W.hoursMin, 1)} h).` : null
  ]);

  // 3) por que está assim
  const why = [];
  if (ok(darr) && darr < 1.05) why.push(`O BCH não está pagando o suficiente acima do BTC (DARR ${f(darr, 3)} contra o empate de cerca de 1,05). Enquanto isso não muda, o aluguel custa mais do que rende.`);
  if (ok(darr) && darr >= 1.05 && e < minE) why.push(`O DARR está bom (${f(darr, 3)}), mas o lance para receber a sua potência (${cfg.targetPh} PH/s) está alto: o livro da NiceHash está caro neste momento.`);
  if (asert && asert.last6h >= 42) why.push(`Hash está chegando ao BCH (${asert.last6h} blocos em 6 horas): pools que trocam de moeda entram quando a margem melhora e a fecham em poucas horas.`);
  if (asert && asert.last6h <= 30) why.push(`Hash está saindo do BCH (${asert.last6h} blocos em 6 horas): a dificuldade vai cair, o que melhora a margem se o preço do aluguel não subir.`);
  if (T === null && ai && ai.band) why.push('Nos últimos dias, margens altas duraram minutos: em nenhuma faixa as 2 horas seguintes ficaram positivas com segurança. São ordens baratas que somem, não janelas de verdade.');
  add('porque', 'Por que está assim', why.length ? why : ['Os fatores estão equilibrados: nenhum puxa a margem com força agora.']);

  // 4) o que esperar
  add('esperar', 'O que esperar nas próximas horas', [
    m1 ? `Em 1 hora, só pela dificuldade: margem perto de ${sg(m1.edge)}. Em 6 horas: ${sg(m6.edge)} (o preço do aluguel e as cotações podem mudar isso).` : null,
    asert && asert.calm ? `Se o ritmo voltar ao normal (6 blocos por hora), a dificuldade para de mudar e a margem fica onde está.` : null,
    T ? `A IA aprendeu que, a partir de ${T.from}% de margem, as 2 horas seguintes ficam positivas em ${f(T.hit * 100, 0)}% das vezes (margem de erro de ${f(T.hitLo * 100, 0)}% a ${f(T.hitHi * 100, 0)}%), com lucro esperado de US$${f(T.ev, 2)} a cada US$100.` : 'A IA ainda não encontrou uma faixa de margem que se sustente por 2 horas com segurança.'
  ]);

  // 5) níveis de decisão (concretos)
  const bidMax = mkt.capEH, needBch = mkt.bchUsd * mkt.bidEH / mkt.capEH, needD = (mkt.capEH / mkt.bidEH - 1) * 100;
  add('niveis', 'Níveis de decisão (o que precisa acontecer para entrar)', mkt.green ? [
    `Fica verde enquanto o lance para ${cfg.targetPh} PH/s estiver abaixo de ${f(bidMax, 4)}. Acima disso o robô pausa.`,
    m1 && m1.edge < minE ? `Sinal de saída: dificuldade subindo no ritmo atual tira ${f(e - m1.edge, 2)} pontos por hora.` : null
  ] : [
    `Preço do aluguel: o lance para ${cfg.targetPh} PH/s precisa cair de ${f(mkt.bidEH, 4)} para ${f(bidMax, 4)} ou menos (${f((1 - bidMax / mkt.bidEH) * 100)}% mais barato).`,
    `Ou o BCH subir de US$${f(mkt.bchUsd, 2)} para cerca de US$${f(needBch, 2)} (${sg((needBch / mkt.bchUsd - 1) * 100)}), mantendo o resto.`,
    `Ou a dificuldade cair ${f(Math.abs(needD))}% (hash saindo do BCH). No ASERT, com metade do ritmo normal de blocos (3 por hora), isso leva cerca de ${f(Math.abs(Math.log2(mkt.capEH / mkt.bidEH)) * 172800 / 1800, 0)} horas.`
  ]);

  // 6) o que fazer e ajustes sugeridos
  const act = [], adj = [];
  if (mkt.green) act.push(power && power.idealPh > 0 ? `Com o robô em Ativo, comprar até ${power.idealPh} PH/s (potência com maior lucro esperado no livro de agora) e parar no bloco.` : 'Com o robô em Ativo, ele compra a sua potência alvo e para no bloco.');
  else act.push('Manter o robô em Observar ou pausado: com margem negativa, cada tentativa perde em média o que a margem indica.');
  if (T && T.from !== minE) adj.push(T.from > minE ? `Margem mínima: aumente de ${minE}% para ${T.from}%. Abaixo disso, o mercado devolveu prejuízo na maior parte das vezes.` : `Margem mínima: se quiser operar mais vezes, pode baixar de ${minE}% para ${T.from}%, onde o lucro esperado ainda foi positivo no pior caso.`);
  if (!T && W && W.pctMin < 5) adj.push(`Margem mínima: mantenha ${minE}%. Ela aconteceu em só ${f(W.pctMin, 1)}% do tempo, mas sem uma faixa comprovada, baixar o mínimo só aumenta as compras com prejuízo.`);
  if (mkt.costPerBlockUsd > 0 && cfg.sessionBudgetUsd > 0) {
    const ch = 1 - Math.exp(-cfg.sessionBudgetUsd / mkt.costPerBlockUsd);
    adj.push(`Stop-loss: US$${f(cfg.sessionBudgetUsd, 0)} por tentativa dá ${f(ch * 100, 0)}% de chance de achar pelo menos 1 bloco (o custo médio de um bloco é US$${f(mkt.costPerBlockUsd, 0)}). Isso não muda o lucro médio, só o tamanho da perda quando não acha. Para ${f(50, 0)}% de chance seriam cerca de US$${f(mkt.costPerBlockUsd * Math.LN2, 0)}.`);
  }
  if (power && power.idealPh > 0 && Math.abs(power.idealPh - cfg.targetPh) / cfg.targetPh > 0.3) adj.push(`Potência alvo: o livro de agora favorece ${power.idealPh} PH/s (sua configuração: ${cfg.targetPh}). Acima disso o lance sobe e a margem cai.`);
  if (cfg.dailyBudgetUsd > 0 && cfg.sessionBudgetUsd > cfg.dailyBudgetUsd) adj.push(`Limite diário (US$${cfg.dailyBudgetUsd}) menor que o stop-loss (US$${cfg.sessionBudgetUsd}): o limite diário corta a tentativa antes. Iguale os dois ou aumente o diário.`);
  if (cfg.weeklyLossUsd > 0 && cfg.weeklyLossUsd < cfg.sessionBudgetUsd * 2) adj.push(`Perda máxima em 7 dias (US$${cfg.weeklyLossUsd}) cobre menos de 2 tentativas completas: o robô para cedo. Considere ao menos US$${cfg.sessionBudgetUsd * 3}.`);
  add('fazer', 'O que fazer agora', act);
  add('ajustes', 'Ajustes sugeridos (a decisão é sua)', adj.length ? adj : ['Sua configuração está coerente com o mercado de agora: nenhum ajuste necessário.']);

  // 7) riscos: o que tornaria a leitura errada
  add('riscos', 'Riscos (o que pode tornar esta leitura errada)', [
    'O preço do aluguel muda em minutos: uma ordem barata com poucas máquinas pode aparecer e sumir. A leitura usa o preço que entrega a sua potência inteira, mas ele também oscila.',
    'Uma alta rápida do BCH contra o BTC abre janela antes de a dificuldade reagir (1 a 2 dias). É o cenário em que esta leitura negativa vira positiva.',
    'Sorte: mesmo com margem positiva, cada tentativa é tudo ou nada. O resultado só converge para a margem depois de muitas tentativas.'
  ]);

  // 8) confiança da IA e correção da leitura anterior
  const C = ai && ai.band && ai.band.calls, lastMine = ai && (ai.done || []).filter((d) => /^mine_/.test(d.type) && d.hit !== null && d.hit !== undefined).slice(-1)[0];
  add('confianca', 'Confiança da IA', [
    L ? `Nível ${L.level.n} (${L.level.name}): ${L.resolved} previsões conferidas, ${L.hard.hits} acertos em ${L.hard.n} difíceis. ${L.lift && L.lift.pts !== null ? `Contra o acaso: ${L.lift.pts > 0 ? 'acerta ' + f(L.lift.pts, 0) + ' pontos a mais' : 'ainda não supera o acaso'}.` : 'Ainda sem comparação suficiente com o acaso.'}` : null,
    C && C.n ? (() => { const w = wilson(C.hits, C.n); return `Faixa aprendida: ${C.hits} acertos em ${C.n} vezes em que disse "faixa boa" (margem de erro de ${f(w.lo * 100, 0)}% a ${f(w.hi * 100, 0)}%).`; })() : 'Faixa aprendida: ainda sem chamadas para conferir.',
    lastMine ? `Última previsão de mineração conferida: "${lastMine.text}" — ${lastMine.hit ? 'acertou' : 'errou'}${lastMine.check ? ' (' + lastMine.check + ')' : ''}.` : null
  ]);

  // funding e outras moedas (resumo)
  if (fund) add('funding', 'Funding', [
    `${fund.passing ? fund.passing + ' oportunidade(s) passam' : 'Nenhuma oportunidade passa'} na regra (24 h seguidas acima do empate, ordem limite).`,
    fund.sim ? `Simulação: ${fund.sim.closed} operação(ões) fechada(s), ${fund.sim.wins} no lucro, resultado ${fund.sim.netUsd >= 0 ? '+' : '−'}US$${f(Math.abs(fund.sim.netUsd), 2)}; ${fund.sim.open} aberta(s). No reteste de 90 dias nenhuma janela fechou positiva nestas corretoras: o regime de alavancagem está frio.` : null
  ]);
  if (algos && algos.length) {
    const go = algos.filter((a) => a.level === 'go'), best = algos.filter((a) => isFinite(a.edge)).sort((a, b) => b.edge - a.edge)[0];
    add('outras', 'Outras moedas (pool PPS, sem sorte)', [go.length ? `${go.map((a) => a.label + ' ' + sg(a.edge)).join(', ')} compensam agora.` : `Nenhum algoritmo compensa agora${best ? `; o melhor é ${best.label} com ${sg(best.edge)}${best.level === 'maybe' ? (best.edge >= minE ? ' (em "talvez": livro raso, poucas ordens recebendo hash; a margem pode não se sustentar com volume)' : ' (abaixo do seu mínimo)') : ''}` : ''}.`]);
  }
  return { at: now, tone, headline: plain(headline), sections: S };
}
