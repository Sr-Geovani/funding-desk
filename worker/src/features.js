// Características de um par de funding (short em A, long em B) num instante, só com o passado.
// Séries: % a.a. por hora (mais antiga primeiro; a última é "agora"). As mesmas funções servem ao treino (histórico
// pago das exchanges) e ao servidor (previsto, amostrado de hora em hora), para o modelo ver o mesmo tipo de dado.
export const FEATURES = ['excess', 'ex8', 'ex24', 'ex72', 'sd24', 'pos24', 'above', 'spike'];
const clip = (x, a) => Math.max(-a, Math.min(a, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// spread: array de % a.a. (A − B) por hora; be: % a.a. que paga as 4 execuções em 3 dias.
export function pairFeatures(spread, be) {
  const n = spread.length, s0 = spread[n - 1], last = (h) => spread.slice(Math.max(0, n - h));
  const w24 = last(24), m24 = mean(w24), sd = Math.sqrt(mean(w24.map((x) => (x - m24) ** 2)));
  let above = 0;
  for (let i = n - 1; i >= 0 && spread[i] >= be && above < 72; i--) above++;
  const m72 = mean(last(72));
  return [
    clip(s0 - be, 500) / 100, clip(mean(last(8)) - be, 500) / 100, clip(m24 - be, 500) / 100, clip(m72 - be, 500) / 100,
    clip(sd, 500) / 100, w24.filter((x) => x > 0).length / w24.length, above / 72, Math.log(Math.max(1, s0) / Math.max(10, Math.abs(m72)))
  ];
}

// Probabilidade (0 a 1) de a entrada pagar as taxas no prazo, segundo o modelo logístico.
export function score(model, x) {
  let z = model.bias;
  for (let i = 0; i < x.length; i++) z += model.weights[i] * (x[i] - model.mean[i]) / (model.std[i] || 1);
  return 1 / (1 + Math.exp(-z));
}

export function beApr(costPct, holdDays = 3) { return costPct / holdDays * 365; }
