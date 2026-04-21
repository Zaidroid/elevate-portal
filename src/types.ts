export interface TeamMember {
  email: string;
  name: string;
  role: 'admin' | 'user';
  active: boolean;
}
