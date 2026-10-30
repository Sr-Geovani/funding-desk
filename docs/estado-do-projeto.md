# Estado do projeto (para continuar em outra conversa)

Atualizado em 30/10/2026. Em uma conversa nova, peça: "leia docs/estado-do-projeto.md e o README e continue".

## O que é
Funding Desk: painel web (PWA, HTML/JS sem build) em https://sr-geovani.github.io/funding-desk/ para operar
**arbitragem de funding** (manual) e **mineração com hash alugado** (manual + robô para BCH), com copiloto em PT-BR.
Dono: Geovani. Regras: sem chaves no front-end nem no repositório; textos em português; dado real vs projeção
sempre identificado; nada de prometer previsão de sorte (Poisson é sem memória).

## Arquitetura
| Arquivo | Papel |
|---|---|
| `core.js` | funding: parsers de 6 exchanges (Binance, Bybit, Hyperliquid, OKX, Bitget, Gate), `cycle()`, oportunidades, filtro só cripto, diário CSV/JSON |
| `mining.js` | mineração: Poisson, hashprice, aluguel, livro NiceHash, blocos BCH, diário de sessões |
| `copilot.js` | vereditos em linguagem simples, jornadas, momentos, glossário |
| `radar.js` | mapas de funding e mineração (9 algoritmos, WhatToMine), sentimento, alertas (agora/histórico), pools e players |
| `insights.js` | plano do ciclo, curto prazo, ficar/sair/trocar, backtest, meta, previsão de mineração, plano combinado |
| `app.js` / `index.html` | interface: Início, Radar, Funding, Mineração (Agora, Jornada, Planejar, Algoritmos, Operar, Rede), Diário, Ajustes |
| `worker/` | backend Cloudflare: API com token, chaves NiceHash como segredo, robô (cron 3 min), alertas + Telegram, proxy |
| `tests/` | `node --test tests/*.test.js tests/*.test.mjs` (91 testes; NiceHash falsa em `worker/dev/mock.mjs`) |
| `.github/workflows/` | `pages.yml` (testes + Pages + fotos de mercado), `worker.yml` (testes + deploy do backend + resumo) |

## Decisões importantes
- Funding: o painel **não executa** ordens; recomenda e registra. Regra de permanência: ficar enquanto o funding for
  positivo (entrada já paga), sair quando negativo; trocar só se o ganho extra cobrir a nova entrada e saída.
- Mineração: veredito = aluguel (mediana NiceHash + 3%) vs receita (após 2% do pool). Livro com < 5 ordens pagando
  = "raso" (no máximo "no limite"). Moedas com < 10 BTC/dia de volume ficam fora do mapa principal.
- Robô (backend): só SHA-256/BCH solo; modos off/observe/active; teto = empate − margem; encerra quando a coinbase
  paga o endereço; stop-loss, limite diário, emergência. Outros algoritmos: ordem manual (aba Algoritmos guia).
- Alertas: "Agora" = condições ativas (somem sozinhas); histórico 7 dias com começo/fim; Telegram: saída/risco na hora,
  entradas em resumo de 30 min.

## Estado e pendências
- [x] Painel publicado; dados ao vivo validados do Brasil (Binance/Bybit diretos no iPhone).
- [ ] **Backend no Cloudflare**: depende do dono (passos em Ajustes → Configurar o backend e `docs/configurar-backend.md`).
      Esta sessão não tem acesso ao Cloudflare nem permissão para criar segredos no GitHub.
- [ ] Validar robô em Observar (NiceHash de teste), depois `NH_ENV = "prod"`.
- [ ] Funding automático: exige servidor no Brasil (Binance/Bybit bloqueiam EUA), chaves de trade sem saque.
- [ ] Robô multi-algoritmo (pool PPS) para Scrypt/RandomX/Equihash etc.
- [ ] Mais exchanges: dYdX (CORS ok), MEXC e KuCoin (via backend).
