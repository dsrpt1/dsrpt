// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ContagionRegistry
 * @notice Registry of wrapped assets, their backing sources, and referencing lending markets.
 *
 * The registry maps the contagion topology:
 *   WrappedAsset (rsETH, wstETH, etc.)
 *     → BackingSource (bridge, LST protocol, etc.)
 *     → LendingMarket[] (Aave, Morpho, Euler, etc.)
 *
 * Each lending market listing has:
 *   - LTV at listing (determines payout multiplier)
 *   - Supply cap (bounds notional exposure)
 *   - Verifier cardinality (1-of-1 DVN vs 3-of-5 — pricing penalty)
 *
 * The contagion multiplier is derived from:
 *   rehypothecation_depth × LTV_aggression × dependency_graph_depth
 *
 * All values are observable on-chain and feed into ContagionPricingEngine.
 */
contract ContagionRegistry {

    // -- Structs -----

    struct WrappedAsset {
        address token;               // wrapped asset address (e.g., rsETH)
        string  symbol;              // "rsETH", "wstETH", etc.
        address backingSource;       // bridge/LST protocol address
        uint8   verifierCardinality; // number of independent verifiers (1 = max risk)
        uint8   verifierThreshold;   // threshold for consensus (e.g., 3-of-5 = threshold 3)
        bool    active;
    }

    struct LendingMarketListing {
        address market;              // lending protocol address (Aave pool, Morpho vault, etc.)
        string  marketName;          // "Aave V3", "Morpho Blue", etc.
        uint16  ltvBps;              // LTV at listing in basis points (9300 = 93%)
        uint256 supplyCap;           // max supply in asset decimals (0 = unlimited)
        bool    active;
    }

    // -- Events -----

    event AssetRegistered(bytes32 indexed assetId, address token, string symbol);
    event AssetUpdated(bytes32 indexed assetId);
    event AssetDeactivated(bytes32 indexed assetId);
    event MarketAdded(bytes32 indexed assetId, address market, string marketName, uint16 ltvBps);
    event MarketUpdated(bytes32 indexed assetId, address market, uint16 ltvBps);
    event MarketRemoved(bytes32 indexed assetId, address market);

    // -- State -----

    address public owner;

    // assetId => WrappedAsset
    mapping(bytes32 => WrappedAsset) public assets;

    // assetId => array of market listings
    mapping(bytes32 => LendingMarketListing[]) public listings;

    // assetId => market address => index in listings array (+ 1, 0 = not found)
    mapping(bytes32 => mapping(address => uint256)) private _listingIndex;

    // All registered asset IDs
    bytes32[] public assetIds;

    // -- Modifiers -----

    modifier onlyOwner() {
        require(msg.sender == owner, "ContagionRegistry: not owner");
        _;
    }

    // -- Constructor -----

    constructor() {
        owner = msg.sender;
    }

    // =========================================================================
    // Asset Management
    // =========================================================================

    function registerAsset(
        address token,
        string calldata symbol,
        address backingSource,
        uint8   verifierCardinality,
        uint8   verifierThreshold
    ) external onlyOwner returns (bytes32 assetId) {
        require(token != address(0), "zero token");
        require(verifierThreshold <= verifierCardinality, "threshold > cardinality");

        assetId = keccak256(abi.encodePacked("contagion:", symbol));
        require(assets[assetId].token == address(0), "already registered");

        assets[assetId] = WrappedAsset({
            token:               token,
            symbol:              symbol,
            backingSource:       backingSource,
            verifierCardinality: verifierCardinality,
            verifierThreshold:   verifierThreshold,
            active:              true
        });

        assetIds.push(assetId);
        emit AssetRegistered(assetId, token, symbol);
    }

    function updateAsset(
        bytes32 assetId,
        address backingSource,
        uint8   verifierCardinality,
        uint8   verifierThreshold
    ) external onlyOwner {
        require(assets[assetId].token != address(0), "not registered");
        require(verifierThreshold <= verifierCardinality, "threshold > cardinality");

        assets[assetId].backingSource = backingSource;
        assets[assetId].verifierCardinality = verifierCardinality;
        assets[assetId].verifierThreshold = verifierThreshold;
        emit AssetUpdated(assetId);
    }

    function deactivateAsset(bytes32 assetId) external onlyOwner {
        require(assets[assetId].token != address(0), "not registered");
        assets[assetId].active = false;
        emit AssetDeactivated(assetId);
    }

    // =========================================================================
    // Lending Market Listings
    // =========================================================================

    function addMarketListing(
        bytes32 assetId,
        address market,
        string calldata marketName,
        uint16  ltvBps,
        uint256 supplyCap
    ) external onlyOwner {
        require(assets[assetId].token != address(0), "asset not registered");
        require(market != address(0), "zero market");
        require(_listingIndex[assetId][market] == 0, "market already listed");

        listings[assetId].push(LendingMarketListing({
            market:     market,
            marketName: marketName,
            ltvBps:     ltvBps,
            supplyCap:  supplyCap,
            active:     true
        }));

        _listingIndex[assetId][market] = listings[assetId].length; // 1-indexed
        emit MarketAdded(assetId, market, marketName, ltvBps);
    }

    function updateMarketListing(
        bytes32 assetId,
        address market,
        uint16  ltvBps,
        uint256 supplyCap
    ) external onlyOwner {
        uint256 idx = _listingIndex[assetId][market];
        require(idx > 0, "market not listed");

        LendingMarketListing storage listing = listings[assetId][idx - 1];
        listing.ltvBps = ltvBps;
        listing.supplyCap = supplyCap;
        emit MarketUpdated(assetId, market, ltvBps);
    }

    function removeMarketListing(bytes32 assetId, address market) external onlyOwner {
        uint256 idx = _listingIndex[assetId][market];
        require(idx > 0, "market not listed");

        listings[assetId][idx - 1].active = false;
        _listingIndex[assetId][market] = 0;
        emit MarketRemoved(assetId, market);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    function getAsset(bytes32 assetId) external view returns (WrappedAsset memory) {
        return assets[assetId];
    }

    function getListings(bytes32 assetId) external view returns (LendingMarketListing[] memory) {
        return listings[assetId];
    }

    function getActiveListings(bytes32 assetId) external view returns (
        LendingMarketListing[] memory active,
        uint256 count
    ) {
        LendingMarketListing[] memory all = listings[assetId];
        uint256 n = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].active) n++;
        }

        active = new LendingMarketListing[](n);
        uint256 j = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].active) {
                active[j++] = all[i];
            }
        }
        count = n;
    }

    function getAssetCount() external view returns (uint256) {
        return assetIds.length;
    }

    /**
     * @notice Aggregate notional at risk across all active markets for an asset.
     *         Sum of (supplyCap × ltvBps / 10000) for each active listing.
     *         This is the maximum contagion exposure.
     */
    function getAggregateExposure(bytes32 assetId) external view returns (
        uint256 totalSupplyCap,
        uint256 weightedLtvNotional
    ) {
        LendingMarketListing[] memory all = listings[assetId];
        for (uint256 i = 0; i < all.length; i++) {
            if (!all[i].active) continue;
            totalSupplyCap += all[i].supplyCap;
            weightedLtvNotional += (all[i].supplyCap * all[i].ltvBps) / 10000;
        }
    }

    /**
     * @notice Verifier cardinality penalty for pricing.
     *         1-of-1 = 10000 bps (max penalty)
     *         2-of-3 = 5000 bps
     *         3-of-5 = 3333 bps
     *         Higher cardinality + threshold = lower penalty.
     * @return penaltyBps Penalty in basis points (10000 = 1.0x multiplier)
     */
    function getVerifierPenalty(bytes32 assetId) external view returns (uint16 penaltyBps) {
        WrappedAsset memory a = assets[assetId];
        if (a.verifierCardinality == 0) return 10000;
        return uint16(10000 / a.verifierThreshold);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }
}
