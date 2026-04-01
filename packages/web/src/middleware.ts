import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Public routes — accessible without login
const isPublicRoute = createRouteMatcher([
  '/',
  '/whitepaper',
  '/how-it-works',
  '/team',
  '/pricing',
  '/api-docs',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/v1/signals/market',   // free: composite market signal
  '/api/webhook',             // Stripe webhook (no auth)
])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
