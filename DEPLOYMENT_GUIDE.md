# DSRPT Deployment Guide

Complete instructions for downloading the repository and deploying the contracts to Base Mainnet.

---

## Prerequisites

1. **Git** - For cloning the repository
2. **Foundry** - Ethereum development toolkit
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
3. **Base Mainnet RPC URL** - Get from [Alchemy](https://www.alchemy.com/), [QuickNode](https://www.quicknode.com/), or public RPC
4. **Private Key** - Deployer wallet with ETH for gas (estimate: ~0.01 ETH)
5. **Basescan API Key** (optional) - For contract verification

---

## Step 1: Clone the Repository

```bash
# Clone the repo
git clone https://github.com/dsrpt1/dsrpt.git
cd dsrpt

# Navigate to contracts package
cd packages/contracts
```

---

## Step 2: Install Dependencies

```bash
# Install Foundry dependencies
forge install

# Verify installation
forge build
```

If build succeeds, you should see:
```
[⠊] Compiling...
[⠒] Compiling 50 files with Solc 0.8.20
[⠢] Solc 0.8.20 finished in 3.45s
Compiler run successful!
```

---

## Step 3: Configure Deployment Parameters

The configuration file is at `packages/contracts/params/base.json`:

```json
{
  "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "chainlink_usdc_usd": "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B",
  "keeper": "0x981306c1aE8829F07444249Ce2D8800F89113B74",
  "depeg_threshold_1e8": 98000000,
  "max_stale_seconds": 600,
  "curve": {
    "baseProbPerDay": 100,
    "slopePerDay": 1,
    "minPremiumBps": 50
  }
}
```

**Key Parameters**:
- `usdc`: Base Mainnet USDC contract (DO NOT CHANGE)
- `chainlink_usdc_usd`: USDC/USD price feed (✅ FIXED to correct address)
- `keeper`: Bot address for automatic policy resolution (use your address or deployer)
- `depeg_threshold_1e8`: $0.98 = 98000000 (trigger price for depeg)
- `max_stale_seconds`: 600 = 10 minutes (max oracle data age)
- `minPremiumBps`: 50 = 0.5% minimum premium

**Optional**: Update the `keeper` address to your keeper bot address (or leave as deployer address).

---

## Step 4: Set Environment Variables

Create a `.env` file in `packages/contracts/`:

```bash
# Required
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
BASE_MAINNET_RPC=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Optional (for contract verification)
BASESCAN_API_KEY=YOUR_BASESCAN_API_KEY
```

**Security Note**:
- NEVER commit `.env` to git (it's already in `.gitignore`)
- NEVER share your private key
- Use a fresh deployer wallet, not your main wallet

Load the environment:
```bash
source .env
```

---

## Step 5: Dry Run (Simulation)

Test the deployment without broadcasting:

```bash
forge script script/DeployBaseSecure.s.sol \
    --rpc-url $BASE_MAINNET_RPC \
    -vvv
```

This simulates the deployment and shows:
- Estimated gas costs
- Contract addresses (simulated)
- Any errors in deployment logic

---

## Step 6: Deploy to Base Mainnet

**⚠️ IMPORTANT**: This spends real ETH. Make sure you have ~0.01 ETH in your deployer wallet.

```bash
forge script script/DeployBaseSecure.s.sol \
    --rpc-url $BASE_MAINNET_RPC \
    --private-key $PRIVATE_KEY \
    --broadcast \
    --verify \
    --etherscan-api-key $BASESCAN_API_KEY \
    -vvv
```

**Flags explained**:
- `--broadcast`: Actually send transactions (remove for dry run)
- `--verify`: Verify contracts on Basescan
- `-vvv`: Verbose output (show all details)

**Expected Output**:
```
== Logs ==
=== DSRPT Deployment (PRODUCTION-READY) ===
Deployer: 0x...
USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Curve Engine: 0x...
Liquidity Pool: 0x...
Policy Manager: 0x...
Depeg Adapter: 0x...
Keeper: 0x...
Curve ID: 0x...

=== Next Steps ===
1. Verify contracts on Basescan
2. Fund pool with initial liquidity
3. Test policy creation with real USDC
4. Set up keeper bot
5. Get professional security audit
```

**Save these addresses!** You'll need them for:
- Frontend configuration
- Keeper bot setup
- Contract interactions

---

## Step 7: Verify Deployment

Check contracts on BaseScan:

```bash
# Policy Manager
https://basescan.org/address/<POLICY_MANAGER_ADDRESS>

# Liquidity Pool
https://basescan.org/address/<POOL_ADDRESS>

# Oracle Adapter
https://basescan.org/address/<ORACLE_ADDRESS>
```

Verify oracle is working:
```bash
# From project root
cd ../..
NEXT_PUBLIC_RPC_URL=$BASE_MAINNET_RPC node packages/web/check-oracle.mjs
```

Should show:
```
✅ SUCCESS - Oracle is working!
Price: $0.9998...
```

---

## Step 8: Update Frontend Configuration

Update `packages/web/.env.local`:

```bash
# Network
NEXT_PUBLIC_CHAIN_ID=8453
NEXT_PUBLIC_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# Contracts (from deployment output)
NEXT_PUBLIC_POLICY_MANAGER=0x...
NEXT_PUBLIC_LIQUIDITY_POOL=0x...
NEXT_PUBLIC_HAZARD_CURVE=0x...
NEXT_PUBLIC_DEPEG_ADAPTER=0x...

# Tokens
NEXT_PUBLIC_USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Oracle
NEXT_PUBLIC_CHAINLINK_USDC_USD=0x7e860098F58bBFC8648a4311b374B1D669a2bc6B

# Keeper
NEXT_PUBLIC_KEEPER=0x...
```

---

## Step 9: Fund the Liquidity Pool

The pool needs initial liquidity before users can buy policies:

```bash
# Approve USDC (e.g., 10,000 USDC)
cast send 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
    "approve(address,uint256)" \
    <POOL_ADDRESS> \
    10000000000 \
    --private-key $PRIVATE_KEY \
    --rpc-url $BASE_MAINNET_RPC

# Deposit to pool
cast send <POOL_ADDRESS> \
    "deposit(uint256,address)" \
    10000000000 \
    <YOUR_ADDRESS> \
    --private-key $PRIVATE_KEY \
    --rpc-url $BASE_MAINNET_RPC
```

Or use the frontend at `/pool` page.

---

## Step 10: Set Up Keeper Bot

The keeper bot automatically resolves expired policies:

```bash
cd packages/keeper

# Install dependencies
npm install

# Configure .env
cp .env.example .env
# Edit .env with your deployed contract addresses

# Run keeper
npm start
```

Keeper should log:
```
🤖 DSRPT Keeper Bot Starting...
📍 Policy Manager: 0x...
📍 Oracle Adapter: 0x...
✅ Keeper authorized
🔍 Checking policies... (every 60s)
```

---

## Step 11: Test the System

### Create a Test Policy

1. Go to frontend: `http://localhost:3000`
2. Connect wallet (make sure you have USDC on Base)
3. Enter coverage amount (e.g., 100 USDC)
4. Select duration (e.g., 7 days)
5. Click "Create Policy"
6. Approve USDC → Create Policy

### Verify Policy Creation

```bash
# Get next policy ID
cast call <POLICY_MANAGER_ADDRESS> "nextPolicyId()" --rpc-url $BASE_MAINNET_RPC

# View policy details (ID = 1)
cast call <POLICY_MANAGER_ADDRESS> \
    "policies(uint256)" \
    1 \
    --rpc-url $BASE_MAINNET_RPC
```

---

## Troubleshooting

### "Insufficient ETH for gas"
- Fund deployer wallet with more ETH
- Estimate: 0.01-0.02 ETH for deployment

### "Oracle reverting"
- Check oracle address: `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B`
- Run diagnostic: `node packages/web/check-oracle.mjs`
- See `ORACLE_DIAGNOSIS_REPORT.md`

### "Contract verification failed"
- Get Basescan API key: https://basescan.org/apis
- Retry verification: `forge verify-contract <ADDRESS> <CONTRACT> --chain-id 8453`

### "Pool has no liquidity"
- Deposit USDC to pool using Step 9
- Minimum: 1000 USDC recommended

### "Build fails"
- Update Foundry: `foundryup`
- Clean build: `forge clean && forge build`
- Check Solidity version: 0.8.20

---

## Security Checklist

Before mainnet deployment:

- [ ] Audit contracts (professional audit recommended)
- [ ] Test on Base Sepolia testnet first
- [ ] Verify all contract addresses on Basescan
- [ ] Test oracle returns correct prices
- [ ] Test policy creation with small amounts
- [ ] Verify keeper bot resolves policies correctly
- [ ] Set up monitoring and alerts
- [ ] Have emergency pause mechanism ready
- [ ] Document contract admin keys and multisig
- [ ] Test withdrawal from liquidity pool

---

## Quick Reference

### Contract Addresses (Example - Update with Your Deployment)

```
Network: Base Mainnet (Chain ID: 8453)

USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Chainlink USDC/USD: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B

Curve Engine: 0x...
Liquidity Pool: 0x...
Policy Manager: 0x...
Oracle Adapter: 0x...
```

### Useful Commands

```bash
# Check pool balance
cast call <POOL_ADDRESS> "totalAssets()" --rpc-url $BASE_MAINNET_RPC

# Check pool shares
cast call <POOL_ADDRESS> "totalSupply()" --rpc-url $BASE_MAINNET_RPC

# Check oracle price
cast call <ORACLE_ADDRESS> \
    "latestPrice(bytes32)" \
    0x0000000000000000000000000000000000000000000000000000000000000000 \
    --rpc-url $BASE_MAINNET_RPC

# Check policy count
cast call <POLICY_MANAGER_ADDRESS> "nextPolicyId()" --rpc-url $BASE_MAINNET_RPC
```

---

## Support

- **Documentation**: See `/ORACLE_DIAGNOSIS_REPORT.md` for oracle issues
- **Diagnostic Tools**: `check-oracle-curl.sh`, `packages/web/check-oracle.mjs`
- **GitHub Issues**: https://github.com/dsrpt1/dsrpt/issues

---

**Last Updated**: 2025-11-13
**Contracts Version**: v1.0 (Production-Ready with Security Fixes)
**Network**: Base Mainnet
