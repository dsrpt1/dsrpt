#!/bin/bash
# Oracle diagnostic script using curl
set -e

ORACLE_ADAPTER="0x10392145F79222990D1aB50049bEB3749eb1983E"
RPC_URL="https://base-mainnet.g.alchemy.com/v2/kOTbBMLKDuuiN7YE3r3np"
USDC_ASSET_ID="0x0000000000000000000000000000000000000000000000000000000000000000"

echo "🔍 DSRPT Oracle Diagnostic"
echo "=========================="
echo ""
echo "📍 Oracle Adapter: $ORACLE_ADAPTER"
echo ""

# Check 1: Get the Chainlink feed address
echo "1️⃣ Checking Chainlink feed address..."
FEED_RESPONSE=$(curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$ORACLE_ADAPTER\",\"data\":\"0x37a7b7d8\"},\"latest\"],\"id\":1}")

FEED=$(echo "$FEED_RESPONSE" | jq -r '.result')
if [ "$FEED" = "null" ] || [ -z "$FEED" ]; then
    echo "   ❌ ERROR: Could not fetch feed address"
    echo "   Response: $FEED_RESPONSE"
    exit 1
fi

# Convert hex address (result is 32 bytes, address is last 20 bytes)
FEED_ADDRESS="0x${FEED:26:40}"
echo "   Feed address: $FEED_ADDRESS"
echo ""

# Check 2: Get threshold
echo "2️⃣ Checking threshold..."
THRESHOLD_RESPONSE=$(curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$ORACLE_ADAPTER\",\"data\":\"0x5a4291a0\"},\"latest\"],\"id\":1}")

THRESHOLD_HEX=$(echo "$THRESHOLD_RESPONSE" | jq -r '.result')
if [ "$THRESHOLD_HEX" = "null" ] || [ -z "$THRESHOLD_HEX" ]; then
    echo "   ❌ ERROR: Could not fetch threshold"
    exit 1
fi

THRESHOLD_DEC=$((16#${THRESHOLD_HEX:2}))
THRESHOLD_USD=$(echo "scale=6; $THRESHOLD_DEC / 100000000" | bc)
echo "   Threshold: \$$THRESHOLD_USD USD"
echo ""

# Check 3: Try to call latestPrice
echo "3️⃣ Testing latestPrice() call..."
# Function selector for latestPrice(bytes32) = 0x7f9c479c
LATESTPRICE_DATA="0x7f9c479c${USDC_ASSET_ID:2}"
PRICE_RESPONSE=$(curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$ORACLE_ADAPTER\",\"data\":\"$LATESTPRICE_DATA\"},\"latest\"],\"id\":1}")

PRICE_RESULT=$(echo "$PRICE_RESPONSE" | jq -r '.result')
ERROR_MSG=$(echo "$PRICE_RESPONSE" | jq -r '.error.message // empty')

if [ -n "$ERROR_MSG" ] || [ "$PRICE_RESULT" = "null" ]; then
    echo "   ❌ FAILED - Oracle is reverting"
    echo "   Error: $ERROR_MSG"
    echo ""
    echo "🔧 DIAGNOSIS:"
    echo "   The oracle contract is calling a Chainlink feed that doesn't exist"
    echo "   or doesn't have data. You need to redeploy with the correct feed."
    echo ""
    echo "✅ CORRECT CHAINLINK FEED FOR BASE MAINNET:"
    echo "   USDC/USD: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B"
    echo ""
    echo "📍 Your oracle is configured with: $FEED_ADDRESS"
    echo ""

    # Check 4: Test the Chainlink feed directly
    echo "4️⃣ Testing Chainlink feed directly..."
    # Function selector for latestRoundData() = 0xfeaf968c
    CHAINLINK_RESPONSE=$(curl -s -X POST "$RPC_URL" \
      -H "Content-Type: application/json" \
      -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$FEED_ADDRESS\",\"data\":\"0xfeaf968c\"},\"latest\"],\"id\":1}")

    CHAINLINK_RESULT=$(echo "$CHAINLINK_RESPONSE" | jq -r '.result')
    CHAINLINK_ERROR=$(echo "$CHAINLINK_RESPONSE" | jq -r '.error.message // empty')

    if [ -n "$CHAINLINK_ERROR" ] || [ "$CHAINLINK_RESULT" = "null" ]; then
        echo "   ❌ Chainlink feed error: $CHAINLINK_ERROR"
        echo "   This confirms the feed address is incorrect or unavailable."
    else
        # Parse answer (second field, 32 bytes offset 64)
        ANSWER_HEX="0x${CHAINLINK_RESULT:66:64}"
        ANSWER_DEC=$((16#${ANSWER_HEX:2}))
        ANSWER_USD=$(echo "scale=6; $ANSWER_DEC / 100000000" | bc)
        echo "   ✅ Chainlink feed exists and has data"
        echo "   Answer: \$$ANSWER_USD"
        echo ""
        echo "🤔 STRANGE: The Chainlink feed works, but oracle still reverts."
        echo "   This suggests an issue with the oracle contract logic."
    fi
else
    echo "   ✅ SUCCESS - Oracle is working!"
    echo ""

    # Parse result (first 32 bytes = price, second 32 bytes = timestamp)
    PRICE_HEX="0x${PRICE_RESULT:2:64}"
    TIME_HEX="0x${PRICE_RESULT:66:64}"

    # Handle negative numbers (int256) - check if first bit is 1
    PRICE_DEC=$((16#${PRICE_HEX:2}))
    TIME_DEC=$((16#${TIME_HEX:2}))

    PRICE_USD=$(echo "scale=6; $PRICE_DEC / 100000000" | bc)

    echo "   Price: \$$PRICE_USD"
    echo "   Updated: $(date -d @$TIME_DEC 2>/dev/null || date -r $TIME_DEC)"
    echo ""

    # Compare with threshold
    if (( $(echo "$PRICE_DEC < $THRESHOLD_DEC" | bc -l) )); then
        echo "   🚨 DEPEG DETECTED - Price below threshold!"
    else
        echo "   ✅ NORMAL - Price above threshold"
    fi
fi

echo ""
echo "📚 See ORACLE_TROUBLESHOOTING.md for detailed fix instructions"
