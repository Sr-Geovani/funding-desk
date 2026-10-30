# Fixtures

- `*.real.json`: respostas reais (Hyperliquid, Blockchair BCH, livro de ordens NiceHash SHA-256) (recortadas para poucas moedas), capturadas em 2026-10-30 12:00 UTC.
- `binance-*.synthetic.json` e `bybit-*.synthetic.json`: **sintéticos**, montados a partir do formato documentado das APIs.
  Binance e Bybit bloqueiam IPs dos EUA (HTTP 451 e 403), de onde os testes foram escritos. Substitua por respostas
  reais (rode `diagnostico.html` de um navegador no Brasil e salve os JSON) quando possível.
