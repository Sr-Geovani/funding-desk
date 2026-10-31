# Pesquisa: sinais para alugar SHA-256 e minerar BCH solo (out/2026)

Base: literatura e fóruns (EN, ZH, RU, ES, PT); análise de 25.769 blocos BCH e 26.101 blocos BTC (04/05 a 30/10/2026,
dumps da Blockchair); preço BCHBTC horário (Binance); 2 fotos do livro da NiceHash (31/10, ~04:30 UTC).

**Definições.** Hashprice BCH (BTC/EH/dia) = 86400·10¹⁸ ÷ (D·2³²) × (3,125 + taxas) × BCHBTC.
**DARR** = hashprice do BCH ÷ hashprice do BTC (quanto o BCH paga por hash em relação ao BTC).

## O que é sorte e o que é previsível
- **Sorte (sem memória):** em que bloco você acerta e quanto tempo o próximo bloco demora. Nos 25,8 mil blocos,
  18,7% saíram em menos de 2 min (exponencial pura: 18,0%) e 5,6% demoraram mais de 30 min (5,0%); autocorrelação entre
  intervalos seguidos ≈ 0. Esperar "o bloco atrasado" não ajuda: depois de 30 min sem bloco, o próximo fica só 0,48% mais fácil.
- **Previsível:** a dificuldade (fórmula ASERT), o preço BCH/BTC, o reajuste do BTC (data e tamanho estimados), o custo
  do aluguel (livro da NiceHash) e a fatia de hash que você teria. É aí que está a vantagem.

## Achados
1. **A única vantagem real é o hashprice do BCH contra o custo na NiceHash (forte).** Retorno por BTC gasto =
   hashprice_BCH × (1 − taxa do pool) ÷ (preço_NH × 1,03). Rajada, horário ou regra de parada não mudam isso.
   Preço máximo na NH = hashprice_BCH × (1 − taxa do pool) ÷ 1,03. Na coleta: DARR ≈ 1,06, clearing 0,4241–0,4243,
   empate ≈ 0,431 (pool 2%) → margem ≈ +1,5%.
2. **Na média o DARR fica abaixo de 1 (forte).** Em 180 dias: média 0,940; acima de 1,00 em 10,3% das horas; acima de
   1,03 em 1,3% (21 janelas, mediana 2 h, máximo 16 h); acima de 1,05 em 0,1%. Nas 2 fotos, o clearing da NH ≈ 0,993 ×
   hashprice do BTC (precisa confirmar com histórico próprio). Se valer sempre, só há valor esperado positivo com DARR
   acima de ~1,04–1,05; alugar o tempo todo renderia por volta de −10% (estimativa).
3. **O reajuste de dificuldade do BTC abre e fecha janelas de forma previsível (forte).** No bloco do reajuste o DARR
   salta mais ou menos o tamanho da variação: +5,92% levou de 0,973 a 1,023 (16/10); +5,54% de 0,969 a 1,001 (29/10);
   −10,09% de 0,914 a 0,813 (14/06). Os 13 reajustes do período seguem o padrão. Fonte: mempool.space
   `/api/v1/difficulty-adjustment` (hoje estima −3,2% por volta de 13/11).
4. **O momentum BCH/BTC antecipa DARR alto (média).** Como o ASERT tem meia-vida de 2 dias, o preço anda antes da
   dificuldade: correlação 0,47 entre log(BCHBTC ÷ EMA de ~2,9 dias) e log(DARR); 0,33 com o retorno de 24 h.
5. **Os mineradores que trocam de moeda fecham a janela em horas (forte).** O hash do BCH cai 5,29% para cada 1% de
   queda na recompensa; com DARR > 1,03 saem 40,4 blocos em 6 h (média 34,8) e a fatia dos pools "outros" vai de 25% a 37%.
6. **Hora do dia: o hash varia, a receita não (forte para o hash).** 5,15 blocos/h às 23 UTC contra 6,59 às 15 UTC;
   blocos solo e EasyMining concentram-se entre 15 e 22 UTC; o DARR médio por hora é plano. Vantagem por horário só
   poderia vir do preço da NH, que não tem histórico público.
7. **Mecânica da NiceHash (média).** Cada um paga o próprio lance e o hash vai primeiro ao maior lance. Ordens grandes
   STANDARD definem o clearing; uma rajada de até ~2 EH a 0,4245–0,426 deve encher com impacto de 0,1–0,4% (não testado).
   Ordens FIXED saíam ~5,6% mais caras. Preço só desce 0,002 a cada ~10 min; com a taxa de 0,00001 BTC por ordem, às vezes
   compensa cancelar e recriar. O pool precisa aceitar dificuldade de share ≥ 1.000.000.
8. **Regras de parada não mudam o valor esperado; mudam a variância (forte).** Número de blocos ~ Poisson; para provar
   com 2 desvios uma vantagem de 3% seriam ~4.400 blocos (~50 BTC de aluguel). Chance de zero blocos: 37% gastando o valor
   de 1 bloco, 5% gastando o valor de 3.
9. **Viés de sobrevivência e golpes (média).** Vitrines mostram só ganhadores (EasyMining: 200 blocos sem dizer o gasto;
   BlockSniper: um "stop-win" em destaque). On-chain, BlockSniper + EloPool somam 40 blocos em 180 dias; o BlockSniper
   cobra 2% direto na coinbase. Golpe documentado: pools "solo" que desviavam o hash para outra rede (fev/2026).
10. **Pouca utilidade:** taxas do BTC (0,7% da recompensa, correlação ≈ 0 com o DARR), mempool do BCH, fluxos de exchange.
    Halving: o BCH deve cortar a recompensa ~9 dias antes do BTC (~abr/2028); nesse intervalo não alugar.

## Top 5 para o painel
1. DARR e valor esperado efetivo em tempo real, com semáforo do preço máximo na NiceHash.
2. Gravador do livro da NiceHash a cada 1–5 min (clearing, profundidade, preço FIXED) → histórico próprio e mapa hora × dia.
3. Calendário do reajuste do BTC com alerta de janela + indicador BCH/BTC contra a média de 2 dias.
4. Resultado esperado × realizado com faixa de sorte (±2 desvios), sem "previsão do próximo bloco".
5. Auditoria de pools pela coinbase (endereço e taxa) e classificação dos blocos em "troca de moeda" e solo.

## Fontes
ASERT: https://upgradespecs.bitcoincashnode.org/2020-11-15-asert/ ·
Tempos de bloco: https://bitcoincashresearch.org/t/chip-2025-03-faster-blocks-for-bitcoin-cash/1513 ·
Propriedades do ASERT: https://bitcoincashresearch.org/t/love-letter-to-bitcoin-cash-bch-asert-daa-absolutely-scheduled-exponentially-rising-targets-difficulty-adjustment-algorithm/1730 ·
Elasticidades: https://bitcoincashresearch.org/t/empirical-analysis-of-the-aserts-performance/708 e https://ideas.repec.org/p/osf/socarx/u58ns.html ·
Noda et al.: https://cbade.hkbu.edu.hk/wp-content/uploads/2020/09/20201016_NODA.pdf · Oscilação pré-ASERT: https://arxiv.org/abs/2006.03044 ·
Rosenfeld: https://arxiv.org/abs/1112.4980 · Taxa NH: https://www.nicehash.com/support/hash-power-marketplace/general-help/what-is-the-service-fee-for-buyers ·
Guia NH: https://static.nicehash.com/marketing/Buying%20Guide.pdf · API NH: https://api2.nicehash.com/main/api/v2/public/buy/info ·
Reajuste BTC: https://mempool.space/api/v1/difficulty-adjustment · Blocos: https://gz.blockchair.com/bitcoin-cash/blocks/ ·
Preços: https://data-api.binance.vision/api/v3/klines?symbol=BCHBTC&interval=1h · BlockSniper: https://blocksniper.ai/ ·
Pools golpistas: https://www.solosatoshi.com/bitcoin-mining-scam-pools-axeos-detection/ ·
EasyMining 200 blocos: https://cointelegraph.com/press-releases/nicehash-hits-200-solo-btc-blocks-grows-hashrate-marketplace ·
MRR: https://www.miningrigrentals.com/faq · Sazonalidade: https://hashrateindex.com/blog/the-summer-slowdown-how-seasons-shape-hashrate-markets/
