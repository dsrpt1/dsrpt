# Update Frontend Addresses After Deployment

## Quick Reference Guide

After you deploy the new contracts, you need to update the frontend configuration.

---

## Step 1: Copy Deployment Output

When you run the deployment, you'll see output like this:

```
=== DSRPT Deployment (PRODUCTION-READY) ===
Deployer: 0x...
USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Curve Engine: 0xNEW_CURVE_ADDRESS_HERE
Liquidity Pool: 0xNEW_POOL_ADDRESS_HERE
Policy Manager: 0xNEW_PM_ADDRESS_HERE
Depeg Adapter: 0xNEW_ORACLE_ADDRESS_HERE
Keeper: 0x981306c1aE8829F07444249Ce2D8800F89113B74
```

**Copy these addresses!**

---

## Step 2: Update .env.local

Edit `packages/web/.env.local` and replace the placeholders:

```bash
cd packages/web
nano .env.local  # or use your preferred editor
```

Update these 4 lines:

```bash
# BEFORE (placeholders):
NEXT_PUBLIC_POLICY_MANAGER=REPLACE_WITH_NEW_POLICY_MANAGER_ADDRESS
NEXT_PUBLIC_LIQUIDITY_POOL=REPLACE_WITH_NEW_POOL_ADDRESS
NEXT_PUBLIC_HAZARD_CURVE=REPLACE_WITH_NEW_CURVE_ADDRESS
NEXT_PUBLIC_DEPEG_ADAPTER=REPLACE_WITH_NEW_ORACLE_ADDRESS

# AFTER (actual addresses from deployment):
NEXT_PUBLIC_POLICY_MANAGER=0xNEW_PM_ADDRESS_HERE
NEXT_PUBLIC_LIQUIDITY_POOL=0xNEW_POOL_ADDRESS_HERE
NEXT_PUBLIC_HAZARD_CURVE=0xNEW_CURVE_ADDRESS_HERE
NEXT_PUBLIC_DEPEG_ADAPTER=0xNEW_ORACLE_ADDRESS_HERE
```

**DO NOT CHANGE** these addresses (they're already correct):
- `NEXT_PUBLIC_USDC`
- `NEXT_PUBLIC_CHAINLINK_USDC_USD`
- `NEXT_PUBLIC_KEEPER`

---

## Step 3: Restart Frontend

```bash
# Kill the dev server (Ctrl+C)
# Start it again
npm run dev
```

---

## Step 4: Verify Addresses are Loaded

Open browser console and check:

```javascript
// Should show NEW addresses, not "REPLACE_WITH..."
console.log(process.env.NEXT_PUBLIC_POLICY_MANAGER)
console.log(process.env.NEXT_PUBLIC_LIQUIDITY_POOL)
console.log(process.env.NEXT_PUBLIC_HAZARD_CURVE)
console.log(process.env.NEXT_PUBLIC_DEPEG_ADAPTER)
```

Or check the Network tab - transactions should be going to the new contract addresses.

---

## Step 5: Test Oracle

Run the diagnostic to verify the new oracle works:

```bash
ORACLE_ADDRESS=0xNEW_ORACLE_ADDRESS \
NEXT_PUBLIC_RPC_URL=https://base-mainnet.g.alchemy.com/v2/kOTbBMLKDuuiN7YE3r3np \
node check-oracle.mjs
```

Should show:
```
✅ SUCCESS - Oracle is working!
Feed address: 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
Price: $0.9998...
```

---

## Step 6: Update Keeper Bot

Edit `packages/keeper/.env`:

```bash
cd packages/keeper
nano .env
```

Update:
```bash
POLICY_MANAGER=0xNEW_PM_ADDRESS_HERE
ADAPTER=0xNEW_ORACLE_ADDRESS_HERE
```

Restart keeper:
```bash
npm start
```

---

## Step 7: Update Vercel (Production)

If you're deploying to Vercel:

1. Go to Vercel dashboard → Your project → Settings → Environment Variables
2. Update these 4 variables:
   - `NEXT_PUBLIC_POLICY_MANAGER`
   - `NEXT_PUBLIC_LIQUIDITY_POOL`
   - `NEXT_PUBLIC_HAZARD_CURVE`
   - `NEXT_PUBLIC_DEPEG_ADAPTER`
3. Redeploy: Deployments → Latest → Redeploy

---

## Common Issues

### "Cannot read property of undefined"
- Frontend can't find contract addresses
- Check .env.local has actual addresses, not "REPLACE_WITH..."
- Restart dev server

### "Transaction reverted"
- Might be calling old contract addresses
- Clear browser cache
- Check Network tab in DevTools for transaction destination

### "Oracle not working"
- Make sure you copied the NEW oracle address
- Run `check-oracle.mjs` to verify

---

## Checklist

After updating addresses, verify:

- [ ] .env.local has 4 new addresses (no "REPLACE_WITH...")
- [ ] Frontend dev server restarted
- [ ] Browser shows new addresses in console
- [ ] Oracle diagnostic passes
- [ ] Can create test policy
- [ ] Premium includes 15% MTM buffer
- [ ] Regime detection shows actual regime (not "fallback")
- [ ] Keeper bot updated and running
- [ ] Vercel environment variables updated (if using Vercel)

---

## Backup Old Addresses

Keep a record of old addresses for reference:

```
OLD ADDRESSES (deprecated):
Policy Manager: 0x7b7Eb364425F6dDC72c2F143dfA47075ab231Cf1
Liquidity Pool: 0xD65D464Cb18D5E89733d0336BC1Ea6e66346a62C
Oracle Adapter: 0x10392145F79222990D1aB50049bEB3749eb1983E (broken)
```

Don't send funds to these addresses after redeployment!
