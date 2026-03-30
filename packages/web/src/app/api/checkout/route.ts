import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Stripe from 'stripe'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2025-03-31.basil' as Stripe.LatestApiVersion,
  })
}

// POST /api/checkout — create Stripe Checkout session for Pro tier
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const proPriceId = process.env.STRIPE_PRO_PRICE_ID
    if (!proPriceId || !process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
    }

    const stripe = getStripe()
    const origin = req.headers.get('origin') || 'https://dsrpt.finance'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: proPriceId, quantity: 1 }],
      success_url: `${origin}/monitor?upgraded=true`,
      cancel_url: `${origin}/pricing`,
      metadata: { clerk_user_id: userId },
    })

    return NextResponse.json({ url: session.url })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
