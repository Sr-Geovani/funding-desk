# Auditoria da IA e das simulações (31/10/2026)

Objetivo: antes de colocar dinheiro real, garantir que (1) a IA mede a si mesma de forma honesta e (2) cada simulação
faz a mesma conta que a operação real faria. Lido linha a linha: `worker/src/brain.js`, `bot.js`, `paper.js`,
`paperfund.js`, `paperalgo.js`, `alerts.js`, `fundai.js`, `index.js` (ciclo) e as telas em `app.js`.

## Como a IA trabalha (visão geral)
- **Quem decide as compras é o robô, com regras fixas** (`bot.js`): compra quando o lance ≤ teto (empate − margem
  mínima), pausa acima, para no bloco, stop-loss por tentativa e limite diário. A IA não muda essas regras sozinha.
- **A IA é o copiloto** (`brain.js`), a cada 3 min:
  1. junta os sinais (margem, DARR, BCH contra a média de 2 dias, reajuste do BTC, blocos chegando, funding com 24 h
     estável e meia-vida, outras moedas);
  2. escreve a análise e o plano de ação (potência, preço, orçamento, travas);
  3. transforma cada sinal numa **previsão com prazo** e confere no prazo com dados reais;
  4. ganha XP e nível só pelo que acertou, separando o fácil do difícil e comparando com o acaso.
- O plano usa a mesma conta do robô (`computeMarket`) e, ao salvar a configuração, é recalculado na hora.

## Previsões
| Tipo | Quando cria | Como confere | Classe | Controle (acaso) |
|---|---|---|---|---|
| Compra segue boa por 1 h | sinal verde | margem ≥ 0 em 1 h | fácil | — |
| Janela abre em 6 h | margem a < 3 pts do mínimo e DARR ≥ 1 ou BCH subindo | **o robô compraria** em algum ciclo | difícil | mesma pergunta a cada 6 h, sem sinal |
| Dificuldade sobe em 3 h | ≥ 42 blocos em 6 h ou pools grandes chegando | dificuldade +0,5% | difícil | a cada 6 h, sem sinal |
| Não compensa em 12 h | DARR < 0,97 e BCH não sobe | o robô não compraria | fácil | — |
| DARR depois do reajuste | reajuste do BTC em ≤ 288 blocos | ±3% **depois que o reajuste acontece** | difícil | "o DARR fica igual" |
| Funding paga as taxas em 3 dias | par passa na regra validada | **a própria IA acompanha os pagamentos** − 4 execuções maker | difícil | regra validada (39%) |
| Pico de funding cai pela metade | diferença ≥ 60% a.a. não estável | diferença em 24 h | fácil | — |
| Outra moeda segue compensando | margem realista > mínimo | margem > 0 em 6 h | fácil | — |

## Defeitos encontrados e corrigidos
| # | Gravidade | Onde | Problema | Correção |
|---|---|---|---|---|
| 1 | **Alta (dinheiro)** | robô e simulação | Stop-loss não parava: ao cancelar, a ordem seguinte recomeçava a conta; o "máximo que você perde" não valia. | Sessão = tentativa até achar bloco, somando todas as ordens (inclusive as que acabaram); no stop-loss cancela tudo e espera `stopCooldownH` (6 h). Simulação igual. |
| 2 | Alta | IA | XP inflado: previsões de "continua igual" valiam até 15 XP; X11 com dado errado (+132%) "acertava" sempre. | Fácil 2 XP, difícil 10, erro 0; margem > 100% fica fora; XP refeito. |
| 3 | Alta | IA | Sem comparação com o acaso: acerto alto podia ser só a frequência natural. | Grupo de controle (mesma pergunta sem sinal); "vantagem" em pontos; nível 3+ exige vantagem > 0. |
| 4 | Média | IA | Funding só era conferido se houvesse alerta no mesmo horário; o resto sumia sem contar. | A IA acompanha a própria posição (pagamentos − taxas). Sem dado: conta como "não conferida". |
| 5 | Média | IA | Reajuste do BTC podia ser conferido antes de acontecer (a data é estimativa). | Só confere depois que o contador de blocos recomeça (até +48 h). |
| 6 | Baixa | IA | "Janela abriu" usava margem ≥ mínimo; o robô usa lance ≤ teto (diferença ~0,1 pt). | Confere com a mesma régua do robô (sinal verde). |
| 7 | Média | IA (tela) | Tipo fácil virava "confiável" e parecia dizer que a compra dá lucro. | Fáceis mostram "persistência · acerto X%". |
| 8 | Média | simulação mineração | Blocos de quando o servidor ficou parado entravam no sorteio sem custo. | Só sorteia blocos do trecho cobrado (+20 min de tolerância). |
| 9 | Baixa | simulação mineração | Chance por bloco = h ÷ (rede + h) subestimava ~2,6% com 100 PH/s. | h ÷ hash da rede: na média dá exatamente λ. |
| 10 | Média | simulação mineração | Preço baixava na hora; a NiceHash só desce um degrau a cada 10 min (o robô já respeitava). | Igual ao robô. |
| 11 | Alta | outras moedas | Dificuldade do momento (DOGE/DASH em vale) e custos faltando: Scrypt +19,7%, X11 +132%. | Média de 24 h, pool PPS 4%, perdas 2,5%, mercado < US$1.000/dia = raso. Simulação recomeçou. |
| 12 | Média | funding | Resultado supõe as 2 pernas em ordem limite; com 1 perna a mercado, ~US$0,60 a mais por operação (o validado é +US$0,11). | Resumo mostra "se 1 perna fosse a mercado". |
| 14 | **Alta (dinheiro)** | robô, simulação, painel | Preço de compra otimista: "menor preço recebendo hash" usava a velocidade média (> 0), que demora a zerar; ordens sem máquinas a 0,40 pareciam recebendo. O hash real só ia para lances ≥ ~0,4254 (31/10). Simulações compravam ~6% mais barato que o possível e mostravam margem de +3% a +5% quando a real era ~−0,5%. | Só conta ordem com máquinas (`rigsCount > 0`); simulações antigas arquivadas (`paperArchive`) e recomeçadas; potência ideal (IA) pela profundidade do livro. |
| 13 | Média | painel | Robô/Rede/IA congelavam no iPhone até reabrir. | Atualiza ao voltar e em qualquer aba; leitura presa destrava. |

## Simulações: o que é fiel e o que não é
**Mineração (BCH solo)**: sorteio honesto (bloco real, número tirado do hash do bloco, chance = seu hash ÷ rede);
custo pelo lance do livro real + 3%; preço desce como na NiceHash; stop-loss e limite diário iguais ao robô;
cenários com os mesmos blocos (sua config, copiloto, rajada 50, sempre ligado).
Fora da conta (pequeno, mas a margem também é pequena, 1–6%): tempo para o hash chegar após criar a ordem (1–5 min),
entrega oscilando ±10% (muda chance e custo juntos), bloco órfão (~0,5–1%), preço do BCH até a recompensa liberar
(100 blocos ≈ 17 h), taxa por ordem.

**Funding**: pagamentos pela taxa prevista na última leitura antes do horário; taxas maker nas 4 execuções + 0,03%.
Fora da conta: ordem limite que não executa (perna solta), diferença de preço entre as duas corretoras na entrada e
na saída (basis: ±0,05–0,3% do tamanho, maior que o lucro médio por operação), saques e rebalanceamento entre corretoras.

**Outras moedas (PPS)**: sem sorte; agora com a conta realista. Conferência bloco a bloco (31/10, 1.370 blocos do DOGE em
24 h): um minerador constante ganhou US$362,8/TH/dia (dificuldade equivalente 41,7 M). A conta bruta (dificuldade do
momento, 29,7 M) daria ~US$509 (+40%, ilusão); a realista (média de 24 h da WhatToMine, 44,5 M) dá ~US$340 (6%
conservadora). Mesmo com o número exato, Scrypt ficou em ~−9% nesse dia. Fora: entrega abaixo do pedido, preço subir com a
nossa ordem em mercado pequeno, câmbio das moedas recebidas.

## Antes de dinheiro real (checklist)
1. **Teste de calibração** pequeno (10 PH/s por 1–2 h, ~US$30): comparar custo por PH/s/h e hash entregue com a
   simulação do mesmo período (`real` × `paper`). Objetivo: medir, não achar bloco.
2. Stop-loss conferido no teste (forçar com orçamento de US$10).
3. Pool: conferir compatibilidade (NiceHash: qualquer; Braiins: extranonce2 ≥ 7 pelo botão do painel).
4. IA: só dar peso às sugestões de tipos difíceis com vantagem > 0 sobre o acaso e 20+ conferidas.
5. Funding real: só com as duas pernas em ordem limite executadas; registrar no Diário para comparar com a simulação.
