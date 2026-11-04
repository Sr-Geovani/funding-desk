# Prompt para pesquisa de mercado (copiar e colar)

Você é um pesquisador de mercado cripto e de renda, com foco em estratégias operáveis por uma pessoa física no Brasil com
capital pequeno (US$100 a US$5.000). Quero um mapa completo, com fontes, de todas as formas de gerar lucro consistente
e mensurável, comparadas entre si e com o CDI. Seja cético: separe o que tem histórico comprovado do que é marketing.

## Contexto do que já construímos e medimos
- Um painel próprio (PWA) com um servidor na Cloudflare que roda a cada minuto, lê dados públicos e opera a NiceHash
  pela API (chaves só no servidor, sem permissão de saque). Assistente no Telegram (Jarbas) e relatório diário.
- **Mineração solo de BCH com hash alugado na NiceHash:** 1 semana real, US$198 gastos, 0 blocos. Margem média de 7 dias
  −3,9%, positiva só 9% do tempo. Robô "Sniper" com gatilhos de dificuldade, atraso de bloco e mempool, kill switch de
  7 min, um tiro por bloco. Conclusão: valor esperado negativo; o horário não muda a chance (sorteio sem memória).
- **Mineração PPS de outras moedas com hash alugado** (pool que paga por share): simulação "como real" em 16 algoritmos
  (RandomX/Monero, Equihash, Scrypt, X11, KawPow, Autolykos, Octopus, etc.). Lastro de ~4 dias: Monero teve ~7 janelas
  positivas por dia, de ~18 min, com ~+6% de margem; as moedas pequenas têm margem alta, mas o mercado de aluguel é
  minúsculo (US$45 a US$400 por dia). Taxa da NiceHash: 3% + 0,00001 BTC por ordem nova; ordem mínima 0,001 BTC.
  MiningRigRentals está mais cara que a NiceHash em todos os algoritmos hoje.
- **Arbitragem de funding entre corretoras** (Binance, Bybit, Hyperliquid, Lighter): 8 operações simuladas, 1 positiva;
  reteste de 90 dias com 27% de acerto. O spread extremo de altcoin some em ~11 h e as taxas comem o ganho.
- **Rendimentos em dólar acompanhados:** Bitfinex (empréstimo) ~6%, Aave USDT/USDC ~5–6%, Ethena ~5%, base BTC ~4,7%,
  Sky sUSDS ~3,8%, stETH ~2,3%, HLP ~0%. **CDI no Brasil ~13,65% ao ano.**
- Restrições: estou no Brasil; Polymarket é bloqueado aqui e não quero contornar bloqueios; nada de chaves no navegador;
  quero só o que dá para medir, simular antes ("papel") e executar com regras claras.

## O que eu quero que você pesquise (com fontes e números de 2025–2026)
1. **Todas as classes de estratégia com lucro para varejo**, com retorno típico, risco, capital mínimo, frequência e se
   funciona do Brasil. Inclua no mínimo:
   - arbitragem: entre corretoras (spot), triangular, CEX × DEX, P2P de USDT/BRL (ágio do dólar cripto no Brasil),
     base (spot × futuro), funding com taxa travada (Pendle Boros), entre plataformas de aluguel de hash;
   - renda: staking, empréstimo, LP em DEX (incluindo LP concentrada e perda impermanente), cofres (vaults),
     produtos "Earn"/"Launchpool" de corretoras, juros fixos (Pendle PT), stablecoins com rendimento;
   - opções: venda coberta, put coberta por caixa (Deribit, Bybit, OKX), estratégias de volatilidade;
   - market making com robô (Hummingbot e similares), grid trading, DCA com regras;
   - liquidações e MEV acessíveis ao varejo (se houver), airdrops e programas de pontos (com custo e risco reais);
   - mineração própria (GPU/ASIC em hospedagem no Paraguai/Etiópia) × aluguel de hash;
   - renda fixa brasileira e dólar (CDB, LCI/LCA, Tesouro, fundos cambiais) como referência.
2. Para cada uma: **onde está o lucro** (quem paga), **por que o varejo costuma perder**, custos ocultos (taxas,
   slippage, impostos no Brasil), **ferramentas e fontes de dados** (APIs públicas, painéis, robôs abertos) e
   **como medir com histórico** (backtest sem olhar o futuro, papel antes do real, amostra mínima).
3. **Ranking final** por retorno ajustado a risco para US$500 e US$5.000, já descontado o CDI, com o que dá para
   automatizar num servidor (APIs públicas, limites de chamada) e o que exige operação manual.
4. **Sinais e janelas:** quais oportunidades aparecem em janelas curtas (minutos/horas), com que frequência, e quais
   dados públicos permitem detectá-las a tempo.
5. **Referências globais:** ferramentas, mesas, pesquisas e robôs de código aberto que fazem isso bem (ex.: Hashrate
   Index, Hummingbot, Freqtrade, Coinglass, Laevitas, DefiLlama, Pendle), e o que copiar deles.

## Formato da resposta
- Tabela comparativa (estratégia, retorno anual típico, risco, capital mínimo, frequência, funciona no Brasil,
  automatizável, fontes).
- Para as 5 melhores: passo a passo para testar em papel e depois com dinheiro pequeno, com regras de entrada, saída,
  tamanho e stop.
- Lista de fontes com link e data. Marque claramente o que é dado verificado e o que é estimativa.
