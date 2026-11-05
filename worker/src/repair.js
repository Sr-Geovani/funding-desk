// Reparos únicos do estado gravado (cada um roda uma vez e fica marcado em state.repairs).
// 04/11 18:06: o livro da NiceHash veio com uma ordem a 0,001 BTC/EH/dia recebendo hash (~450× abaixo do mercado). A margem
// do BCH foi a 40.152% nessa leitura e contaminou: a margem média, as três simulações de BCH (2,7 min de aluguel quase de
// graça) e o valor gravado de uma previsão da IA. O reparo tira o ponto do histórico e refaz o gasto daquelas janelas pelo
// preço da leitura seguinte (0,4265). A previsão continua certa (a margem passou de −2% com −1,8% na mesma janela).
export function repairBookGlitch(state) {
  const s = state || {}, done = s.repairs || [];
  if (done.includes('book-0001')) return { state: s, notes: [] };
  const notes = [], H = (s.edgeHist || []);
  const bad = H.filter((x) => x && !(x[1] <= 100));
  if (bad.length) {
    s.edgeHist = H.filter((x) => x && x[1] <= 100);
    notes.push(`margem: ${bad.length} leitura(s) com defeito tiradas do histórico`);
    for (const b of bad) {
      const nxt = s.edgeHist.find((x) => x[0] > b[0] && x[2] > 0.01), prv = s.edgeHist.slice().reverse().find((x) => x[0] < b[0] && x[2] > 0.01);
      const price = (nxt || prv || [])[2];
      for (const k of ['paper', 'paperBurst', 'paperPlan', 'paperAlways', 'paperSniper']) {
        const P = s[k]; if (!P || !price) continue;
        for (const r of [].concat(P.runs || [], P.run ? [P.run] : [])) {
          if (!(r.priceEH > 0 && r.priceEH < price * 0.5) || Math.abs(r.start - b[0]) > 3600e3) continue;
          const fixed = r.spendUsd * price / r.priceEH, add = fixed - r.spendUsd, day = new Date(r.start).toISOString().slice(0, 10);
          r.spendUsd = fixed; r.priceEH = price; r.edgePct = null; r.repaired = 'preço com defeito no livro';
          P.spendUsd = (P.spendUsd || 0) + add;
          if (P.days && P.days[day]) P.days[day].spendUsd = (P.days[day].spendUsd || 0) + add;
          if (P.sess && P.sess.start <= r.start) P.sess.spendUsd = (P.sess.spendUsd || 0) + add;
          notes.push(`${k}: janela de ${new Date(r.start).toISOString().slice(11, 16)} UTC refeita (+US$${add.toFixed(2).replace('.', ',')} de aluguel)`);
        }
      }
    }
    for (const x of (s.ai && s.ai.done) || []) {
      if (!(x.maxEdge > 100 || x.value > 100)) continue;
      const w = s.edgeHist.filter((h) => h[0] >= x.t && h[0] <= (x.due || x.t)).map((h) => h[1]), mx = w.length ? Math.max(...w) : null;
      if (x.maxEdge > 100) x.maxEdge = mx;
      if (x.value > 100) x.value = mx;
      if (x.hit && x.minEdge !== undefined && !(mx !== null && mx >= x.minEdge)) { x.hit = false; x.repaired = true; const st = s.ai.stats && s.ai.stats[x.type]; if (st) st.hits = Math.max(0, st.hits - 1); }
      notes.push(`IA: previsão "${String(x.text || '').slice(0, 60)}" reconferida sem a leitura com defeito (${x.hit ? 'continua certa' : 'virou erro'})`);
    }
  }
  s.repairs = done.concat(['book-0001']);
  return { state: s, notes };
}
