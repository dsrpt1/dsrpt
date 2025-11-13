# Oracle Diagnosis Report - DSRPT

**Date**: 2025-11-13
**Oracle Address**: `0x10392145F79222990D1aB50049bEB3749eb1983E`
**Network**: Base Mainnet (Chain ID 8453)

---

## Executive Summary

✅ **Root cause identified**: Oracle deployed with invalid Chainlink feed address
✅ **Impact**: All `latestPrice()` calls revert (system gracefully falls back to volatile regime)
✅ **Solution**: Redeploy oracle with correct feed address
✅ **Correct feed verified**: Official Chainlink documentation confirms address

---

## Diagnostic Results

### 1. Current Configuration (INCORRECT)

```
Oracle Adapter: 0x10392145F79222990D1aB50049bEB3749eb1983E
Chainlink Feed: 0x2489462e64ea205386b7b8737609b3701047a77d ❌
```

**Issue**: NO CONTRACT exists at this address on Base Mainnet
- eth_getCode returns: `0x` (no bytecode)
- This causes all Chainlink price queries to fail
- Confirmed via RPC call to Base Mainnet

### 2. Correct Configuration (VERIFIED)

```
Chainlink USDC/USD Feed: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B ✅
```

**Verification**:
- ✅ Contract exists on Base Mainnet
- ✅ Returns valid price data: ~$0.99982 (as of diagnostic)
- ✅ Confirmed by official Chainlink documentation: https://data.chain.link/feeds/base/base/usdc-usd
- ✅ Listed as "Standard" proxy contract
- ✅ Product: USDC/USD-RefPrice-DF-Base-001

**Feed Details**:
- Network: Base Mainnet
- Tier: Low Market Risk
- Deviation Threshold: 0.3%

### 3. Alternative Feeds Tested

The following addresses were tested but **DO NOT exist on Base Mainnet**:
- ❌ `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` - No contract
- ❌ `0x986b5E1e1755e3C2440e960477f25201B0a8bbD4` - No contract
- ❌ `0x84E045745ED829c5b778aBB17104FC2600020850` - No contract
- ❌ `0x37be050e75C7F0a80F0E8abBFC2c4Ff826728cAa` - No contract
- ❌ `0xfB6471ACD42c91FF265344Ff73E88353521d099F` - No contract
- ❌ `0xEa674bBC33AE708Bc9EB4ba348b04E4eB55b496b` - No contract

**Note**: These addresses are for **Ethereum Mainnet**, not Base Mainnet.

---

## Impact Assessment

### System Behavior (Current)

✅ **Graceful Degradation Working**:
- Regime detector catches revert error
- Falls back to "volatile" regime
- Uses conservative middle-ground pricing
- Policies can still be created
- No system crashes or failures

❌ **Missing Functionality**:
- No automatic regime detection (calm/volatile/crisis)
- Cannot adjust premiums based on real USDC price
- Oracle-dependent features unavailable
- Suboptimal pricing for users and LPs

### Example Error Message

```
Error fetching oracle data: The contract function "latestPrice" reverted.
Contract Call:
  address:   0x10392145F79222990D1aB50049bEB3749eb1983E
  function:  latestPrice(bytes32 assetId)
  args:      (0x0000000000000000000000000000000000000000000000000000000000000000)

Defaulting to volatile regime.
```

---

## Solution: Redeploy Oracle

### Step 1: Update Deployment Script

File: `packages/contracts/script/DeployBaseSecure.s.sol`

```solidity
// CORRECT address for Base Mainnet
address chainlinkUsdcUsd = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B;

DepegOracleAdapter adapter = new DepegOracleAdapter(
    AggregatorV3Interface(chainlinkUsdcUsd), // ✅ Correct feed
    deployer,                                 // owner
    keeper,                                   // keeper
    99_500_000,                              // $0.995 threshold (1e8)
    3600                                      // 1 hour max stale
);
```

### Step 2: Redeploy Contract

```bash
cd packages/contracts

# Set environment variables
export PRIVATE_KEY="your_deployer_private_key"
export BASE_MAINNET_RPC="your_base_rpc_url"

# Deploy
forge script script/DeployBaseSecure.s.sol \
    --rpc-url $BASE_MAINNET_RPC \
    --private-key $PRIVATE_KEY \
    --broadcast \
    --verify

# Note the new DepegOracleAdapter address from deployment output
```

### Step 3: Update PolicyManager

```bash
# Set the new oracle address
export NEW_ORACLE_ADDRESS="0x..." # From deployment output
export POLICY_MANAGER="0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1"
export OWNER_KEY="your_owner_private_key"

# Update PolicyManager to use new oracle
cast send $POLICY_MANAGER \
    "setOracle(address)" \
    $NEW_ORACLE_ADDRESS \
    --private-key $OWNER_KEY \
    --rpc-url $BASE_MAINNET_RPC

# Verify the update
cast call $POLICY_MANAGER \
    "oracle()" \
    --rpc-url $BASE_MAINNET_RPC
```

### Step 4: Update Frontend Configuration

File: `packages/web/.env.local`

```bash
# Update oracle address
NEXT_PUBLIC_DEPEG_ADAPTER=0x... # New address from Step 2

# Verify Chainlink feed address is correct
NEXT_PUBLIC_CHAINLINK_USDC_USD=0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

### Step 5: Verify Fix

```bash
# Test the new oracle
cd packages/web
node check-oracle.mjs

# Should show:
# ✅ SUCCESS - Oracle is working!
# Price: $0.9998...
```

---

## Prevention

### For Future Deployments

1. **Always verify Chainlink feed addresses** before deploying:
   - Check official docs: https://docs.chain.link/data-feeds/price-feeds/addresses
   - Verify network (Base vs Ethereum vs others)
   - Test feed returns data: `cast call $FEED "latestRoundData()"`

2. **Add deployment script validation**:
   ```solidity
   // Verify feed exists and has data
   (,int256 answer,,,) = AggregatorV3Interface(chainlinkUsdcUsd).latestRoundData();
   require(answer > 0, "Feed has no data");
   ```

3. **Use network-specific config files**:
   ```
   config/
     base-mainnet.json  ← Separate configs per network
     ethereum-mainnet.json
     base-sepolia.json
   ```

4. **Add CI/CD checks**:
   - Verify contract exists before deployment
   - Test oracle calls in staging environment
   - Automated smoke tests post-deployment

---

## Testing Checklist

After redeploying, verify:

- [ ] Oracle contract deployed successfully
- [ ] Oracle returns valid USDC price (~$0.999-1.001)
- [ ] PolicyManager points to new oracle
- [ ] Regime detector shows actual regime (not fallback)
- [ ] Create test policy - no "Oracle contract not initialized" error
- [ ] Check oracle button in UI works
- [ ] Premium calculation uses real regime detection

---

## Additional Resources

- **Chainlink Base Feeds**: https://docs.chain.link/data-feeds/price-feeds/addresses?network=base
- **USDC/USD Feed Details**: https://data.chain.link/feeds/base/base/usdc-usd
- **Troubleshooting Guide**: `ORACLE_TROUBLESHOOTING.md`
- **Diagnostic Scripts**:
  - `check-oracle-curl.sh` - Shell-based diagnostic
  - `packages/web/check-oracle.mjs` - Node.js diagnostic

---

## Questions?

If issues persist after redeployment:
1. Verify you're on Base Mainnet (chain ID 8453)
2. Check RPC endpoint is working
3. Confirm oracle address in PolicyManager matches deployed address
4. Run diagnostic scripts to verify configuration
5. Check BaseScan for contract verification and read functions

**Current Status**: System functional with fallback, but requires oracle fix for optimal operation.
