// ElevateBridge email templates. Each template renders a subject + body
// from a freelancer + sender + optional matched company. mailto: opens
// the OS default mail client (Outlook on macOS / Windows when set as
// default); templateOutlookWebUrl is the fallback for browser-based
// composition.

import type { Freelancer } from '../../types/freelancer';

export type FlTemplateKey =
  | 'match_offer'      // proposed match with a company
  | 'kickoff'          // engagement is starting; brief the freelancer
  | 'check_in'         // active engagement nudge
  | 'on_file'          // not currently matched — staying warm
  | 'release'          // engagement ended, thank-you
  | 'rematch';         // released freelancer being offered a new match

export type FlTemplateContext = {
  freelancer: Pick<Freelancer, 'full_name' | 'email' | 'track' | 'role_profile' | 'location'>;
  sender: { name?: string; email: string; title?: string };
  company?: { company_name?: string; sector?: string };
};

export type FlRenderedTemplate = {
  subject: string;
  body: string;
  to: string;
};

function firstName(full: string): string {
  if (!full) return '';
  return full.trim().split(/\s+/)[0];
}
function senderFirstName(s: FlTemplateContext['sender']): string {
  if (s.name) return firstName(s.name);
  return firstName(s.email.split('@')[0].replace(/\./g, ' '));
}
function senderTitle(s: FlTemplateContext['sender']): string {
  return s.title || 'ElevateBridge Coordinator';
}
const SIGNATURE = (s: FlTemplateContext['sender']) =>
  `\n\nBest,\n${senderFirstName(s)}\n${senderTitle(s)} — Gaza Sky Geeks`;

const TEMPLATES: Record<FlTemplateKey, (ctx: FlTemplateContext) => { subject: string; body: string }> = {
  match_offer: ({ freelancer, sender, company }) => ({
    subject: `ElevateBridge — proposed match${company?.company_name ? ` with ${company.company_name}` : ''}`,
    body:
      `Dear ${firstName(freelancer.full_name) || 'there'},\n\n` +
      `I'd like to propose matching you with ${company?.company_name || 'a Cohort 3 Elevate company'} for an ElevateBridge engagement. ` +
      `${company?.sector ? `They work in ${company.sector}, which fits your ${freelancer.track || ''} track. ` : ''}` +
      `Your role would be to act as their sales funnel — running outreach, writing proposals on Upwork (or your platform of choice), and helping convert leads into deals.\n\n` +
      `Are you available to take this on? If yes, I'll set up a kickoff call this week to brief you on their services and goals.` +
      SIGNATURE(sender),
  }),
  kickoff: ({ freelancer, sender, company }) => ({
    subject: `ElevateBridge kickoff — ${company?.company_name || 'your engagement'}`,
    body:
      `Hi ${firstName(freelancer.full_name) || 'there'},\n\n` +
      `Excited to kick off your engagement${company?.company_name ? ` with ${company.company_name}` : ''}. ` +
      `Before our call, please:\n\n` +
      `  1. Review the company brief I'll attach separately\n` +
      `  2. Set up a clean ${freelancer.track || 'platform'} profile\n` +
      `  3. Draft 2-3 sample proposals so we can refine on the call\n\n` +
      `Let me know which day this week works for a 45-minute kickoff.` +
      SIGNATURE(sender),
  }),
  check_in: ({ freelancer, sender, company }) => ({
    subject: `ElevateBridge — quick check-in${company?.company_name ? ` (${company.company_name})` : ''}`,
    body:
      `Hi ${firstName(freelancer.full_name) || 'there'},\n\n` +
      `Just checking in on the engagement${company?.company_name ? ` with ${company.company_name}` : ''}. ` +
      `How is the proposal pipeline going? Any blockers I can help with — positioning, pricing, missing collateral?\n\n` +
      `Happy to jump on a 20-minute call if useful.` +
      SIGNATURE(sender),
  }),
  on_file: ({ freelancer, sender }) => ({
    subject: `ElevateBridge — staying connected`,
    body:
      `Dear ${firstName(freelancer.full_name) || 'there'},\n\n` +
      `Thank you for being part of the ElevateBridge network. We don't have a match for you right now, but your profile and ${freelancer.track || ''} expertise are on file. ` +
      `As soon as a Cohort 3 company surfaces a need that fits, I'll reach out.\n\n` +
      `In the meantime, please stay engaged with us through the GSG Newsletter and let me know if your availability changes.` +
      SIGNATURE(sender),
  }),
  release: ({ freelancer, sender, company }) => ({
    subject: `ElevateBridge — wrapping up${company?.company_name ? ` with ${company.company_name}` : ''}`,
    body:
      `Hi ${firstName(freelancer.full_name) || 'there'},\n\n` +
      `Thank you for your work${company?.company_name ? ` with ${company.company_name}` : ''}. We're closing out this engagement.\n\n` +
      `Could you share a short wrap-up — leads generated, deals closed, what worked, what didn't? It helps us calibrate future matches and report on the program.\n\n` +
      `If you're open to another match, I'll keep you in the active pool and reach out as soon as the right fit comes up.` +
      SIGNATURE(sender),
  }),
  rematch: ({ freelancer, sender, company }) => ({
    subject: `ElevateBridge — new match opportunity${company?.company_name ? ` with ${company.company_name}` : ''}`,
    body:
      `Hi ${firstName(freelancer.full_name) || 'there'},\n\n` +
      `Now that your previous engagement has wrapped up, I have a new match opportunity${company?.company_name ? ` with ${company.company_name}` : ''} that I think fits your background well.\n\n` +
      `${company?.sector ? `They're in ${company.sector} ` : ''}and need sales-funnel support — proposal writing, outreach, lead qualification.\n\n` +
      `Are you open to taking this on? I can set up a kickoff call this week.` +
      SIGNATURE(sender),
  }),
};

export function renderFlTemplate(key: FlTemplateKey, ctx: FlTemplateContext): FlRenderedTemplate {
  const t = TEMPLATES[key](ctx);
  return { subject: t.subject, body: t.body, to: ctx.freelancer.email };
}

export function flTemplateMailto(rendered: FlRenderedTemplate): string {
  const enc = encodeURIComponent;
  return `mailto:${enc(rendered.to)}?subject=${enc(rendered.subject)}&body=${enc(rendered.body)}`;
}

export function flTemplateOutlookWebUrl(rendered: FlRenderedTemplate): string {
  const enc = encodeURIComponent;
  return (
    `https://outlook.office.com/mail/deeplink/compose` +
    `?to=${enc(rendered.to)}` +
    `&subject=${enc(rendered.subject)}` +
    `&body=${enc(rendered.body)}`
  );
}

export function flSuggestedTemplate(status: string): FlTemplateKey {
  switch (status) {
    case 'Available': return 'match_offer';
    case 'Matched': return 'kickoff';
    case 'Active': return 'check_in';
    case 'Producing': return 'check_in';
    case 'Released': return 'rematch';
    case 'On Hold': return 'check_in';
    case 'Dropped':
    case 'Archived':
    default:
      return 'on_file';
  }
}

export const FL_TEMPLATE_LABELS: Record<FlTemplateKey, string> = {
  match_offer: 'Match offer',
  kickoff: 'Engagement kickoff',
  check_in: 'Check-in',
  on_file: 'Staying connected',
  release: 'Engagement wrap',
  rematch: 'New match offer',
};

export const FL_ALL_TEMPLATE_KEYS: FlTemplateKey[] = [
  'match_offer',
  'kickoff',
  'check_in',
  'on_file',
  'release',
  'rematch',
];
