// Route-level guards for the Elevate Portal.
//
//   <RequireAdmin>     — wraps admin-only routes (/payments, /team,
//                        /admin/lookups, /import). Non-admin direct
//                        URL visit bounces to /my-hub instead of
//                        leaking the page contents.
//
//   <LandingRouter>    — picks the post-login landing page by tier:
//                        leadership → HomePage (the cross-portfolio
//                        dashboard); profile_manager / member →
//                        /my-hub (their AM-scoped landing).
//
// The sidebar in AppShell already filters admin items away from
// non-admin users; these guards close the typed-URL gap.

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { isAdmin, isLeadership } from '../config/team';
import { HomePage } from '../pages/HomePage';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const email = user?.email || '';
  if (!isAdmin(email) && !isLeadership(email)) {
    return <Navigate to="/my-hub" replace />;
  }
  return <>{children}</>;
}

export function LandingRouter() {
  const { user } = useAuth();
  const email = user?.email || '';
  if (isAdmin(email) || isLeadership(email)) {
    return <HomePage />;
  }
  return <Navigate to="/my-hub" replace />;
}
