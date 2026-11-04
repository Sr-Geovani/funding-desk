# Boas práticas: mineração solo com hash alugado (04/11/2026)

Levantamento em documentação da NiceHash, do pool BlockSniper (fork do CKPool), de outros pools solo de BCH e de guias de
operadores. Ressalva: várias páginas da NiceHash são antigas; os números delas podem ter mudado. Cada linha diz o que
fazemos no painel.

## Pool e dificuldade das shares
| Prática | Fonte | No painel |
|---|---|---|
| Fixar a dificuldade das shares pela senha do pool (`d=` ou `diff=`); vale na hora em que conecta e passa por cima do automático | README do BlockSniper (CKPool) | **Aplicado:** o painel mostra a senha do pool atual e cria uma cópia com `d=` (padrão 10.000.000) para as próximas ordens |
| A NiceHash exige dificuldade mínima no SHA256 (página de operadores: 500.000); dificuldade baixa demais deixa a ordem "morta" e gera multa | NiceHash, página de operadores e "Read before placing your first order" | **Aplicado:** abaixo de 500.000 o painel recusa e avisa |
| Com hash alugado, usar dificuldade alta; ela não muda o ganho | 2Miners (solo BCH), NiceHash | **Aplicado:** explicado ao lado da senha |
| No solo, a dificuldade das shares não muda a chance de bloco; a chance depende só do hash contra a dificuldade da rede | Kryptex | **Aplicado:** cartilha e respostas |
| O BlockSniper reconhece a NiceHash e dá 500.000; porta acima de 4000 vira "highdiff" (1.000.000) | README do BlockSniper | Nota: nosso pool usa a porta 3333 |
| Testar o pool no verificador da NiceHash antes de usar | NiceHash (pool verificator) | Recomendação no texto do pool |
| O pool precisa de extranonce2 com 4 ou mais (NiceHash) e 7 ou mais (Braiins) | NiceHash; Braiins | **Aplicado:** botão "Conferir com a Braiins" |

Conta de referência: shares por segundo = hash (H/s) ÷ (dificuldade × 2^32). Com 75 PH/s, 500.000 dá ~35 shares por
segundo numa conexão; 10.000.000 dá ~1,7. Menos shares deixa a conexão mais leve e estável. O trabalho aceito no pool vem
em degraus maiores, mas soma o mesmo.

## Ordem na NiceHash
| Prática | Fonte | No painel |
|---|---|---|
| Ordem padrão (lance) pode ser superada a qualquer hora; a fixa tem prioridade e preço travado, dura até 24 h e custa mais | guias da NiceHash | Usamos a padrão: tiros curtos e lance pelo preço que entrega a potência |
| Baixar preço só 10 min depois da última mudança (erro 5061) | NiceHash (visto ao vivo) | **Aplicado:** a potência desce mesmo com a recusa, e a baixa fica agendada |
| Ordem nova pode ficar sem hash por até ~1 min; o hash leva alguns minutos para chegar inteiro | NiceHash; medido (~3 min) | **Aplicado:** o registro dos tiros mostra a potência recebida |
| Cancelar devolve o que sobrou para a carteira; o valor da ordem pode ser reabastecido | NiceHash | **Aplicado:** ordem com todo o saldo e reabastecimento automático |
| Quando o valor da ordem acaba, a NiceHash encerra a ordem | NiceHash (visto ao vivo em 04/11) | **Aplicado:** aviso com o motivo, o que gastou e o que acontece agora; aviso antes, quando o saldo da ordem não cobre um tiro |
| Taxa de 3% sobre o gasto e 0,00001 BTC por ordem nova | NiceHash | **Aplicado:** nas contas de margem e no valor da ordem |
| Recusas de shares até 1–2% são normais; acima disso é problema de pool ou conexão | guias de pool | Parcial: o painel não lê as recusas do pool; avisa quando um tiro pagou e quase não recebeu hash |

## Dados da rede e decisão
| Prática | Fonte | No painel |
|---|---|---|
| Ver o bloco novo o quanto antes (os pools usam aviso direto do nó) | README do BlockSniper (ZMQ) | Parcial: duas instâncias da Haskoin ao mesmo tempo, a mais nova vale; registro de quem viu primeiro |
| A dificuldade do BCH (ASERT) muda a cada bloco; a do próximo bloco sai da fórmula | especificação ASERT | **Aplicado:** gatilho de dificuldade pelo bloco em mineração |
| O tempo desde o último bloco não aumenta a chance do próximo (sorteio sem memória) | matemática do Poisson | **Aplicado:** explicado; o gatilho de atraso só escolhe quando gastar |

## Risco e operação
| Prática | Fonte | No painel |
|---|---|---|
| Chave da API sem permissão de saque | segurança básica | **Aplicado** |
| Limites de gasto: por tentativa, por dia, por semana, prazo do tiro | gestão de risco | **Aplicado** |
| Orçamento para a variação do solo: em média, um bloco custa o valor dele; contar com 1 a 2 blocos esperados de gasto | matemática do solo | **Aplicado:** na resposta e na cartilha |
| Aviso de bloco achado no seu endereço | prática dos pools solo | **Aplicado:** Telegram e selo "seu" |

## Fontes
- NiceHash, pool operators: https://www.nicehash.com/pool-operators
- NiceHash, Read before placing your first order: https://www.nicehash.com/support/hash-power-marketplace/orders/read-before-placing-your-first-order
- NiceHash, minimum pool difficulty for SHA256: https://www.nicehash.com/blog/post/-pool-operators-buyers-minimum-pool-difficulty-for-sha256-will-be-set-to-4095
- BlockSniper (CKPool), README antigo: https://github.com/skaisser/ckpool/blob/master/LEGACY-README.md
- 2Miners, solo BCH: https://solo-bch.2miners.ru/help
- Kryptex, vardiff × dificuldade fixa: https://pool.kryptex.com/pt-br/articles/vardiff-vs-static-diff-en
- Mining-Dutch (d=nicehash): https://www.mining-dutch.nl/?page=about
- SoloBCH: https://pool.solobch.com/
- NiceHash × MiningRigRentals: https://miningboard.com/guides/nicehash-vs-mining-rig-rentals
- Rejeição de shares (ViaBTC): https://www.viabtc.com/en/blog/Beginner-what-causes-a-high-reject-rate-and-how-to-fix-it-before-it-cuts-profit-668
