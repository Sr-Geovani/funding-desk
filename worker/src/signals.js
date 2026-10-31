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
  if (d >= 1.0) return `acima de ${DARR_REF.above.filter(([l]) => d >= l).pop()[0].toFixed(2)}: só ${pct.toString().replace('.', ',')}% das horas nos últimos 6 meses`;
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
