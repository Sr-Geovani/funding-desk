# Auditoria da primeira semana (31/10 a 04/11/2026)

Dados do próprio servidor (resultado real da NiceHash, simulações com os blocos reais, placar dos sinais) e do mercado
(fontes no fim). Tudo em dólar, salvo quando dito. "Simulado" = mesmas regras e mesmos blocos, sem dinheiro.

## 1. O que aconteceu (números)
| Frente | Período | Gasto | Resultado | Leitura |
|---|---|---|---|---|
| Mineração BCH real (NiceHash) | 31/10–04/11 | US$198 | 0 blocos | trabalho entregue ~0,20 bloco esperado (~US$167): ~−16% em média, mais o azar de não ter saído |
| Sniper simulado | 03/11–04/11 | US$509 | 0 blocos; valor esperado US$489 (−3,9%) | 0,58 bloco esperado; com o gatilho de mempool em 1× ele atira demais |
| Margem do aluguel BCH | 7 dias | — | média −3,9%; positiva em 9% do tempo; máximo +11,4% | 24 h: média −5,1%, positiva em 1,2% do tempo |
| Melhores cenários (retrovisor) | 316 blocos | — | o "melhor pela sorte" deu +25% na 1ª metade e −4,8% na 2ª | valor esperado de −5,5% a −7%: a sorte não se repete |
| Funding simulado | 28/10–04/11 | US$1.000 por perna | 8 operações, 1 positiva, −US$2,33 | taxas US$8,20 > funding recebido US$5,87; ficaram em média 11 h |
| Placar dos sinais de funding | 28/10–04/11 | — | projetado +US$43, real −US$9,56, 0 acertos em 8 | a projeção de "3 dias" supunha que o spread durava; durou horas |
| Outras moedas (aluguel + pool PPS, simulado) | 30/10–04/11 | US$79 | RandomX (Monero) +6,4% em 16 h; Equihash +6,1%; Scrypt +3,9%; SHA-256 −3,4% | janelas de minutos a horas; **é o único resultado positivo da semana** |
| Rendimentos passivos (simulado) | 7 dias | — | Bitfinex 5,9% a.a., base 4,7%, Ethena 4,8%, HLP ~0% | todos abaixo do CDI em reais (~13,65–14,9% a.a.) |

## 2. Por que perdemos (causas, em ordem de peso)
1. **Comprar hash para BCH solo tem valor esperado negativo neste mercado.** O aluguel acompanha o BTC (hashprice ~US$33/PH/dia
   no início de novembro; aluguel SHA-256 na NiceHash ~US$42–44 em outubro) e o BCH paga parecido. Nossa margem medida ficou
   entre −2% e −7% quase o tempo todo. Gatilhos de horário ou de atraso não mudam isso: o sorteio dos blocos não tem memória.
2. **Erros de execução, já corrigidos:** preço do tiro abaixo do mercado (o hash não vinha), potência cortada no meio do tiro,
   fonte de dados atrasada ou fora do ar, Sniper congelado sem dados, pool apagado, ordem acabando por saldo sem aviso.
   Parte do gasto real comprou pouco hash.
3. **Funding de altcoins:** os spreads extremos voltam ao normal em ~11 a 18 h (medido por outros e por nós: ~11 h). Com
   taxa de entrada e saída de ~0,1% por perna, a operação precisa de muito spread em pouco tempo; na prática perdeu.
4. **Projeções otimistas:** "~US$7,76 em 3 dias" supunha 3 dias de spread. Agora o alerta mostra o histórico real ao lado.

## 3. O que o mercado mostra agora (lastro externo)
- **Base BTC (cash and carry):** ~4–4,7% ao ano em outubro, perto dos títulos americanos; o trade foi desmontado por fundos.
- **Ethena sUSDe:** ~5,1% ao ano, com depósitos caindo. **Aave USDC:** ~3–3,5%.
- **Brasil:** Selic 13,75% (decisão do Copom em 04/11); CDI ~13,65%. Em reais, sem risco de cripto, o CDI paga ~3 vezes o carry em dólar.
- **Mineração:** só é lucrativa com máquina própria e energia barata (abaixo de ~US$0,07/kWh). Alugar para minerar BTC/BCH
  custa mais que o hash rende.
- **Funding de altcoins:** é dominado por mesas com custo baixo; o varejo perde para taxa e para a reversão.

## 4. Conclusões
1. Não há, hoje, vantagem comprovada em alugar hash para BCH solo. Cada dólar gasto volta em média ~US$0,94–0,98, e a
   variação é enorme: um bloco precisa, em média, de ~US$830 de gasto.
2. As regras de entrada do Sniper escolhem *quando* gastar, não melhoram a chance. O que muda o resultado é a margem no tiro.
3. O único sinal positivo da semana veio de **mineração PPS de outras moedas** (RandomX/Monero, Equihash), em janelas curtas.
   Ainda é simulação, com receita estimada pela WhatToMine.
4. Para o seu capital, o rendimento sem risco em reais (CDI) bate todas as frentes de carry em dólar que acompanhamos.

## 5. Direções (o que fazer)
1. **BCH solo:** só atirar com margem a partir de 0% (trava do Sniper em 0), gatilho de mempool de volta para 100× (em 1× ele
   atira o tempo todo) e orçamento de "bilhete": um valor que você aceita perder por mês. Manter o Observar e as simulações
   para juntar lastro, sem depositar mais até a margem melhorar.
2. **Validar a frente RandomX (Monero) com dinheiro pequeno:** uma ordem de ~US$10–20 na NiceHash para um pool PPS de XMR,
   1–2 h, medindo receita real contra a simulada (mesmo método da calibração do BCH). Só escalar se bater.
3. **Funding:** parar de operar altcoin de spread extremo; acompanhar só como sinal. Se quiser carry em dólar, usar BTC/ETH
   (base ~4–5%) sabendo que fica abaixo do CDI.
4. **Reserva:** o dinheiro parado fica melhor em CDI/Tesouro Selic do que em carteira de corretora.
5. **Próxima revisão:** em 7 dias, com as simulações rodando sem buraco e o registro de tiros e de fim de ordem completos.

## 6. Correções feitas nesta revisão
- As simulações rodam em qualquer modo (antes paravam no Ativo e o lastro dos cenários ficava com buraco).
- Fora do Ativo o Sniper real não atira; o quadro "Agora" mostra o Sniper simulado e tem botões de modo e de Sniper.
- Alertas de funding mostram o histórico real dos sinais ao lado da projeção.

## Fontes
- Hashprice nov/2026: https://shattered.io/bitcoin-hashprice-33-record-difficulty-148-trillion-2026/ · https://www.pickaxe.io/resources/news/bitcoin-mining-hashrate-holds-steady-amid-difficulty-shift · https://millionminer.com/news/bitcoin-mining-update-november-2026
- Aluguel × hashprice: https://solofury.com/guides/nicehash-solo-mining/ · https://miningboard.com/guides/what-is-hashpower-marketplace
- Base BTC: https://proveyouredge.com/articles/bitcoin-futures-basis-cme-spot-cash-and-carry · https://www.coindesk.com/markets/2026/08/10/a-rare-cme-shift-hedge-funds-abandon-structural-shorts-to-bet-on-a-bitcoin-rally · https://www.theblock.co/news/business/2026-04-09-cme-bitcoin-futures-activity-slumps-to-14-month-low-as-basis-trade-unwind-drains-institutional-demand-396722
- Ethena e Aave: https://aavescan.com/rates/ethena-susde · https://defillama.com/protocol/ethena · https://aavescan.com/ethereum-v3/usdc
- Selic/CDI: https://www.remessaonline.com.br/blog/reuniao-copom-novembro-2026/ · https://www.otempo.com.br/economia/2026/11/3/mercado-financeiro-preve-corte-na-taxa-selic-na-reuniao-do-copom · https://investidor10.com.br/indices/selic/
- Funding de altcoins: https://askrubyai.github.io/blog/posts/2026-02-14-funding-rate-arbitrage · https://www.sharpe.ai/arbitrage/guide/funding-rate-arbitrage · https://blog.bitmex.com/2025q2-derivatives-report
