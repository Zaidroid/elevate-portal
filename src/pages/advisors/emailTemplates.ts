// Pipeline-stage email templates. Each template renders a subject + body
// from an advisor + sender + optional company. Output is wrapped into a
// mailto: URL so clicking it opens the user's default mail client with
// everything pre-filled.

import type { Advisor } from '../../types/advisor';

export type TemplateKey =
  | 'welcome'
  | 'intro_invite'
  | 'assessment_request'
  | 'match_offer'
  | 'rejection'
  | 'thank_you';

export type TemplateContext = {
  advisor: Pick<Advisor, 'full_name' | 'email' | 'position' | 'employer' | 'country'>;
  sender: { name?: string; email: string };
  company?: { company_name?: string };
};

export type RenderedTemplate = {
  subject: string;
  body: string;
  to: string;
};

const SIGNATURE = (name?: string) =>
  name
    ? `\n\nBest,\n${name}\nGSG Elevate Companies team`
    : `\n\nBest,\nGSG Elevate Companies team`;

const TEMPLATES: Record<TemplateKey, (ctx: TemplateContext) => { subject: string; body: string }> = {
  welcome: ({ advisor, sender }) => ({
    subject: `GSG Elevate · welcome, ${firstName(advisor.full_name)}`,
    body:
      `Hi ${firstName(advisor.full_name)},\n\n` +
      `Thanks for applying to advise GSG Elevate companies. We received your form and will be in touch within the week with next steps.\n\n` +
      `If anything in your submission has changed, just reply to this email and we'll update your file.` +
      SIGNATURE(sender.name),
  }),
  intro_invite: ({ advisor, sender }) => ({
    subject: `GSG Elevate · intro call`,
    body:
      `Hi ${firstName(advisor.full_name)},\n\n` +
      `Following up on your application — we'd love to schedule a 30-minute intro call to walk you through how Elevate works and learn more about how you could best support our cohort.\n\n` +
      `What times work for you in the next two weeks? Send me a couple of slots and I'll confirm the calendar invite.` +
      SIGNATURE(sender.name),
  }),
  assessment_request: ({ advisor, sender }) => ({
    subject: `GSG Elevate · next steps`,
    body:
      `Hi ${firstName(advisor.full_name)},\n\n` +
      `Great chatting today. As a next step, we'd like to do a short assessment so we can match you to the right Elevate company. I'll send the assessment brief separately within 48 hours.` +
      SIGNATURE(sender.name),
  }),
  match_offer: ({ advisor, sender, company }) => ({
    subject: `GSG Elevate · ${company?.company_name ? `proposed match with ${company.company_name}` : 'proposed match'}`,
    body:
      `Hi ${firstName(advisor.full_name)},\n\n` +
      `We'd like to match you with ${company?.company_name || 'an Elevate company'} for an advisory engagement. They're working on areas we think align well with your background${advisor.position ? ` (${advisor.position}${advisor.employer ? ` at ${advisor.employer}` : ''})` : ''}.\n\n` +
      `Are you open to an intro call with the founder? If yes, I'll set it up this week.` +
      SIGNATURE(sender.name),
  }),
  rejection: ({ advisor, sender }) => ({
    subject: `GSG Elevate · update on your application`,
    body:
      `Hi ${firstName(advisor.full_name)},\n\n` +
      `Thanks again for taking the time to apply to advise our Elevate cohort. We're not able to move forward with a match this round, but we'll keep your profile on file for future cohorts where the fit may be stronger.\n\n` +
      `We appreciate your interest and hope to stay in touch.` +
      SIGNATURE(sender.name),
  }),
  thank_you: ({ advisor, sender }) => ({
    subject: `GSG Elevate · thank you`,
    body:
      `Hi ${firstName(advisor.full_name)},\n\n` +
      `Thank you for your support of the Elevate companies. The engagement has wrapped up successfully — we appreciate the time and expertise you contributed.\n\n` +
      `We'll keep you in mind for future opportunities.` +
      SIGNATURE(sender.name),
  }),
};

function firstName(full: string): string {
  if (!full) return '';
  return full.trim().split(/\s+/)[0];
}

export function renderTemplate(key: TemplateKey, ctx: TemplateContext): RenderedTemplate {
  const t = TEMPLATES[key](ctx);
  return {
    subject: t.subject,
    body: t.body,
    to: ctx.advisor.email,
  };
}

export function templateMailto(rendered: RenderedTemplate): string {
  const enc = encodeURIComponent;
  return `mailto:${enc(rendered.to)}?subject=${enc(rendered.subject)}&body=${enc(rendered.body)}`;
}

// Pick the most relevant template for the advisor's current pipeline stage.
export function suggestedTemplate(pipelineStatus: string): TemplateKey {
  switch (pipelineStatus) {
    case 'New': return 'welcome';
    case 'Acknowledged':
    case 'Allocated': return 'intro_invite';
    case 'Intro Done': return 'assessment_request';
    case 'Approved': return 'match_offer';
    case 'Rejected': return 'rejection';
    case 'Matched': return 'thank_you';
    default: return 'welcome';
  }
}

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  welcome: 'Welcome',
  intro_invite: 'Intro invite',
  assessment_request: 'Assessment request',
  match_offer: 'Match offer',
  rejection: 'Polite decline',
  thank_you: 'Thank you / wrap',
};
