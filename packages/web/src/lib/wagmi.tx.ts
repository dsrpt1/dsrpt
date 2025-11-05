// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {LiquidityPool} from "./LiquidityPool.sol";
import {HazardCurveEngine} from "./HazardCurveEngine.sol";
import {IOracle} from "./interfaces/IOracle.sol";

contract PolicyManager {
    IERC20 public immutable asset;
    LiquidityPool public pool;
    HazardCurveEngine public curve;
    IOracle public oracle;

    constructor(IERC20 a, LiquidityPool p, HazardCurveEngine c) {
        asset = a;
        pool = p;
        curve = c;
    }

    function setOracle(IOracle o) external {
        oracle = o;
    }
}
import { http, createConfig } from 'wagmi'
import { base } from 'wagmi/chains'

export const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_RPC_URL),
  },
})
