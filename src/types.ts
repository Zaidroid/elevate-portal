export type Tier = 'leadership' | 'profile_manager' | 'member';

export interface TeamMember {
  email: string;
  name: string;
  role: 'admin' | 'user';
  tier: Tier;
  active: boolean;
  title?: string;
}
