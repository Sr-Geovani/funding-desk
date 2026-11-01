# Métodos de análise e aprendizado: o que se faz fora e o que temos (01/11/2026)

Pesquisa em artigos acadêmicos (SSRN, arXiv, KAIST, Bitcoin Cash Research), guias de mesas e ferramentas de arbitragem
e fóruns de quem opera. Objetivo: ver se o painel trabalha como os sistemas que operam e o que falta.
Ressalva: boa parte do material de prática é de blogs e fóruns, não de estudos revisados; os números deles são ilustrativos.

## 1. Mineração com hash alugado (BCH)
| O que se faz | Fonte | No painel |
|---|---|---|
| Comparar aluguel × receita do pool ("rent vs mine gap"); positivo = compensa | MiningBoard (pool BCH solo: −20,5% num instantâneo) | Igual: margem no preço real (passo 1 da cartilha) |
| O hash do BCH reage ~8× mais que o do BTC à rentabilidade (1% de receita a menos → −5,29% de hash no BCH, −0,62% no BTC) | Bitcoin Cash Research | Confirma o que medimos: margens altas duram minutos (tabela por faixa) |
| ASERT foi feito para reduzir a vantagem de quem entra e sai | especificação ASERT (BCHN) | Por isso as janelas são curtas e raras |
| "Fickle mining": decidir pela mudança de dificuldade, que é mais previsível que o preço | KAIST (Kwon et al., 2019) | Parcial: medidor de blocos em 6 h e reajuste do BTC. **Falta:** prever a dificuldade da próxima hora pela fórmula do ASERT |

## 2. Arbitragem de funding
| O que se faz | Fonte | No painel |
|---|---|---|
| APR extremo some em horas; carry positivo pode virar negativo | guias sharpe.ai, Amberdata, CCXT | Igual: reteste de 90 dias, janela de estabilidade, saída quando vira (1 h) |
| Taxa taker mata operação curta; usar ordem limite | guias OneKey, BitMEX | Igual: execução maker padrão, custo a mercado mostrado à parte |
| Creditar o funding no horário exato de cada corretora | Bagtester | Igual: pagamentos por horário de cada perna |
| Risco de base entre corretoras é um modelo à parte | Bagtester, CoinEx | **Falta:** só aparece como nota |

## 3. Validação (não se enganar com o teste)
| O que se faz | Fonte | No painel |
|---|---|---|
| Descontar o número de tentativas: testar muitas regras gera "vencedores" por acaso (Deflated Sharpe) | Bailey e López de Prado, SSRN 2460551 | Parcial: teste fora da amostra dos melhores cenários |
| Probabilidade de overfitting (PBO): chance de a melhor no teste ficar abaixo da mediana fora dele | Bailey, Borwein, López de Prado e Zhu, SSRN 2326253 | **Falta:** medir isso em vários cortes, não só um |
| Margem de erro antes de confiar | prática geral | Igual (01/11): intervalo de Wilson e lucro esperado no pior caso |

## 4. Do simulado para o real
| O que se faz | Fonte | No painel |
|---|---|---|
| Diferença simulado × real ("implementation shortfall") vem mais da execução | BS Capital Markets, PickMyTrade | Plano: teste de calibração pequeno |
| Registrar hora do sinal, preço pedido, preço e quantidade recebidos; comparar | fóruns de algotrading | **Falta:** registro de potência pedida × entregue e tempo até o hash chegar |
| Começar mínimo e só aumentar quando o real bater com o simulado | fóruns de algotrading | Plano: 10 PH/s por 1–2 h antes de escalar |

## 5. Tamanho da aposta e aprendizado
| O que se faz | Fonte | No painel |
|---|---|---|
| Kelly fracionado (¼ a ½), porque a vantagem estimada tem erro; mínimo ~50 operações | LuxAlgo, guias de Kelly | Parcial: capital mínimo por Kelly cheio. **Falta:** mostrar ½ Kelly e exigir amostra |
| Regime de mercado (HMM etc.) diz o ambiente, não a hora de entrar; supõe mercado estável | preprint 2026, guias | Igual em espírito: regime simples (alavancagem, DARR). **Falta:** faixa aprendida separada por regime |
| Escolher entre estratégias aprendendo com o resultado (Thompson sampling), com esquecimento 0,95–0,97 | arXiv 1911.05309, scripts | Parcial: faixa aprendida com esquecimento. **Falta:** escolher entre os cenários (Sua, Copiloto, Rajada, melhores) pelo placar |

## Melhorias sugeridas (ordem)
1. Prever a dificuldade da próxima hora pelo ASERT e a margem esperada da próxima hora (decide melhor que a margem de agora).
2. Registro de execução no modo real: potência pedida × entregue, tempo até chegar o hash, preço pago (para a calibração).
3. Seleção de cenário por Thompson sampling em modo sombra, com esquecimento.
4. Faixa aprendida por regime (DARR alto/baixo, alavancagem quente/fria).
5. PBO em vários cortes da janela, e Kelly fracionado com amostra mínima.

## Fontes
- MiningBoard, pool BCH solo: https://miningboard.com/pools/bch.solo-pool.org
- Empirical analysis of the ASERT's performance: https://bitcoincashresearch.org/t/empirical-analysis-of-the-aserts-performance/708
- Especificação ASERT: https://upgradespecs.bitcoincashnode.org/2020-11-15-asert/
- Kwon et al., Bitcoin vs. Bitcoin Cash (KAIST, 2019): https://syssec.kaist.ac.kr/pub/2019/kwon_sp_2019.pdf
- Unstable Throughput: When the Difficulty Algorithm Breaks: https://arxiv.org/pdf/2006.03044
- Funding rate arbitrage (sharpe.ai): https://www.sharpe.ai/arbitrage/guide/funding-rate-arbitrage
- Amberdata, guia de funding: https://blog.amberdata.io/the-ultimate-guide-to-funding-rate-arbitrage-amberdata
- CCXT, arbitragem em 2026: https://docs.ccxt.com/blog/crypto-arbitrage-strategies
- Bagtester, funding: https://bagtester.com/guides/funding-rate-arbitrage
- Deflated Sharpe Ratio: https://papers.ssrn.com/abstract=2460551
- Probability of Backtest Overfitting: https://papers.ssrn.com/abstract=2326253
- Implementation shortfall: https://www.bscapitalmarkets.com/the-implementation-shortfall-where-paper-trading-meets-real-trading.html
- Paper × live (PickMyTrade): https://blog.pickmytrade.io/paper-trading-automated-strategy-test-before-going-live/
- Kelly (LuxAlgo): https://www.luxalgo.com/library/concept/kelly-criterion/
- HMM em cripto (preprint): https://www.preprints.org/manuscript/202603.0831/v1/download
- Thompson sampling para carteira: https://arxiv.org/pdf/1911.05309
