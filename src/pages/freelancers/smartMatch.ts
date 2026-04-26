// Smart match for ElevateBridge: rank Cohort 3 companies that need sales-
// funnel support against an Available freelancer's profile (track + role +
// geography). Surfaced in the detail drawer when status === Available so
// the team can match with one click.
//
// A company is a candidate when:
//   - It has at least one Intervention Assignment of type "MA-ElevateBridge"
//     that is not Cancelled / Completed (so it currently needs the support).
//   - It is not Withdrawn / Graduated / Rejected.
//
// Score weights (max 100):
//   +40  the company explicitly has an MA-ElevateBridge assignment in flight
//   +25  freelancer track aligns with the company's preferred channel hint
//        (currently inferred from sector — SaaS / FinTech / B2B = Upwork bias,
//         E-commerce / EdTech = Social bias, others get a neutral score)
//   +15  freelancer is currently solo (Individual or Job Hunter) and the
//        company is small (<=10 employees) — better fit than putting an
//        Agency on a tiny startup
//   +10  same governorate (rare but useful when in-person handoff is needed)
//   +10  freelancer's role aligns with the most recent assignment's notes
//        keyword hits (proposals / outreach / sales)

import type { CompanyLite, EnrichedFreelancer } from './utils';

export type FlMatchScore = {
  company: CompanyLite;
  score: number;
  reasons: string[];
};

// Companies that have an MA-ElevateBridge assignment open. The portal page
// passes in this set pre-filtered (cheaper than re-walking the assignments
// for each scoring call).
export type CompanyWithEbNeed = CompanyLite & {
  has_eb_assignment: boolean;
  employee_count?: string;
};

const TRACK_TO_SECTOR_HINT: Record<string, string[]> = {
  Upwork: ['saas', 'fintech', 'devtools', 'ai/ml', 'cybersecurity', 'outsourcing services'],
  'Social Media': ['e-commerce', 'edtech', 'media', 'marketing/adtech', 'gaming'],
  Other: [],
};

export function suggestFreelancerMatches(
  fl: EnrichedFreelancer,
  companies: CompanyWithEbNeed[],
  limit = 3
): FlMatchScore[] {
  const trackHints = (TRACK_TO_SECTOR_HINT[fl.track] || []).map(s => s.toLowerCase());
  const flGoverns = (fl.location || '').toLowerCase().trim();
  const flRole = (fl.role_profile || '').toLowerCase();

  const candidates = companies.filter(c => {
    const status = (c.status || '').toLowerCase();
    if (status === 'withdrawn' || status === 'graduated' || status === 'rejected') return false;
    return c.has_eb_assignment;
  });

  const scored: FlMatchScore[] = candidates.map(c => {
    let score = 0;
    const reasons: string[] = [];

    score += 40;
    reasons.push('Company has an active MA-ElevateBridge engagement');

    const sector = (c.sector || '').toLowerCase();
    if (sector && trackHints.some(h => sector === h || sector.includes(h) || h.includes(sector))) {
      score += 25;
      reasons.push(`${fl.track} track fits ${c.sector} sector`);
    }

    const empCount = parseInt(c.employee_count || '0', 10);
    const isSmall = Number.isFinite(empCount) && empCount > 0 && empCount <= 10;
    const isSoloProfile = flRole === 'individual' || flRole === 'job hunter';
    if (isSmall && isSoloProfile) {
      score += 15;
      reasons.push(`Small team (${empCount}) suits a ${fl.role_profile}`);
    }

    const govern = (c.governorate || '').toLowerCase();
    if (flGoverns && govern && (govern.includes(flGoverns) || flGoverns.includes(govern))) {
      score += 10;
      reasons.push(`Same region (${c.governorate})`);
    }

    return { company: c, score, reasons };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Markdown export for a freelancer profile — same shape as the advisor
// version, adapted to the freelancer fields.
export function freelancerToMarkdown(fl: EnrichedFreelancer): string {
  const lines: string[] = [];
  lines.push(`# ${fl.full_name || '(unnamed)'} · ${fl.freelancer_id}`);
  lines.push('');
  lines.push(`**Status**: ${fl.status || 'Available'}${fl.is_stuck ? ` (stuck ${fl.days_in_status}d)` : ''}`);
  lines.push(`**Email**: ${fl.email || '—'}`);
  if (fl.phone) lines.push(`**Phone**: ${fl.phone}`);
  if (fl.location) lines.push(`**Location**: ${fl.location}`);
  lines.push(`**Track**: ${fl.track || '—'} · **Role**: ${fl.role_profile || '—'}`);
  if (fl.assigned_mentor) lines.push(`**Mentor**: ${fl.assigned_mentor}`);
  if (fl.matched_company_name || fl.company_id) {
    lines.push(`**Matched company**: ${fl.matched_company_name || fl.company_id}`);
  }
  lines.push('');

  if (fl.notes) {
    lines.push('## Intake notes');
    lines.push(`> ${fl.notes.replace(/\n/g, '\n> ')}`);
    lines.push('');
  }

  lines.push('## Tracker');
  lines.push(`- Owner (assignee): ${fl.assignee_email || '—'}`);
  lines.push(`- Acknowledgement sent: ${fl.ack_sent || '—'}`);
  lines.push(`- Assessment date: ${fl.assessment_date || '—'}`);
  lines.push(`- Decision date: ${fl.decision_date || '—'}`);
  if (fl.tracker_notes) {
    lines.push('');
    lines.push(`> ${fl.tracker_notes.replace(/\n/g, '\n> ')}`);
  }

  if (fl.followups_for.length > 0) {
    lines.push('');
    lines.push('## Follow-ups');
    for (const f of fl.followups_for.slice().sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))) {
      lines.push(`- [${f.status === 'Done' ? 'x' : ' '}] ${f.type} due ${f.due_date} (${f.assignee_email}) — ${f.notes || ''}`);
    }
  }
  if (fl.comments_for.length > 0) {
    lines.push('');
    lines.push('## Comments');
    for (const c of fl.comments_for) {
      lines.push(`- _${c.author_email}, ${c.created_at?.slice(0, 10) || ''}_: ${c.body}`);
    }
  }
  if (fl.activity_for.length > 0) {
    lines.push('');
    lines.push('## Activity');
    const sorted = fl.activity_for.slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    for (const a of sorted.slice(0, 25)) {
      lines.push(`- ${a.timestamp?.slice(0, 19).replace('T', ' ')} · ${a.user_email} · ${a.action}${a.field ? ` ${a.field}` : ''}${a.new_value ? ` → ${a.new_value}` : ''}`);
    }
  }
  return lines.join('\n');
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
