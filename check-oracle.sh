#!/bin/bash

# Quick Oracle Diagnostic Script
# DO NOT COMMIT API KEYS TO GIT!

echo "🔍 DSRPT Oracle Diagnostic"
echo "=========================="
echo ""

ORACLE_ADAPTER="0x10392145F79222990D1aB50049bEB3749eb1983E"
RPC_URL="https://mainnet.base.org"  # Using public RPC for safety

echo "📍 Oracle Adapter: $ORACLE_ADAPTER"
echo ""

# Check 1: Get the Chainlink feed address
echo "1️⃣ Checking Chainlink feed address..."
FEED=$(cast call $ORACLE_ADAPTER "feed()" --rpc-url $RPC_URL)
echo "   Feed address: $FEED"
echo ""

# Check 2: Get threshold
echo "2️⃣ Checking threshold..."
THRESHOLD=$(cast call $ORACLE_ADAPTER "threshold1e8()" --rpc-url $RPC_URL)
THRESHOLD_DEC=$((16#${THRESHOLD:2}))
THRESHOLD_USD=$(echo "scale=6; $THRESHOLD_DEC / 100000000" | bc)
echo "   Threshold: $THRESHOLD_USD USD"
echo ""

# Check 3: Try to call latestPrice
echo "3️⃣ Testing latestPrice() call..."
RESULT=$(cast call $ORACLE_ADAPTER "latestPrice(bytes32)" "0x0000000000000000000000000000000000000000000000000000000000000000" --rpc-url $RPC_URL 2>&1)

if [[ $RESULT == *"reverted"* ]] || [[ $RESULT == *"error"* ]]; then
    echo "   ❌ FAILED - Oracle is reverting"
    echo "   Error: $RESULT"
    echo ""
    echo "🔧 DIAGNOSIS:"
    echo "   The oracle contract is calling a Chainlink feed that doesn't exist"
    echo "   or doesn't have data. You need to redeploy with the correct feed."
    echo ""
    echo "✅ CORRECT CHAINLINK FEED FOR BASE MAINNET:"
    echo "   USDC/USD: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B"
    echo ""
else
    echo "   ✅ SUCCESS - Oracle is working!"
    echo "   Result: $RESULT"
    echo ""

    # Parse the result (first 64 chars = price, next 64 = timestamp)
    PRICE_HEX=${RESULT:2:64}
    TIME_HEX=${RESULT:66:64}

    PRICE_DEC=$((16#$PRICE_HEX))
    TIME_DEC=$((16#$TIME_HEX))

    PRICE_USD=$(echo "scale=6; $PRICE_DEC / 100000000" | bc)

    echo "   Price: \$$PRICE_USD"
    echo "   Updated: $(date -d @$TIME_DEC 2>/dev/null || date -r $TIME_DEC)"
fi

echo ""
echo "📚 See ORACLE_TROUBLESHOOTING.md for detailed fix instructions"
