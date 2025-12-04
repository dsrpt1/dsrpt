#!/usr/bin/env node
// Oracle diagnostic script using viem
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const ORACLE_ADAPTER = process.env.ORACLE_ADDRESS || process.env.NEXT_PUBLIC_DEPEG_ADAPTER || '0x3e28f67Ba8db79194c5A7dd602CA3B8d5CfA7FC6';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org';
const USDC_ASSET_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';

const ORACLE_ABI = [
  {
    type: 'function',
    name: 'feed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'threshold1e8',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'latestPrice',
    stateMutability: 'view',
    inputs: [{ name: 'assetId', type: 'bytes32' }],
    outputs: [
      { name: 'price', type: 'int256' },
      { name: 'updatedAt', type: 'uint256' },
    ],
  },
];

console.log('🔍 DSRPT Oracle Diagnostic');
console.log('==========================\n');
console.log(`📍 Oracle Adapter: ${ORACLE_ADAPTER}`);
console.log(`🌐 RPC URL: ${RPC_URL}\n`);

const client = createPublicClient({
  chain: base,
  transport: http(RPC_URL, {
    timeout: 15_000,
    retryCount: 3,
  }),
});

async function checkOracle() {
  try {
    // Check 1: Get Chainlink feed address
    console.log('1️⃣ Checking Chainlink feed address...');
    const feedAddress = await client.readContract({
      address: ORACLE_ADAPTER,
      abi: ORACLE_ABI,
      functionName: 'feed',
    });
    console.log(`   Feed address: ${feedAddress}`);
    console.log('');

    // Check 2: Get threshold
    console.log('2️⃣ Checking threshold...');
    const threshold = await client.readContract({
      address: ORACLE_ADAPTER,
      abi: ORACLE_ABI,
      functionName: 'threshold1e8',
    });
    const thresholdUSD = Number(threshold) / 1e8;
    console.log(`   Threshold: $${thresholdUSD.toFixed(6)}`);
    console.log('');

    // Check 3: Try to call latestPrice
    console.log('3️⃣ Testing latestPrice() call...');
    try {
      const result = await client.readContract({
        address: ORACLE_ADAPTER,
        abi: ORACLE_ABI,
        functionName: 'latestPrice',
        args: [USDC_ASSET_ID],
      });

      const price = Number(result[0]) / 1e8;
      const updatedAt = Number(result[1]);
      const date = new Date(updatedAt * 1000);

      console.log('   ✅ SUCCESS - Oracle is working!');
      console.log('');
      console.log(`   Price: $${price.toFixed(6)}`);
      console.log(`   Updated: ${date.toISOString()}`);
      console.log(`   Updated: ${date.toLocaleString()}`);
      console.log('');

      if (price < thresholdUSD) {
        console.log('   🚨 DEPEG DETECTED - Price below threshold!');
      } else {
        console.log('   ✅ NORMAL - Price above threshold');
      }
    } catch (error) {
      console.log('   ❌ FAILED - Oracle is reverting');
      console.log(`   Error: ${error.message}`);
      console.log('');
      console.log('🔧 DIAGNOSIS:');
      console.log('   The oracle contract is calling a Chainlink feed that doesn\'t exist');
      console.log('   or doesn\'t have data. You need to redeploy with the correct feed.');
      console.log('');
      console.log('✅ CORRECT CHAINLINK FEED FOR BASE MAINNET:');
      console.log('   USDC/USD: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B');
      console.log('');
      console.log(`📍 Your oracle is configured with: ${feedAddress}`);
      console.log('');

      // Additional check: try to read from the Chainlink feed directly
      console.log('4️⃣ Testing Chainlink feed directly...');
      const CHAINLINK_ABI = [
        {
          type: 'function',
          name: 'latestRoundData',
          stateMutability: 'view',
          inputs: [],
          outputs: [
            { name: 'roundId', type: 'uint80' },
            { name: 'answer', type: 'int256' },
            { name: 'startedAt', type: 'uint256' },
            { name: 'updatedAt', type: 'uint256' },
            { name: 'answeredInRound', type: 'uint80' },
          ],
        },
      ];

      try {
        const feedData = await client.readContract({
          address: feedAddress,
          abi: CHAINLINK_ABI,
          functionName: 'latestRoundData',
        });
        console.log(`   ✅ Chainlink feed exists and has data`);
        console.log(`   Answer: ${Number(feedData[1]) / 1e8}`);
      } catch (feedError) {
        console.log(`   ❌ Chainlink feed error: ${feedError.message}`);
        console.log('   This confirms the feed address is incorrect or unavailable.');
      }
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
  }

  console.log('');
  console.log('📚 See ORACLE_TROUBLESHOOTING.md for detailed fix instructions');
}

checkOracle().catch(console.error);
