import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-03-31.basil' as Stripe.LatestApiVersion,
})

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''

// POST /api/webhook — Stripe webhook handler
// Updates Clerk user metadata with subscription tier on payment events
export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature') || ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const clerk = await clerkClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const clerkUserId = session.metadata?.clerk_user_id
    if (clerkUserId) {
      await clerk.users.updateUserMetadata(clerkUserId, {
        publicMetadata: { subscription_tier: 'pro', stripe_customer_id: session.customer },
      })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = subscription.customer as string
    // Find Clerk user by Stripe customer ID and downgrade
    const users = await clerk.users.getUserList({ limit: 100 })
    const user = users.data.find(
      u => u.publicMetadata?.stripe_customer_id === customerId
    )
    if (user) {
      await clerk.users.updateUserMetadata(user.id, {
        publicMetadata: { subscription_tier: 'free', stripe_customer_id: customerId },
      })
    }
  }

  return NextResponse.json({ received: true })
}
