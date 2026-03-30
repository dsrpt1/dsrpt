import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// All routes are public until Clerk is properly configured.
// To enable auth gating, move routes from publicRoutes to protectedRoutes.
const isPublicRoute = createRouteMatcher([
  '/(.*)',
])

// These routes will require auth once Clerk is configured:
// const isProtectedRoute = createRouteMatcher([
//   '/monitor',
//   '/api/v1/signals/assets',
//   '/api/v1/alerts',
//   '/api/v1/history',
// ])

export default clerkMiddleware(async (auth, req) => {
  // Uncomment to enable auth gating:
  // if (isProtectedRoute(req)) {
  //   await auth.protect()
  // }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
