import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Public routes — no auth required
const isPublicRoute = createRouteMatcher([
  '/',
  '/whitepaper',
  '/how-it-works',
  '/team',
  '/api/v1/signals/market',   // free: market composite signal
])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip static files and Next.js internals
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
