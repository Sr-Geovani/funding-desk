// Camada de IA do funding (modo sombra): histórico horário próprio do previsto e nota de cada par candidato.
// O servidor guarda, de hora em hora, o previsto (% a.a.) das moedas interessantes em cada exchange (até 72 h) e
// calcula a probabilidade de a entrada pagar as taxas em 3 dias com o modelo treinado (scripts/train-funding-model.mjs).
import { pairFeatures, score, beApr } from './features.js';

const KEEP = 72, MAX_COINS = 60, MIN_HOURS = 6;

// fh: { lastHour, coins: { COIN: { lastSel, v: { Venue: [apr|null, ...] } } } }; rows: previsto atual.
export function updateHistory(fh, { rows, selected, hour }) {
  const h = fh && fh.coins ? fh : { lastHour: null, coins: {} };
  if (h.lastHour === hour) return h;
  for (const c of selected) (h.coins[c] = h.coins[c] || { lastSel: hour, v: {} }).lastSel = hour;
  for (const [c, e] of Object.entries(h.coins)) {
    if (hour - e.lastSel > 24) { delete h.coins[c]; continue; }
    const r = rows[c] || {};
    const venues = new Set(Object.keys(e.v).concat(Object.keys(r)));
    for (const v of venues) {
      const arr = e.v[v] || (e.v[v] = []);
      arr.push(r[v] && isFinite(r[v].apr) ? Math.round(r[v].apr * 10) / 10 : null);
      if (arr.length > KEEP) arr.splice(0, arr.length - KEEP);
    }
  }
  const keys = Object.keys(h.coins);
  if (keys.length > MAX_COINS) keys.sort((a, b) => h.coins[a].lastSel - h.coins[b].lastSel).slice(0, keys.length - MAX_COINS).forEach((k) => delete h.coins[k]);
  h.lastHour = hour;
  return h;
}

// Moedas para acompanhar: as oportunidades boas, as posições abertas e as de maior diferença entre exchanges.
export function pickCoins(rows, extra) {
  const spread = Object.entries(rows).map(([c, r]) => { const a = Object.values(r).map((x) => x.apr).filter(isFinite); return [c, a.length > 1 ? Math.max(...a) - Math.min(...a) : 0]; });
  // diferença ≥ 12% a.a.: perto do empate com ordem limite (~13% a.a.)
  const top = spread.filter((x) => x[1] >= 12).sort((a, b) => b[1] - a[1]).slice(0, 40).map((x) => x[0]);
  return [...new Set((extra || []).concat(top))].slice(0, MAX_COINS);
}

// Pares cuja diferença ficou acima do empate (ordem limite) nas últimas 24 h seguidas: a regra validada em 90 dias.
export function stablePairs(fh, { fees, slipPct = 0.03, hours = 24 }) {
  const out = {};
  if (!fh || !fh.coins) return out;
  const mk = (v) => (fees[v] && isFinite(fees[v].maker) ? fees[v].maker : 0.02);
  for (const [c, e] of Object.entries(fh.coins)) {
    const vs = Object.keys(e.v);
    for (const A of vs) for (const B of vs) {
      if (A === B) continue;
      const a = e.v[A].slice(-hours), b = e.v[B].slice(-hours);
      if (a.length < hours || b.length < hours) continue;
      const be = beApr(2 * (mk(A) + mk(B)) + slipPct, 3);
      if (a.every((x, i) => x !== null && b[i] !== null && x - b[i] >= be)) out[c + '|' + A + '|' + B] = true;
    }
  }
  return out;
}

// Meia-vida (AR(1)) e captura esperada em 72 h dos pares com spread positivo agora (% do tamanho).
export function pairStatsOf(fh, FDI) {
  const out = {};
  if (!fh || !fh.coins || !FDI) return out;
  for (const [c, e] of Object.entries(fh.coins)) {
    const vs = Object.keys(e.v);
    for (const A of vs) for (const B of vs) {
      if (A === B) continue;
      const a = e.v[A], b = e.v[B], n = Math.min(a.length, b.length), sp = [];
      for (let i = 0; i < n; i++) { const x = a[a.length - n + i], y = b[b.length - n + i]; if (x !== null && y !== null) sp.push(x - y); }
      if (sp.length < 12 || sp[sp.length - 1] <= 0) continue;
      const m = FDI.ar1(sp);
      if (!m) continue;
      out[c + '|' + A + '|' + B] = { phi: +m.phi.toFixed(3), halfLifeH: +m.halfLifeH.toFixed(1), mu: +m.mu.toFixed(1), exp72: +FDI.expectedCapturePct(m, sp[sp.length - 1], 72).toFixed(4), n: sp.length };
    }
  }
  return out;
}

// Nota de cada par (short A, long B) com spread acima do empate agora. fees: % taker por exchange.
export function scorePairs(fh, { model, fees, slipPct = 0.03 }) {
  const out = {};
  if (!model || !fh || !fh.coins) return out;
  for (const [c, e] of Object.entries(fh.coins)) {
    const vs = Object.keys(e.v);
    for (const A of vs) for (const B of vs) {
      if (A === B) continue;
      const a = e.v[A], b = e.v[B], n = Math.min(a.length, b.length), sp = [];
      for (let i = 0; i < n; i++) { const x = a[a.length - n + i], y = b[b.length - n + i]; if (x !== null && y !== null) sp.push(x - y); }
      if (sp.length < MIN_HOURS) continue;
      const t = (v) => (fees[v] && isFinite(fees[v].taker) ? fees[v].taker : 0.05), be = beApr(2 * (t(A) + t(B)) + slipPct, 3);
      if (sp[sp.length - 1] < be) continue;
      out[c + '|' + A + '|' + B] = { p: Math.round(score(model, pairFeatures(sp, be)) * 1000) / 1000, hours: sp.length };
    }
  }
  return out;
}
