# Modelo de funding (IA em modo sombra)

Gerado em 2026-10-31T03:00:00.000Z com 90 dias de funding **pago** de Hyperliquid, OKX e Bitget (50 moedas).
Binance e Bybit bloqueiam o servidor de treino; o modelo aprende o comportamento do *spread*, que vale para os outros pares.

**Pergunta que o modelo responde:** quando a regra diz "Compensa" (spread acima do empate em 2 leituras), qual a chance
de a entrada pagar as 4 execuções e o deslize nos 3 dias seguintes?

**Teste honesto:** treinado nos primeiros 2/3 do período e medido só no último 1/3, que ele não viu (com 3 dias de folga).
Valores em US$ por operação de US$1.000 por perna.

| Conjunto | Entradas | Acerto | Resultado médio |
|---|---|---|---|
| Treino (regras) | 4467 | 15% | −US$1.26 |
| Teste: todas as entradas das regras | 2066 | 4% | −US$1.68 |
| Teste: só as que a IA aprova (p ≥ 0.5) | 17 | 0% | −US$1.54 |
| Teste: as que a IA vetaria | 2049 | 4% | −US$1.68 |

AUC no teste: 0.81 (0,5 = acaso; 1 = perfeito).

**Calibração no teste** (a chance prevista bate com o que aconteceu?):

| Faixa prevista | Entradas | Previsto | Real |
|---|---|---|---|
| 0–0.3 | 2008 | 11% | 4% |
| 0.3–0.5 | 41 | 39% | 12% |
| 0.5–0.7 | 16 | 59% | 0% |
| 0.7–1 | 1 | 73% | 0% |

**Características usadas** (todas do passado): excesso do spread sobre o empate agora e nas médias de 8, 24 e 72 h,
oscilação em 24 h, fração de horas positivas em 24 h, horas seguidas acima do empate e tamanho do pico em relação à média.

Pesos: excess 0.51, ex8 0.21, ex24 -0.01, ex72 -0.01, sd24 -0.09, pos24 0.07, above -0.10, spike -0.30.

**Como entra no robô:** em modo sombra. O robô simulado de funding roda duas versões lado a lado, "Regras" e
"Regras + IA" (só entra se p ≥ 0.5). Vira oficial só se ganhar por semanas no placar real.

## O que os dados dizem sobre as regras (mesmos 90 dias, US$1.000 por perna)

Cada linha é uma regra de entrada testada em todas as horas do período. "3d" = fica 3 dias; "saída do robô" = sai quando
a diferença fica ≤ 0 em 2 leituras (média de 18 h). Taker = ordem a mercado (taxa cheia); maker = ordem limite.

| Execução · regra de entrada · saída | Entradas | Acerto | Média por operação |
|---|---|---|---|
| taker · regra atual (acima do empate em 2 leituras) · 3d | 5.968 | 11% | −US$1,40 |
| taker · regra atual · saída do robô | 5.968 | 6% | −US$1,77 |
| taker · média de 24 h acima do empate · 3d | 2.132 | 20% | −US$0,96 |
| maker · regra atual · 3d | 23.930 | 23% | −US$0,36 |
| maker · média de 24 h acima do empate · 3d | 10.927 | 37% | −US$0,05 |
| **maker · 24 h seguidas acima do empate · saída do robô** | **1.975** | **39%** | **+US$0,11** |

Leitura: com taxa cheia, quase nenhuma diferença dura o bastante para pagar as 4 execuções. O que chega perto do
lucro é ordem limite + diferença estável há 24 h + sair quando virar. Ressalva: o histórico usa a última taxa já
paga (as exchanges de 8 h atualizam devagar) e não inclui Binance e Bybit; o robô ao vivo usa a taxa prevista.

## Reteste das janelas (01/11/2026, 90 dias: 03/08 a 01/11)
Pergunta: 24 h seguidas acima do empate é tempo demais? Mesmas fontes (Hyperliquid, OKX, Bitget, taxa já paga),
ordem limite nas 4 execuções, US$1.000 por perna, uma posição por par de cada vez
(`scripts/backtest-janelas-funding.mjs`).

| Janela antes de entrar | Saída do robô: entradas · acerto · média/op | Fica 3 dias: entradas · acerto · média/op |
|---|---|---|
| 2 leituras (sem janela) | 6.387 · 5% · −US$0,80 | 3.281 · 14% · −US$0,62 |
| 6 h | 2.924 · 7% · −US$0,73 | 2.099 · 18% · −US$0,48 |
| 12 h | 971 · 11% · −US$0,62 | 851 · 25% · −US$0,33 |
| 18 h | 334 · 17% · −US$0,53 | 318 · 32% · −US$0,20 |
| 24 h | 214 · 16% · −US$0,63 | 205 · 27% · −US$0,34 |
| 36 h | 38 · 18% · −US$0,61 | 37 · 43% · −US$0,07 |
| 48 h | 17 · 0% · −US$1,16 | 17 · 29% · −US$0,36 |

Leitura: janelas curtas perdem mais (o pico volta antes de pagar as 4 execuções); de 18 h para cima o resultado por
operação melhora, mas nesses 90 dias (regime frio de alavancagem) **nenhuma janela fechou positiva** nessas três
corretoras. 18 h e 24 h ficam empatadas dentro do ruído (poucas centenas de entradas). O +US$0,11 do teste anterior
foi num período diferente. Fora da conta: Binance, Bybit e Lighter (taxa zero), onde estão os maiores spreads de agora.
