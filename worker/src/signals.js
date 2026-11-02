// Sinais de mineração além da sorte (pesquisa em docs/pesquisa-mineracao.md).
// DARR = quanto o BCH paga por hash ÷ quanto o BTC paga. A NiceHash precifica o aluguel pelo BTC (o maior mercado),
// então alugar para o BCH só dá lucro médio quando o BCH paga mais que o BTC, descontadas as taxas.
const TWO32 = 4294967296;

// Referência de 180 dias (04/05 a 30/10/2026, pesquisa): média 0,940; p5 0,844; p95 1,010; % das horas acima de cada nível.
export const DARR_REF = { mean: 0.94, p5: 0.844, p95: 1.01, above: [[1.0, 10.3], [1.03, 1.3], [1.04, 0.5], [1.05, 0.1]] };

// Receita por hash em BTC por EH/s por dia: blocos por dia com 1 EH/s × recompensa da moeda × preço em BTC.
export function hashpriceEH(D, rewardCoin, coinInBtc) { return 86400 * 1e18 / (D * TWO32) * rewardCoin * coinInBtc; }

export function darrOf({ dBch, feesBch = 0, bchBtc, dBtc, feesBtc = 0 }) {
  if (!(dBch > 0 && dBtc > 0 && bchBtc > 0)) return null;
  const hpBch = hashpriceEH(dBch, 3.125 + feesBch, bchBtc), hpBtc = hashpriceEH(dBtc, 3.125 + feesBtc, 1);
  return { darr: hpBch / hpBtc, hpBch, hpBtc };
}

// Em que faixa histórica o DARR está (texto curto).
export function darrBand(d) {
  if (!isFinite(d)) return '';
  let pct = 100;
  for (const [lvl, p] of DARR_REF.above) if (d >= lvl) pct = p;
  if (d >= 1.0) return `acima de ${DARR_REF.above.filter(([l]) => d >= l).pop()[0].toFixed(2).replace('.', ',')}: só ${pct.toString().replace('.', ',')}% das horas nos últimos 6 meses`;
  if (d >= DARR_REF.mean) return 'acima da média dos últimos 6 meses (0,94), mas abaixo de 1';
  return 'abaixo da média dos últimos 6 meses (0,94)';
}

// Reajuste de dificuldade do BTC (mempool.space /api/v1/difficulty-adjustment). Se a dificuldade do BTC sobe x%,
// o hash do BTC passa a pagar x% menos e o DARR sobe ~x% (e vice-versa).
export function retargetOf(adj, darr) {
  if (!adj || !isFinite(adj.difficultyChange)) return null;
  const ch = +adj.difficultyChange;
  return { at: adj.estimatedRetargetDate || null, changePct: ch, remainingBlocks: adj.remainingBlocks, progress: adj.progressPercent,
    darrAfter: isFinite(darr) ? darr * (1 + ch / 100) : null };
}

// BCH/BTC contra a média exponencial de ~2 dias (o ASERT do BCH reage em ~2 dias: o preço anda antes da dificuldade).
// closes: preços horários BCH/BTC, mais antigo primeiro.
export function momentumOf(closes) {
  const c = (closes || []).filter((x) => x > 0);
  if (c.length < 30) return null;
  const a = 1 - Math.pow(2, -1 / 48);
  let ema = c[0];
  for (const x of c) ema += a * (x - ema);
  const last = c[c.length - 1], prev = c.length > 24 ? c[c.length - 25] : null;
  return { last, ema, vsEmaPct: (last / ema - 1) * 100, ret24Pct: prev ? (last / prev - 1) * 100 : null };
}

// "Janela fechando": quando o BCH paga mais, pools grandes trocam o hash do BTC para o BCH e os blocos aceleram.
// recent: [{ t, pool, solo }] das últimas 24 h.
export const SWITCHERS = ['ViaBTC', 'AntPool', 'Mining-Dutch', 'F2Pool', 'Binance Pool', 'BTC.com', 'Foundry', 'Poolin', 'JCBCH'];
export function windowMeter(recent, now) {
  const r = (recent || []).filter((b) => now - b.t <= 24 * 3600e3);
  const inH = (h) => r.filter((b) => now - b.t <= h * 3600e3);
  const share = (a) => (a.length ? a.filter((b) => SWITCHERS.includes(b.pool)).length / a.length : null);
  const h1 = inH(1), h6 = inH(6);
  return { last1h: h1.length, last6h: h6.length, last24h: r.length, exp1h: 6, exp6h: 36,
    bigShare6h: share(h6), bigShare24h: share(r), solo6h: h6.filter((b) => b.solo).length };
}

// Gravador do aluguel por hora da semana (UTC): soma margem, preço e hash para o mapa hora × dia.
// week: 168 baldes [n, somaMargem, somaPreço, somaPH, somaDARR]; índice = dia (0 = domingo) × 24 + hora.
export function weekAdd(week, t, { edge, price, ph, darr }) {
  const w = week && week.length === 168 ? week : Array.from({ length: 168 }, () => [0, 0, 0, 0, 0]);
  const d = new Date(t), i = d.getUTCDay() * 24 + d.getUTCHours(), b = w[i];
  if (!isFinite(edge) || !isFinite(price)) return w;
  b[0]++; b[1] += edge; b[2] += price; b[3] += ph || 0; b[4] += isFinite(darr) ? darr : 0;
  return w;
}

// Margem média do mercado (o "normal" contra o qual comparar o momento): a partir do gravador de 15 em 15 min (edgeHist:
// [t, margem no lance, ...]). Leituras de antes da correção do preço (31/10) usam o lance corrigido (+5,8%).
// Devolve, para 24 h e 7 dias: média, mediana, % do tempo com margem ≥ 0 e ≥ o seu mínimo, e onde a margem de agora fica.
export function marginStats(edgeHist, { now, fixAt, minEdge = 3, edgeNow = null }) {
  const F = 1.058, pts = (edgeHist || []).filter((x) => x && isFinite(x[1]))
    .map((x) => [x[0], fixAt && x[0] < fixAt ? ((1 + x[1] / 100) / F - 1) * 100 : x[1]]);
  const win = (h) => {
    const v = pts.filter((x) => x[0] >= now - h * 3600e3).map((x) => x[1]);
    if (v.length < 4) return null;
    const s = v.slice().sort((a, b) => a - b), n = v.length;
    return { n, hours: n / 4, avg: v.reduce((a, b) => a + b, 0) / n, median: s[Math.floor(n / 2)], min: s[0], max: s[n - 1],
      pctPos: v.filter((x) => x >= 0).length / n * 100, pctMin: v.filter((x) => x >= minEdge).length / n * 100,
      hoursMin: v.filter((x) => x >= minEdge).length / 4, rankNow: isFinite(edgeNow) && edgeNow !== null ? (v.filter((x) => x < edgeNow - 0.05).length + v.filter((x) => Math.abs(x - edgeNow) <= 0.05).length / 2) / n * 100 : null,
      label: n / 4 >= 144 ? '7 dias' : n / 4 >= 48 ? Math.round(n / 96) + ' dias' : Math.max(1, Math.round(n / 4)) + ' h',
      top10: s[Math.min(n - 1, Math.floor(n * 0.9))], top25: s[Math.min(n - 1, Math.floor(n * 0.75))] };
  };
  // onde a chance é maior: horas (Brasília, UTC−3) com melhor margem média e o DARR nos 10% melhores momentos
  const raw = (edgeHist || []).filter((x) => x && isFinite(x[1]) && x[0] >= now - 7 * 864e5);
  const fixE = (x) => (fixAt && x[0] < fixAt ? ((1 + x[1] / 100) / F - 1) * 100 : x[1]);
  let bestHours = null, darrTop = null, darrAll = null;
  if (raw.length >= 48) {
    const byH = Array.from({ length: 24 }, () => [0, 0]);
    for (const x of raw) { const h = (new Date(x[0]).getUTCHours() + 21) % 24; byH[h][0]++; byH[h][1] += fixE(x); }
    bestHours = byH.map((b, h) => ({ h, n: b[0], avg: b[0] ? b[1] / b[0] : null })).filter((b) => b.n >= 2).sort((a, b) => b.avg - a.avg).slice(0, 3);
    const es = raw.map(fixE).sort((a, b) => a - b), cut = es[Math.floor(es.length * 0.9)];
    const dv = (arr) => { const v = arr.map((x) => x[3]).filter((d) => isFinite(d) && d > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    darrTop = dv(raw.filter((x) => fixE(x) >= cut)); darrAll = dv(raw);
  }
  return { at: now, minEdge, now: isFinite(edgeNow) ? edgeNow : null, h24: win(24), d7: win(24 * 7), bestHours, darrTop, darrAll };
}

// Previsão da dificuldade do BCH pela fórmula do ASERT (aserti3-2d, meia-vida de 2 dias = 172.800 s): a cada bloco a
// dificuldade é multiplicada por 2^((600 − intervalo) / 172800). Em H horas com b blocos por hora:
// fator = 2^((600·b·H − 3600·H) / 172800). Blocos mais rápidos que 10 min (hash chegando) sobem a dificuldade.
// A margem depois disso: (1 + margem) ÷ fator − 1 (o resto igual: preço do aluguel e cotações).
export const ASERT_HALFLIFE = 172800;
export function asertFactor(blocksPerHour, hours) {
  return Math.pow(2, (600 * blocksPerHour * hours - 3600 * hours) / ASERT_HALFLIFE);
}
export function asertForecast({ recentBlocks, now, edgeNow }) {
  const ts = (recentBlocks || []).map((b) => b.t).filter((t) => t && t <= now).sort((a, b) => a - b);
  if (ts.length < 6) return null;
  const n6 = ts.filter((t) => t > now - 6 * 3600e3).length, n1 = ts.filter((t) => t > now - 3600e3).length;
  const pace = n6 / 6, after = (f) => (isFinite(edgeNow) && edgeNow !== null ? ((1 + edgeNow / 100) / f - 1) * 100 : null);
  const at = (b, h) => { const f = asertFactor(b, h); return { hours: h, dPct: (f - 1) * 100, edge: after(f) }; };
  return { pace6h: pace, last1h: n1, last6h: n6, h1: at(pace, 1), h6: at(pace, 6), h24: at(pace, 24),
    // se o ritmo voltar ao normal (6 por hora) a dificuldade para de mudar; se o hash que entrou sair, cai
    calm: at(6, 6), sinceLast: ts.length ? Math.round((now - ts[ts.length - 1]) / 60e3) : null };
}

// Regra relativa (opcional): margem mínima = o percentil `pct` das margens das últimas 24 h (entra só nos melhores
// momentos do dia), nunca abaixo do piso. Não muda a matemática: se esses momentos têm margem negativa, cada tentativa
// perde em média; o painel mostra esse custo ao lado.
export function relativeMinEdge(edgeHist, { now, fixAt, pct = 75, floor = -2 }) {
  const F = 1.058, v = (edgeHist || []).filter((x) => x && isFinite(x[1]) && x[0] >= now - 24 * 3600e3)
    .map((x) => (fixAt && x[0] < fixAt ? ((1 + x[1] / 100) / F - 1) * 100 : x[1])).sort((a, b) => a - b);
  if (v.length < 24) return null;
  const p = v[Math.min(v.length - 1, Math.floor(v.length * pct / 100))];
  return Math.round(Math.max(floor, p) * 10) / 10;
}
