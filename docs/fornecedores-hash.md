# Fornecedores de hash SHA-256 (31/10/2026)

Preços lidos ao vivo nas APIs públicas, em BTC por EH/s por dia, e comparados com o lance do robô na NiceHash.
O painel mostra o mesmo quadro em Mineração → Operar → "Fornecedores de hash" (atualiza a cada 15 min).

| | NiceHash | Braiins Hashpower | MiningRigRentals |
|---|---|---|---|
| Modelo | livro de ordens; hash vai ao maior lance | livro de ordens (prioridade: preço, depois idade do lance) | aluguel de máquinas, preço do dono, horas fixas |
| Preço para receber hash | 0,4242 (lance) | 0,4348 (menor lance casado) | 0,47–0,51 (SHA-256 AsicBoost: menor anúncio e último aluguel) |
| Taxa | 3% | 0% no beta (pode mudar) | — |
| Total | 0,4369 | **0,4348 (−0,5%)** | +8% a +16% |
| Hash disponível | ~22,8 EH/s pagos no livro | ~5,5 EH/s ofertados, ~1,8 casados | 43,8 EH/s anunciados, ~620 PH/s alugados (AsicBoost) |
| Mínimos | ordem 0,001 BTC, 1 PH/s | 1 PH/s; 10.000 sats com limite de velocidade | por máquina |
| Cadastro | KYC; Travel Rule em depósitos | Telegram + e-mail; depósitos passam por triagem | e-mail |
| Pool de BCH | qualquer Stratum | **só pool com extranonce2 ≥ 7**: a maioria dos pools de BCH usa 4 | qualquer |
| API para robô | sim (em uso) | sim: criar, editar e cancelar lances; livro público | sim |

## Conclusões
- **Braiins Hashpower** é a única alternativa com preço competitivo (sem a taxa de 3%, empata ou fica levemente
  melhor). A trava é técnica: o pool de BCH precisa de extranonce2 ≥ 7. A própria Braiins diz que a maioria dos pools
  de BCH/BSV é incompatível. Use o botão "Conferir com a Braiins" no cadastro de pool (o servidor abre o Stratum e
  lê o valor). Se o BlockSniper não passar, é preciso outro pool solo de BCH que passe.
- Na Braiins, editar o lance faz ele perder a prioridade da fila: o robô teria de editar menos que na NiceHash
  (adaptação necessária antes de ligar).
- **MiningRigRentals** não serve para o BCH solo: 8–16% acima do preço da NiceHash, com DARR perto de 1 não há margem.
  Correção (31/10): a primeira leitura usou o SHA-256 simples (pequeno, 0,63); o mercado certo é o AsicBoost.
- Não confirmados aqui (páginas não abriram): Rigly (mercado via Lightning), Hashing24 e Hashrate Farm (contratos de
  prazo fixo para pools de BTC).

## NiceHash: depósito retido (Travel Rule / VASP)
Pelas páginas de ajuda da NiceHash (podem ter mudado):
1. Carteira → abrir o depósito retido → **Resolve Travel Rule Data**.
2. Escolher de onde veio: **de outra corretora (VASP)**, informar nome, endereço e país do remetente; ou **de carteira
   própria (autocustódia)**, provar com **assinatura da carteira** (Wallet Signature Proof) ou **comprovação visual**.
3. Se continuar parado, abrir chamado no suporte com o ID da transação.
Para não repetir: depositar sempre da mesma carteira própria já verificada (sacar da corretora para ela antes). A
Braiins também pede depósito de carteira própria e faz revisão manual em dias úteis (até 48 h).

Fontes: academy.braiins.com/braiins-hashpower (fees, quick-start, faqs/basics, api); hashpower.braiins.com/v1/spot
(orderbook, stats); miningrigrentals.com/api/v2/info/algos/sha256ab; nicehash.com/support/general-help/travel-rule.
