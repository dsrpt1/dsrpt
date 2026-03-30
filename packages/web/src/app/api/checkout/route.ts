import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-03-31.basil' as Stripe.LatestApiVersion,
})

const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || ''

// POST /api/checkout — create Stripe Checkout session for Pro tier
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!PRO_PRICE_ID) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
    }

    const origin = req.headers.get('origin') || 'https://dsrpt.finance'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
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
