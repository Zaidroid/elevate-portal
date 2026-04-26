// Mercy Corps threshold classification and SLA math. Mirrored here so the
// portal can populate these fields at write time, rather than relying solely
// on sheet formulas (which are still welcome as a backup).

export type Threshold = 'Micro' | 'Small' | 'Standard' | 'High Value';

const SLA_WORKDAYS: Record<Threshold, number> = {
  Micro: 5,
  Small: 10,
  Standard: 25,
  'High Value': 35,
};

export function classifyThreshold(totalUsd: number): Threshold {
  if (totalUsd < 5_000) return 'Micro';
  if (totalUsd < 25_000) return 'Small';
  if (totalUsd < 150_000) return 'Standard';
  return 'High Value';
}

export function slaForThreshold(t: Threshold): number {
  return SLA_WORKDAYS[t];
}

export function totalUsd(qty: string | number, unitCost: string | number): number {
  const q = typeof qty === 'number' ? qty : parseFloat(String(qty || '').replace(/[^\d.-]/g, ''));
  const u = typeof unitCost === 'number' ? unitCost : parseFloat(String(unitCost || '').replace(/[^\d.-]/g, ''));
  if (isNaN(q) || isNaN(u)) return 0;
  return q * u;
}

// Subtract N working days (Mon-Fri) from a date. Returns ISO date YYYY-MM-DD.
export function subtractWorkdays(dateIso: string, workdays: number): string {
  const d = new Date(dateIso);
  if (isNaN(d.getTime())) return '';
  let remaining = workdays;
  // Step backwards one calendar day at a time, decrement remaining only on weekdays.
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay(); // 0 Sun .. 6 Sat
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return formatIsoDate(d);
}

export function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Derives all computed fields for a PR row. Caller merges the result into the row
// prior to writing to sheets.
export function derivePRFields(input: {
  qty?: string | number;
  unit_cost_usd?: string | number;
  target_award_date?: string;
}): {
  total_cost_usd: string;
  threshold_class: Threshold | '';
  sla_working_days: string;
  pr_deadline: string;
} {
  const total = totalUsd(input.qty || 0, input.unit_cost_usd || 0);
  if (total <= 0) {
    return { total_cost_usd: '', threshold_class: '', sla_working_days: '', pr_deadline: '' };
  }
  const t = classifyThreshold(total);
  const sla = slaForThreshold(t);
  const deadline = input.target_award_date ? subtractWorkdays(input.target_award_date, sla) : '';
  return {
    total_cost_usd: total.toFixed(2),
    threshold_class: t,
    sla_working_days: String(sla),
    pr_deadline: deadline,
  };
}
