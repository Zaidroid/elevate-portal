export type Tier = 'leadership' | 'profile_manager' | 'member';

export interface TeamMember {
  email: string;
  name: string;
  role: 'admin' | 'user';
  tier: Tier;
  active: boolean;
  title?: string;
  // Personal Arabic nickname rendered inside the English greeting in the
  // top bar and on the post-login splash. Optional — falls back to the
  // English first name when missing.
  nicknameAr?: string;
}
