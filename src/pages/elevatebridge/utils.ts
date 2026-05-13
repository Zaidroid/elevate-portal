// ElevateBridge enrichers & aggregations. Pure functions — given the
// raw tab data, produce the joined / aggregated views the tabs render.

import type {
  EbApplicant,
  EbStage1,
  EbStage2,
  EbStage3Ssi,
  EbDecisionRow,
  EbSession,
  EbAttendance,
  EbMentor,
  EbTopPerformer,
} from '../../types/elevateBridge';

// Display: official funnel numbers from the Selection Process Report.
// These are the design targets; the live tab also shows the computed
// counts so anomalies are obvious.
export const FUNNEL_TARGET = {
  totalApplications: 203,
  waitlisted: 115,
  qualifiedStage2: 88,
  finalAdmitted: 32,
  capacityNet: 29,
} as const;

export const TRACK_LABEL: Record<string, string> = {
  FL: 'Freelance (Upwork)',
  SM: 'Social Media / BD',
  'FL+SM': 'Combined (FL + SM)',
};

export const TRACK_TONE: Record<string, 'teal' | 'orange' | 'red' | 'neutral'> = {
  FL: 'teal',
  SM: 'orange',
  'FL+SM': 'red',
};

export const STAGE_ORDER: Array<string> = [
  'Applied',
  'S1 Filter',
  'S2 Sort',
  'S3 Scoring',
  'Interview',
  'Decision',
];

export const REGION_LABEL: Record<string, string> = {
  'West Bank': 'West Bank',
  'Gaza Strip': 'Gaza Strip',
  'Outside Palestine': 'Outside Palestine',
};

export const DECISION_TONE: Record<string, 'teal' | 'orange' | 'red' | 'neutral'> = {
  Admitted: 'teal',
  Waitlisted: 'orange',
  Withdrew: 'neutral',
  Dropped: 'red',
  Disqualified: 'red',
};

// Funnel counts computed from the applicants tab. Returns both raw counts
// (what's in the data) and the report target so the UI can call out
// drift between live state and the official numbers. Accepts both the
// canonical "Pass"/"Fail" values and the source-workbook "Yes"/"No"
// values so the funnel works regardless of which got seeded.
function passedS1(value: string): boolean {
  const v = (value || '').toLowerCase();
  return v.startsWith('pass') || v === 'yes' || v === 'in';
}
export function computeFunnel(applicants: EbApplicant[]) {
  const total = applicants.length;
  let s1Pass = 0;
  let s2Qualified = 0;
  let admitted = 0;
  let withdrew = 0;
  for (const a of applicants) {
    if (passedS1(a.killing_factor_result)) s1Pass++;
    if (a.track_assigned) s2Qualified++;
    if (a.decision === 'Admitted') admitted++;
    if (a.decision === 'Withdrew' || a.decision === 'Dropped') withdrew++;
  }
  return {
    total,
    waitlisted: total - s1Pass,
    qualifiedStage2: s2Qualified,
    admitted,
    netCapacity: admitted - withdrew,
  };
}

// Distribution by assigned track (for the Overview chart).
export function trackDistribution(applicants: EbApplicant[]) {
  const out: Record<string, number> = { FL: 0, SM: 0, 'FL+SM': 0, Unassigned: 0 };
  for (const a of applicants) {
    const t = a.track_assigned || 'Unassigned';
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

// Distribution by region (West Bank / Gaza / Outside).
export function regionDistribution(applicants: EbApplicant[]) {
  const out: Record<string, number> = {};
  for (const a of applicants) {
    const r = a.region || 'Unknown';
    out[r] = (out[r] || 0) + 1;
  }
  return out;
}

// Apply the Killing Factor rule from the report:
//   total achievable income ≤ $1000 → Waitlist
//   outside Palestine → Waitlist
// Returns 'Pass' | 'Fail' and the reason if it would fail.
export function evaluateKillingFactor(a: EbApplicant): { result: 'Pass' | 'Fail'; reason: string } {
  if (a.region === 'Outside Palestine') {
    return { result: 'Fail', reason: 'Outside Palestine' };
  }
  const incomeStr = a.total_score || '';
  const income = Number(incomeStr) || 0;
  if (income > 0 && income <= 1000) {
    return { result: 'Fail', reason: 'Income ≤ $1,000' };
  }
  return { result: 'Pass', reason: '' };
}

export type EnrichedApplicant = EbApplicant & {
  display_name: string;        // Name_EN with Name_AR fallback
  hasFlScore: boolean;
  hasSmScore: boolean;
  numericTotalScore: number;
  stage1?: EbStage1;
  stage2?: EbStage2;
  ssi?: EbStage3Ssi;
  decisionRow?: EbDecisionRow;
};

// Join applicants with the stage / decision tabs by applicant_id.
export function enrichApplicants(
  applicants: EbApplicant[],
  stage1: EbStage1[],
  stage2: EbStage2[],
  ssi: EbStage3Ssi[],
  decisions: EbDecisionRow[],
): EnrichedApplicant[] {
  const s1 = new Map(stage1.map(r => [r.applicant_id, r]));
  const s2 = new Map(stage2.map(r => [r.applicant_id, r]));
  const sx = new Map(ssi.map(r => [r.applicant_id, r]));
  const dc = new Map(decisions.map(r => [r.applicant_id, r]));
  return applicants.map(a => {
    const numericTotalScore = Number(a.total_score || '0') || 0;
    return {
      ...a,
      display_name: a.full_name_en || a.full_name_ar || a.email || a.applicant_id,
      hasFlScore: Boolean(a.response_score_fl || a.interview_score_fl),
      hasSmScore: Boolean(a.response_score_sm || a.interview_score_sm),
      numericTotalScore,
      stage1: s1.get(a.applicant_id),
      stage2: s2.get(a.applicant_id),
      ssi: sx.get(a.applicant_id),
      decisionRow: dc.get(a.applicant_id),
    };
  });
}

// Match against query string — name, email, phone, location, track.
export function matchesApplicantQuery(a: EnrichedApplicant, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase().trim();
  return (
    (a.full_name_en || '').toLowerCase().includes(needle) ||
    (a.full_name_ar || '').toLowerCase().includes(needle) ||
    (a.email || '').toLowerCase().includes(needle) ||
    (a.phone || '').toLowerCase().includes(needle) ||
    (a.location || '').toLowerCase().includes(needle) ||
    (a.track_assigned || '').toLowerCase().includes(needle) ||
    (a.track_registered || '').toLowerCase().includes(needle)
  );
}

// Group scores (Response or Interview) by applicant for the drawer.
export function scoresByApplicant<T extends { applicant_id: string }>(
  scores: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const s of scores) {
    const arr = out.get(s.applicant_id) || [];
    arr.push(s);
    out.set(s.applicant_id, arr);
  }
  return out;
}

// Capacity totals — mentor hours, sessions completed, budget spent.
export function capacitySummary(mentors: EbMentor[], sessions: EbSession[]) {
  let totalHours = 0;
  let completedHours = 0;
  let totalBudget = 0;
  let spent = 0;
  for (const m of mentors) {
    totalBudget += Number(m.budget_total || '0') || 0;
    totalHours += Number(m.total_hours || '0') || 0;
  }
  for (const s of sessions) {
    const hrs = Number(s.hours || '0') || 0;
    if ((s.status || '').toLowerCase() === 'completed') {
      completedHours += hrs;
      // Cost = hours × matching mentor rate (best-effort lookup by track)
      const mentor = mentors.find(m => m.track === s.track);
      if (mentor) {
        spent += hrs * (Number(mentor.hourly_rate || '0') || 0);
      }
    }
  }
  return {
    totalBudget,
    spent,
    remaining: Math.max(0, totalBudget - spent),
    totalHours,
    completedHours,
    sessionsCompleted: sessions.filter(s => (s.status || '').toLowerCase() === 'completed').length,
    sessionsScheduled: sessions.length,
  };
}

// Attendance matrix for the Capacity tab.
export type AttendanceCell = { attended: 'Yes' | 'No' | 'Late' | ''; record?: EbAttendance };
export type AttendanceMatrix = {
  participantIds: string[];
  participantNames: Map<string, string>;
  sortedSessions: EbSession[];
  matrix: Map<string, Map<string, AttendanceCell>>;
};
export function buildAttendanceMatrix(
  sessions: EbSession[],
  attendance: EbAttendance[],
): AttendanceMatrix {
  const participantIds = Array.from(new Set(attendance.map(a => a.applicant_id))).sort();
  const participantNames = new Map<string, string>();
  for (const a of attendance) {
    if (!participantNames.has(a.applicant_id)) participantNames.set(a.applicant_id, a.full_name || a.applicant_id);
  }
  const matrix = new Map<string, Map<string, AttendanceCell>>();
  for (const pid of participantIds) {
    matrix.set(pid, new Map());
  }
  for (const a of attendance) {
    const row = matrix.get(a.applicant_id);
    if (!row) continue;
    row.set(a.session_id, {
      attended: (a.attended || '') as AttendanceCell['attended'],
      record: a,
    });
  }
  const sortedSessions = [...sessions].sort((x, y) => {
    if (x.track !== y.track) return x.track.localeCompare(y.track);
    if (x.date !== y.date) return x.date.localeCompare(y.date);
    return (Number(x.session_num) || 0) - (Number(y.session_num) || 0);
  });
  return { participantIds, participantNames, sortedSessions, matrix };
}

// Stable mint helpers — caller passes a seed so re-mints are idempotent.
export function mintScoreId(applicantId: string, track: string, criterionKey: string): string {
  return `${applicantId}-${track}-${criterionKey}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export function mintInterviewId(applicantId: string, track: string, q: number): string {
  return `${applicantId}-${track}-Q${q}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export function mintAttendanceId(sessionId: string, applicantId: string): string {
  return `${sessionId}-${applicantId}`;
}

export function mintSessionId(track: string, sessionNum: number | string): string {
  const t = (track || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 16);
  return `${t}-s${sessionNum}-${Date.now().toString(36)}`;
}

// Top performer city-rank groupings for the table.
export function groupTopPerformers(rows: EbTopPerformer[]) {
  const byTrack: Record<string, EbTopPerformer[]> = { FL: [], SM: [], 'FL+SM': [] };
  for (const r of rows) {
    const t = r.track || 'FL';
    if (!byTrack[t]) byTrack[t] = [];
    byTrack[t].push(r);
  }
  for (const t of Object.keys(byTrack)) {
    byTrack[t].sort((a, b) => (Number(a.overall_rank) || 9999) - (Number(b.overall_rank) || 9999));
  }
  return byTrack;
}
