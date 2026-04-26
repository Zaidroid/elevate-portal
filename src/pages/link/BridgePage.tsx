// /link/:app — single-purpose route that hands the current OAuth token to a
// legacy sub-app (selection-tool, advisor pipeline, leaves tracker) via URL
// hash and redirects.
//
// Why a route at all when the sidebar already has anchor links: the sidebar
// builds the URL at render time; if the token has rolled over since the page
// rendered, the link is stale. This route reads the token on demand at click
// time, so deep links from anywhere (HomePage, notifications, dashboards)
// always carry a fresh token.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, Lock, RefreshCw } from 'lucide-react';
import { Button, Card, CardHeader } from '../../lib/ui';

type BridgeTarget = {
  key: string;
  label: string;
  description: string;
  url: string;
};

const TARGETS: BridgeTarget[] = [
  {
    key: 'selection',
    label: 'Selection tool',
    description: 'Cohort selection workflow — applicant filtering, scoring, interviews, final cohort.',
    url: 'https://elevateselection.zaidlab.xyz',
  },
  {
    key: 'advisors-legacy',
    label: 'Advisor pipeline (legacy)',
    description: 'Original Advisors kanban + intake. Native /advisors page is the future home.',
    url: 'https://elevate-advisors.zaidlab.xyz',
  },
  {
    key: 'leaves',
    label: 'Leaves tracker',
    description: 'Team leave requests and approvals. Apps Script backend.',
    url: 'https://elevate-leaves.zaidlab.xyz',
  },
];

function buildSsoHash(): string | null {
  const token = localStorage.getItem('google_access_token');
  const expiry = localStorage.getItem('token_expiry');
  const email = localStorage.getItem('user_email');
  if (!token || !email) return null;
  return `#access_token=${token}&user_email=${encodeURIComponent(email)}&token_expiry=${expiry || ''}`;
}

export function BridgePage() {
  const { app } = useParams<{ app: string }>();
  const target = TARGETS.find(t => t.key === app);

  const [autoBridge, setAutoBridge] = useState(true);
  const [seconds, setSeconds] = useState(2);

  useEffect(() => {
    if (!target || !autoBridge) return;
    const hash = buildSsoHash();
    if (!hash) return;
    const t = setInterval(() => setSeconds(s => s - 1), 1000);
    const r = setTimeout(() => {
      window.location.href = `${target.url}${hash}`;
    }, 2000);
    return () => {
      clearInterval(t);
      clearTimeout(r);
    };
  }, [target, autoBridge]);

  if (!target) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader title="Unknown bridge target" subtitle={`No linked app called "${app}"`} />
          <Link to="/" className="text-sm text-brand-teal hover:underline">Back to home</Link>
        </Card>
      </div>
    );
  }

  const hash = buildSsoHash();
  if (!hash) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader
            title={`Sign in required to open ${target.label}`}
            subtitle="Your portal session has no active OAuth token."
          />
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            <Lock className="h-4 w-4 text-brand-red" />
            Sign in again from the home screen, then retry.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card accent="teal">
        <CardHeader title={`Bridging to ${target.label}`} subtitle={target.description} />
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Passing your portal session over via URL hash. The sub-app reads it once and signs you in
          without a second OAuth popup.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => {
              setAutoBridge(false);
              window.location.href = `${target.url}${hash}`;
            }}
          >
            <ArrowRight className="h-4 w-4" /> Open now
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAutoBridge(false);
              window.open(`${target.url}${hash}`, '_blank', 'noopener,noreferrer');
            }}
          >
            <ExternalLink className="h-4 w-4" /> Open in new tab
          </Button>
          {autoBridge && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Auto-redirect in {Math.max(0, seconds)}s
            </span>
          )}
        </div>
        {autoBridge && (
          <button
            onClick={() => setAutoBridge(false)}
            className="mt-3 text-xs text-brand-teal hover:underline"
          >
            Cancel auto-redirect
          </button>
        )}
      </Card>
    </div>
  );
}

export const BRIDGE_TARGETS = TARGETS;
