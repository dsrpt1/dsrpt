# Oracle Troubleshooting Guide

## Issue: "Oracle contract not initialized" Error

If you see the message **"Oracle contract not initialized - using default pricing"** when creating policies, it means the DepegOracleAdapter contract is reverting when called.

### Why This Happens

The `DepegOracleAdapter.latestPrice()` function calls a Chainlink price feed internally. The revert occurs when:

1. **Chainlink feed address is wrong or not set**
2. **Chainlink feed has no data**
3. **The feed contract doesn't exist at that address**

### Current Configuration

Your deployed DepegOracleAdapter is at:
```
0x10392145F79222990D1aB50049bEB3749eb1983E
```

### How to Check the Oracle Configuration

1. **View the contract on BaseScan**:
   ```
   https://basescan.org/address/0x10392145F79222990D1aB50049bEB3749eb1983E#readContract
   ```

2. **Check the `feed` address** (should be the Chainlink USDC/USD aggregator)
3. **Check the `threshold1e8` value** (should be < 100000000, e.g., 99500000 for $0.995)

### Correct Chainlink Feed for Base Mainnet

The correct Chainlink USDC/USD feed on Base Mainnet is:
```
USDC/USD: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

**Important**: Your `.env.local` shows:
```
NEXT_PUBLIC_CHAINLINK_USDC_USD=0x2489462e64Ea205386b7b8737609B3701047a77d
```

This address might be incorrect or for a different network.

### How to Fix

#### Option 1: Verify Current Oracle (Recommended First)

Check if the oracle was deployed with the correct feed address:

```bash
# Using cast (Foundry)
cast call 0x10392145F79222990D1aB50049bEB3749eb1983E "feed()" --rpc-url https://mainnet.base.org

# Expected: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B (or valid Chainlink feed)
```

If the feed address is wrong, proceed to Option 2.

#### Option 2: Deploy New Oracle with Correct Feed

1. **Update deployment script** with correct Chainlink feed:

```solidity
// In DeployBaseSecure.s.sol
address chainlinkUsdcUsd = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B; // Base Mainnet

DepegOracleAdapter adapter = new DepegOracleAdapter(
    AggregatorV3Interface(chainlinkUsdcUsd), // Correct feed
    deployer,                                 // owner
    keeper,                                   // keeper
    99_500_000,                              // $0.995 threshold
    3600                                      // 1 hour max stale
);
```

2. **Redeploy**:
```bash
cd packages/contracts
forge script script/DeployBaseSecure.s.sol \
    --rpc-url $BASE_MAINNET_RPC \
    --private-key $PRIVATE_KEY \
    --broadcast \
    --verify
```

3. **Update environment variables** with new address:
```bash
# packages/web/.env.local
NEXT_PUBLIC_DEPEG_ADAPTER=0x[new_address_here]
```

4. **Update PolicyManager** to use new oracle:
```bash
cast send $POLICY_MANAGER \
    "setOracle(address)" \
    $NEW_ORACLE_ADDRESS \
    --private-key $OWNER_KEY \
    --rpc-url $BASE_MAINNET_RPC
```

#### Option 3: Use Mock Oracle for Testing

If you're still in development/testing:

1. Deploy a simple mock oracle that returns a fixed price
2. Update the PolicyManager to use the mock
3. Test the full flow
4. Replace with real Chainlink oracle before production

### Verify the Fix

After fixing, test the oracle:

```bash
# Test latestPrice call
cast call $ORACLE_ADAPTER \
    "latestPrice(bytes32)" \
    0x0000000000000000000000000000000000000000000000000000000000000000 \
    --rpc-url https://mainnet.base.org

# Should return: price (int256) and timestamp (uint256)
# Example: 99800000 (= $0.998), 1699564800
```

### System Behavior During Oracle Failure

**Good news**: The system gracefully handles oracle failures:

✅ **Regime Detection**: Falls back to "volatile" regime
✅ **Pricing**: Uses middle-ground parameters (not too cheap, not too expensive)
✅ **Policies**: Can still be created and function normally
✅ **Payouts**: Keeper manually checks price when resolving

However, you should fix the oracle for:
- Accurate regime-based pricing
- Automatic price-based regime detection
- Better user experience (no error messages)

### Finding the Correct Chainlink Feed

Visit Chainlink's Data Feeds page:
```
https://docs.chain.link/data-feeds/price-feeds/addresses?network=base
```

Look for:
- **USDC / USD** on **Base Mainnet**
- Verify the address matches: `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B`

### Still Having Issues?

1. **Check RPC endpoint** - Make sure your RPC URL is working
2. **Check network** - Ensure you're on Base Mainnet (chain ID 8453)
3. **Check contract exists** - Verify the oracle address is deployed
4. **Check Chainlink feed** - Verify the feed is returning data

### Contact

If you need help:
1. Check BaseScan for the contract at the deployed address
2. Verify constructor parameters
3. Test with `cast call` commands above
4. Check Chainlink feed directly

---

## Quick Reference

| Item | Address |
|------|---------|
| **Current Oracle Adapter** | `0x10392145F79222990D1aB50049bEB3749eb1983E` |
| **PolicyManager** | `0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1` |
| **Correct Chainlink USDC/USD (Base)** | `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` |
| **Your Config (might be wrong)** | `0x2489462e64Ea205386b7b8737609B3701047a77d` |

**Action**: Verify which Chainlink feed address your oracle was deployed with, and if it's wrong, redeploy with the correct one.
