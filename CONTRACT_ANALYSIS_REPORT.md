# DSRPT Smart Contract Security & Functionality Analysis
## Comprehensive Contract Audit Report

**Network:** Base Mainnet (Chain ID: 8453)
**Analysis Date:** 2025-11-12
**Analyzer:** Claude (Anthropic)

---

## Executive Summary

The DSRPT protocol consists of 5 core smart contracts implementing a **parametric insurance system** for USDC depeg events. The system uses on-chain oracles for price feeds, a liquidity pool for capital management, and automated risk pricing via hazard curves.

**Overall Risk Assessment:** 🟡 **MEDIUM-HIGH**
- Several contracts are **MVP/prototype implementations** with incomplete functionality
- Missing critical security features (access controls, premium collection, payout distribution)
- Oracle integration present but policy resolution not fully automated

---

## Contract Inventory

| Contract | Address | Status | Purpose |
|----------|---------|--------|---------|
| **PolicyManager** | `0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1` | ⚠️ MVP | Policy lifecycle management |
| **LiquidityPool** | `0xD65D464Cb18D5E89733d0336BC1Ea6e66346a62C` | ⚠️ MVP | Capital pool for payouts |
| **HazardCurveEngine** | `0x2D3680dc7f0f210bd440a83EcCAd92c4d1d290eB` | ⚠️ Basic | Risk pricing (simplified) |
| **DepegOracleAdapter** | `0x10392145F79222990D1aB50049bEB3749eb1983E` | ✅ Functional | Chainlink oracle wrapper |
| **USDC (Token)** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ✅ Official | Base USDC (Circle) |
| **Chainlink USDC/USD** | `0x2489462e64Ea205386b7b8737609B3701047a77d` | ✅ Official | Price oracle |
| **Keeper EOA** | `0x981306c1aE8829F07444249Ce2D8800F89113B74` | 🔑 Private Key | Bot for condition setting |

---

## Detailed Contract Analysis

### 1. PolicyManager (`0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1`)

**Source:** `/packages/contracts/src/PolicyManager.sol`
**Compiler:** Solidity ^0.8.20
**License:** MIT

#### Functionality:
```solidity
contract PolicyManager {
    struct Policy {
        address buyer;
        uint256 payout;
        uint256 premium;
        uint256 startTs;
        uint256 endTs;
        bool resolved;
    }

    // Key Functions:
    - createPolicy(premium, payout, duration) → returns policyId
    - resolve(policyId) → marks policy as resolved
    - setOracle(oracle) → sets oracle adapter
}
```

#### What It Does:
- **Creates insurance policies** with specified premium, payout amount, and duration
- Stores policy data on-chain (buyer, amounts, timestamps, resolution status)
- Tracks next policy ID via auto-incrementing counter
- References external oracle for condition checking

#### Critical Issues: 🔴
1. **No premium collection** - Line 46 comment: "in real life: verify premium via curve, pull premium from buyer"
   - Users can create policies without paying
   - No `asset.transferFrom(msg.sender, address(this), premium)` call

2. **No payout distribution** - Line 60-65: `resolve()` doesn't transfer funds
   - Resolution just sets `resolved = true`
   - No actual USDC transfer to policyholder

3. **No access control** on `resolve()`
   - Anyone can call `resolve()` on any policy
   - Missing `onlyKeeper` or `onlyOracle` modifier

4. **No oracle condition check** - Line 63 comment: "in real life: check oracle condition"
   - Doesn't verify if depeg actually occurred
   - Oracle integration incomplete

5. **No integration with LiquidityPool**
   - Doesn't pull capital from pool for payouts
   - Missing `pool.payoutPolicy()` call

#### Correct Flow (Not Implemented):
```solidity
function createPolicy(...) external {
    require(asset.transferFrom(msg.sender, address(pool), premium));
    // verify premium via curve.premiumOf()
    // store policy
}

function resolve(uint256 id) external onlyKeeper {
    require(oracle.conditionMet(policyId), "condition not met");
    require(!p.resolved, "already resolved");
    require(asset.transferFrom(address(pool), p.buyer, p.payout));
    p.resolved = true;
}
```

---

### 2. LiquidityPool (`0xD65D464Cb18D5E89733d0336BC1Ea6e66346a62C`)

**Source:** `/packages/contracts/src/LiquidityPool.sol`
**Compiler:** Solidity ^0.8.24
**License:** MIT

#### Functionality:
```solidity
contract LiquidityPool {
    IERC20 public immutable asset; // USDC
    address public policyManager;

    // Key Functions:
    - deposit(amount) → LPs deposit USDC
    - withdraw(amount) → LPs withdraw USDC
    - poolAssets() → view total capital
    - setPolicyManager(address) → admin function
}
```

#### What It Does:
- Holds USDC capital from liquidity providers
- Simple deposit/withdraw for LPs
- Tracks total pool assets via `balanceOf(this)`

#### Critical Issues: 🔴
1. **No access control on withdraw** - Line 22-24
   - Anyone can withdraw any amount
   - No LP share tracking or ownership validation
   - Missing: `require(lpShares[msg.sender] >= amt)`

2. **No access control on deposit** - Line 18-20
   - Anyone can deposit (not necessarily bad, but unusual)
   - No LP share minting

3. **No PolicyManager integration**
   - PolicyManager never calls this contract
   - Missing `payoutPolicy()` function for automated payouts

4. **No setPolicyManager access control** - Line 14-16
   - Anyone can change the PolicyManager address
   - Should be `onlyOwner` or set in constructor as immutable

5. **No ERC-4626 vault standard**
   - Not using industry-standard vault interface
   - Missing share-based accounting

#### Correct Flow (Not Implemented):
```solidity
contract LiquidityPool is ERC4626 {
    function deposit(uint256 amt, address receiver) public returns (uint256 shares) {
        shares = previewDeposit(amt);
        asset.transferFrom(msg.sender, address(this), amt);
        _mint(receiver, shares);
    }

    function withdraw(uint256 amt, address receiver, address owner) public returns (uint256 shares) {
        require(msg.sender == owner || allowance[owner][msg.sender] >= shares);
        shares = previewWithdraw(amt);
        _burn(owner, shares);
        asset.transfer(receiver, amt);
    }

    function payoutPolicy(address buyer, uint256 amt) external onlyPolicyManager {
        require(asset.transfer(buyer, amt));
    }
}
```

---

### 3. HazardCurveEngine (`0x2D3680dc7f0f210bd440a83EcCAd92c4d1d290eB`)

**Source:** `/packages/contracts/src/HazardCurveEngine.sol`
**Compiler:** Solidity ^0.8.24
**License:** MIT

#### Functionality:
```solidity
contract HazardCurveEngine {
    struct Curve {
        uint256 baseProbPerDay;
        uint256 slopePerDay;
        uint256 minPremiumBps;
    }

    mapping(bytes32 => Curve) public curves;

    // Key Functions:
    - setCurve(id, curve) → stores risk curve parameters
    - premiumOf(id, coverage, tenorDays) → calculates premium
}
```

#### What It Does:
- Stores risk curves by ID (keccak256 hash)
- Calculates premiums based on coverage amount
- **Formula:** `premium = (coverage × minPremiumBps) / 10,000`

#### Critical Issues: 🟡
1. **Simplified pricing model** - Line 10-14
   - Only uses `minPremiumBps`, ignores `baseProbPerDay` and `slopePerDay`
   - Comment: `/*tenorDays*/` is ignored
   - Not using duration in pricing (time-invariant)

2. **No access control on setCurve** - Line 8
   - Anyone can create or modify curves
   - Should be `onlyOwner` or `onlyAdmin`

3. **Missing actual hazard curve math**
   - Real implementation should use: `prob = baseProbPerDay + (slopePerDay × tenorDays)`
   - Should integrate GPD, Hawkes process (done off-chain in your API)

#### Current vs. Intended:
- **Current:** Simple BPS multiplier (0.5% = 50 bps)
- **Intended:** Full actuarial model with POT/GPD/Hawkes (implemented in `/src/lib/risk/`)

**Note:** This is intentionally simplified - the **real pricing happens off-chain** in your `/api/quote` endpoint using the full GPD+Hawkes model. The on-chain version is just a fallback/safety check.

---

### 4. DepegOracleAdapter (`0x10392145F79222990D1aB50049bEB3749eb1983E`)

**Source:** `/packages/contracts/src/oracle/DepegOracleAdapter.sol`
**Compiler:** Solidity ^0.8.24
**License:** MIT

#### Functionality:
```solidity
contract DepegOracleAdapter is IOracle, Ownable {
    AggregatorV3Interface public immutable feed; // Chainlink
    address public keeper;
    uint256 public threshold1e8; // depeg threshold (e.g., 98000000 = $0.98)
    uint256 public maxStale; // max staleness in seconds

    mapping(bytes32 => bool) public resolved;
    mapping(bytes32 => bool) public condition;

    // Key Functions:
    - latestPrice(assetId) → reads Chainlink, normalizes to 1e8
    - setCondition(policyId, met) → keeper sets if condition met
    - conditionMet(policyId) → returns if policy triggered
    - threshold1e8() → depeg threshold
}
```

#### What It Does:
- Wraps Chainlink USDC/USD price feed
- Normalizes decimals to 1e8 format (Chainlink standard)
- Keeper calls `setCondition()` when USDC < threshold
- Validates price staleness (blocks old data)
- Stores resolution state per policy

#### Security Features: ✅
1. **Staleness check** - Line 65: `require(block.timestamp - ts <= maxStale)`
2. **Threshold validation** - Line 66: Price must be below threshold if `met = true`
3. **One-time resolution** - Line 62: `require(!resolved[policyId])`
4. **Keeper-only** - Line 28: `modifier onlyKeeper()`
5. **Owner controls** - Lines 45-50: Only owner can update params

#### Workflow:
```
1. Chainlink feed updates USDC/USD price
2. Keeper bot monitors price
3. If price < $0.98 (threshold), keeper calls setCondition(policyId, true)
4. PolicyManager can query conditionMet(policyId) → true
5. PolicyManager resolves policy and pays out
```

#### Issues: 🟡
1. **Centralized keeper** - Single EOA has power to trigger payouts
   - Could be compromised or malicious
   - Should use multi-sig or decentralized keeper network (Chainlink Automation)

2. **No direct integration** - PolicyManager doesn't auto-call this
   - Keeper must manually trigger resolution
   - Missing: Chainlink Automation job

---

### 5. USDC Token (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)

**Type:** Official Circle USDC on Base
**Standard:** ERC-20
**Decimals:** 6
**Issuer:** Circle

**Functions Used:**
- `balanceOf(address)` - Check balances
- `transfer(to, amount)` - Send USDC
- `transferFrom(from, to, amount)` - Transfer on behalf (requires approval)
- `approve(spender, amount)` - Authorize spending

**Status:** ✅ Official, audited, widely used

---

### 6. Chainlink Oracle (`0x2489462e64Ea205386b7b8737609B3701047a77d`)

**Type:** Chainlink USDC/USD Price Feed (Base)
**Standard:** AggregatorV3Interface
**Decimals:** 8 (prices in 1e8 format)
**Update Frequency:** ~1-5 minutes (depending on deviation/heartbeat)

**Functions Used:**
- `latestRoundData()` → (roundId, price, startedAt, updatedAt, answeredInRound)
- `decimals()` → 8

**Status:** ✅ Official Chainlink infrastructure

---

## System Architecture

```
┌─────────────┐
│   User UI   │ (Next.js + API)
└──────┬──────┘
       │
       ├─ OFF-CHAIN: /api/quote
       │  ├─ Fetch oracle price
       │  ├─ Detect regime (calm/volatile/crisis)
       │  ├─ Calculate premium (GPD + Hawkes)
       │  └─ Return quote
       │
       └─ ON-CHAIN: Create Policy
          │
          v
    ┌──────────────────┐
    │  PolicyManager   │ ← createPolicy(premium, payout, duration)
    └────────┬─────────┘
             │
             ├─ (NOT IMPLEMENTED) Transfer premium from user
             ├─ Store policy data
             └─ Emit PolicyCreated event

    ┌──────────────────┐
    │ DepegOracleAdapter│ ← Reads Chainlink USDC/USD
    └────────┬─────────┘
             │
             ├─ Keeper monitors price
             ├─ If USDC < $0.98, setCondition(policyId, true)
             └─ PolicyManager can query conditionMet()

    ┌──────────────────┐
    │  LiquidityPool   │ ← (NOT INTEGRATED)
    └────────┬─────────┘
             │
             ├─ LPs deposit USDC
             └─ (SHOULD) Pay out claims to policyholders
```

---

## Critical Gaps & Security Concerns

### 🔴 High Severity

1. **No Premium Collection**
   - PolicyManager doesn't collect USDC from buyers
   - Anyone can create "free" policies
   - **Fix:** Add `asset.transferFrom(msg.sender, address(pool), premium)` in `createPolicy()`

2. **No Payout Distribution**
   - `resolve()` doesn't transfer USDC to policyholders
   - Resolution is just a state change
   - **Fix:** Add `pool.payoutPolicy(p.buyer, p.payout)` in `resolve()`

3. **Unrestricted Pool Withdrawals**
   - Anyone can withdraw any amount from LiquidityPool
   - No LP share tracking
   - **Fix:** Implement ERC-4626 vault with share-based accounting

4. **No Access Control on Critical Functions**
   - `PolicyManager.resolve()` - anyone can resolve
   - `LiquidityPool.setPolicyManager()` - anyone can change
   - `LiquidityPool.withdraw()` - anyone can drain
   - `HazardCurveEngine.setCurve()` - anyone can modify pricing
   - **Fix:** Add `Ownable`, `onlyKeeper`, `onlyPolicyManager` modifiers

### 🟡 Medium Severity

5. **PolicyManager Doesn't Verify Oracle Conditions**
   - Comment says "in real life: check oracle condition"
   - Should call `oracle.conditionMet(policyId)` before resolving
   - **Fix:** Add `require(oracle.conditionMet(bytes32(id)), "condition not met")`

6. **Centralized Keeper**
   - Single EOA controls condition setting
   - Private key compromise = unauthorized payouts
   - **Fix:** Use Chainlink Automation or multi-sig

7. **HazardCurve Ignores Duration**
   - Pricing doesn't factor in tenor (time)
   - Real actuarial model is off-chain only
   - **Fix:** Either implement full on-chain pricing or remove unused params

8. **No Integration Between Contracts**
   - PolicyManager never calls LiquidityPool
   - Oracle adapter not automatically triggered
   - **Fix:** Wire up contract interactions

### 🟢 Low Severity

9. **Missing Events**
   - LiquidityPool has no `Deposit`/`Withdraw` events
   - Hard to track LP activity
   - **Fix:** Add `event Deposit(address indexed user, uint256 amount)`

10. **No Reentrancy Guards**
    - External calls without CEI pattern
    - Low risk since no reentrancy attack surface yet
    - **Fix:** Add `nonReentrant` modifiers

---

## Correct Implementation Example

Here's how the system **should** work:

```solidity
// PolicyManager.sol (CORRECTED)
function createPolicy(uint256 premium, uint256 payout, uint256 duration) external returns (uint256 id) {
    // 1. Verify premium is sufficient
    uint256 requiredPremium = curve.premiumOf(CURVE_ID, payout, duration / 1 days);
    require(premium >= requiredPremium, "insufficient premium");

    // 2. Collect premium from buyer, send to pool
    require(asset.transferFrom(msg.sender, address(pool), premium), "transfer failed");

    // 3. Store policy
    id = nextPolicyId++;
    policies[id] = Policy({
        buyer: msg.sender,
        payout: payout,
        premium: premium,
        startTs: block.timestamp,
        endTs: block.timestamp + duration,
        resolved: false
    });

    emit PolicyCreated(id, msg.sender, premium, payout, block.timestamp, block.timestamp + duration);
}

function resolve(uint256 id) external onlyKeeper {
    Policy storage p = policies[id];
    require(!p.resolved, "already resolved");
    require(block.timestamp >= p.endTs, "policy not expired");

    // Check if depeg condition was met
    bytes32 policyId = bytes32(id);
    bool conditionMet = oracle.conditionMet(policyId);

    if (conditionMet) {
        // Pay out from pool
        pool.payoutPolicy(p.buyer, p.payout);
    }

    p.resolved = true;
    emit PolicyResolved(id, conditionMet);
}
```

```solidity
// LiquidityPool.sol (CORRECTED)
contract LiquidityPool is ERC4626, Ownable {
    address public policyManager;

    constructor(IERC20 _asset) ERC4626(_asset, "DSRPT LP", "dLP") {}

    function setPolicyManager(address pm) external onlyOwner {
        policyManager = pm;
    }

    function payoutPolicy(address buyer, uint256 amt) external {
        require(msg.sender == policyManager, "only PM");
        require(asset.transfer(buyer, amt), "transfer failed");
        emit Payout(buyer, amt);
    }
}
```

---

## Off-Chain Pricing Engine Analysis

**Location:** `/packages/web/src/lib/risk/`

Your off-chain pricing is **sophisticated and production-ready**:

### Components:
1. **hazard.ts** - GPD CDF/PDF, Hawkes process, piecewise payouts
2. **price.ts** - Full actuarial pricing: `Premium = EL + RL + CL + LL + O/H`
3. **regimeDetector.ts** - Auto-detects market regime from oracle

### Pricing Formula:
```
EL = L × p_trigger(T) × E[g(I) | I>u]

Where:
- L = limit (coverage amount)
- p_trigger(T) = 1 - exp(-λ_eff × T)
- λ_eff = μ / (1 - α/β)  (Hawkes stationary rate)
- E[g(I) | I>u] = ∫ g(u+y) × f_GPD(y) dy

Premium = EL + (0.35 × EL) + CL + LL + (0.03 × EL)
```

**This is excellent** - you have institutional-grade pricing off-chain. The on-chain contracts just need to:
1. Verify off-chain quote is reasonable (within bounds)
2. Collect payment
3. Distribute payouts when triggered

---

## Deployment Status Summary

| Contract | Deployed? | Verified? | Functional? | Integration? |
|----------|-----------|-----------|-------------|--------------|
| PolicyManager | ✅ Yes | ❓ Unknown | ⚠️ Partial | ❌ No |
| LiquidityPool | ✅ Yes | ❓ Unknown | ⚠️ Unsafe | ❌ No |
| HazardCurve | ✅ Yes | ❓ Unknown | ⚠️ Simplified | ❌ No |
| DepegOracle | ✅ Yes | ❓ Unknown | ✅ Yes | ⚠️ Manual |
| USDC | ✅ Official | ✅ Yes | ✅ Yes | ✅ Yes |
| Chainlink | ✅ Official | ✅ Yes | ✅ Yes | ✅ Yes |

---

## Recommendations

### Immediate (Before Launch):
1. ✅ **Implement premium collection** in PolicyManager.createPolicy()
2. ✅ **Implement payout distribution** in PolicyManager.resolve()
3. ✅ **Add access controls** (Ownable, onlyKeeper modifiers)
4. ✅ **Fix LiquidityPool withdrawals** (ERC-4626 shares)
5. ✅ **Integrate contracts** (PM → Pool → Oracle)

### Short Term:
6. ✅ **Verify contracts** on Basescan for transparency
7. ✅ **Add comprehensive events** for indexing/monitoring
8. ✅ **Implement reentrancy guards**
9. ✅ **Add pause mechanism** for emergency stops
10. ✅ **Deploy Chainlink Automation** for keeper tasks

### Long Term:
11. ✅ **Professional security audit** (Trail of Bits, OpenZeppelin)
12. ✅ **Decentralize keeper** (multi-sig or keeper network)
13. ✅ **Implement full on-chain pricing** (optional)
14. ✅ **Add governance** for parameter updates
15. ✅ **Bug bounty program** on Immunefi

---

## Conclusion

**Current State:** MVP/Prototype
**Production Readiness:** 🔴 **NOT READY**
**Code Quality:** 🟡 Medium (well-structured but incomplete)
**Security Posture:** 🔴 High Risk (missing critical safeguards)

**The Good:**
- Clean, readable Solidity code
- Excellent off-chain actuarial pricing
- Oracle integration architecture is sound
- Uses official Chainlink and USDC contracts

**The Critical:**
- No money actually moves (premium collection / payout missing)
- No access controls (anyone can do anything)
- Contracts not integrated with each other
- Unsafe pool withdrawals

**Next Steps:**
1. Complete the MVP implementation (add missing transfer logic)
2. Add access controls and security measures
3. Test thoroughly on testnet with real scenarios
4. Get professional security audit
5. Verify contracts on Basescan
6. Deploy keeper automation

**Estimated Work:** 2-3 weeks for a secure MVP, 2-3 months for production-grade system with audit.

---

## Appendix: Contract Addresses

```bash
# Core Protocol
POLICY_MANAGER=0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1
LIQUIDITY_POOL=0xD65D464Cb18D5E89733d0336BC1Ea6e66346a62C
HAZARD_CURVE=0x2D3680dc7f0f210bd440a83EcCAd92c4d1d290eB
DEPEG_ADAPTER=0x10392145F79222990D1aB50049bEB3749eb1983E

# External Dependencies
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
CHAINLINK_USDC_USD=0x2489462e64Ea205386b7b8737609B3701047a77d

# Keeper
KEEPER_EOA=0x981306c1aE8829F07444249Ce2D8800F89113B74
```

**Basescan Links:**
- PolicyManager: https://basescan.org/address/0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1
- LiquidityPool: https://basescan.org/address/0xD65D464Cb18D5E89733d0336BC1Ea6e66346a62C
- HazardCurve: https://basescan.org/address/0x2D3680dc7f0f210bd440a83EcCAd92c4d1d290eB
- DepegAdapter: https://basescan.org/address/0x10392145F79222990D1aB50049bEB3749eb1983E

---

**Report Generated:** 2025-11-12
**Analysis Tools:** Manual code review + architectural analysis
**Disclaimer:** This is not a formal security audit. Engage professional auditors before mainnet launch.
