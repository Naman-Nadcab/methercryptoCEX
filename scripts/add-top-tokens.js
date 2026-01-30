const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Blockchain IDs
const CHAINS = {
  ETH: 'eff409ac-9900-426c-97bb-6c0f3d9be237',
  BSC: '830c283d-baf4-4480-bf8b-924de4eef6f3',
  POLYGON: '668ef874-d572-41ba-a318-d936d926b0b6',
  ARBITRUM: '3a6587a5-249f-49ca-b69b-ef7483a7f61c',
  AVALANCHE: '09e30a20-2a60-421a-a3a7-8593ed3082b0',
  SOLANA: 'f737efa2-b174-49a7-ba94-a719203269d1',
  TRON: 'b005a098-7bf3-4d64-be7f-110b084322da',
  BITCOIN: 'bc65b497-5893-4d04-aeea-fdaa4f4d4da8',
};

// Top 100 tokens with contract addresses on multiple chains
const TOP_TOKENS = [
  // Native coins (no contract address)
  { symbol: 'BTC', name: 'Bitcoin', type: 'crypto', decimals: 8, chains: [{ chain: 'BITCOIN', contract: null }], minWithdraw: '0.0001', fee: '0.0001' },
  { symbol: 'ETH', name: 'Ethereum', type: 'crypto', decimals: 18, chains: [{ chain: 'ETH', contract: null }], minWithdraw: '0.001', fee: '0.0005' },
  { symbol: 'BNB', name: 'BNB', type: 'crypto', decimals: 18, chains: [{ chain: 'BSC', contract: null }], minWithdraw: '0.01', fee: '0.001' },
  { symbol: 'SOL', name: 'Solana', type: 'crypto', decimals: 9, chains: [{ chain: 'SOLANA', contract: null }], minWithdraw: '0.1', fee: '0.01' },
  { symbol: 'MATIC', name: 'Polygon', type: 'crypto', decimals: 18, chains: [{ chain: 'POLYGON', contract: null }], minWithdraw: '1', fee: '0.1' },
  { symbol: 'AVAX', name: 'Avalanche', type: 'crypto', decimals: 18, chains: [{ chain: 'AVALANCHE', contract: null }], minWithdraw: '0.1', fee: '0.01' },
  { symbol: 'TRX', name: 'Tron', type: 'crypto', decimals: 6, chains: [{ chain: 'TRON', contract: null }], minWithdraw: '10', fee: '1' },
  { symbol: 'ARB', name: 'Arbitrum', type: 'crypto', decimals: 18, chains: [{ chain: 'ARBITRUM', contract: null }], minWithdraw: '1', fee: '0.1' },

  // Stablecoins (multi-chain)
  { symbol: 'USDT', name: 'Tether USD', type: 'stablecoin', decimals: 6, chains: [
    { chain: 'ETH', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    { chain: 'BSC', contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { chain: 'POLYGON', contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' },
    { chain: 'ARBITRUM', contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' },
    { chain: 'AVALANCHE', contract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7' },
    { chain: 'TRON', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
    { chain: 'SOLANA', contract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
  ], minWithdraw: '10', fee: '1' },
  
  { symbol: 'USDC', name: 'USD Coin', type: 'stablecoin', decimals: 6, chains: [
    { chain: 'ETH', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    { chain: 'BSC', contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { chain: 'POLYGON', contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
    { chain: 'ARBITRUM', contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
    { chain: 'AVALANCHE', contract: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
    { chain: 'SOLANA', contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'DAI', name: 'Dai Stablecoin', type: 'stablecoin', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x6B175474E89094C44Da98b954EescdeCB5dC86C' },
    { chain: 'BSC', contract: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3' },
    { chain: 'POLYGON', contract: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063' },
    { chain: 'ARBITRUM', contract: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1' },
    { chain: 'AVALANCHE', contract: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'BUSD', name: 'Binance USD', type: 'stablecoin', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x4Fabb145d64652a948d72533023f6E7A623C7C53' },
    { chain: 'BSC', contract: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56' },
  ], minWithdraw: '10', fee: '0.5' },

  { symbol: 'TUSD', name: 'TrueUSD', type: 'stablecoin', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x0000000000085d4780B73119b644AE5ecd22b376' },
    { chain: 'BSC', contract: '0x14016E85a25aeb13065688cAFB43044C2ef86784' },
    { chain: 'TRON', contract: 'TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'FRAX', name: 'Frax', type: 'stablecoin', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x853d955aCEf822Db058eb8505911ED77F175b99e' },
    { chain: 'BSC', contract: '0x90C97F71E18723b0Cf0dfa30ee176Ab653E89F40' },
    { chain: 'POLYGON', contract: '0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89' },
    { chain: 'ARBITRUM', contract: '0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F' },
    { chain: 'AVALANCHE', contract: '0xD24C2Ad096400B6FBcd2ad8B24E7acBc21A1da64' },
  ], minWithdraw: '10', fee: '1' },

  // Major altcoins
  { symbol: 'XRP', name: 'XRP', type: 'crypto', decimals: 6, chains: [
    { chain: 'ETH', contract: '0x628F76eAB0C1298F7a24d337bBbF1ef8A1Ea6A24' },
    { chain: 'BSC', contract: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE' },
  ], minWithdraw: '10', fee: '0.25' },

  { symbol: 'DOGE', name: 'Dogecoin', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43' },
    { chain: 'ETH', contract: '0x4206931337dc273a630d328dA6441786BfaD668f' },
  ], minWithdraw: '50', fee: '5' },

  { symbol: 'ADA', name: 'Cardano', type: 'crypto', decimals: 6, chains: [
    { chain: 'BSC', contract: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'SHIB', name: 'Shiba Inu', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' },
    { chain: 'BSC', contract: '0x2859e4544C4bB03966803b044A93563Bd2D0DD4D' },
    { chain: 'POLYGON', contract: '0x6f8a06447Ff6FcF75d803135a7de15CE88C1d4ec' },
  ], minWithdraw: '500000', fee: '50000' },

  { symbol: 'LINK', name: 'Chainlink', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
    { chain: 'BSC', contract: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD' },
    { chain: 'POLYGON', contract: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39' },
    { chain: 'ARBITRUM', contract: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4' },
    { chain: 'AVALANCHE', contract: '0x5947BB275c521040051D82396192181b413227A3' },
  ], minWithdraw: '0.5', fee: '0.1' },

  { symbol: 'UNI', name: 'Uniswap', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' },
    { chain: 'BSC', contract: '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1' },
    { chain: 'POLYGON', contract: '0xb33EaAd8d922B1083446DC23f610c2567fB5180f' },
    { chain: 'ARBITRUM', contract: '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'WBTC', name: 'Wrapped Bitcoin', type: 'crypto', decimals: 8, chains: [
    { chain: 'ETH', contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
    { chain: 'POLYGON', contract: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6' },
    { chain: 'ARBITRUM', contract: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f' },
    { chain: 'AVALANCHE', contract: '0x50b7545627a5162F82A992c33b87aDc75187B218' },
  ], minWithdraw: '0.0001', fee: '0.00005' },

  { symbol: 'LTC', name: 'Litecoin', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0x4338665CBB7B2485A8855A139b75D5e34AB0DB94' },
    { chain: 'ETH', contract: '0x6B175474E89094C44Da98b954EedhceCB5dE86C' },
  ], minWithdraw: '0.01', fee: '0.001' },

  { symbol: 'BCH', name: 'Bitcoin Cash', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0x8fF795a6F4D97E7887C79beA79aba5cc76444aDf' },
  ], minWithdraw: '0.01', fee: '0.001' },

  { symbol: 'ATOM', name: 'Cosmos', type: 'crypto', decimals: 6, chains: [
    { chain: 'ETH', contract: '0x8D983cb9388EaC77af0474fA441C4815500Cb7BB' },
    { chain: 'BSC', contract: '0x0Eb3a705fc54725037CC9e008bDede697f62F335' },
  ], minWithdraw: '0.5', fee: '0.05' },

  { symbol: 'DOT', name: 'Polkadot', type: 'crypto', decimals: 10, chains: [
    { chain: 'BSC', contract: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402' },
    { chain: 'ETH', contract: '0x7f8e0d4c6c7D97E2Df8e97f49BB3E9E68e3e6c3C' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'ICP', name: 'Internet Computer', type: 'crypto', decimals: 8, chains: [
    { chain: 'ETH', contract: '0x054B8f99D15cC5B35a42a926635977d62692F25b' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'FIL', name: 'Filecoin', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x6e1A19F235bE7ED8E3369eF73b196C07257494DE' },
    { chain: 'BSC', contract: '0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'APT', name: 'Aptos', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0x0b15Ddf19D47E6a86A56148fb4aFFFc6929BcB89' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'NEAR', name: 'NEAR Protocol', type: 'crypto', decimals: 24, chains: [
    { chain: 'ETH', contract: '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'AAVE', name: 'Aave', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9' },
    { chain: 'BSC', contract: '0xfb6115445Bff7b52FeB98650C87f44907E58f802' },
    { chain: 'POLYGON', contract: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B' },
    { chain: 'AVALANCHE', contract: '0x63a72806098Bd3D9520cC43356dD78afe5D386D9' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'MKR', name: 'Maker', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2' },
    { chain: 'BSC', contract: '0x5f0Da599BB2ccCfcf6Fdfd7D81743cABC279e1b9' },
    { chain: 'POLYGON', contract: '0x6f7C932e7684666C9fd1d44527765433e01fF61d' },
  ], minWithdraw: '0.01', fee: '0.001' },

  { symbol: 'GRT', name: 'The Graph', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7' },
    { chain: 'BSC', contract: '0x52CE071Bd9b1C4B00A0b92D298c512478CaD67e8' },
    { chain: 'POLYGON', contract: '0x5fe2B58c013d7601147DcdD68C143A77499f5531' },
    { chain: 'ARBITRUM', contract: '0x9623063377AD1B27544C965cCd7342f7EA7e88C7' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'SNX', name: 'Synthetix', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F' },
    { chain: 'POLYGON', contract: '0x50B728D8D964fd00C2d0AAD81718b71311feF68a' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'CRV', name: 'Curve DAO Token', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xD533a949740bb3306d119CC777fa900bA034cd52' },
    { chain: 'POLYGON', contract: '0x172370d5Cd63279eFa6d502DAB29171933a610AF' },
    { chain: 'ARBITRUM', contract: '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978' },
    { chain: 'AVALANCHE', contract: '0x47536F17F4fF30e64A96a7555826b8f9e66ec468' },
  ], minWithdraw: '5', fee: '0.5' },

  { symbol: 'LDO', name: 'Lido DAO', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32' },
    { chain: 'POLYGON', contract: '0xC3C7d422809852031b44ab29EEC9F1EfF2A58756' },
    { chain: 'ARBITRUM', contract: '0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'RNDR', name: 'Render Token', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24' },
    { chain: 'POLYGON', contract: '0x61299774020dA444Af134c82fa83E3810b309991' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'INJ', name: 'Injective', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xe28b3B32B6c345A34Ff64674606124Dd5Aceca30' },
    { chain: 'BSC', contract: '0xa2B726B1145A4773F68593CF171187d8EBe4d495' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'IMX', name: 'Immutable X', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'OP', name: 'Optimism', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x4200000000000000000000000000000000000042' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'FTM', name: 'Fantom', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x4E15361FD6b4BB609Fa63C81A2be19d873717870' },
    { chain: 'BSC', contract: '0xAD29AbB318791D579433D831ed122aFeAf29dcfe' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'SAND', name: 'The Sandbox', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x3845badAde8e6dFF049820680d1F14bD3903a5d0' },
    { chain: 'BSC', contract: '0x67b725d7e342d7B611fa85e859Df9697D9378B2e' },
    { chain: 'POLYGON', contract: '0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'MANA', name: 'Decentraland', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942' },
    { chain: 'BSC', contract: '0x26433c8127d9b4e9B71Eaa15111DF99Ea2EeB2f8' },
    { chain: 'POLYGON', contract: '0xA1c57f48F0Deb89f569dFbe6E2B7f46D33606fD4' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'AXS', name: 'Axie Infinity', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b' },
    { chain: 'BSC', contract: '0x715D400F88C167884bbCc41C5FeA407ed4D2f8A0' },
  ], minWithdraw: '0.5', fee: '0.05' },

  { symbol: 'APE', name: 'ApeCoin', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x4d224452801ACEd8B2F0aebE155379bb5D594381' },
    { chain: 'BSC', contract: '0xC762043E211571eB34f1ef377e5e8e76914962f9' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'PEPE', name: 'Pepe', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x6982508145454Ce325dDbE47a25d4ec3d2311933' },
    { chain: 'BSC', contract: '0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00' },
  ], minWithdraw: '1000000', fee: '100000' },

  { symbol: 'WLD', name: 'Worldcoin', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x163f8C2467924be0ae7B5347228CABF260318753' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'STX', name: 'Stacks', type: 'crypto', decimals: 6, chains: [
    { chain: 'ETH', contract: '0x006BeA43Baa3f7A6f765F14f10A1a1b08334EF45' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'HBAR', name: 'Hedera', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0x3e8C067a5A1E41E0E5BD4f5C3E94C9B4C7c4C7C4' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'ALGO', name: 'Algorand', type: 'crypto', decimals: 6, chains: [
    { chain: 'BSC', contract: '0x78D9D80E67bC80A11efbf84B7c8A65Da51a8EF3C' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'VET', name: 'VeChain', type: 'crypto', decimals: 18, chains: [
    { chain: 'BSC', contract: '0x6FDcdfef7c496407cCb0cEC90f9C5Aaa1Cc8D888' },
    { chain: 'ETH', contract: '0xD850942eF8811f2A866692A623011bDE52a462C1' },
  ], minWithdraw: '100', fee: '10' },

  { symbol: 'EGLD', name: 'MultiversX', type: 'crypto', decimals: 18, chains: [
    { chain: 'BSC', contract: '0xbF7c81FFF98BbE61B40Ed186e4AfD6DDd01337fe' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'XLM', name: 'Stellar', type: 'crypto', decimals: 7, chains: [
    { chain: 'BSC', contract: '0x43C934A845205F0b514417d757d7235B8f53f1B9' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'THETA', name: 'Theta Network', type: 'crypto', decimals: 18, chains: [
    { chain: 'BSC', contract: '0xd7e2A01a9963E35e207f86f775a6E96c17B97b52' },
    { chain: 'ETH', contract: '0x3883f5e181fccaF8410FA61e12b59BAd963fb645' },
  ], minWithdraw: '5', fee: '0.5' },

  { symbol: 'XMR', name: 'Monero', type: 'crypto', decimals: 12, chains: [
    { chain: 'BSC', contract: '0x465E2d214B58b57f0b6E86c904b0B483D0eD8Cd5' },
  ], minWithdraw: '0.01', fee: '0.001' },

  { symbol: 'EOS', name: 'EOS', type: 'crypto', decimals: 4, chains: [
    { chain: 'BSC', contract: '0x56b6fB708fC5732DEC1Afc8D8556423A2EDcCbD6' },
    { chain: 'ETH', contract: '0x86Fa049857E0209aa7D9e616F7eb3b3B78ECfdb0' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'FLOW', name: 'Flow', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0x9eA8fD68Bb3AAc65c1B71eb58f0D3e3d2d5A0e1d' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'NEO', name: 'Neo', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0xA9c2dD27E6C3f5E3f2e5F3F8F3E3E3E3E3E3E3E3' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'KLAY', name: 'Klaytn', type: 'crypto', decimals: 18, chains: [
    { chain: 'BSC', contract: '0x5Fd6e1E3e3E3E3E3E3E3E3E3E3E3E3E3E3E3E3E3' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'RUNE', name: 'THORChain', type: 'crypto', decimals: 8, chains: [
    { chain: 'ETH', contract: '0x3155BA85D5F96b2d030a4966AF206230e46849cb' },
    { chain: 'BSC', contract: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' },
  ], minWithdraw: '0.5', fee: '0.05' },

  { symbol: 'CHZ', name: 'Chiliz', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x3506424F91fD33084466F402d5D97f05F8e3b4AF' },
    { chain: 'BSC', contract: '0x9Fb83c0635De2E815fd1c21b3a292277540C2e8d' },
  ], minWithdraw: '50', fee: '5' },

  { symbol: 'ENJ', name: 'Enjin Coin', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xF629cBd94d3791C9250152BD8dfBDF380E2a3B9c' },
    { chain: 'BSC', contract: '0xC9849E6fdB743d08fAeE3E34dd2D1bc69EA11a51' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'COMP', name: 'Compound', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xc00e94Cb662C3520282E6f5717214004A7f26888' },
    { chain: 'BSC', contract: '0x52CE071Bd9b1C4B00A0b92D298c512478CaD67e8' },
    { chain: 'POLYGON', contract: '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'BAT', name: 'Basic Attention Token', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x0D8775F648430679A709E98d2b0Cb6250d2887EF' },
    { chain: 'BSC', contract: '0x101d82428437127bF1608F699CD651e6Abf9766E' },
    { chain: 'POLYGON', contract: '0x3Cef98bb43d732E2F285eE605a8158cDE967D219' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'ZEC', name: 'Zcash', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0x1Ba42e5193dfA8B03D15dd1B86a3113bbBEF8Eeb' },
  ], minWithdraw: '0.01', fee: '0.001' },

  { symbol: 'DASH', name: 'Dash', type: 'crypto', decimals: 8, chains: [
    { chain: 'BSC', contract: '0xEC7bca19AcF1F9b7CBE1f24c0E75F485C22B0826' },
  ], minWithdraw: '0.01', fee: '0.001' },

  { symbol: 'ZIL', name: 'Zilliqa', type: 'crypto', decimals: 12, chains: [
    { chain: 'BSC', contract: '0xb86AbCb37C3A4B64f74f59301AFF131a1BEcC787' },
    { chain: 'ETH', contract: '0x05f4a42e251f2d52b8ed15E9FEdAacFcEF1FAD27' },
  ], minWithdraw: '100', fee: '10' },

  { symbol: 'IOTA', name: 'IOTA', type: 'crypto', decimals: 6, chains: [
    { chain: 'BSC', contract: '0xd944f1D1e9d5f9Bb90b62f9D45e447D989580782' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'YFI', name: 'yearn.finance', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e' },
    { chain: 'BSC', contract: '0x88f1A5ae2A3BF98AEAF342D26B30a79438c9142e' },
  ], minWithdraw: '0.001', fee: '0.0001' },

  { symbol: 'SUSHI', name: 'SushiSwap', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2' },
    { chain: 'BSC', contract: '0x947950BcC74888a40Ffa2593C5798F11Fc9124C4' },
    { chain: 'POLYGON', contract: '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a' },
    { chain: 'ARBITRUM', contract: '0xd4d42F0b6DEF4CE0383636770eF773390d85c61A' },
    { chain: 'AVALANCHE', contract: '0x37B608519F91f70F2EeB0e5Ed9AF4061722e4F76' },
  ], minWithdraw: '5', fee: '0.5' },

  { symbol: '1INCH', name: '1inch Network', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x111111111117dC0aa78b770fA6A738034120C302' },
    { chain: 'BSC', contract: '0x111111111117dC0aa78b770fA6A738034120C302' },
    { chain: 'POLYGON', contract: '0x9c2C5fd7b07E95EE044DDeba0E97a665F142394f' },
    { chain: 'ARBITRUM', contract: '0x6314C31A7a1652cE482cffe247E9CB7c3f4BB9aF' },
  ], minWithdraw: '5', fee: '0.5' },

  { symbol: 'GALA', name: 'Gala', type: 'crypto', decimals: 8, chains: [
    { chain: 'ETH', contract: '0xd1d2Eb1B1e90B638588728b4130137D262C87cae' },
    { chain: 'BSC', contract: '0x7dDEE176F665cD201F93eEDE625770E2fD911990' },
  ], minWithdraw: '100', fee: '10' },

  { symbol: 'GMT', name: 'STEPN', type: 'crypto', decimals: 8, chains: [
    { chain: 'ETH', contract: '0xe3c408BD53c31C085a1746AF401A4042954ff740' },
    { chain: 'BSC', contract: '0x3019BF2a2eF8040C242C9a4c5c4BD4C81678b2A1' },
    { chain: 'SOLANA', contract: '7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'MASK', name: 'Mask Network', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x69af81e73A73B40adF4f3d4223Cd9b1ECE623074' },
    { chain: 'BSC', contract: '0x2eD9a5C8C13b93955103B9a7C167B67Ef4d568a3' },
    { chain: 'POLYGON', contract: '0x2B9E7ccDF0F4e5B24757c1E1a80e311E34Cb10c7' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'DYDX', name: 'dYdX', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x92D6C1e31e14520e676a687F0a93788B716BEff5' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'LRC', name: 'Loopring', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xBBbbCA6A901c926F240b89EacB641d8Aec7AEafD' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'ENS', name: 'Ethereum Name Service', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'BLUR', name: 'Blur', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x5283D291DBCF85356A21bA090E6db59121208b44' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'FXS', name: 'Frax Share', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0' },
    { chain: 'BSC', contract: '0xe48A3d7d0Bc88d552f730B62c006bC925eadB9eE' },
    { chain: 'POLYGON', contract: '0x1a3acf6D19267E2d3e7f898f42803e90C9219062' },
  ], minWithdraw: '0.5', fee: '0.05' },

  { symbol: 'RPL', name: 'Rocket Pool', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xD33526068D116cE69F19A9ee46F0bd304F21A51f' },
    { chain: 'ARBITRUM', contract: '0xB766039cc6DB368759C1E56B79AFfE831d0Cc507' },
  ], minWithdraw: '0.1', fee: '0.01' },

  { symbol: 'AGIX', name: 'SingularityNET', type: 'crypto', decimals: 8, chains: [
    { chain: 'ETH', contract: '0x5B7533812759B45C2B44C19e320ba2cD2681b542' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'FET', name: 'Fetch.ai', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85' },
    { chain: 'BSC', contract: '0x031b41e504677879370e9DBcF937283A8691Fa7f' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'OCEAN', name: 'Ocean Protocol', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x967da4048cD07aB37855c090aAF366e4ce1b9F48' },
    { chain: 'BSC', contract: '0xDCe07662CA8EbC241316a15B611c89711414Dd1a' },
    { chain: 'POLYGON', contract: '0x282d8efCe846A88B159800bd4130ad77443Fa1A1' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'ROSE', name: 'Oasis Network', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x26B80FBfC01b71495f477d5237071242e0d959d7' },
    { chain: 'BSC', contract: '0xF00600eBC7633462BC4F9C61eA2cE99F5AAEBd4a' },
  ], minWithdraw: '50', fee: '5' },

  { symbol: 'ANKR', name: 'Ankr', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x8290333ceF9e6D528dD5618Fb97a76f268f3EDD4' },
    { chain: 'BSC', contract: '0xf307910A4c7bbc79691fD374889b36d8531B08e3' },
    { chain: 'POLYGON', contract: '0x101A023270368c0D50BFfb62780F4aFd4ea79C35' },
  ], minWithdraw: '100', fee: '10' },

  { symbol: 'SSV', name: 'ssv.network', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54' },
  ], minWithdraw: '0.5', fee: '0.05' },

  { symbol: 'OSMO', name: 'Osmosis', type: 'crypto', decimals: 6, chains: [
    { chain: 'ETH', contract: '0xD52BBF229099c79b7C5A0cE4bBb2D67A4d1D4C7f' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'CELO', name: 'Celo', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x3294395e62F4eB6aF3f1Fcf89f5602D90Fb3Ef69' },
  ], minWithdraw: '5', fee: '0.5' },

  { symbol: 'KCS', name: 'KuCoin Token', type: 'crypto', decimals: 6, chains: [
    { chain: 'ETH', contract: '0xf34960d9d60be18cC1D5Afc1A6F012A723a28811' },
  ], minWithdraw: '0.5', fee: '0.05' },

  { symbol: 'HT', name: 'Huobi Token', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x6f259637dcD74C767781E37Bc6133cd6A68aa161' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'BONE', name: 'Bone ShibaSwap', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x9813037ee2218799597d83D4a5B6F3b6778218d9' },
  ], minWithdraw: '5', fee: '0.5' },

  { symbol: 'FLOKI', name: 'Floki Inu', type: 'crypto', decimals: 9, chains: [
    { chain: 'ETH', contract: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E' },
    { chain: 'BSC', contract: '0xfb5B838b6cfEEdC2873aB27866079AC55363D37E' },
  ], minWithdraw: '10000', fee: '1000' },

  { symbol: 'MEME', name: 'Memecoin', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xb131f4A55907B10d1F0A50d8ab8FA09EC342cd74' },
  ], minWithdraw: '100', fee: '10' },

  { symbol: 'WOO', name: 'WOO Network', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x4691937a7508860F876c9c0a2a617E7d9E945D4B' },
    { chain: 'BSC', contract: '0x4691937a7508860F876c9c0a2a617E7d9E945D4B' },
    { chain: 'POLYGON', contract: '0x1B815d120B3eF02039Ee11dC2d33DE7aA4a8C603' },
    { chain: 'ARBITRUM', contract: '0xcAFcD85D8ca7Ad1e1C6F82F651fA15E33AEfD07b' },
    { chain: 'AVALANCHE', contract: '0xaBC9547B534519fF73921b1FBA6E672b5f58D083' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'CAKE', name: 'PancakeSwap', type: 'crypto', decimals: 18, chains: [
    { chain: 'BSC', contract: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' },
    { chain: 'ETH', contract: '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898' },
    { chain: 'ARBITRUM', contract: '0x1b896893dfc86bb67Cf57767b9c1B4c4d8bf0C94' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'GMX', name: 'GMX', type: 'crypto', decimals: 18, chains: [
    { chain: 'ARBITRUM', contract: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a' },
    { chain: 'AVALANCHE', contract: '0x62edc0692BD897D2295872a9FFCac5425011c661' },
  ], minWithdraw: '0.05', fee: '0.005' },

  { symbol: 'PENDLE', name: 'Pendle', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0x808507121B80c02388fAd14726482e061B8da827' },
    { chain: 'ARBITRUM', contract: '0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'JTO', name: 'Jito', type: 'crypto', decimals: 9, chains: [
    { chain: 'SOLANA', contract: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL' },
  ], minWithdraw: '0.5', fee: '0.05' },

  { symbol: 'PYTH', name: 'Pyth Network', type: 'crypto', decimals: 6, chains: [
    { chain: 'SOLANA', contract: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3' },
    { chain: 'ETH', contract: '0xefC921459dcb66c9e80f3b825C2Ec5c6E9D7D9f7' },
  ], minWithdraw: '10', fee: '1' },

  { symbol: 'BONK', name: 'Bonk', type: 'crypto', decimals: 5, chains: [
    { chain: 'SOLANA', contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
    { chain: 'ETH', contract: '0x1151CB3d861920e07a38e03eEAd12C32178567F6' },
  ], minWithdraw: '1000000', fee: '100000' },

  { symbol: 'JUP', name: 'Jupiter', type: 'crypto', decimals: 6, chains: [
    { chain: 'SOLANA', contract: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  ], minWithdraw: '5', fee: '0.5' },

  { symbol: 'RAY', name: 'Raydium', type: 'crypto', decimals: 6, chains: [
    { chain: 'SOLANA', contract: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'ORCA', name: 'Orca', type: 'crypto', decimals: 6, chains: [
    { chain: 'SOLANA', contract: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE' },
  ], minWithdraw: '1', fee: '0.1' },

  { symbol: 'WETH', name: 'Wrapped Ether', type: 'crypto', decimals: 18, chains: [
    { chain: 'ETH', contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
    { chain: 'POLYGON', contract: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' },
    { chain: 'ARBITRUM', contract: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
    { chain: 'AVALANCHE', contract: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB' },
  ], minWithdraw: '0.001', fee: '0.0005' },
];

// Fiat currencies to keep
const FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];

async function main() {
  try {
    console.log('Starting token import...\n');

    // Get existing currencies to avoid duplicates
    const existing = await pool.query('SELECT symbol, blockchain_id FROM currencies');
    const existingSet = new Set(existing.rows.map(r => `${r.symbol}-${r.blockchain_id}`));
    console.log(`Found ${existing.rows.length} existing currencies\n`);

    let totalAdded = 0;
    let skipped = 0;

    // Add each token
    for (const token of TOP_TOKENS) {
      console.log(`Adding ${token.symbol} (${token.name})...`);
      
      for (const chainInfo of token.chains) {
        const blockchainId = CHAINS[chainInfo.chain];
        if (!blockchainId) {
          console.log(`  ⚠ Unknown chain: ${chainInfo.chain}`);
          continue;
        }

        const decimals = chainInfo.decimals || token.decimals;
        const chainSuffix = token.chains.length > 1 ? ` (${chainInfo.chain})` : '';
        const name = token.name + chainSuffix;
        const logoUrl = `/assets/upload/currency-logo/${token.symbol.toLowerCase()}.svg`;

        // Check if already exists
        const key = `${token.symbol}-${blockchainId}`;
        if (existingSet.has(key)) {
          // Update existing currency with logo and contract
          await pool.query(`
            UPDATE currencies SET 
              logo_url = $1,
              contract_address = COALESCE(contract_address, $2),
              min_withdrawal = $3,
              withdrawal_fee = $4
            WHERE symbol = $5 AND blockchain_id = $6
          `, [logoUrl, chainInfo.contract, token.minWithdraw, token.fee, token.symbol, blockchainId]);
          console.log(`  ↻ Updated on ${chainInfo.chain}`);
          skipped++;
          continue;
        }

        try {
          await pool.query(`
            INSERT INTO currencies (
              symbol, name, currency_type, blockchain_id, contract_address,
              decimals, display_decimals, logo_url, is_active, is_listed,
              deposit_enabled, withdrawal_enabled, min_deposit, min_withdrawal,
              withdrawal_fee, withdrawal_fee_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          `, [
            token.symbol,
            name,
            token.type,
            blockchainId,
            chainInfo.contract,
            decimals,
            8,
            logoUrl,
            true,
            true,
            true,
            true,
            0,
            token.minWithdraw,
            token.fee,
            'fixed'
          ]);
          totalAdded++;
          console.log(`  ✓ Added on ${chainInfo.chain}`);
        } catch (err) {
          console.log(`  ✗ Error on ${chainInfo.chain}: ${err.message}`);
        }
      }
    }

    console.log(`\n✅ Import complete! Added ${totalAdded} new currencies, updated ${skipped} existing.`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

main();
