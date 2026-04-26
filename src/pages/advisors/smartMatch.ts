// Smart match: rank Cohort 3 companies for a given advisor based on
// sector overlap, Stage 2 category fit, and geography. Surfaced in the
// detail drawer when the advisor reaches Approved status.

import type { CategoryKey, Stage2Score } from '../../types/advisor';
import type { CompanyLite, EnrichedAdvisor } from './utils';

export type MatchScore = {
  company: CompanyLite;
  score: number;
  reasons: string[];
};

// Mapping from Stage 2 category to company sectors that typically benefit
// most. Conservative — adjust as the team learns which fits land.
const CATEGORY_SECTOR_HINT: Record<CategoryKey | 'Unqualified', string[]> = {
  CEO: ['SaaS', 'FinTech', 'HealthTech', 'EdTech', 'E-commerce', 'Other'],
  CTO: ['SaaS', 'AI/ML', 'DevTools', 'Cybersecurity', 'FinTech', 'HealthTech'],
  COO: ['Outsourcing Services', 'Marketing/AdTech', 'E-commerce', 'GovTech', 'AgriTech'],
  Marketing: ['Marketing/AdTech', 'E-commerce', 'EdTech', 'Media'],
  AI: ['AI/ML', 'HealthTech', 'FinTech', 'CleanTech'],
  Unqualified: [],
};

function topCategoryScore(s: Stage2Score): { key: CategoryKey | 'Unqualified'; value: number } {
  const items: Array<[CategoryKey, number]> = [
    ['CEO', s.ceo],
    ['CTO', s.cto],
    ['COO', s.coo],
    ['Marketing', s.marketing],
    ['AI', s.ai],
  ];
  if (s.primary === 'Unqualified') return { key: 'Unqualified', value: 0 };
  let best: [CategoryKey, number] = ['CEO', 0];
  for (const [k, v] of items) if (v > best[1]) best = [k, v];
  return { key: best[0], value: best[1] };
}

export function suggestMatches(
  advisor: EnrichedAdvisor,
  companies: CompanyLite[],
  limit = 3
): MatchScore[] {
  const top = topCategoryScore(advisor.stage2);
  const advisorCountry = (advisor.country || '').toLowerCase().trim();
  const sectorHints = CATEGORY_SECTOR_HINT[top.key].map(s => s.toLowerCase());

  const candidates = companies.filter(c => {
    // Only suggest companies that are still in active engagement state.
    const status = (c.status || '').toLowerCase();
    if (status === 'withdrawn' || status === 'graduated' || status === 'rejected') return false;
    // Avoid suggesting the conflicting company.
    if (advisor.conflict_company_id && c.company_id === advisor.conflict_company_id) return false;
    return true;
  });

  const scored: MatchScore[] = candidates.map(c => {
    let score = 0;
    const reasons: string[] = [];

    // Sector × category hint
    const sector = (c.sector || '').toLowerCase();
    if (sector && sectorHints.some(h => sector === h || sector.includes(h) || h.includes(sector))) {
      score += 50;
      reasons.push(`Sector "${c.sector}" aligns with ${top.key} expertise`);
    }

    // Stage 2 score boost — stronger Stage 2 score → more confident match
    if (top.value >= 60) {
      score += 20;
      reasons.push(`Strong Stage 2 ${top.key} fit (${top.value})`);
    } else if (top.value >= 40) {
      score += 10;
      reasons.push(`Moderate Stage 2 ${top.key} fit (${top.value})`);
    }

    // Geography (loose match)
    const govern = (c.governorate || '').toLowerCase();
    if (govern && advisorCountry && (govern.includes(advisorCountry) || advisorCountry.includes(govern))) {
      score += 15;
      reasons.push(`Same region (${c.governorate})`);
    }

    return { company: c, score, reasons };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Calendar URL helper — Google Calendar event template URL with the
// advisor + assignee invited and the date pre-filled. Used by the Tracker
// tab when intro_scheduled_date is set.
export function googleCalendarUrl(opts: {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  guests: string[];
  durationMinutes?: number;
}): string {
  const start = opts.date.replace(/-/g, '');
  // Default 30-minute slot if no specific time was captured.
  const duration = opts.durationMinutes || 30;
  const startDt = new Date(`${opts.date}T10:00:00Z`);
  const endDt = new Date(startDt.getTime() + duration * 60_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const dates = `${fmt(startDt)}/${fmt(endDt)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    details: opts.description,
    dates,
    add: opts.guests.filter(Boolean).join(','),
  });
  void start;
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Markdown export of an advisor's full profile. Used by the "Export
// profile" button in the drawer.
export function advisorToMarkdown(adv: EnrichedAdvisor): string {
  const lines: string[] = [];
  lines.push(`# ${adv.full_name || '(unnamed)'} · ${adv.advisor_id}`);
  lines.push('');
  lines.push(`**Status**: ${adv.pipeline_status || 'New'}${adv.is_stuck ? ` (stuck ${adv.days_in_status}d)` : ''}`);
  lines.push(`**Email**: ${adv.email || '—'}`);
  if (adv.linkedin) lines.push(`**LinkedIn**: ${adv.linkedin}`);
  if (adv.country) lines.push(`**Country**: ${adv.country}`);
  if (adv.position) lines.push(`**Position**: ${adv.position}${adv.employer ? ` at ${adv.employer}` : ''}`);
  if (adv.years) lines.push(`**Years of experience**: ${adv.years}`);
  if (adv.paid_or_vol) lines.push(`**Paid / Volunteer**: ${adv.paid_or_vol}`);
  lines.push('');
  lines.push('## Scoring');
  lines.push(`- **Stage 1**: ${adv.stage1.total} / 100 — ${adv.stage1.pass ? 'PASS' : 'FAIL'}`);
  if (adv.stage1.pass) {
    lines.push(`- **Stage 2 primary**: ${adv.stage2.primary}`);
    lines.push(`  - CEO ${adv.stage2.ceo} · CTO ${adv.stage2.cto} · COO ${adv.stage2.coo} · Marketing ${adv.stage2.marketing} · AI ${adv.stage2.ai}`);
  }
  lines.push('');
  if (adv.exp_areas || adv.exp_detail) {
    lines.push('## Experience');
    if (adv.exp_areas) lines.push(`- Areas: ${adv.exp_areas}`);
    if (adv.exp_detail) lines.push(`- Detail: ${adv.exp_detail}`);
    lines.push('');
  }
  if (adv.c_level === 'Yes') {
    lines.push('## C-Level experience');
    if (adv.c_level_detail) lines.push(adv.c_level_detail);
    lines.push('');
  }
  lines.push('## Tracker');
  lines.push(`- Assignee: ${adv.assignee_email || '—'}`);
  lines.push(`- Intro scheduled: ${adv.intro_scheduled_date || '—'}`);
  lines.push(`- Intro done: ${adv.intro_done_date || '—'}`);
  lines.push(`- Assessment date: ${adv.assessment_date || '—'}`);
  lines.push(`- Decision date: ${adv.decision_date || '—'}`);
  if (adv.tracker_notes) {
    lines.push('');
    lines.push(`> ${adv.tracker_notes.replace(/\n/g, '\n> ')}`);
  }
  if (adv.assignment_company_id) {
    lines.push('');
    lines.push('## Assignment');
    lines.push(`- Company: ${adv.assignment_company_id}`);
    if (adv.assignment_intervention_type) lines.push(`- Intervention: ${adv.assignment_intervention_type}`);
    if (adv.assignment_status) lines.push(`- Status: ${adv.assignment_status}`);
    if (adv.assignment_notes) lines.push(`- Notes: ${adv.assignment_notes}`);
  }
  if (adv.followups_for.length > 0) {
    lines.push('');
    lines.push('## Follow-ups');
    for (const f of adv.followups_for.slice().sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))) {
      lines.push(`- [${f.status === 'Done' ? 'x' : ' '}] ${f.type} due ${f.due_date} (${f.assignee_email}) — ${f.notes || ''}`);
    }
  }
  if (adv.comments_for.length > 0) {
    lines.push('');
    lines.push('## Comments');
    for (const c of adv.comments_for) {
      lines.push(`- _${c.author_email}, ${c.created_at?.slice(0, 10) || ''}_: ${c.body}`);
    }
  }
  if (adv.activity_for.length > 0) {
    lines.push('');
    lines.push('## Activity');
    const sorted = adv.activity_for.slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    for (const a of sorted.slice(0, 25)) {
      lines.push(`- ${a.timestamp?.slice(0, 19).replace('T', ' ')} · ${a.user_email} · ${a.action}${a.field ? ` ${a.field}` : ''}${a.new_value ? ` → ${a.new_value}` : ''}`);
    }
  }
  if (adv.conflict_company_id) {
    lines.push('');
    lines.push(`> ⚠ Possible conflict: employer "${adv.employer}" overlaps with company "${adv.conflict_company_name}".`);
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
