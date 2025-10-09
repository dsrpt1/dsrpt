// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IERC20 { function transferFrom(address,address,uint256) external returns (bool); function transfer(address,uint256) external returns (bool); }
interface IOracle { function conditionMet(bytes32) external view returns (bool); }
contract HazardCurveEngine { function premiumOf(bytes32,uint256,uint256) external view returns(uint256){} }
contract LiquidityPool { function poolAssets() external view returns(uint256){} }
contract PolicyManager {
    IERC20 public immutable asset; LiquidityPool public pool; HazardCurveEngine public curve; IOracle public oracle;
    struct Policy { address buyer; bytes32 productId; bytes32 assetId; uint256 coverage; uint64 startTs; uint32 tenorDays; bool active; bool paidOut; }
    mapping(uint256=>Policy) public policies; uint256 public nextId=1;
    constructor(IERC20 a, LiquidityPool p, HazardCurveEngine c){ asset=a; pool=p; curve=c; }
    function setOracle(IOracle o) external { oracle=o; }
    function buyPolicy(bytes32 productId, bytes32 /*assetId*/, uint256 coverage, uint32 tenorDays) external returns (uint256 id){
        uint256 premium = curve.premiumOf(productId, coverage, tenorDays);
        require(asset.transferFrom(msg.sender, address(this), premium));
        id = nextId++; policies[id]=Policy(msg.sender,productId,0x0,coverage,uint64(block.timestamp),tenorDays,true,false);
    }
    function resolve(uint256 id) external {
        Policy storage p = policies[id]; require(p.active && !p.paidOut);
        if (oracle.conditionMet(_policyKey(id))) { require(asset.transfer(p.buyer, p.coverage)); p.paidOut=true; }
        p.active=false;
    }
    function _policyKey(uint256 id) internal pure returns (bytes32){ return keccak256(abi.encodePacked("POLICY", id)); }
}
