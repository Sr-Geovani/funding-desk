# Referências globais: como as ferramentas do mercado fazem e o que aplicamos (04/11/2026)

Objetivo: operar como as mesas e ferramentas que funcionam, com lastro (histórico) antes de arriscar dinheiro.

## 1. Ferramentas de referência e o que copiamos delas
| Ferramenta | O que ela faz bem | No painel |
|---|---|---|
| Hashrate Index (Luxor) | Hashprice diário, curva a termo do hash; "compre hash quando ele está barato contra o custo" | **Aplicado:** preço do hash de hoje contra o último ano (histórico diário da NiceHash desde 2019), por algoritmo |
| WhatToMine / minerstat | Receita por hash de cada moeda | Já usado (com dificuldade média de 24 h, taxa do pool e perdas) |
| NiceHash (marketplace) | Preço do hash por algoritmo, ordem padrão × fixa | Já usado: livro ao vivo, ordem que fica aberta entre janelas |
| MiningRigRentals | Aluguel por máquina | **Aplicado:** comparação em todos os algoritmos (hoje mais cara que a NiceHash) |
| Hummingbot (robô aberto) | Estratégia de arbitragem de funding entre corretoras (desde 2024), market making entre corretoras | Mesma ideia do nosso funding; o histórico mostrou que em altcoin a taxa come o spread |
| Pendle Boros | Transforma o funding em contrato com taxa fixa (trava o funding de um lado por um prazo) | **Candidata:** permite travar o funding e eliminar o risco de o spread sumir; acompanhar |
| Freqtrade (backtest) | Teste sem olhar o futuro, teste fora da amostra, taxas reais, papel antes do real (30 operações ou 3 meses) | **Aplicado:** simulação "como real" com taxas, placar e regra de só confiar depois de amostra |
| DefiLlama | Rendimentos de empréstimo e staking | Já usado (Aave, Sky, Lido, Jito) ao lado do CDI |

## 2. Práticas que viraram regra no painel
1. **Lastro antes de dinheiro:** cada frente tem placar desde o início (real e simulado) e um veredito.
2. **Histórico de preço:** o aluguel só é "barato" se estiver abaixo da mediana do ano; o percentil aparece em cada oportunidade.
3. **Margem gravada hora a hora (60 dias):** quanto tempo cada algoritmo fica positivo, acima de +2% e em que horários (UTC).
4. **Custo fixo dividido pelo uso:** a taxa de ordem nova é paga uma vez e dividida pelas janelas que a ordem atende; só entra se a janela típica pagar a sua parte.
5. **Mercado pequeno não entra:** no máximo 10% do que o mercado do algoritmo gasta por dia.
6. **Sem olhar o futuro:** decisões usam só o dado do momento; os "melhores cenários" são marcados como retrovisor.
7. **Papel antes do real:** só considerar dinheiro real numa frente com pelo menos 30 operações simuladas positivas no acumulado.

## 3. Frentes: veredito com o que temos hoje
| Frente | Lastro | Veredito |
|---|---|---|
| BCH solo com hash alugado | real US$198, 0 blocos; margem de 7 dias média −3,9%, positiva 9% do tempo | Sem vantagem: só como bilhete |
| Sniper | simulado, valor esperado −3,9% | Loteria |
| Moedas PPS (aluguel + pool que paga por share) | simulação "como real" em 16 algoritmos, histórico de preço de 1 ano, margem hora a hora | Em teste: a única com janelas positivas |
| Funding de altcoins | 8 operações simuladas, 1 positiva; reteste de 90 dias com 27% de acerto | Descartado (só sinal) |
| Funding com taxa travada (Boros) | sem lastro ainda | Candidata |
| Rendimentos em dólar | até ~6–7% ao ano | Abaixo do CDI em reais (~13,65%) |

## Fontes
- Hashrate Index, curva a termo: https://hashrateindex.com/blog/does-the-hashrate-forward-curve-predict-future-hashprice/
- Hashrate Index, hashprice: https://hashrateindex.com/blog/hashprice-at-all-time-lows-how-can-miners-use-the-forward-curve/
- Hashprice Index: https://data.hashrateindex.com/chart/bitcoin-hashprice-index
- Hummingbot 1.27 (arbitragem de funding): https://hummingbot.org/release-notes/1.27.0
- Hummingbot × outros robôs de funding: https://hackernoon.com/hummingbot-vs-godzilladev-an-honest-comparison-for-funding-rate-arbitrage-and-market-making-2026
- Pendle Boros: https://pendle.gitbook.io/boros/the-basics/chapter-1-yield-units-yu · https://blockworks.co/news/boros-pendle-tokenizes-funding-rates · https://www.dextools.io/tutorials/pendle-boros-funding-rate-futures-explained
- Freqtrade, análise sem olhar o futuro: https://www.freqtrade.io/en/stable/lookahead-analysis/
- Validação de backtest: https://cli-trader-site.pages.dev/trading-skills/backtesting-validation/ · https://dev.to/trendrider/5-backtesting-mistakes-that-cost-crypto-traders-thousands-227k
- Histórico de preço da NiceHash (API pública): https://api2.nicehash.com/main/api/v2/public/algo/history?algorithm=RANDOMXMONERO
