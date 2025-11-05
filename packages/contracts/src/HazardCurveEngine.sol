// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract HazardCurveEngine {
    struct Curve { uint256 baseProbPerDay; uint256 slopePerDay; uint256 minPremiumBps; }
    mapping(bytes32 => Curve) public curves;

    function setCurve(bytes32 id, Curve memory c) external { curves[id] = c; }

    function premiumOf(bytes32 id, uint256 coverage, uint256 /*tenorDays*/) external view returns (uint256) {
        Curve memory c = curves[id];
        uint256 bps = c.minPremiumBps;
        return (coverage * bps) / 10_000;
    }
}
