// Logframes module: compute indicator actuals against live Companies /
// Assignments / Payments data and surface variance vs target.
//
// Strategy: each indicator row in the Dutch / SIDA logframe carries a free-
// text "Exact Source of Calculation". We do not try to parse arbitrary
// natural language. Instead we recognise a handful of canonical phrases and
// compute their actuals; everything else falls through to "Manual" and is
// editable inline.

export type IndicatorComputed = {
  actual: number | null;
  status: 'on_track' | 'at_risk' | 'off_track' | 'manual';
  hint: string;
};

type ComputeInputs = {
  companies: Array<Record<string, string>>;
  assignments: Array<Record<string, string>>;
  payments: Array<Record<string, string>>;
};

// Map of source-text phrase fragments → computation. First match wins.
type Rule = {
  match: RegExp;
  hint: string;
  compute: (inputs: ComputeInputs) => number;
};

const RULES: Rule[] = [
  {
    match: /companies\s+(selected|onboarded|active)/i,
    hint: 'COUNT(Companies WHERE status IN Selected/Onboarded/Active)',
    compute: ({ companies }) => companies.filter(c =>
      ['Selected', 'Onboarded', 'Active'].includes(c.status || '')
    ).length,
  },
  {
    match: /tth.*(placement|placed|talent)/i,
    hint: 'COUNT(Assignments WHERE intervention_type = TTH)',
    compute: ({ assignments }) => assignments.filter(a =>
      (a.intervention_type || '').startsWith('TTH')
    ).length,
  },
  {
    match: /upskilling/i,
    hint: 'COUNT(Assignments WHERE intervention_type = Upskilling)',
    compute: ({ assignments }) => assignments.filter(a =>
      (a.intervention_type || '').startsWith('Upskilling')
    ).length,
  },
  {
    match: /(c[\s-]?suite|leader.*coach)/i,
    hint: 'COUNT(Assignments WHERE intervention_type = C-Suite)',
    compute: ({ assignments }) => assignments.filter(a =>
      (a.intervention_type || '').startsWith('C-Suite')
    ).length,
  },
  {
    match: /market\s+access/i,
    hint: 'COUNT(Assignments WHERE intervention_type starts MA)',
    compute: ({ assignments }) => assignments.filter(a =>
      (a.intervention_type || '').startsWith('MA')
    ).length,
  },
  {
    match: /conference|travel/i,
    hint: 'COUNT(Assignments WHERE intervention_type = Conferences)',
    compute: ({ assignments }) => assignments.filter(a =>
      (a.intervention_type || '') === 'Conferences'
    ).length,
  },
  {
    match: /spend|burn|paid|disbursed/i,
    hint: 'SUM(Payments.amount_usd WHERE status = Paid)',
    compute: ({ payments }) => payments
      .filter(p => p.status === 'Paid')
      .reduce((s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0),
  },
  {
    match: /freelancer|elevatebridge/i,
    hint: 'COUNT(Assignments WHERE intervention_type = MA-ElevateBridge)',
    compute: ({ assignments }) => assignments.filter(a =>
      (a.intervention_type || '') === 'MA-ElevateBridge'
    ).length,
  },
];

export function computeIndicator(
  sourceText: string,
  inputs: ComputeInputs,
  target: number | null
): IndicatorComputed {
  const rule = RULES.find(r => r.match.test(sourceText || ''));
  if (!rule) {
    return { actual: null, status: 'manual', hint: 'Manual entry — could not parse Source of Calculation' };
  }
  const actual = rule.compute(inputs);
  if (target === null || target <= 0) {
    return { actual, status: 'manual', hint: rule.hint };
  }
  const ratio = actual / target;
  const status = ratio >= 1 ? 'on_track' : ratio >= 0.6 ? 'at_risk' : 'off_track';
  return { actual, status, hint: rule.hint };
}

export function parseTarget(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.toString().replace(/[$,]/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
