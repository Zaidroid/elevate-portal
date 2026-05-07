// Personalised greeting helper.
//
// Each team member sees a time-of-day English greeting with their
// personal Arabic nickname embedded inline (e.g., "Good morning, زيد.").
// Falls back to their English first name if no nickname is set.
//
// Used by the sidebar footer, HomePage header, and MyHubPage header so
// the same line shows up consistently across every post-login surface.

import type { ReactNode } from 'react';
import { nicknameAr, displayName } from '../config/team';

export type GreetingParts = {
  /** "Good morning" / "Good afternoon" / "Good evening" — English. */
  prefix: string;
  /** Either the Arabic nickname (RTL) or the English first name. */
  who: string;
  /** True if `who` is Arabic and should be wrapped in dir="rtl". */
  isArabic: boolean;
};

function timePrefix(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(email: string): string {
  const full = displayName(email);
  if (!full || full === email) {
    const local = email.split('@')[0] || 'there';
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return full.split(' ')[0] || full;
}

export function getGreeting(email: string, now: Date = new Date()): GreetingParts {
  const ar = nicknameAr(email);
  return {
    prefix: timePrefix(now),
    who: ar || firstName(email),
    isArabic: !!ar,
  };
}

// Convenience JSX renderer for the inline greeting. The Arabic nickname
// span is wrapped in dir="rtl" so right-to-left punctuation lands
// correctly when embedded in the surrounding English line.
export function PersonalGreeting({
  email,
  fallback = 'Welcome',
  className = '',
}: {
  email: string | null | undefined;
  fallback?: string;
  className?: string;
}): ReactNode {
  if (!email) return <span className={className}>{fallback}</span>;
  const g = getGreeting(email);
  return (
    <span className={className}>
      {g.prefix},{' '}
      <span dir={g.isArabic ? 'rtl' : 'ltr'} className={g.isArabic ? 'inline-block align-baseline' : ''}>
        {g.who}
      </span>
      .
    </span>
  );
}
