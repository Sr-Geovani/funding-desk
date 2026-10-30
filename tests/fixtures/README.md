# Fixtures

- `*.real.json`: respostas reais (Hyperliquid, Blockchair BCH, livro de ordens NiceHash SHA-256) (recortadas para poucas moedas), capturadas em 2026-10-30 12:00 UTC.
- `binance-*.synthetic.json` e `bybit-*.synthetic.json`: **sintéticos**, montados a partir do formato documentado das APIs.
  Binance e Bybit bloqueiam IPs dos EUA (HTTP 451 e 403), de onde os testes foram escritos. Substitua por respostas
  reais quando possível. Em 2026-10-30 o `diagnostico.html` rodado num iPhone no Brasil confirmou que todos os campos usados
  existem nas respostas reais (premiumIndex, ticker/24hr, fundingInfo com `fundingIntervalHours`, fundingRate; tickers,
  instruments-info com `fundingInterval` em uma página só, funding/history) e que o CORS libera o navegador.
