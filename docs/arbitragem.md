# Arbitragem de stablecoins (08/11/2026)

## O que o painel faz
A cada 3 minutos (minutos 2, 5, 8… de cada hora) o servidor lê cerca de 30 fontes públicas e compara os preços de
USDC/USDT, USDT/BRL, USDC/BRL, USDT/USD e USDC/USD. Todo resultado sai **líquido** das taxas de balcão de cada perna
e do gás das DEX.

| Grupo | Plataformas | Duplas |
|---|---|---|
| Corretoras globais | Binance (dado público pelo espelho oficial `data-api.binance.vision`), OKX, Bybit, KuCoin, Gate, MEXC, Bitget, HTX, Kraken, Coinbase, Bitstamp | USDC/USDT; USDT/BRL e USDC/BRL (Binance, OKX, Bybit, Bitget); USD (Kraken, Coinbase) |
| Corretoras brasileiras | Foxbit, Mercado Bitcoin, Bitso, Ripio, BitPreço, NovaDAX | USDT/BRL e USDC/BRL |
| DEX | Hyperliquid (livro de ordens), Jupiter (Solana), KyberSwap (Arbitrum e Base), ParaSwap (Ethereum) | USDC/USDT: o que um agregador entrega para US$1.000 nos dois sentidos, já com a taxa dos pools e o gás |

Tipos de oportunidade:
1. **Direta:** compra a mesma dupla onde está mais barata e vende onde está mais cara. Exige saldo parado nas duas pontas.
2. **Triangular:** BRL → USDT → USDC → BRL, ou o inverso, numa corretora só ou combinando várias. O mesmo vale com USD.
3. **Com DEX:** quando uma das pernas é uma DEX. Exige saldo na carteira da rede (Solana, Arbitrum, Base ou Ethereum).

## Regras para não enganar a gente
- **Fantasma:** uma diferença que aparece numa leitura e some na seguinte não conta. O papel só executa o que continua
  positivo na leitura seguinte, pelo preço dessa leitura (o que daria para pegar de verdade).
- **Taxas:** usa a taxa de balcão (taker) do nível básico de cada plataforma. As tabelas oficiais pedem login e há
  promoções que zeram a taxa de stable, então os valores são estimativas editáveis no código (`VENUES` em
  `worker/src/arb.js`). O painel mostra o bruto ao lado do líquido.

  | Plataforma | Taxa usada |
  |---|---|
  | Binance, OKX, Bybit, KuCoin, Bitget | 0,10% |
  | MEXC | 0,05% |
  | Gate, HTX, Kraken | 0,20% |
  | Bitstamp | 0,40% |
  | Coinbase | 0,60% |
  | Foxbit | 0,50% |
  | Mercado Bitcoin | 0,70% |
  | Bitso | 0,65% |
  | Ripio | 0,50% |
  | BitPreço | 0,30% |
  | NovaDAX | 0,50% |
  | Hyperliquid | 0,07% |
- **Estoque e reequilíbrio:** a simulação usa US$200 por operação (ou o que o livro aguenta) e um estoque de US$1.000 em
  cada plataforma. Quando 80% do estoque foi usado, cobra ~US$1 de transferência para reequilibrar.
- **Bloqueio de região:** algumas corretoras bloqueiam a região de onde o servidor sai (no teste de 08/11, Bybit e
  Mercado Bitcoin). Isso fica registrado como "sem resposta" naquela fonte. **Não contornamos bloqueio.**

## Robô (nasce desligado)
- **Modos:**
  - **Desligado:** não faz nada.
  - **Ensaio:** confere o saldo pela API e monta e assina as ordens, mas não envia nada.
  - **Real:** envia as ordens.
- **O que executa:** só a arbitragem **direta** entre duas corretoras que ele sabe operar (Binance, OKX, Bybit, KuCoin,
  Foxbit) e só depois de confirmada em duas leituras. Triangular e DEX ficam no mapa e no papel.
- **Como envia:** as duas ordens ao mesmo tempo, como limite IOC (executa na hora no preço visto ou cancela), para não
  sobrar ordem esquecida no livro.
- **Travas:**
  - valor por operação (US$50);
  - limite do dia (US$200);
  - margem líquida mínima (0,10%);
  - se só uma perna for aceita, o robô se desliga sozinho e avisa no Telegram.
- **Chaves:**
  - só permissão de negociar spot, **nunca saque**;
  - o servidor recusa chave com saque onde a corretora informa (Binance, OKX, Bybit, KuCoin);
  - ficam cifradas no backend, junto com as outras credenciais, e nunca voltam para o painel.
- **Reequilíbrio entre corretoras:** é manual. A chave não tem saque.
- **Assinaturas:** escritas pela documentação pública de cada API. A da Binance foi conferida com o exemplo oficial da
  documentação. As outras não foram testadas com chave real, e por isso o primeiro uso deve ser o **ensaio**.
- **Região:** a execução real depende de o servidor sair por uma região que a corretora aceita. O ensaio mostra se a
  corretora respondeu.

## Primeira leitura (08/11, 04:00 UTC)
- **Direta entre corretoras:** a maior diferença foi USDT/BRL, comprando na Binance (5,6323) e vendendo na Bitget (5,645):
  +0,23% bruto, mas **+0,025% líquido** com as duas taxas de 0,10%. Abaixo da regra de 0,05% do papel.
- **USDC/USDT:** as corretoras globais ficaram todas em ~1,0012, com diferenças de 0,001% a 0,01%, menores que qualquer taxa.
- **DEX:** a diferença entre redes ficou em ±0,005%.

## Antes de ligar com dinheiro
1. Deixar o mapa e o papel rodarem pelo menos 7 dias: frequência, duração e tamanho das oportunidades confirmadas.
2. Conferir as taxas reais da sua conta em cada corretora (o nível e as promoções mudam o resultado).
3. Pôr saldo pequeno nas duas corretoras da rota que mais se repete e usar o **ensaio** por alguns dias.
4. Só então o **real**, com as travas no mínimo.
5. Confirmar se a corretora atende residentes no Brasil e se está regularizada, e declarar as operações
   (IN RFB 2.291/2025, Lei 14.754/2023).
