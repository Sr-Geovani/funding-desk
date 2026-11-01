# Cartilha de entrada — mineração BCH solo com hash alugado (31/10/2026)

No painel: Mineração → Agora → "Cartilha de entrada" (o servidor avalia os 9 fatores a cada 3 min,
`worker/src/entry.js`).

## 1. Como funciona o ecossistema
- **Rede BCH**: um bloco a cada ~10 min, recompensa de 3,125 BCH + taxas. A dificuldade se ajusta sozinha (ASERT,
  meia-vida de ~2 dias) para manter os 10 min.
- **Quem vende hash** (donos de máquinas SHA-256) poderia minerar BTC. Por isso o preço do aluguel na NiceHash fica
  colado no que o BTC paga por hash (hashprice do BTC). Em 31/10: aluguel 0,4254 BTC/EH/dia × hashprice do BTC 0,4265.
- **Quem compra** paga esse preço + 3% (NiceHash) e aponta para um pool solo de BCH (BlockSniper: 2%). Só sobra lucro
  quando o BCH paga mais que o BTC por hash, acima desses ~5%: **DARR ≥ ~1,05** só para empatar.
- **A rede se corrige**: quando o BCH paga mais, pools grandes trocam de moeda, os blocos aceleram e a dificuldade sobe
  em horas. As janelas boas são raras e curtas: em 6 meses o DARR passou de 1,03 em 1,3% das horas (mediana ~2 h,
  máximo 16 h) e de 1,05 em 0,1%.
- **Sorte**: os blocos seguem um sorteio sem memória (testado com 1.039 blocos: sem padrão por sequência ou horário).
  Nada no passado diz quando sai o próximo.

## 2. Dois jogos diferentes
| | Mineração industrial | Solo com hash alugado |
|---|---|---|
| Como ganha | margem sobre a energia, todo dia | o bloco inteiro quando acerta |
| Sorte | quase nenhuma (pool paga por share) | tudo ou nada a cada tentativa |
| Retorno por tentativa | estável | achou: +200% ou mais; não achou: −100% |
| Retorno de longo prazo | margem sobre a energia (ex.: S21 XP a US$0,065/kWh ≈ +50% sobre a energia, sem a máquina) | **a margem do aluguel** (hoje ≈ 0) |
| O que decide | preço da energia e eficiência da máquina | DARR, preço do aluguel, taxas |

O ROI alto do solo existe **por tentativa**. Repetindo muitas vezes, o resultado converge para a margem: margem
positiva + repetição = lucro; margem negativa + repetição = perda certa. Exemplo real (placar de 24 h e 7 dias, 100 PH/s
ligado direto): −74% em um dia, +15% na semana.

## 3. A sequência de fatores (cartilha)
| # | Fator | Verde | Atenção | Contra | Por quê |
|---|---|---|---|---|---|
| 1 | Margem no preço real (NiceHash), no lance em que dá para comprar ≥ 1 PH/s (profundidade do livro) | ≥ sua margem mínima (3%) | 0 a 3% | < 0 | é o lucro médio por dólar; o menor preço do livro às vezes só tem hash para menos de 1 PH/s |
| 2 | Margem sem a taxa (Braiins) | ≥ 3% | 0 a 3% | < 0 | sem 3% de taxa o empate cai para DARR ~1,02 |
| 3 | DARR | ≥ 1,05 | 1,00 a 1,05 | < 1,00 | base da margem; mostra a raridade histórica |
| 4 | BCH/BTC × média de 2 dias | ≥ +2% | entre | ≤ −2% | o preço anda antes da dificuldade: janela de horas a 2 dias |
| 5 | Blocos nas últimas 6 h | ≤ 30 (hash saindo) | 31–41 | ≥ 42 (hash chegando) | hash chegando fecha a janela em horas |
| 6 | Reajuste do BTC (≤ 3 dias) | positivo | — (longe: neutro) | negativo | o DARR muda na mesma proporção |
| 7 | Horário do aluguel | margem desta hora ≥ média + 0,5 pt | ≤ média − 0,5 pt | — | só o preço da NiceHash varia por hora (mapa próprio) |
| 8 | Potência ideal e capital | potência ideal > 0 | — | 0 | tamanho do ganho e da sorte; capital mínimo = bloco ÷ (2 × margem) |
| 9 | A tentativa | — | — | — | orçamento, chance de ≥1 bloco e desfecho (tudo ou nada) |

**Veredito**: *Entrar* = passo 1 verde e nenhum dos passos 4–6 contra. *Cautela* = passo 1 verde com sinal de piora.
*Esperar* = margem positiva abaixo do mínimo, ou mínimo atingido só sem a taxa (Braiins). *Não entrar* = margem
negativa.

## 4. Na prática
No topo da cartilha fica a **margem do mercado** (24 h e 7 dias): média, quanto do tempo ficou ≥ 0 e ≥ o seu mínimo, e
se o momento está melhor ou pior que o normal. O preço usado é o que compra a sua potência inteira (profundidade do
livro), não o da ordem mais barata.

1. Olhar o veredito. Se não for "Entrar", o robô já fica pausado.
2. Se for "Entrar": usar a potência do passo 8 (até o teto), stop-loss por tentativa (passo 9) e parar no bloco.
3. Para jogar na **loteria de propósito** (aceitando perder o orçamento), escolher os momentos de margem menos negativa
   e um orçamento que não faça falta.
4. Conferir depois: placar da sorte (Rede), cenários com os 5 melhores da janela (Diário → Robô) e "A IA bate o acaso?"
   (se os sinais 4–6 de fato antecipam janelas). Os "melhores" são retrovisor: a regra que vale é a que tem média positiva.

## 5. Leitura de 31/10 (exemplo)
DARR ~1,05 (topo histórico), margem real na NiceHash ≈ −0,4% (preço real 0,4254 × empate 0,4244), Braiins ≈ +0,5%,
BCH/BTC +2,5% sobre a média (dificuldade vai alcançar), reajuste do BTC −4,0% em 13/11 (DARR cai para ~1,01).
Veredito: **não entrar**.
