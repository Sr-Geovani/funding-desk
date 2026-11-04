// Copiloto IA: junta todos os sinais (mineração, funding, outras moedas) numa análise e transforma cada sinal numa
// PREVISÃO conferível ("a janela abre em até 6 h", "esse pico some em 24 h"...). Quando o prazo vence, o servidor confere
// com os dados reais: acerto dá XP. A confiança de cada tipo de previsão aprende com o próprio histórico de acertos,
// e a maturidade (nível) sobe com o número de previsões conferidas e a taxa de acerto. Ninguém precisa executar a dica.
// Fácil = aposta que o que está aí continua (acerta quase sempre, vale pouco). Difícil = aposta numa mudança (vale muito).
// Para subir de nível não basta tempo: é preciso acertar as difíceis E bater o acaso (grupo de controle).
// Auditoria (31/10): docs/auditoria-ia-e-simulacoes.md.
import { creditLegs, newLegs, legsFeePct, FUND_RULES } from './paperfund.js';
export const LEVELS = [
  { n: 1, name: 'Aprendiz', min: 0, hard: 0, hit: 0 }, { n: 2, name: 'Analista', min: 30, hard: 5, hit: 0 },
  { n: 3, name: 'Estrategista', min: 100, hard: 20, hit: 0.5, skill: true }, { n: 4, name: 'Mestre', min: 300, hard: 60, hit: 0.55, skill: true }
];
// Grupo de controle ("o acaso"): a mesma pergunta das previsões difíceis, feita SEM sinal, de tantas em tantas horas.
// Vantagem da IA = acerto com sinal − acerto sem sinal. Se for ≤ 0, o sinal não ajuda (e o nível não passa de Analista).
export const CTRL = { mine_wait: 6, mine_close: 6 };
export const XP = { hard: 10, easy: 2, trusted: 5 };
export const TYPES = {
  mine_buy: { label: 'Compra de hash (BCH) segue boa por 1 h', h: 1, cool: 3, base: 0.6, hard: false },
  mine_wait: { label: 'Janela do BCH abre em até 6 h', h: 6, cool: 6, base: 0.4, hard: true },
  mine_close: { label: 'Dificuldade do BCH sobe em 3 h (hash chegando)', h: 3, cool: 6, base: 0.55, hard: true },
  mine_avoid: { label: 'Alugar não compensa nas próximas 12 h', h: 12, cool: 12, base: 0.7, hard: false },
  btc_retarget: { label: 'DARR depois do reajuste do BTC', h: null, cool: 24 * 12, base: 0.6, hard: true },
  fund_go: { label: 'Entrada de funding paga as taxas em 3 dias', h: 72, cool: 24, base: 0.4, hard: true },
  fund_spike: { label: 'Pico de funding some em 24 h', h: 24, cool: 24, base: 0.7, hard: false },
  algo_go: { label: 'Outra moeda segue compensando por 6 h', h: 6, cool: 12, base: 0.5, hard: false },
  // 04/11: as janelas das outras moedas duram ~30 min; a previsão de 6 h errava 2 de 3. A nova olha 1 h (a de 6 h fica no histórico).
  algo_go1: { label: 'Outra moeda segue compensando por 1 h', h: 1, cool: 3, base: 0.5, hard: false }
};
const xpOf = (type, hit, trusted) => (!hit ? 0 : TYPES[type] && TYPES[type].hard ? XP.hard + (trusted ? XP.trusted : 0) : XP.easy);
const H = 3600e3;

// Vantagem sobre o acaso por tipo (só com 5+ conferidas dos dois lados) e a média ponderada.
export function liftOf(ai) {
  const by = {}; let wsum = 0, w = 0;
  for (const k of Object.keys(CTRL)) {
    const s = (ai.stats || {})[k], c = ((ai.ctrl || {}).stats || {})[k];
    if (!s || !c || s.n < 5 || c.n < 5) { by[k] = { sig: s || null, ctrl: c || null, pts: null }; continue; }
    const pts = (s.hits / s.n - c.hits / c.n) * 100;
    by[k] = { sig: s, ctrl: c, pts }; wsum += pts * s.n; w += s.n;
  }
  return { by, pts: w >= 10 ? wsum / w : null, n: w };
}
export function levelOf(ai) {
  const ent = Object.entries(ai.stats || {}), sum = (fn) => ent.reduce((a, [k, s]) => a + (fn(k) ? s.n : 0), 0);
  const n = sum(() => true), hits = ent.reduce((a, [, s]) => a + s.hits, 0), rate = n ? hits / n : 0;
  const isHard = (k) => !!(TYPES[k] && TYPES[k].hard);
  const hn = sum(isHard), hh = ent.reduce((a, [k, s]) => a + (isHard(k) ? s.hits : 0), 0), hRate = hn ? hh / hn : 0;
  const lift = liftOf(ai), noSkill = lift.pts !== null && lift.pts <= 0;
  let cur = LEVELS[0];
  for (const L of LEVELS) if (n >= L.min && hn >= L.hard && hRate >= L.hit && !(L.skill && noSkill)) cur = L;
  const next = LEVELS.find((L) => L.n === cur.n + 1) || null;
  const progress = next ? Math.min(1, n / next.min) * Math.min(1, hn / next.hard) * (next.hit ? Math.min(1, hRate / next.hit) : 1) * (next.skill && noSkill ? 0.5 : 1) : 1;
  const unscored = Object.values(ai.unscored || {}).reduce((a, x) => a + x, 0);
  return { level: cur, next, resolved: n, hits, rate, hard: { n: hn, hits: hh, rate: hRate }, easy: { n: n - hn, hits: hits - hh }, progress, lift, unscored };
}
// Versão 2 do XP (31/10): refaz o XP com o peso por dificuldade (antes: até 15 por acerto de qualquer tipo, 1 por erro).
function migrate(ai) {
  if (ai.v === 2) return ai;
  ai.xp = 0;
  for (const [k, s] of Object.entries(ai.stats || {})) { s.xp = s.hits * xpOf(k, true, false); ai.xp += s.xp; }
  for (const d of ai.done || []) if (d.hit !== null && d.hit !== undefined) d.xp = xpOf(d.type, d.hit, false);
  ai.v = 2;
  return ai;
}
export function reliability(ai, type) {
  const s = (ai.stats || {})[type] || { n: 0, hits: 0 };
  const rel = (s.hits + 1) / (s.n + 2), base = TYPES[type].base;
  return { n: s.n, rel, conf: s.n >= 5 ? (base + rel) / 2 : base, trusted: s.n >= 20 && rel >= 0.6 };
}
const spreadOf = (rows, key) => { const [c, s, l] = key.split('|'), r = rows && rows[c]; return r && r[s] && r[l] ? r[s].apr - r[l].apr : null; };

// snap: { now, edge, green, minEdge, darr, D, mom, ret, win, fund:[{key,coin,netUsd}], rows, stable24, algos:[{k,label,edge,level}], scoreDone:[...] }
// Confere uma previsão (ou amostra de controle) vencida. Devolve { hit, value } ou { wait: true } ou {} (sem dado).
function check(o, snap, now) {
  if (o.type === 'mine_buy') return isFinite(snap.edge) ? { hit: snap.edge >= 0, value: snap.edge } : {};
  // janela = o robô compraria (sinal verde, lance ≤ teto), a mesma régua do robô; antes era margem ≥ mínimo (quase igual)
  if (o.type === 'mine_wait') return o.sawGreen === undefined ? { hit: o.maxEdge >= o.minEdge, value: o.maxEdge } : { hit: o.sawGreen, value: o.maxEdge };
  if (o.type === 'mine_avoid') return o.sawGreen === undefined ? { hit: o.maxEdge < o.minEdge, value: o.maxEdge } : { hit: !o.sawGreen, value: o.maxEdge };
  if (o.type === 'mine_close') return snap.D ? { hit: snap.D > o.D0 * 1.005, value: (snap.D / o.D0 - 1) * 100 } : {};
  if (o.type === 'btc_retarget') {
    // a data do reajuste é estimativa (muda horas): só confere depois que ele aconteceu (contador de blocos recomeça)
    const R = snap.ret, rem0 = o.rem0 === undefined ? 288 : o.rem0;
    if (!(R && isFinite(R.remainingBlocks) && R.remainingBlocks > rem0 + 100)) return now < o.due + 48 * H ? { wait: true } : {};
    if (!isFinite(snap.darr)) return {};
    return { hit: Math.abs(snap.darr / o.pred - 1) <= 0.03, value: snap.darr, beat: isFinite(o.naive) ? Math.abs(snap.darr - o.pred) < Math.abs(snap.darr - o.naive) : null };
  }
  if (o.type === 'algo_go' || o.type === 'algo_go1') { const a = (snap.algos || []).find((x) => x.k === o.key); return a && isFinite(a.edge) ? { hit: a.edge > 0, value: a.edge } : {}; }
  if (o.type === 'fund_spike') { const sp = spreadOf(snap.rows, o.key); return sp !== null ? { hit: sp < o.s0 / 2, value: sp } : {}; }
  if (o.type === 'fund_go') {
    // acompanhada pela própria IA (pagamentos reais de funding − 4 execuções maker + deslize), sem depender de alerta
    if (o.pos) { const costs = o.pos.notional * (2 * legsFeePct(snap.fees || {}, o.pos.s, o.pos.l, 'maker') + FUND_RULES.slipPct) / 100, net = o.pos.fundingUsd - costs;
      return { hit: net > 0, value: net }; }
    const d = (snap.scoreDone || []).find((x) => x.key === o.key && Math.abs(x.t - o.t) <= 6 * H);
    return d ? { hit: d.hit, value: d.netUsd } : now < o.due + 12 * H ? { wait: true } : {};
  }
  return {};
}
// Atualiza o que precisa ser acompanhado a cada ciclo (antes do prazo).
function track(o, snap, now) {
  if (o.type === 'mine_wait' || o.type === 'mine_avoid') {
    o.maxEdge = Math.max(o.maxEdge === undefined ? -1e9 : o.maxEdge, isFinite(snap.edge) ? snap.edge : -1e9);
    if (o.sawGreen !== undefined && snap.green) o.sawGreen = true;
  }
  if (o.type === 'fund_go' && o.pos && snap.rows) creditLegs(o.pos, snap.rows[o.pos.coin] || {}, o.pos.notional, now);
}

// snap: { now, edge, green, minEdge, darr, D, mom, ret, win, fund:[{key,coin,netUsd}], rows, fees, stable24, algos:[{k,label,edge,level}], scoreDone:[...] }
// Texto claro, sem símbolos: a IA fala "maior que", "menor que", "positiva", "negativa".
export function plain(t) {
  return String(t).replace(/\s*≥\s*/g, ' maior ou igual a ').replace(/\s*≤\s*/g, ' menor ou igual a ').replace(/\s+>\s+/g, ' maior que ').replace(/\s+<\s+/g, ' menor que ')
    .replace(/±/g, 'mais ou menos ').replace(/\s×\s/g, ' e ').replace(/ {2,}/g, ' ').replace(/\( /g, '(').trim();
}
const sgn = (x, d = 1) => (x > 0 ? 'positiva (+' : x < 0 ? 'negativa (' : 'zero (') + f(x, d) + '%)';

// Faixa aprendida (mineração): para cada leitura de margem (a cada 15 min), a IA confere se a média das 2 horas
// seguintes ficou positiva. Agrupa por faixa de 1 ponto e descobre a partir de qual margem a chance de resultado
// positivo passa de 60%. Esquece devagar (peso cai à metade em ~1 semana): a faixa acompanha o mercado. Também
// guarda o próprio placar: nas vezes em que a faixa dizia "boa", quantas acertou.
export const BAND = { aheadH: 2, minN: 8, minHitLo: 0.5, haircut: 0.5, z: 1.28, decay: 0.999, lo: -8, hi: 10 };
// Intervalo de confiança do acerto (Wilson, 80%): com poucos casos, "67%" pode ser sorte; o intervalo mostra o quanto.
export function wilson(h, n, z = BAND.z) {
  if (!(n > 0)) return { lo: 0, hi: 1 };
  const p = h / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}
// Faixa boa = a menor margem a partir da qual, juntando todas as leituras acima dela:
//  (1) o lucro esperado por dólar nas 2 h seguintes, já descontada a execução (hash demora a chegar, degrau de preço:
//      0,5 ponto), fica positivo MESMO no limite de baixo do intervalo; e (2) o acerto fica acima de 50% no limite de baixo.
// Decide pelo lucro esperado, não só pelo acerto; e só confia quando a margem de erro deixa.
export function bandThreshold(band) {
  if (!band || !band.bins) return null;
  let n = 0, h = 0, sum = 0, sq = 0, best = null;
  for (let b = BAND.hi; b >= BAND.lo; b--) {
    const x = band.bins[b]; if (!x) continue;
    n += x[0]; h += x[1]; sum += x[2]; sq += x[3] !== undefined ? x[3] : x[2] * x[2] / (x[0] || 1);
    if (n < BAND.minN) continue;
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean)), ev = mean - BAND.haircut, evLo = ev - BAND.z * sd / Math.sqrt(n), w = wilson(h, n);
    if (evLo > 0 && w.lo >= BAND.minHitLo) best = { from: b, n, hit: h / n, hitLo: w.lo, hitHi: w.hi, avgNext: mean, ev, evLo };
  }
  return best;
}
function bandStep(band, hist, fixAt, now) {
  const B = band && band.bins ? band : { bins: {}, lastT: 0, calls: { n: 0, hits: 0 } };
  B.calls = B.calls || { n: 0, hits: 0 };
  const F = 1.058, fx = (x) => (fixAt && x[0] < fixAt ? ((1 + x[1] / 100) / F - 1) * 100 : x[1]);
  const pts = (hist || []).filter((x) => x && isFinite(x[1]));
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[0] <= B.lastT || p[0] > now - BAND.aheadH * H) continue;
    const nx = pts.filter((q) => q[0] > p[0] && q[0] <= p[0] + BAND.aheadH * H);
    B.lastT = p[0];
    if (nx.length < 4) continue;
    const e = fx(p), avg = nx.reduce((a, q) => a + fx(q), 0) / nx.length, hit = avg >= 0;
    const T = bandThreshold(B); // o que a faixa dizia ANTES de ver o resultado (placar honesto)
    if (T && e >= T.from) { B.calls.n++; if (hit) B.calls.hits++; }
    for (const k of Object.keys(B.bins)) B.bins[k] = B.bins[k].map((v) => v * BAND.decay);
    const b = Math.max(BAND.lo, Math.min(BAND.hi, Math.floor(e))), x = B.bins[b] || (B.bins[b] = [0, 0, 0, 0]);
    x[0] += 1; x[1] += hit ? 1 : 0; x[2] += avg; x[3] = (x[3] !== undefined ? x[3] : x[2] * x[2] / x[0]) + avg * avg;
  }
  B.at = now;
  return B;
}

export function brainStep(prev, snap) {
  const ai = migrate(prev && prev.since ? JSON.parse(JSON.stringify(prev)) : { since: snap.now, xp: 0, open: [], done: [], stats: {}, last: {}, v: 2 });
  ai.unscored = ai.unscored || {}; ai.ctrl = ai.ctrl || { open: [], stats: {}, last: {} };
  const events = [], now = snap.now;
  if (snap.hist) ai.band = bandStep(ai.band, snap.hist, snap.fixAt, now);
  // 1) conferir previsões abertas
  const still = [];
  for (const o of ai.open) {
    track(o, snap, now);
    if (now < o.due) { still.push(o); continue; }
    const c = check(o, snap, now);
    if (c.wait) { still.push(o); continue; }
    const hit = c.hit === undefined ? null : c.hit, value = c.value === undefined ? null : c.value;
    const r = Object.assign({}, o, { hit, value, resolvedAt: now });
    delete r.pos;
    if (hit !== null) r.check = ({ mine_buy: `margem 1 h depois: ${f(value, 1)}%`, mine_wait: `${hit ? 'o robô compraria' : 'o robô não compraria'} no período; maior margem ${f(value, 1)}% (precisava ${o.minEdge}%)`,
      mine_avoid: `${hit ? 'o robô não compraria' : 'o robô compraria'} no período; maior margem ${f(value, 1)}% (mínimo ${o.minEdge}%)`, mine_close: `dificuldade variou ${f(value, 2)}%`,
      btc_retarget: `DARR depois: ${f(value, 3)} (previsto ${f(o.pred, 3)}${isFinite(o.naive) ? '; sem a previsão, ficaria em ' + f(o.naive, 3) + (c.beat ? ': a previsão chegou mais perto' : ': a previsão não ajudou') : ''})`,
      algo_go: `margem 6 h depois: ${f(value, 1)}%`, algo_go1: `margem 1 h depois: ${f(value, 1)}%`, fund_spike: `diferença 24 h depois: ${f(value, 0)}% a.a. (era ${f(o.s0, 0)}%)`, fund_go: `resultado em 3 dias, já com as taxas: US$${f(value, 2)}` })[o.type] || '';
    if (hit !== null) {
      const s = ai.stats[o.type] || (ai.stats[o.type] = { n: 0, hits: 0, xp: 0 });
      s.n++; if (hit) s.hits++;
      s.b = (s.b || 0) + Math.pow((isFinite(o.conf) ? o.conf : 0.5) - (hit ? 1 : 0), 2); // calibração (Brier): 0 = perfeita, 0,25 = chute
      if (c.beat !== undefined && c.beat !== null) { s.bn = (s.bn || 0) + 1; if (c.beat) s.beat = (s.beat || 0) + 1; }
      r.xp = xpOf(o.type, hit, o.trusted); r.hard = !!TYPES[o.type].hard;
      s.xp = (s.xp || 0) + r.xp; ai.xp += r.xp;
      events.push(`IA ${hit ? 'acertou' : 'errou'}${r.hard ? '' : ' (fácil)'}: ${o.text} (+${r.xp} XP)`);
    } else ai.unscored[o.type] = (ai.unscored[o.type] || 0) + 1; // sem dado para conferir: fica de fora (contado)
    ai.done.push(r);
  }
  ai.open = still; ai.done = ai.done.slice(-200);

  // 1b) grupo de controle: mesma pergunta sem sinal, em horário fixo
  const cs = [];
  for (const o of ai.ctrl.open) {
    track(o, snap, now);
    if (now < o.due) { cs.push(o); continue; }
    const c = check(o, snap, now);
    if (c.hit === undefined) continue;
    const st = ai.ctrl.stats[o.type] || (ai.ctrl.stats[o.type] = { n: 0, hits: 0 });
    st.n++; if (c.hit) st.hits++;
  }
  ai.ctrl.open = cs;
  const ctl = (type, extra) => {
    if (ai.ctrl.last[type] && now - ai.ctrl.last[type] < CTRL[type] * H) return;
    ai.ctrl.last[type] = now;
    ai.ctrl.open.push(Object.assign({ type, t: now, due: now + TYPES[type].h * H }, extra));
  };
  if (!snap.green && isFinite(snap.edge)) ctl('mine_wait', { minEdge: snap.minEdge, maxEdge: snap.edge, sawGreen: false });
  if (snap.D) ctl('mine_close', { D0: snap.D });

  // 2) novas previsões a partir dos sinais de agora
  const add = (type, key, text, extra) => {
    const k = type + '|' + key;
    if (ai.last[k] && now - ai.last[k] < TYPES[type].cool * H) return;
    if (ai.open.some((o) => o.type === type && o.key === key)) return;
    const rel = reliability(ai, type);
    ai.last[k] = now;
    text = plain(text); if (extra && extra.why) extra.why = plain(extra.why);
    ai.open.push(Object.assign({ type, key, text, t: now, due: now + (TYPES[type].h || 24) * H, conf: +rel.conf.toFixed(2), trusted: rel.trusted }, extra));
    events.push(`IA prevê: ${text}`);
  };
  const e = snap.edge, mom = snap.mom ? snap.mom.vsEmaPct : 0;
  if (snap.green) add('mine_buy', 'bch', `comprar hash para o BCH agora (margem ${f(e, 1)}%) continua no positivo daqui a 1 h`, { why: `margem ${f(e, 1)}% ≥ seu mínimo ${snap.minEdge}%; DARR ${isFinite(snap.darr) ? f(snap.darr, 3) : '—'}. Margens assim raramente viram negativas em 1 h.` });
  else if (isFinite(e) && (snap.darr >= 1 || mom >= 2) && e > snap.minEdge - 3) add('mine_wait', 'bch', `a margem do BCH passa de ${snap.minEdge}% em até 6 h (agora ${f(e, 1)}%, DARR ${f((snap.darr || 0), 3)})`, { minEdge: snap.minEdge, maxEdge: e, sawGreen: false,
    why: `${snap.darr >= 1 ? 'DARR ' + f(snap.darr, 3) + ' ≥ 1 (BCH paga mais que o BTC)' : ''}${snap.darr >= 1 && mom >= 2 ? ' e ' : ''}${mom >= 2 ? 'BCH ' + f(mom, 1) + '% acima da média de 2 dias (preço antes da dificuldade)' : ''}; margem a menos de 3 pontos do mínimo.` });
  if (isFinite(snap.darr) && snap.darr < 0.97 && mom <= 0 && !snap.green) add('mine_avoid', 'bch', `alugar para o BCH não compensa nas próximas 12 h (DARR ${f(snap.darr, 3)})`, { minEdge: snap.minEdge, maxEdge: e, sawGreen: false, why: `DARR ${f(snap.darr, 3)} abaixo de 0,97 e o BCH não está subindo contra o BTC: sem motor para a margem melhorar logo.` });
  const w = snap.win;
  if (w && snap.D && (w.last6h >= 42 || (w.bigShare6h !== null && w.bigShare24h !== null && w.bigShare6h - w.bigShare24h >= 0.1 && w.last6h >= 30)))
    add('mine_close', 'bch', `a dificuldade do BCH sobe mais de 0,5% em 3 h (${w.last6h} blocos em 6 h; pools grandes chegando)`, { D0: snap.D, why: `${w.last6h} blocos em 6 h (esperado 36) e pools grandes ${w.bigShare6h !== null ? f(w.bigShare6h * 100, 0) + '%' : '—'} (24 h: ${w.bigShare24h !== null ? f(w.bigShare24h * 100, 0) + '%' : '—'}): hash chegando faz o ASERT subir a dificuldade.` });
  const R = snap.ret;
  if (R && R.at && R.remainingBlocks <= 288 && isFinite(R.darrAfter))
    add('btc_retarget', String(Math.round(R.at / 864e5)), `depois do reajuste do BTC (${pctTxt(R.changePct)}), o DARR fica em ~${f(R.darrAfter, 3)} (±3%)`, { pred: R.darrAfter, naive: snap.darr, rem0: R.remainingBlocks, due: R.at + 2 * H, why: `reajuste do BTC em ${R.remainingBlocks} blocos, estimativa ${pctTxt(R.changePct)}: o BTC passa a pagar ${pctTxt(-R.changePct)} por hash, então o DARR muda na mesma proporção.` });
  for (const fo of (snap.fund || []).slice(0, 3)) {
    const [c, sv, lv] = fo.key.split('|'), cr = (snap.rows || {})[c] || {};
    const pos = cr[sv] && cr[lv] ? Object.assign({ coin: c, s: sv, l: lv, notional: FUND_RULES.capital / 2 * FUND_RULES.lev, fundingUsd: 0, payments: 0 }, { legs: newLegs(cr[sv], cr[lv], sv, lv) }) : null;
    add('fund_go', fo.key, `${fo.coin} (${fo.key.split('|').slice(1).join(' × ')}) paga as taxas em 3 dias`, { pos, why: 'diferença acima do empate (ordem limite) nas últimas 24 h e a meia-vida indica que paga as taxas. Reteste de 90 dias (03/08 a 01/11): 27% de acerto e média negativa (−US$0,34 por operação); a IA confere se agora é diferente.' });
  }
  const spikes = [];
  for (const [c, r] of Object.entries(snap.rows || {})) {
    const v = Object.entries(r).filter(([, x]) => isFinite(x.apr)).sort((a, b) => b[1].apr - a[1].apr);
    if (v.length < 2) continue;
    const key = c + '|' + v[0][0] + '|' + v[v.length - 1][0], sp = v[0][1].apr - v[v.length - 1][1].apr;
    if (sp >= 60 && !(snap.stable24 || {})[key]) spikes.push([key, sp]);
  }
  for (const [key, sp] of spikes.sort((a, b) => b[1] - a[1]).slice(0, 2)) add('fund_spike', key, `o pico de ${key.split('|')[0]} (${f(sp, 0)}% a.a. entre ${key.split('|').slice(1).join(' e ')}) cai pela metade em 24 h`, { s0: sp, why: `${f(sp, 0)}% a.a. é pico (≥ 60%) e não ficou 24 h estável; no histórico, diferenças assim voltam em ~18 h.` });
  for (const a of (snap.algos || []).filter((x) => x.level === 'go' && isFinite(x.edge) && x.edge <= 100)) add('algo_go1', a.k, `${a.label} segue com margem positiva daqui a 1 h (agora ${f(a.edge, 1)}%)`, { why: `margem ${f(a.edge, 1)}% = receita por hash ÷ aluguel típico − 1, já com taxas; livro com ordens suficientes.` });
  for (const k of Object.keys(ai.last)) if (now - ai.last[k] > 30 * 24 * H) delete ai.last[k];
  return { ai, events };
}
function pctTxt(x) { return (x >= 0 ? '+' : '') + f(x, 1) + '%'; }
function f(x, d) { return Number(x).toFixed(d).replace('.', ','); } // número em pt-BR

// Análise em texto: o que está acontecendo agora e o que fazer, juntando tudo.
export function analysis(snap, ai) {
  const L = levelOf(ai), out = [], recs = [];
  const e = snap.edge, d = snap.darr;
  if (isFinite(e)) {
    const W = snap.mm && (snap.mm.d7 || snap.mm.h24), lab = W ? (W.label || '7 dias') : '';
    const T = bandThreshold(ai && ai.band), C = ai && ai.band && ai.band.calls;
    const lim = snap.limits || {};
    // motivo claro (pausado ou comprando), com a média do mercado
    out.push(snap.green
      ? `Mineração BCH: comprando. A margem agora é ${sgn(e)}, maior que o seu mínimo de ${snap.minEdge}%${d ? `; DARR ${f(d, 3)}` : ''}.`
      : `Mineração BCH: pausado. Motivo: a margem agora é ${sgn(e)}, menor que o seu mínimo de ${snap.minEdge}%${d ? `; DARR ${f(d, 3)}` : ''}.`);
    if (W) out.push(`Mercado (${lab}): a margem média foi ${sgn(W.avg)}. Ficou positiva em ${f(W.pctPos, 0)}% do tempo e maior que ${snap.minEdge}% em ${f(W.pctMin, 1)}% do tempo (cerca de ${f(W.hoursMin, 1)} h). A margem de agora é melhor que ${f(W.rankNow || 0, 0)}% das leituras do período.`);
    // o que a IA aprendeu e onde operar (a regra é sua: a IA só sugere)
    if (T) {
      const hrs = (snap.mm && snap.mm.bestHours || []).map((x) => String(x.h).padStart(2, '0') + 'h').join(', ');
      const sug = T.from > snap.minEdge ? `Aumente a margem mínima para ${T.from}%: abaixo disso o mercado devolveu prejuízo na maior parte das vezes.`
        : T.from < snap.minEdge ? `Se quiser operar mais vezes, ajuste a margem mínima para ${T.from}%: a partir dela a média das 2 horas seguintes foi positiva. Com ${snap.minEdge}% você opera menos, com folga maior.`
        : `Mantenha a margem mínima em ${snap.minEdge}%: é exatamente onde a chance passa a ser maior.`;
      out.push(`O que a IA aprendeu (${f(T.n, 0)} leituras): quando a margem estava a partir de ${T.from}%, as 2 horas seguintes tiveram média positiva em ${f(T.hit * 100, 0)}% das vezes (margem de erro: entre ${f(T.hitLo * 100, 0)}% e ${f(T.hitHi * 100, 0)}%). Lucro esperado, já com o custo de execução: US$${f(T.ev, 2)} a cada US$100 gastos (no pior caso do intervalo, US$${f(T.evLo, 2)}). ${sug}${hrs ? ` Horários com mais chance: ${hrs} (Brasília).` : ''} ${e >= T.from ? 'Agora está dentro dessa faixa.' : `Agora está fora: faltam ${f(T.from - e, 1)} pontos.`}`);
    } else if (ai && ai.band) out.push(`A IA ainda não achou uma faixa de margem em que o lucro esperado das 2 horas seguintes fique positivo com segurança (já descontado o custo de execução e a margem de erro; precisa de pelo menos ${BAND.minN} casos). Enquanto isso, a sugestão é manter o robô pausado e acompanhar.`);
    if (C && C.n >= 5) { const w = wilson(C.hits, C.n); out.push(`Placar da faixa aprendida: nas ${C.n} vezes em que ela disse "faixa boa", acertou ${C.hits} (${f(C.hits / C.n * 100, 0)}%; margem de erro entre ${f(w.lo * 100, 0)}% e ${f(w.hi * 100, 0)}%). Quando erra, a faixa sobe sozinha; quando acerta, ela se mantém.`); }
    if (lim.stopUsd || lim.dailyUsd) out.push(`Limites que a IA respeita (definidos por você): stop-loss de US$${f(lim.stopUsd || 0, 0)} por tentativa, espera de ${f(lim.coolH || 0, 0)} h depois dele e limite diário de US$${f(lim.dailyUsd || 0, 0)}${lim.weekUsd ? `; perda máxima de US$${f(lim.weekUsd, 0)} em 7 dias` : ''}.`);
    if (snap.green) recs.push({ area: 'mineracao', text: 'Janela aberta: com o robô em Ativo, ele compraria agora e pararia no bloco.', type: 'mine_buy' });
  }
  if (snap.mom && snap.mom.vsEmaPct >= 2) out.push(`BCH subiu ${f(snap.mom.vsEmaPct, 1)}% acima da média de 2 dias contra o BTC: a dificuldade ainda não reagiu, o que costuma melhorar a margem nas próximas horas.`);
  if (snap.ret && isFinite(snap.ret.darrAfter)) out.push(`Reajuste do BTC em ${snap.ret.remainingBlocks} blocos (${pctTxt(snap.ret.changePct)}): o DARR deve ir para ~${f(snap.ret.darrAfter, 3)}.`);
  if (snap.win && snap.win.last6h >= 42) out.push(`Hash grande chegando ao BCH (${snap.win.last6h} blocos em 6 h): a janela tende a fechar em horas.`);
  const nf = (snap.fund || []).length;
  out.push(nf ? `Funding: ${nf} oportunidade${nf > 1 ? 's' : ''} passa${nf > 1 ? 'm' : ''} na regra validada (24 h estável, ordem limite).` : 'Funding: nenhuma oportunidade passa na regra validada agora (24 h estável + ordem limite + meia-vida).');
  for (const fo of (snap.fund || []).slice(0, 2)) recs.push({ area: 'funding', text: `${fo.coin}: short ${fo.key.split('|')[1]}, long ${fo.key.split('|')[2]} com ordem limite (~US$${f((fo.netUsd || 0), 2)} projetado em 3 dias).`, type: 'fund_go' });
  const ag = (snap.algos || []).filter((x) => x.level === 'go' && isFinite(x.edge) && x.edge <= 100);
  if (ag.length) { out.push(`Outras moedas: ${ag.map((a) => a.label + ' ' + f(a.edge, 1) + '%').join(', ')} compensam em pool PPS (ordem manual).`); for (const a of ag.slice(0, 2)) recs.push({ area: 'outras', text: `${a.label}: ordem manual na NiceHash para pool PPS enquanto a margem ficar positiva.`, type: 'algo_go1' }); }
  for (let i = 0; i < out.length; i++) out[i] = plain(out[i]);
  for (const r of recs) { r.text = plain(r.text); const rel = reliability(ai, r.type); r.conf = rel.conf; r.trusted = rel.trusted; r.n = rel.n; r.hard = !!TYPES[r.type].hard; r.rate = rel.n ? (ai.stats[r.type].hits / rel.n) : null; }
  // Autocrítica: tipo de previsão com 8+ conferidas e acerto abaixo de 40% não vira recomendação; fica marcado com o placar.
  for (const r of recs) if (r.n >= 8 && r.rate !== null && r.rate < 0.4) { r.blocked = true; r.text = plain(`Não recomendado pelo histórico (acertou ${Math.round(r.rate * 100)}% em ${r.n}): `) + r.text; }
  const weak = Object.keys((ai && ai.stats) || {}).filter((k) => TYPES[k] && ai.stats[k].n >= 8 && ai.stats[k].hits / ai.stats[k].n < 0.4);
  if (weak.length) out.push(plain(`Onde a IA ainda erra (não use como sinal): ${weak.map((k) => `${TYPES[k].label} (${ai.stats[k].hits} de ${ai.stats[k].n})`).join('; ')}.`));
  return { level: L, lines: out, recs };
}

// Potência ideal (IA): lucro esperado por dia em cada potência. Comprar mais pode exigir lance mais alto (profundidade do
// livro: o lance precisa passar das ordens que já recebem). Mostra também a sorte (desvio de 1 dia: blocos ~ Poisson) e o
// capital mínimo pelo critério de Kelly: com margem m e bloco de valor V, apostar em solo só faz o capital crescer no
// longo prazo se o capital for maior que V ÷ (2m); abaixo disso a sorte quebra antes de a média aparecer.
export const POWER_STEPS = [1, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500];
export function powerPlan(mkt, cfg, limits) {
  if (!(mkt && mkt.ok && mkt.phDaysPerBlock > 0 && mkt.btcUsd > 0 && mkt.blockNetUsd > 0 && mkt.breakEvenEH > 0 && mkt.fillEH > 0)) return null;
  const prem = 1 + (cfg.bidPremiumPct || 0) / 100, fee = 1 + (cfg.rentFeePct || 0) / 100, V = mkt.blockNetUsd;
  const depth = Array.isArray(mkt.depth) && mkt.depth.length ? mkt.depth : [[mkt.fillEH, Infinity]];
  const ceil4 = (x) => Math.ceil(x * 1e4 - 1e-9) / 1e4;
  const curve = POWER_STEPS.map((ph) => {
    const lv = depth.find((d) => d[1] >= ph);
    if (!lv) return null; // o livro inteiro não tem esse tamanho
    const bid = ceil4(lv[0] * prem), cost = ph / 1000 * bid * mkt.btcUsd * fee, blocks = ph / mkt.phDaysPerBlock;
    return { ph, bidEH: bid, edgePct: (blocks * V / cost - 1) * 100, costDay: cost, profitDay: blocks * V - cost, blocksDay: blocks,
      luckDay: Math.sqrt(blocks) * V, chanceDay: 1 - Math.exp(-blocks), overCap: ph > limits.maxLimitPh };
  }).filter(Boolean);
  const inCap = curve.filter((r) => !r.overCap), best = inCap.reduce((a, r) => (r.profitDay > a.profitDay ? r : a), { ph: 0, profitDay: 0 });
  const edge = best.ph ? best.edgePct / 100 : (curve[0] ? curve[0].edgePct / 100 : 0);
  return { curve, idealPh: best.profitDay > 0 ? best.ph : 0, idealProfitDay: best.profitDay > 0 ? best.profitDay : 0, edgePct: edge * 100,
    bankrollMinUsd: edge > 0 ? V / (2 * edge) : null, blockUsd: V, capPh: limits.maxLimitPh };
}

// Plano de ação do copiloto: o que fazer agora, com números (potência, preço, orçamento, duração, quando parar)
// e as travas que impedem de operar. ctx: { cfg, limits, mkt, acct:{balanceBtc,pools}, fund:[...], algoMap:[...], capital, pools:{algo:[[nome,url]]} }
export function actionPlan(ctx) {
  const { cfg, limits, mkt, acct } = ctx, out = { mining: null, funding: null, others: [], blockers: [] };
  const n = (x, d) => Number(x).toFixed(d).replace('.', ',');
  // --- mineração BCH (solo) ---
  if (mkt && mkt.ok) {
    const budget = cfg.sessionBudgetUsd > 0 ? cfg.sessionBudgetUsd : 300;
    const perPhDay = mkt.bidEH / 1000 * mkt.btcUsd * (1 + cfg.rentFeePct / 100); // US$ por PH/s por dia no lance
    const hours = 2; // janelas costumam durar ~2 h (pesquisa): gastar o orçamento da sessão nesse tempo
    const book = mkt.bookTotalPH || 0;
    const rawPh = Math.floor(budget / (perPhDay * hours / 24)), liq = book ? Math.floor(book * 0.05) : Infinity;
    const power = powerPlan(mkt, cfg, limits);
    let ph = Math.max(1, Math.min(rawPh, limits.maxLimitPh, liq)); // até o teto do servidor e 5% do hash alugado no mercado
    if (power && power.idealPh > 0) ph = Math.max(1, Math.min(ph, power.idealPh)); // nunca acima da potência que mais lucra
    const capBy = ph < rawPh ? (ph === limits.maxLimitPh ? `teto de segurança do servidor (${limits.maxLimitPh} PH/s)` : 'liquidez: 5% do hash alugado no mercado') : null;
    // comparação: o que cada potência faz numa janela típica de ~2 h (mesma média por dólar; muda chance e gasto)
    const alt = [10, 30, ph].filter((x, i, a) => a.indexOf(x) === i).map((x) => { const c = x * perPhDay / 24 * hours, l = x / mkt.phDaysPerBlock * hours / 24; return { ph: x, costUsd: c, chance: 1 - Math.exp(-l) }; });
    const costH = ph * perPhDay / 24, dur = Math.min(24, budget / costH);
    const lam = ph / mkt.phDaysPerBlock * dur / 24, chance = 1 - Math.exp(-lam);
    const amountBtc = Math.max(0.001, Math.min(limits.maxOrderBtc, budget / mkt.btcUsd));
    const green = mkt.green;
    // a sua configuração (o que o robô vai executar) com os mesmos números, para comparar com a sugestão
    const myPh = Math.max(1, Math.min(cfg.targetPh || 1, limits.maxLimitPh)), myCostH = myPh * perPhDay / 24;
    const mine = { ph: myPh, budgetUsd: budget, costPerHourUsd: myCostH, durationH: Math.min(999, budget / myCostH),
      chance2h: 1 - Math.exp(-myPh / mkt.phDaysPerBlock * hours / 24), cost2h: myCostH * hours };
    out.mining = {
      action: green ? 'alugar' : 'esperar', edge: mkt.edgeAtBidPct, price: mkt.bidEH, maxPrice: mkt.capEH, ph, budgetUsd: budget, durationH: dur,
      amountBtc: +amountBtc.toFixed(4), chance, expBlocks: lam, costPerHourUsd: costH, blockUsd: mkt.blockNetUsd, alt, mine, power,
      chance2h: 1 - Math.exp(-ph / mkt.phDaysPerBlock * hours / 24), cost2h: costH * hours,
      why: [`Orçamento por tentativa: US$${n(budget, 0)} (o seu stop-loss). Soma todas as ordens até achar bloco; ao estourar, o robô cancela e espera ${cfg.stopCooldownH === undefined ? 6 : cfg.stopCooldownH} h. É o máximo que você perde numa tentativa sem bloco (o limite diário segura o dia).`,
        `As janelas boas duram ~2 h (pesquisa de 6 meses). A potência é a que gasta esse orçamento dentro de uma janela: US$${n(budget, 0)} ÷ (US$${n(perPhDay / 24, 2)} por PH/s por hora × 2 h) = ${rawPh} PH/s.`,
        capBy ? `Limitado a ${ph} PH/s pelo ${capBy}.` : `Cabe no teto de segurança (${limits.maxLimitPh} PH/s) e na liquidez do mercado.`,
        'Por dólar gasto, a média é a mesma com qualquer potência. Mais potência = mais chance enquanto a janela está aberta (e o orçamento acaba mais rápido); menos potência = a janela fecha antes de você usar o orçamento.',
        power ? (power.idealPh > 0
          ? `Potência ideal (IA): ${power.idealPh} PH/s, lucro esperado ~US$${n(power.idealProfitDay, 0)}/dia com margem real de ${n(power.edgePct, 1)}% (lance pela profundidade do livro). A sorte de 1 dia oscila ~±US$${n((power.curve.find((r) => r.ph === power.idealPh) || {}).luckDay || 0, 0)}. Capital mínimo para essa margem aguentar a sorte (critério de Kelly): ~US$${n(power.bankrollMinUsd, 0)}.`
          : `Potência ideal (IA): 0 PH/s agora. Em nenhuma potência o lucro esperado é positivo: margem real de ${n(power.edgePct, 1)}% no preço que de fato recebe hash (${n((power.curve[0] || {}).bidEH || 0, 4)}).`) : 'Sem o livro da NiceHash não dá para calcular a potência ideal.'],
      title: green ? `Alugar agora: ${ph} PH/s a até ${n(mkt.capEH, 4)}` : `Esperar: o aluguel está acima do preço que compensa`,
      text: green
        ? `Margem de ${n(mkt.edgeAtBidPct, 1)}% no lance. Com ${ph} PH/s (~US$${n(costH, 0)}/h), o orçamento de US$${n(budget, 0)} dura ~${n(dur, 1)} h e dá ${n(chance * 100, 0)}% de chance de achar um bloco (~US$${n(mkt.blockNetUsd, 0)}). Parar no bloco; stop-loss em US$${n(budget, 0)}.`
        : `O robô compra sozinho quando o lance ficar em ${n(mkt.capEH, 4)} ou menos (hoje ${n(mkt.bidEH, 4)}, margem ${n(mkt.edgeAtBidPct, 1)}%). Deixe o plano pronto: ${ph} PH/s, orçamento de US$${n(budget, 0)} por sessão, parar no bloco.`,
      apply: { targetPh: ph, sessionBudgetUsd: budget, orderAmountBtc: +amountBtc.toFixed(4), onBlock: 'cancel', autoCreate: true }
    };
    // travas da mineração, com o que fazer
    if (!cfg.payoutAddress) out.blockers.push({ id: 'address', text: 'Falta o seu endereço BCH (onde cai a recompensa).', fix: 'Mineração → Operar → Endereço BCH.' });
    const sha = (acct && acct.pools || []).filter((p) => !p.algorithm || /SHA256/.test(p.algorithm));
    if (!cfg.poolId) out.blockers.push({ id: 'pool', text: 'Nenhum pool escolhido para as ordens do robô.', fix: sha.length ? `Usar "${sha[0].name}"` : 'Cadastre o pool BlockSniper em Operar.', poolId: sha.length ? sha[0].id : null });
    if (acct && isFinite(acct.balanceBtc) && acct.balanceBtc < amountBtc) out.blockers.push({ id: 'balance', text: `Saldo na NiceHash: ${n(acct.balanceBtc, 6)} BTC; o plano precisa de ${n(amountBtc, 4)} BTC (~US$${n(amountBtc * mkt.btcUsd, 0)}).`, fix: 'Depositar BTC na carteira da NiceHash (Carteira → Depositar → BTC).' });
    if (!cfg.autoCreate) out.blockers.push({ id: 'auto', text: 'O robô não cria ordem sozinho: ele só mexe em ordens que você abrir.', fix: 'Aplicar o plano (liga "criar ordem sozinho").' });
    if (cfg.mode !== 'active') out.blockers.push({ id: 'mode', text: cfg.mode === 'observe' ? 'O robô está em Observar: só simula.' : 'O robô está desligado.', fix: 'Ativar depois de resolver as travas acima.' });
  }
  // --- funding ---
  const f = (ctx.fund || [])[0];
  const leg = (ctx.capital || 1000) / 2 * 2;
  out.funding = f
    ? { action: 'entrar', title: `Abrir ${f.coin}: short ${f.s}, long ${f.l}`, text: `US$${n(leg, 0)} por perna (2x, US$${n(ctx.capital || 1000, 0)} de capital), ordem limite nas duas; esperado ~US$${n(f.netUsd || 0, 2)} em 3 dias. Sair quando a diferença ficar ≤ 0 (o painel avisa). Funding é manual: abra nas exchanges e registre no Diário.`,
        why: ['A diferença ficou acima do empate (com ordem limite) nas últimas 24 h seguidas.', 'A meia-vida da diferença indica que ela dura o bastante para pagar as 4 execuções.',
          'Regra validada em 90 dias de dados: 39% de acerto e média de +US$0,11 por operação. É margem pequena: tamanho moderado.', 'Ordem limite porque a taxa a mercado (taker) come quase todo o ganho.'] }
    : { action: 'esperar', title: 'Funding: nenhuma entrada agora', text: 'Nenhuma diferença passou na regra validada (24 h acima do empate, ordem limite, meia-vida que paga as taxas). Não force: nos últimos 90 dias, fora dessa regra, a média foi prejuízo.',
        why: ['Picos de diferença costumam voltar em ~18 h: a entrada (4 execuções) não se paga.', 'Com ordem a mercado, entrar quando a diferença passa do empate perdeu US$1,40 por operação em 90 dias.', 'O servidor só considera estável depois de 24 h de histórico próprio do par.'] };
  // --- outras moedas (pool PPS: resultado sem sorte) ---
  for (const a of (ctx.algoMap || []).filter((x) => x.level === 'go' && x.edgePct > 0 && x.edgePct <= 100).slice(0, 3)) {
    const pools = (ctx.pools || {})[a.algo] || [];
    out.others.push({ algo: a.algo, title: `${a.label} (${(a.coins || []).join('+')}): margem ${n(a.edgePct, 1)}%`,
      text: `Ordem manual na NiceHash (${a.algo}) apontada para um pool PPS${pools.length ? ' como ' + pools.slice(0, 2).map((p) => p[0]).join(' ou ') : ''}; preço até ${a.capBtcPerUnit ? n(a.capBtcPerUnit, 6) + ' BTC/' + (a.unit || 'unid.') + '/dia' : 'o máximo do mapa'}; orçamento sugerido US$100/dia; parar se a margem ficar abaixo de 0.`,
      why: [`Margem ${n(a.edgePct, 1)}% = quanto o hash rende nessa moeda ÷ aluguel típico na NiceHash − 1, já com 3% da NiceHash, pool PPS 4%, shares perdidos e venda das moedas (2,5%) e a dificuldade média de 24 h.`, 'Pool PPS paga por share: sem sorte de bloco, o resultado diário é o esperado.', 'O livro tem ordens suficientes recebendo hash (preço confiável).', 'Ordem manual: o robô automático hoje só opera o BCH.'] });
  }
  return out;
}

// Plano para o saldo: o que fazer com o saldo que está na NiceHash numa janela de horas (ex.: a madrugada), do jeito
// mais eficiente para o cenário. A chance de achar bloco depende só de quanto se gasta (não da potência nem do tempo):
// 1 − e^(−gasto ÷ custo por bloco). O que dá para otimizar é QUANDO se gasta (nos melhores momentos do dia, com a
// regra relativa) e o custo das pausas. Taxas da NiceHash: 3% sobre o gasto e 0,00001 BTC por ordem nova.
export const NH_ORDER_FEE_BTC = 0.00001;
export function balancePlan({ balanceBtc, mkt, mm, cfg, units, limits, hours = 8, relPct = 75, floor = -2 }) {
  if (!(mkt && mkt.ok) || !isFinite(balanceBtc)) return null;
  const minOrder = (units && units.minOrderBtc) || 0.001, usable = balanceBtc - NH_ORDER_FEE_BTC;
  if (usable < minOrder) return { ok: false, balanceBtc, need: minOrder + NH_ORDER_FEE_BTC, why: `O saldo (${f(balanceBtc, 6)} BTC) é menor que o mínimo de uma ordem na NiceHash (${f(minOrder, 3)} BTC mais ${f(NH_ORDER_FEE_BTC, 5)} de taxa).` };
  const amount = Math.floor(Math.min(usable, limits.maxOrderBtc) * 1e6) / 1e6, budget = amount * mkt.btcUsd;
  const H = mm && (mm.h24 || mm.d7), thr = H && isFinite(H.top25) ? Math.round(Math.max(floor, H.top25) * 10) / 10 : floor;
  const buyFrac = (100 - relPct) / 100, buyH = Math.max(0.5, hours * buyFrac);
  const perPhH = mkt.bidEH / 1000 * mkt.btcUsd * (1 + (cfg.rentFeePct || 3) / 100) / 24;  // US$ por PH/s por hora
  const minPh = Math.max(cfg.minPh || 0, (units && units.minLimitPH) || 1), pauseUsd = minPh * perPhH * Math.max(0, hours - buyH);
  const ph = Math.max(minPh, Math.min(limits.maxLimitPh, Math.floor(Math.max(0, budget - pauseUsd) / (buyH * perPhH) / 5) * 5 || minPh));
  const chance = 1 - Math.exp(-budget / mkt.costPerBlockUsd), expMargin = Math.min(thr, 0);
  return { ok: true, at: Date.now(), hours, amountBtc: amount, budgetUsd: budget, feeUsd: NH_ORDER_FEE_BTC * mkt.btcUsd, threshold: thr, relPct, floor, ph, buyH, pauseUsd,
    chance, blockUsd: mkt.blockNetUsd, expLossUsd: budget * -expMargin / 100 + NH_ORDER_FEE_BTC * mkt.btcUsd, perPhH,
    config: { mode: 'active', minEdgeMode: 'relativo', relPct, relFloorPct: floor, targetPh: ph, minPh: 0, sessionBudgetUsd: Math.ceil(budget), dailyBudgetUsd: Math.ceil(budget) + 5,
      orderAmountBtc: amount, autoCreate: true, onBlock: 'cancel' } };
}
