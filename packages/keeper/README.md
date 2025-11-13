# DSRPT Keeper Bot

Automated keeper bot for resolving expired parametric insurance policies.

## Features

- ✅ Monitors all policies for expiration
- ✅ Checks oracle conditions (USDC price vs threshold)
- ✅ Calls `setCondition()` on DepegOracleAdapter
- ✅ Calls `resolve()` on PolicyManager
- ✅ Automatic retry logic with exponential backoff
- ✅ Comprehensive logging

## Setup

1. **Install dependencies**:
```bash
cd packages/keeper
npm install
```

2. **Configure environment variables**:

Create `.env` file:
```bash
# RPC endpoint for Base Mainnet
RPC_URL=https://mainnet.base.org

# Contract addresses
POLICY_MANAGER=0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1
ADAPTER=0x10392145F79222990D1aB50049bEB3749eb1983E

# Keeper private key (must be the configured keeper address)
KEEPER_PRIVATE_KEY=0x...

# Check interval in milliseconds (default: 60000 = 1 minute)
CHECK_INTERVAL_MS=60000
```

**Security Note**: The keeper EOA must match the `keeper` address set in PolicyManager.

## Running

**Development**:
```bash
npm run dev
```

**Production**:
```bash
npm run build
npm start
```

## How It Works

1. **Every interval** (default 60s):
   - Fetches `nextPolicyId` from PolicyManager
   - Iterates through all policies (1 to nextPolicyId-1)

2. **For each policy**:
   - Reads policy details from PolicyManager
   - Skips if already resolved
   - Skips if not yet expired
   - If expired:
     a. Checks if oracle condition is set
     b. If not set: Fetches USDC price, compares to threshold, calls `setCondition()`
     c. Calls PolicyManager.`resolve()`
     d. Waits for confirmation and logs result

3. **Outcome**:
   - If condition met → Payout distributed to policyholder
   - If condition not met → Premium kept in pool

## Logs Example

```
╔═══════════════════════════════════════╗
║   DSRPT Keeper Bot - ONLINE          ║
╚═══════════════════════════════════════╝
Keeper address: 0x981306c1aE8829F07444249Ce2D8800F89113B74
PolicyManager: 0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1
Oracle Adapter: 0x10392145F79222990D1aB50049bEB3749eb1983E
Check interval: 60s
Network: Base Mainnet

========================================
Keeper heartbeat at 2025-11-13T10:00:00.000Z
========================================
Total policies: 5

--- Checking Policy #1 ---
Policy #1: Already resolved ✓

--- Checking Policy #2 ---
Policy #2: Still active (expires in 2.5h)

--- Checking Policy #3 ---
Policy #3: EXPIRED - Ready to resolve!
  Buyer: 0xabc...def
  Payout: 10000000000
  Premium: 50000000
  Expired at: 2025-11-13T09:45:00.000Z
  Oracle condition not set yet. Checking price...
  Current USDC Price: $0.999800 (threshold: $0.995000)
  Price updated at: 2025-11-13T09:59:30.000Z
  Condition Met: false
  Setting oracle condition...
  ✓ setCondition() tx: 0xabc123...
  ✓ setCondition() confirmed
  Resolving policy on PolicyManager...
  ✓ resolve() tx: 0xdef456...
  ✓ resolve() confirmed in block 12345678

✅ Policy #3 RESOLVED SUCCESSFULLY

========================================
Heartbeat complete. Next check in 60s
========================================
```

## Monitoring

Consider setting up:
- **Process manager**: PM2 or systemd for auto-restart
- **Alerts**: Monitor logs for errors, send to Discord/Telegram
- **Gas monitoring**: Track keeper wallet balance
- **Uptime monitoring**: Pingdom, UptimeRobot

### PM2 Example

```bash
pm2 start dist/index.js --name dsrpt-keeper
pm2 save
pm2 startup
```

## Troubleshooting

**"NotKeeper" error**:
- Ensure KEEPER_PRIVATE_KEY matches the keeper address set in PolicyManager
- Check with: `cast call $POLICY_MANAGER "keeper()" --rpc-url $RPC_URL`

**"PolicyNotExpired" error**:
- Policy hasn't expired yet, keeper will try again on next tick

**"OracleNotSet" error**:
- Oracle address not configured in PolicyManager
- Owner needs to call PolicyManager.`setOracle()`

**RPC rate limiting**:
- Use a paid RPC provider (Alchemy, Infura, etc.)
- Increase CHECK_INTERVAL_MS to reduce requests

## Gas Costs

Per policy resolution:
- `setCondition()`: ~50,000 gas
- `resolve()`: ~100,000 gas
- **Total**: ~150,000 gas per policy

At 1 gwei gas price on Base: ~$0.01 per resolution

Ensure keeper wallet has sufficient ETH for gas.
