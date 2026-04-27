// SelectionPage — the team's dedicated multi-user space for the live
// final-decision session. Shares its data scaffolding with CompaniesPage
// for now (mode='selection' switches the page identity: header title,
// tab set, hidden ops views). Phase 2/3 of the plan will fully extract
// the data hooks into a useSelectionData() helper so this can be a
// genuinely standalone page.
//
// What this gives the team today:
// - Distinct /selection route they can bookmark and use during the
//   live session without the operational noise of /companies.
// - Tab set focused on the workflow: Today's review queue · Final
//   cohort decisions · Imports & seeds · Activity.
// - Heartbeat presence (so the room can see who is currently on what).

import { useEffect } from 'react';
import { useAuth } from '../../services/auth';
import { CompaniesPage } from '../companies/CompaniesPage';
import { startPresenceHeartbeat } from './presence';

export function SelectionPage() {
  const { user } = useAuth();

  // Per-user heartbeat so the room can see who is currently active.
  // Best-effort — failures log to console and never block.
  useEffect(() => {
    if (!user?.email) return;
    return startPresenceHeartbeat(user.email);
  }, [user?.email]);

  return <CompaniesPage mode="selection" />;
}
