// Team roster with Cohort 3 role tiers. Profile Managers (Mohammed Ayesh,
// Doaa) each own a portfolio of companies end-to-end. Leadership
// (Zaid, Raouf, Israa) gets the cross-portfolio oversight view.
//
// Roster source: at boot we try to read VITE_SHEET_TEAM_ROSTER (Team tab);
// the hardcoded list below is the offline fallback so the app stays usable
// when the sheet is unreachable. All role checks read from the live roster.

import type { TeamMember, Tier } from '../types';
import { fetchRange } from '../lib/sheets/client';

export const AUTHORIZED_USERS: TeamMember[] = [
  { email: 'zaid@gazaskygeeks.com', name: 'Zaid Salem', role: 'admin', tier: 'leadership', active: true, title: 'Market Access Officer' },
  { email: 'israa@gazaskygeeks.com', name: 'Israa Hamoudeh', role: 'admin', tier: 'leadership', active: true, title: 'Team Lead' },
  { email: 'raouf@gazaskygeeks.com', name: 'Raouf Said', role: 'admin', tier: 'leadership', active: true, title: 'Co-working Spaces Lead' },

  { email: 'ayesh@gazaskygeeks.com', name: 'Mohammed Ayesh', role: 'user', tier: 'profile_manager', active: true, title: 'Profile Manager' },
  { email: 'doaa@gazaskygeeks.com', name: 'Doaa Younis', role: 'user', tier: 'profile_manager', active: true, title: 'Profile Manager' },

  { email: 'muna@gazaskygeeks.com', name: 'Muna Mahroum', role: 'user', tier: 'member', active: true, title: 'Pre-TTH' },
  { email: 'mzourob@gazaskygeeks.com', name: 'Mohammed Zourob', role: 'user', tier: 'member', active: true, title: 'ElevateBridge Filtration' },
];

// Account Managers — the three team members who own a finalized
// company's day-to-day after selection. Used by the Final Decision
// surface in the Companies page (Mohammad / Doaa / Muna).
export const ACCOUNT_MANAGERS: { email: string; name: string }[] = [
  { email: 'ayesh@gazaskygeeks.com', name: 'Mohammed Ayesh' },
  { email: 'doaa@gazaskygeeks.com', name: 'Doaa Younis' },
  { email: 'muna@gazaskygeeks.com', name: 'Muna Mahroum' },
];

export const ALLOWED_DOMAIN = import.meta.env.VITE_DOMAIN_ALLOWLIST || 'gazaskygeeks.com';

const normalize = (email: string) => email.trim().toLowerCase();

// Mutable live roster. Defaults to the hardcoded fallback; `loadTeamRosterFromSheet`
// replaces it once the sheet has been read successfully.
let liveRoster: TeamMember[] = [...AUTHORIZED_USERS];
const rosterListeners = new Set<() => void>();
let rosterLoadPromise: Promise<TeamMember[]> | null = null;

function getRoster(): TeamMember[] {
  return liveRoster;
}

function notifyRosterChange() {
  rosterListeners.forEach(cb => {
    try { cb(); } catch (e) { console.error('[team] roster listener error', e); }
  });
}

export function subscribeToRoster(cb: () => void): () => void {
  rosterListeners.add(cb);
  return () => rosterListeners.delete(cb);
}

// Derive Tier from role + title fields when the sheet doesn't carry an explicit
// tier column. Admins are leadership; "Profile Manager" titles are profile_manager;
// everyone else is a member.
function deriveTier(role: 'admin' | 'user', title: string): Tier {
  if (role === 'admin') return 'leadership';
  if (/profile\s*manager/i.test(title)) return 'profile_manager';
  return 'member';
}

function parseRoster(rows: string[][]): TeamMember[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const colEmail = idx('email');
  const colName = idx('name');
  const colRole = idx('role');
  const colActive = idx('active');
  const colTitle = idx('title');
  const colTier = idx('tier'); // optional
  if (colEmail < 0 || colName < 0) return [];

  const out: TeamMember[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const email = (row[colEmail] || '').trim();
    if (!email || !email.includes('@')) continue;
    const role: 'admin' | 'user' =
      (row[colRole] || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
    const activeRaw = (row[colActive] || '').trim().toLowerCase();
    const active = !activeRaw || ['yes', 'true', '1', 'active'].includes(activeRaw);
    const title = (row[colTitle] || '').trim();
    const explicitTier = colTier >= 0 ? (row[colTier] || '').trim().toLowerCase() : '';
    const tier: Tier =
      explicitTier === 'leadership' || explicitTier === 'profile_manager' || explicitTier === 'member'
        ? (explicitTier as Tier)
        : deriveTier(role, title);
    out.push({
      email,
      name: (row[colName] || '').trim() || email,
      role,
      tier,
      active,
      title: title || undefined,
    });
  }
  return out;
}

// Read the Team tab once and replace the in-memory roster. Failures are logged
// and swallowed so the hardcoded fallback continues to gate auth. The promise is
// cached so repeated boots-in-flight share one fetch.
export function loadTeamRosterFromSheet(): Promise<TeamMember[]> {
  if (rosterLoadPromise) return rosterLoadPromise;
  const sheetId = import.meta.env.VITE_SHEET_TEAM_ROSTER as string | undefined;
  if (!sheetId) {
    return Promise.resolve(liveRoster);
  }
  rosterLoadPromise = (async () => {
    try {
      const rows = await fetchRange(sheetId, 'Team!A:I');
      const parsed = parseRoster(rows);
      if (parsed.length === 0) {
        console.warn('[team] roster sheet returned no usable rows; keeping hardcoded fallback');
        return liveRoster;
      }
      liveRoster = parsed;
      notifyRosterChange();
      return liveRoster;
    } catch (err) {
      console.warn('[team] roster sheet fetch failed; keeping hardcoded fallback', err);
      return liveRoster;
    }
  })();
  return rosterLoadPromise;
}

export function isAuthorizedUser(email: string): boolean {
  const n = normalize(email);
  return getRoster().some(u => u.email.toLowerCase() === n);
}

export function getUserRole(email: string): 'admin' | 'user' | null {
  return getUserByEmail(email)?.role ?? null;
}

export function getUserByEmail(email: string): TeamMember | null {
  const n = normalize(email);
  return getRoster().find(u => u.email.toLowerCase() === n) || null;
}

export function isAdmin(email: string): boolean {
  return getUserRole(email) === 'admin';
}

export function getTier(email: string): Tier {
  return getUserByEmail(email)?.tier ?? 'member';
}

export function isLeadership(email: string): boolean {
  return getTier(email) === 'leadership';
}

export function isProfileManager(email: string): boolean {
  return getTier(email) === 'profile_manager';
}

export function getProfileManagers(): TeamMember[] {
  return getRoster().filter(u => u.active && u.tier === 'profile_manager');
}

export function getLeadership(): TeamMember[] {
  return getRoster().filter(u => u.active && u.tier === 'leadership');
}

export function getActiveTeam(): TeamMember[] {
  return getRoster().filter(u => u.active);
}

export function displayName(email: string): string {
  return getUserByEmail(email)?.name || email;
}
