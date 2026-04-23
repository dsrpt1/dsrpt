// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ContagionRegistry} from "./ContagionRegistry.sol";
import {ContagionTrigger} from "./ContagionTrigger.sol";

/**
 * @title ContagionPolicyManager
 * @notice Manages contagion cover policies with dilution-based parametric payouts.
 *
 * Two policy types:
 *
 * 1. Position cover (for users/LPs):
 *    Payout = position_size × LTV × (1 - R_breach)
 *    "I have $1M rsETH on Aave at 93% LTV. If rsETH depegs to 82%,
 *     pay me $1M × 0.93 × 0.18 = $167K"
 *
 * 2. Protocol cover (for DAOs):
 *    Payout = Σ(borrows_against_W) × (1 - R_breach), capped at notional
 *    "Aave DAO covers its treasury's bad-debt exposure from rsETH listings"
 *
 * Tranche structure:
 *   Senior (first-loss): pays first 500 bps of dilution (0-5%)
 *     → small notional, high frequency, algorithmic LP carry
 *   Mezzanine: pays 500-2000 bps (5-20%)
 *     → PolicyNFT pool, hazard curve pricing
 *   Catastrophic: pays 2000+ bps (20%+)
 *     → reinsured by large capital providers, macro crypto vol pricing
 *
 * Settlement is automatic: when ContagionTrigger fires, any address
 * can call settlePolicies() to distribute payouts.
 */
contract ContagionPolicyManager {

    // -- Enums -----

    enum PolicyType { Position, Protocol }
    enum PolicyStatus { Active, Settled, Expired, Cancelled }
    enum Tranche { Senior, Mezzanine, Catastrophic }

    // -- Structs -----

    struct Policy {
        uint256    policyId;
        bytes32    assetId;           // wrapped asset this covers
        address    buyer;
        PolicyType policyType;
        Tranche    tranche;
        uint256    notional;          // covered amount in settlement asset
        uint16     ltvBps;            // LTV used for payout calc (position cover)
        uint256    premium;           // premium paid
        uint32     startTime;
        uint32     endTime;
        PolicyStatus status;
        uint256    payout;            // filled on settlement
    }

    struct TrancheConfig {
        uint16  floorBps;      // dilution floor (0 for senior)
        uint16  ceilingBps;    // dilution ceiling (500 for senior, 2000 for mezz)
        uint256 totalCapacity; // max aggregate notional
        uint256 utilized;      // current aggregate notional
    }

    // -- Events -----

    event PolicyCreated(
        uint256 indexed policyId,
        bytes32 indexed assetId,
        address indexed buyer,
        PolicyType policyType,
        Tranche tranche,
        uint256 notional,
        uint256 premium
    );

    event PolicySettled(
        uint256 indexed policyId,
        bytes32 indexed assetId,
        uint256 payout,
        uint16  dilutionBps
    );

    event PoliciesSettled(
        bytes32 indexed assetId,
        uint256 policiesSettled,
        uint256 totalPayout
    );

    event TrancheConfigured(Tranche tranche, uint16 floorBps, uint16 ceilingBps, uint256 capacity);
    event CapitalDeposited(Tranche tranche, address depositor, uint256 amount);

    // -- State -----

    address public owner;
    IERC20 public settlementAsset;       // USDC
    ContagionRegistry public registry;
    ContagionTrigger public trigger;

    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;

    // buyer => array of policy IDs
    mapping(address => uint256[]) public buyerPolicies;

    // assetId => array of active policy IDs
    mapping(bytes32 => uint256[]) public assetPolicies;

    // Tranche configs
    mapping(Tranche => TrancheConfig) public tranches;

    // Tranche capital pools
    mapping(Tranche => uint256) public trancheCapital;

    // -- Modifiers -----

    modifier onlyOwner() {
        require(msg.sender == owner, "ContagionPolicyManager: not owner");
        _;
    }

    // -- Constructor -----

    constructor(
        address _settlementAsset,
        address _registry,
        address _trigger
    ) {
        require(_settlementAsset != address(0), "zero asset");
        require(_registry != address(0), "zero registry");
        require(_trigger != address(0), "zero trigger");

        owner = msg.sender;
        settlementAsset = IERC20(_settlementAsset);
        registry = ContagionRegistry(_registry);
        trigger = ContagionTrigger(_trigger);
        nextPolicyId = 1;

        // Default tranche config
        tranches[Tranche.Senior] = TrancheConfig({
            floorBps: 0,
            ceilingBps: 500,        // 0-5% dilution
            totalCapacity: 0,
            utilized: 0
        });
        tranches[Tranche.Mezzanine] = TrancheConfig({
            floorBps: 500,
            ceilingBps: 2000,       // 5-20% dilution
            totalCapacity: 0,
            utilized: 0
        });
        tranches[Tranche.Catastrophic] = TrancheConfig({
            floorBps: 2000,
            ceilingBps: 10000,      // 20-100% dilution
            totalCapacity: 0,
            utilized: 0
        });
    }

    // =========================================================================
    // Policy Creation
    // =========================================================================

    /**
     * @notice Create a position cover policy.
     *         Payout = notional × ltvBps × dilution / 10000^2
     *         (capped by tranche floor/ceiling)
     */
    function createPositionCover(
        bytes32 assetId,
        uint256 notional,
        uint16  ltvBps,
        Tranche tranche,
        uint32  durationDays,
        uint256 premium
    ) external returns (uint256 policyId) {
        require(notional > 0, "zero notional");
        require(ltvBps > 0 && ltvBps <= 10000, "invalid LTV");
        require(durationDays > 0, "zero duration");

        ContagionRegistry.WrappedAsset memory asset = registry.getAsset(assetId);
        require(asset.active, "asset not active");

        TrancheConfig storage tc = tranches[tranche];
        require(tc.utilized + notional <= tc.totalCapacity || tc.totalCapacity == 0, "tranche full");

        // Collect premium
        require(settlementAsset.transferFrom(msg.sender, address(this), premium), "premium transfer failed");

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            policyId:   policyId,
            assetId:    assetId,
            buyer:      msg.sender,
            policyType: PolicyType.Position,
            tranche:    tranche,
            notional:   notional,
            ltvBps:     ltvBps,
            premium:    premium,
            startTime:  uint32(block.timestamp),
            endTime:    uint32(block.timestamp + uint256(durationDays) * 1 days),
            status:     PolicyStatus.Active,
            payout:     0
        });

        tc.utilized += notional;
        buyerPolicies[msg.sender].push(policyId);
        assetPolicies[assetId].push(policyId);

        emit PolicyCreated(policyId, assetId, msg.sender, PolicyType.Position, tranche, notional, premium);
    }

    /**
     * @notice Create a protocol cover policy (DAO treasury protection).
     *         Payout = notional × dilution / 10000
     *         (LTV not applied — the notional IS the borrow exposure)
     */
    function createProtocolCover(
        bytes32 assetId,
        uint256 notional,
        Tranche tranche,
        uint32  durationDays,
        uint256 premium
    ) external returns (uint256 policyId) {
        require(notional > 0, "zero notional");
        require(durationDays > 0, "zero duration");

        ContagionRegistry.WrappedAsset memory asset = registry.getAsset(assetId);
        require(asset.active, "asset not active");

        TrancheConfig storage tc = tranches[tranche];
        require(tc.utilized + notional <= tc.totalCapacity || tc.totalCapacity == 0, "tranche full");

        require(settlementAsset.transferFrom(msg.sender, address(this), premium), "premium transfer failed");

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            policyId:   policyId,
            assetId:    assetId,
            buyer:      msg.sender,
            policyType: PolicyType.Protocol,
            tranche:    tranche,
            notional:   notional,
            ltvBps:     10000,     // protocol cover: LTV = 100% (notional = borrow exposure)
            premium:    premium,
            startTime:  uint32(block.timestamp),
            endTime:    uint32(block.timestamp + uint256(durationDays) * 1 days),
            status:     PolicyStatus.Active,
            payout:     0
        });

        tc.utilized += notional;
        buyerPolicies[msg.sender].push(policyId);
        assetPolicies[assetId].push(policyId);

        emit PolicyCreated(policyId, assetId, msg.sender, PolicyType.Protocol, tranche, notional, premium);
    }

    // =========================================================================
    // Settlement
    // =========================================================================
    //
    // Anyone can call settle after a breach cascade fires.
    // Payout formula:
    //   Position: notional × ltvBps × effective_dilution / 10000^2
    //   Protocol: notional × effective_dilution / 10000
    //
    // effective_dilution = min(dilutionBps, tranche_ceiling) - tranche_floor
    // (clamped to tranche's dilution band)

    function settlePolicies(bytes32 assetId) external returns (uint256 totalPayout, uint256 count) {
        require(trigger.isTriggered(assetId), "no breach triggered");

        ContagionTrigger.BreachEvent memory evt = trigger.getBreachEvent(assetId);
        uint16 dilution = evt.dilutionBps;

        uint256[] memory policyIds = assetPolicies[assetId];

        for (uint256 i = 0; i < policyIds.length; i++) {
            Policy storage p = policies[policyIds[i]];

            if (p.status != PolicyStatus.Active) continue;
            if (block.timestamp > p.endTime) {
                p.status = PolicyStatus.Expired;
                continue;
            }

            // Calculate effective dilution within tranche band
            TrancheConfig memory tc = tranches[p.tranche];
            uint16 effectiveDilution = _clampToTranche(dilution, tc.floorBps, tc.ceilingBps);

            if (effectiveDilution == 0) continue;

            // Calculate payout
            uint256 payout;
            if (p.policyType == PolicyType.Position) {
                // position_size × LTV × dilution
                payout = (p.notional * p.ltvBps * effectiveDilution) / (10000 * 10000);
            } else {
                // borrows × dilution (LTV already baked into notional)
                payout = (p.notional * effectiveDilution) / 10000;
            }

            // Cap payout at notional
            if (payout > p.notional) payout = p.notional;

            // Cap at available tranche capital
            if (payout > trancheCapital[p.tranche]) {
                payout = trancheCapital[p.tranche];
            }

            p.payout = payout;
            p.status = PolicyStatus.Settled;
            trancheCapital[p.tranche] -= payout;
            totalPayout += payout;
            count++;

            // Transfer payout to buyer
            if (payout > 0) {
                settlementAsset.transfer(p.buyer, payout);
            }

            emit PolicySettled(policyIds[i], assetId, payout, effectiveDilution);
        }

        emit PoliciesSettled(assetId, count, totalPayout);
    }

    function _clampToTranche(
        uint16 dilution,
        uint16 floor,
        uint16 ceiling
    ) internal pure returns (uint16) {
        if (dilution <= floor) return 0;
        uint16 capped = dilution > ceiling ? ceiling : dilution;
        return capped - floor;
    }

    // =========================================================================
    // Capital Management
    // =========================================================================

    function depositCapital(Tranche tranche, uint256 amount) external {
        require(amount > 0, "zero amount");
        require(settlementAsset.transferFrom(msg.sender, address(this), amount), "transfer failed");
        trancheCapital[tranche] += amount;
        emit CapitalDeposited(tranche, msg.sender, amount);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function getBuyerPolicies(address buyer) external view returns (uint256[] memory) {
        return buyerPolicies[buyer];
    }

    function getAssetPolicies(bytes32 assetId) external view returns (uint256[] memory) {
        return assetPolicies[assetId];
    }

    /**
     * @notice Estimate payout for a hypothetical breach at a given dilution.
     */
    function estimatePayout(
        uint256 policyId,
        uint16  hypotheticalDilutionBps
    ) external view returns (uint256 payout) {
        Policy memory p = policies[policyId];
        TrancheConfig memory tc = tranches[p.tranche];
        uint16 effectiveDilution = _clampToTranche(hypotheticalDilutionBps, tc.floorBps, tc.ceilingBps);

        if (p.policyType == PolicyType.Position) {
            payout = (p.notional * p.ltvBps * effectiveDilution) / (10000 * 10000);
        } else {
            payout = (p.notional * effectiveDilution) / 10000;
        }

        if (payout > p.notional) payout = p.notional;
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function configureTranche(
        Tranche tranche,
        uint16  floorBps,
        uint16  ceilingBps,
        uint256 capacity
    ) external onlyOwner {
        require(ceilingBps > floorBps, "ceiling <= floor");
        tranches[tranche] = TrancheConfig({
            floorBps: floorBps,
            ceilingBps: ceilingBps,
            totalCapacity: capacity,
            utilized: tranches[tranche].utilized
        });
        emit TrancheConfigured(tranche, floorBps, ceilingBps, capacity);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }
}
