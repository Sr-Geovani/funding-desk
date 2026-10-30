// Alertas do backend (rodam a cada ciclo, mesmo com o painel fechado) usando as mesmas regras do painel.
// Funding: previsto publicado pela Hyperliquid (Binance, Bybit e HL), que responde de qualquer região.
import FD from '../../core.js';
import FDR from '../../radar.js';
import FDC from '../../copilot.js';

export function fundingSnapshot(predicted, cfg, now) {
  const p = FD.parsePredicted(predicted), rows = {};
  for (const v of Object.keys(p)) for (const c of Object.keys(p[v])) (rows[c] = rows[c] || {})[v] = p[v][c];
  const hold = cfg.alertHold || 3;
  const params = { capital: cfg.alertCapital || 1000, lev: 2, hold, minVol: 0, minOi: 0, aprCap: 150, mode: 'pp', fees: FD.DEFAULT_FEES,
    execShort: 'taker', execLong: 'taker', slipPct: 0.03, rebalUsd: 1, sort: 'net', now };
  const best = FD.opportunities(rows, params).slice(0, 20).map((o) => {
    const v = FDC.fundingVerdict(o, { hold, aprCap: 150 });
    return { key: o.coin + '|' + o.s + '|' + o.l, coin: o.coin, title: 'short ' + o.s + ', long ' + o.l, level: v.level,
      netTxt: '~' + FDC.money(o.m.netUsd) + ' em ' + hold + ' dias com ' + FDC.money(o.m.notional, 0) + ' por perna' };
  }).filter((b) => b.level === 'go').slice(0, 5);
  return { best, sent: FDR.sentiment(rows, Object.keys(p)) };
}

// state: { alertPrev, alertMem, alerts }; devolve os alertas novos e o estado atualizado.
export function runAlerts({ state, funding, edges, now, minEdgePct }) {
  const snap = { best: funding ? funding.best : [], sent: funding ? funding.sent : null, edges: edges || {} };
  const r = FDR.evaluateAlerts({ snap, prev: state.alertPrev || {}, mem: state.alertMem || {}, now, minEdgePct });
  return {
    alerts: r.alerts,
    state: { alertPrev: snap, alertMem: r.mem, alerts: (state.alerts || []).concat(r.alerts).slice(-50) }
  };
}
