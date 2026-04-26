// Pipeline-stage email templates. Each template renders a subject + body
// from an advisor + sender + optional company. Output is wrapped into
// either a mailto: URL (opens the OS default mail client — Outlook on
// macOS / Windows when configured) or an Outlook web compose URL as a
// fallback when no desktop client is wired up.

import type { Advisor } from '../../types/advisor';

export type TemplateKey =
  | 'welcome'
  | 'intro_invite'
  | 'match_offer'
  | 'on_file'
  | 'thank_you';

export type TemplateContext = {
  advisor: Pick<Advisor, 'full_name' | 'email' | 'position' | 'employer' | 'country'>;
  sender: { name?: string; email: string; title?: string };
  company?: { company_name?: string };
};

export type RenderedTemplate = {
  subject: string;
  body: string;
  to: string;
};

function firstName(full: string): string {
  if (!full) return '';
  return full.trim().split(/\s+/)[0];
}

function senderFirstName(s: TemplateContext['sender']): string {
  if (s.name) return firstName(s.name);
  // Fall back to the local-part of the email if no name is set.
  return firstName(s.email.split('@')[0].replace(/\./g, ' '));
}

function senderTitle(s: TemplateContext['sender']): string {
  return s.title || 'Market Access Coordinator';
}

const SIGNATURE = (s: TemplateContext['sender']) =>
  `\n\nBR,\n${senderFirstName(s)}`;

// ---- Templates --------------------------------------------------------
//
// Wording supplied by the team. Variables are interpolated:
//   {first_name}  -> advisor's first name
//   {sender}      -> Mohammed / Doaa / Zaid etc.
//   {sender_title} -> "Market Access Coordinator" (default)
//   {company}     -> matched company name (when available)
//
// `welcome` is the live "we want to interview you" outreach. The team
// uses one combined message for acknowledgement + intro-invite, so the
// New / Acknowledged / Allocated stages all share this template.

const TEMPLATES: Record<TemplateKey, (ctx: TemplateContext) => { subject: string; body: string }> = {
  welcome: ({ advisor, sender }) => ({
    subject: `Becoming a GSG Advisor — let's chat`,
    body:
      `Dear ${firstName(advisor.full_name) || 'there'},\n\n` +
      `I am ${senderFirstName(sender)}, the ${senderTitle(sender)} at Gaza Sky Geeks (GSG). It's a pleasure to e-meet you 😃\n\n` +
      `Thank you for filling in the survey to become a GSG advisor.\n\n` +
      `We appreciate your patience while we were filtering applications, and we also highly appreciate your interest in supporting the Palestinian ecosystem.\n\n` +
      `Upon reviewing your application, it would be my pleasure to have an interview with you to learn more about you and your experience.\n\n` +
      `Please let me know when you are free for a 30-minute call so we can touch base.\n\n` +
      `Looking forward to hearing back from you,` +
      SIGNATURE(sender),
  }),
  // Same body as welcome — kept as an alias so post-intro reminders use
  // a consistent voice without ever asking the team to write a fresh one.
  intro_invite: (ctx) => TEMPLATES.welcome(ctx),
  match_offer: ({ advisor, sender, company }) => ({
    subject: `GSG Elevate — ${company?.company_name ? `proposed match with ${company.company_name}` : 'proposed match'}`,
    body:
      `Dear ${firstName(advisor.full_name) || 'there'},\n\n` +
      `Following up on our last conversation — we'd like to propose matching you with ${company?.company_name || 'one of our Cohort 3 companies'} for an advisory engagement. ` +
      `Based on your background${advisor.position ? ` as ${advisor.position}${advisor.employer ? ` at ${advisor.employer}` : ''}` : ''}, the fit looks strong.\n\n` +
      `Are you open to an intro call with the founder? If yes, I'll set it up this week.` +
      SIGNATURE(sender),
  }),
  on_file: ({ advisor, sender }) => ({
    subject: `Welcome to the GSG advisor network`,
    body:
      `Dear ${firstName(advisor.full_name) || 'there'},\n\n` +
      `Thank you for applying and for your genuine interest in supporting Palestinian tech companies. We are glad to have you in our network.\n\n` +
      `We match advisors to companies based on their specific intervention needs, confirmed once our company cohort is finalised. Your profile and expertise are on file and we will reach out as soon as there is a strong match for you.\n\n` +
      `We look forward to working with you and hope you stay connected through the GSG Newsletter in the meantime.\n\n` +
      `Best regards,` +
      SIGNATURE(sender),
  }),
  thank_you: ({ advisor, sender }) => ({
    subject: `Thank you for your support`,
    body:
      `Dear ${firstName(advisor.full_name) || 'there'},\n\n` +
      `Thank you for your support of the Elevate companies. The engagement has wrapped up — we appreciate the time and expertise you contributed.\n\n` +
      `We'll keep you in mind for future opportunities.` +
      SIGNATURE(sender),
  }),
};

export function renderTemplate(key: TemplateKey, ctx: TemplateContext): RenderedTemplate {
  const t = TEMPLATES[key](ctx);
  return {
    subject: t.subject,
    body: t.body,
    to: ctx.advisor.email,
  };
}

// mailto: opens the system default mail client. On macOS / Windows when
// Outlook is set as the default mail handler, this opens Outlook directly.
// "From" is whatever account is signed in to that client.
export function templateMailto(rendered: RenderedTemplate): string {
  const enc = encodeURIComponent;
  return `mailto:${enc(rendered.to)}?subject=${enc(rendered.subject)}&body=${enc(rendered.body)}`;
}

// Outlook web fallback — useful when no desktop mail client is the default
// (Chrome on a fresh machine, for example) or the team member is signed in
// to Office 365 in the browser.
export function templateOutlookWebUrl(rendered: RenderedTemplate): string {
  const enc = encodeURIComponent;
  return (
    `https://outlook.office.com/mail/deeplink/compose` +
    `?to=${enc(rendered.to)}` +
    `&subject=${enc(rendered.subject)}` +
    `&body=${enc(rendered.body)}`
  );
}

// Pick the most relevant template for the advisor's current pipeline stage.
export function suggestedTemplate(pipelineStatus: string): TemplateKey {
  switch (pipelineStatus) {
    case 'New':
    case 'Acknowledged':
    case 'Allocated':
    case 'Intro Scheduled':
    case 'Intro Done':
    case 'Assessment':
      return 'welcome';
    case 'Approved':
      return 'match_offer';
    case 'Rejected':
      return 'on_file';
    case 'Matched':
      return 'thank_you';
    default:
      return 'welcome';
  }
}

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  welcome: 'Welcome & intro invite',
  intro_invite: 'Welcome & intro invite',
  match_offer: 'Match offer',
  on_file: 'On file — waiting for match',
  thank_you: 'Thank you / wrap',
};

// All templates exposed to the picker, in the order they should appear.
// `intro_invite` is intentionally omitted — it's an alias of `welcome`,
// so showing both would just be visual noise.
export const ALL_TEMPLATE_KEYS: TemplateKey[] = ['welcome', 'on_file', 'match_offer', 'thank_you'];
