import { useMemo, useState } from 'react';
import { ExternalLink, Download } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Badge, Button, Card, CardHeader, DataTable, FilterBar, statusTone, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column, FilterGroup, FilterValues } from '../../lib/ui';

const ADVISORS_TOOL_URL = 'https://elevate-advisors.zaidlab.xyz';

function buildSsoUrl(baseUrl: string): string {
  const token = localStorage.getItem('google_access_token');
  const expiry = localStorage.getItem('token_expiry');
  const email = localStorage.getItem('user_email');
  if (!token || !email) return baseUrl;
  return `${baseUrl}#access_token=${token}&user_email=${encodeURIComponent(email)}&token_expiry=${expiry || ''}`;
}

// Legacy Google Form headers — exact strings from the source sheet.
const H = {
  id: 'advisor_id',
  name: 'Full Name ',
  gender: 'Gender',
  country: 'Country ',
  email: 'Email',
  whatsapp: 'WhatsApp Number',
  linkedin: 'LinkedIn Profile Link (URL)',
  techRating: '  How would you rate your experience in the tech industry? Ranking from 5 (highest) to 1 (lowest)',
  ecoRating: 'How would you rate your Knowledge in the Palestinian tech ecosystem? Ranking from 5 (highest) to 1 (lowest)',
  expAreas: 'Which of the following do you have experience in?',
  cLevel: 'Do you have experience in working with C-level managers?',
  position: 'What is your current position?',
  employer: 'Who is your current employer?',
  years: 'What is your total years of experience?',
  paidVol: 'Are you looking for a paid or volunteering opportunity? ',
  hourly: 'If you are looking for a paid opportunity, please share your expected hourly rate in USD',
  cv: 'Please upload your CV',
  assignCompany: 'assignment_company_id',
  assignIntervention: 'assignment_intervention_type',
  assignStatus: 'assignment_status',
  assignNotes: 'assignment_notes',
} as const;

type Advisor = Record<string, string>;

// Canonical country aliases. Keys are normalized (lowercased, stripped) raw values;
// values are the canonical display label we want to group under.
const COUNTRY_ALIASES: Record<string, string> = {
  'palestine': 'Palestine',
  'palestinian territory': 'Palestine',
  'palestinian territories': 'Palestine',
  'state of palestine': 'Palestine',
  'occupied palestinian territory': 'Palestine',
  'west bank': 'Palestine',
  'gaza': 'Palestine',
  'gaza strip': 'Palestine',
  'ps': 'Palestine',
  'فلسطين': 'Palestine',

  'israel': 'Israel',
  'il': 'Israel',

  'jordan': 'Jordan',
  'jo': 'Jordan',
  'hashemite kingdom of jordan': 'Jordan',

  'united states': 'United States',
  'united states of america': 'United States',
  'usa': 'United States',
  'u.s.a.': 'United States',
  'u.s.': 'United States',
  'us': 'United States',
  'america': 'United States',

  'united kingdom': 'United Kingdom',
  'uk': 'United Kingdom',
  'u.k.': 'United Kingdom',
  'great britain': 'United Kingdom',
  'britain': 'United Kingdom',
  'england': 'United Kingdom',

  'united arab emirates': 'United Arab Emirates',
  'uae': 'United Arab Emirates',
  'u.a.e.': 'United Arab Emirates',
  'emirates': 'United Arab Emirates',

  'saudi arabia': 'Saudi Arabia',
  'ksa': 'Saudi Arabia',
  'kingdom of saudi arabia': 'Saudi Arabia',

  'egypt': 'Egypt',
  'arab republic of egypt': 'Egypt',

  'lebanon': 'Lebanon',
  'turkey': 'Turkey',
  'türkiye': 'Turkey',
  'turkiye': 'Turkey',
  'germany': 'Germany',
  'deutschland': 'Germany',
  'netherlands': 'Netherlands',
  'the netherlands': 'Netherlands',
  'holland': 'Netherlands',
  'canada': 'Canada',
  'qatar': 'Qatar',
  'kuwait': 'Kuwait',
  'bahrain': 'Bahrain',
  'oman': 'Oman',
  'morocco': 'Morocco',
  'tunisia': 'Tunisia',
  'algeria': 'Algeria',
  'syria': 'Syria',
  'iraq': 'Iraq',
  'yemen': 'Yemen',
  'sweden': 'Sweden',
  'norway': 'Norway',
  'denmark': 'Denmark',
  'finland': 'Finland',
  'france': 'France',
  'spain': 'Spain',
  'italy': 'Italy',
  'belgium': 'Belgium',
  'switzerland': 'Switzerland',
  'austria': 'Austria',
  'ireland': 'Ireland',
  'australia': 'Australia',
  'india': 'India',
  'pakistan': 'Pakistan',
};

function normalizeCountry(raw: string | undefined): string {
  if (!raw) return '';
  // Lowercase, strip diacritics, collapse whitespace, drop trailing punctuation.
  const cleaned = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;]+$/, '')
    .toLowerCase();
  if (!cleaned) return '';
  if (COUNTRY_ALIASES[cleaned]) return COUNTRY_ALIASES[cleaned];
  // No alias match: title-case the original trimmed value for display.
  return raw.trim().replace(/\s+/g, ' ').replace(/\w\S*/g, w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  );
}

export function AdvisorsPage() {
  const { user } = useAuth();
  const sheetId = getSheetId('advisors');
  const tab = getTab('advisors', 'advisors');

  const { rows, loading, error, refresh } = useSheetDoc<Advisor>(
    sheetId || null, tab, H.id, { userEmail: user?.email }
  );

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterValues>({ country: [], paidVol: [], assignment: [] });

  const counts = useMemo(() => {
    const byCountry = new Map<string, number>();
    const byPaidVol = new Map<string, number>();
    const byAssignment = new Map<string, number>();
    for (const r of rows) {
      const c = normalizeCountry(r[H.country]);
      if (c) byCountry.set(c, (byCountry.get(c) || 0) + 1);
      const pv = (r[H.paidVol] || '').trim();
      if (pv) byPaidVol.set(pv, (byPaidVol.get(pv) || 0) + 1);
      const as = (r[H.assignStatus] || '').trim() || '__unassigned__';
      byAssignment.set(as, (byAssignment.get(as) || 0) + 1);
    }
    return { byCountry, byPaidVol, byAssignment };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const country = filters.country || [];
    const paidVol = filters.paidVol || [];
    const assignment = filters.assignment || [];
    return rows.filter(r => {
      if (country.length > 0 && !country.includes(normalizeCountry(r[H.country]))) return false;
      if (paidVol.length > 0 && !paidVol.includes((r[H.paidVol] || '').trim())) return false;
      if (assignment.length > 0) {
        const key = (r[H.assignStatus] || '').trim() || '__unassigned__';
        if (!assignment.includes(key)) return false;
      }
      if (!q) return true;
      return [r[H.name], r[H.email], r[H.position], r[H.employer], r[H.expAreas]]
        .some(v => (v || '').toLowerCase().includes(q));
    });
  }, [rows, query, filters]);

  const filterGroups: FilterGroup[] = useMemo(() => {
    const countryOpts = Array.from(counts.byCountry.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: value, count }));
    const paidVolOpts = Array.from(counts.byPaidVol.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: value, count }));
    const assignmentOpts = [
      { value: '__unassigned__', label: 'Unassigned', count: counts.byAssignment.get('__unassigned__') || 0 },
      ...Array.from(counts.byAssignment.entries())
        .filter(([k]) => k !== '__unassigned__')
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, label: value, count })),
    ];
    return [
      { key: 'country', label: 'Country', options: countryOpts },
      { key: 'paidVol', label: 'Paid / Volunteer', options: paidVolOpts },
      { key: 'assignment', label: 'Assignment', options: assignmentOpts },
    ];
  }, [counts]);

  const columns: Column<Advisor>[] = [
    {
      key: H.name,
      header: 'Advisor',
      render: r => (
        <div className="flex items-center gap-3">
          <AdvisorAvatar name={r[H.name] || ''} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-navy-500 dark:text-white">{r[H.name] || '—'}</div>
            <div className="truncate text-xs text-slate-500">
              {[r[H.position], r[H.employer]].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: H.country,
      header: 'Country',
      width: '140px',
      render: r => {
        const n = normalizeCountry(r[H.country]);
        return n ? <span>{n}</span> : <span className="text-slate-400">—</span>;
      },
    },
    { key: H.years, header: 'Years', width: '80px' },
    {
      key: H.paidVol,
      header: 'Basis',
      width: '120px',
      render: r => {
        const v = (r[H.paidVol] || '').trim();
        if (!v) return <span className="text-slate-400">—</span>;
        const paid = /paid/i.test(v);
        return <Badge tone={paid ? 'amber' : 'teal'}>{paid ? 'Paid' : 'Volunteer'}</Badge>;
      },
    },
    {
      key: H.assignStatus,
      header: 'Assignment',
      render: r => r[H.assignStatus]
        ? <Badge tone={statusTone(r[H.assignStatus])}>{r[H.assignStatus]}</Badge>
        : <span className="text-xs text-slate-400">Unassigned</span>,
    },
  ];

  if (!sheetId) {
    return (
      <Card>
        <CardHeader title="Non-Technical Advisors" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_ADVISORS</code> in your environment.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Advisors</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Read-only summary. Assignments, matching, and editing live in the Advisors tool.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={refresh}>Refresh</Button>
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename('advisors'), filtered)}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <a
            href={buildSsoUrl(ADVISORS_TOOL_URL)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-red px-3.5 py-2 text-sm font-semibold text-white shadow-brand-red transition-colors hover:bg-brand-red-dark"
          >
            Open Advisors Tool <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </header>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      <FilterBar
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search by name, email, position, employer, expertise…"
        groups={filterGroups}
        values={filters}
        onValuesChange={setFilters}
        total={rows.length}
        filtered={filtered.length}
        resultNoun="advisors"
      />

      <DataTable columns={columns} rows={filtered} loading={loading} />
    </div>
  );
}

const AVATAR_TONES = [
  'bg-brand-teal/15 text-brand-teal',
  'bg-brand-red/15 text-brand-red',
  'bg-brand-orange/15 text-brand-orange',
  'bg-navy-500/15 text-navy-500 dark:text-slate-100',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
];

function toneFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function AdvisorAvatar({ name }: { name: string }) {
  const tone = toneFor(name || '·');
  return (
    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ${tone}`}>
      {initialsOf(name)}
    </div>
  );
}
