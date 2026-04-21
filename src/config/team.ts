// ============================================
// Team Configuration — Advisor Pipeline
// ============================================

import type { TeamMember } from '../types';

/** Seed team roster — same team as the selection-tool */
export const AUTHORIZED_USERS: TeamMember[] = [
  { email: 'zaid@gazaskygeeks.com', name: 'Zaid Salem', role: 'admin', active: true },
  { email: 'doaa@gazaskygeeks.com', name: 'Doaa Younis', role: 'user', active: true },
  { email: 'raouf@gazaskygeeks.com', name: 'Raouf Said', role: 'user', active: true },
  { email: 'ayesh@gazaskygeeks.com', name: 'Mohammed Ayesh', role: 'user', active: true },
  { email: 'muna@gazaskygeeks.com', name: 'Muna Mahroum', role: 'user', active: true },
  { email: 'mzourob@gazaskygeeks.com', name: 'Mohammed Zourob', role: 'user', active: true },
  { email: 'israa@gazaskygeeks.com', name: 'Israa Hamoudeh', role: 'user', active: true },
  { email: 'mai@gazaskygeeks.com', name: 'Mai Al-Kahlout', role: 'user', active: true },
  { email: 'saed@gazaskygeeks.com', name: 'Saed Aldeeb', role: 'user', active: true },
  { email: 'lina@gazaskygeeks.com', name: 'Lina Marshoud', role: 'user', active: true },
];

export const ALLOWED_DOMAIN = import.meta.env.VITE_DOMAIN_ALLOWLIST || 'gazaskygeeks.com';

export function isAuthorizedUser(email: string): boolean {
  return AUTHORIZED_USERS.some(u => u.email.toLowerCase() === email.toLowerCase());
}

export function getUserRole(email: string): 'admin' | 'user' | null {
  const user = AUTHORIZED_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  return user ? user.role : null;
}

export function getUserByEmail(email: string): TeamMember | null {
  return AUTHORIZED_USERS.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

export function isAdmin(email: string): boolean {
  return getUserRole(email) === 'admin';
}

export function getActiveTeam(): TeamMember[] {
  return AUTHORIZED_USERS.filter(u => u.active);
}
