// Capacity Building tab — three mentor-led training tracks running
// Feb 2 – Apr 5, 2026. Mentor cards summarise each track; per-track
// session lists are editable for admins (date, topic, recording, hours,
// status). Attendance matrix is editable inline.

import { useMemo, useState } from 'react';
import { CalendarDays, ExternalLink, Plus, Save, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  useToast,
} from '../../lib/ui';
import type {
  EbAttendance,
  EbMentor,
  EbSession,
} from '../../types/elevateBridge';
import {
  buildAttendanceMatrix,
  capacitySummary,
  mintAttendanceId,
  mintSessionId,
} from './utils';
import { appendEbActivity, diffForEbActivity } from './activityLog';

type Props = {
  mentors: EbMentor[];
  sessions: EbSession[];
  attendance: EbAttendance[];
  canEdit: boolean;
  userEmail: string;
  sheetId: string;
  updateMentor: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  updateSession: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  createSession: (row: Partial<Record<string, string>>) => Promise<unknown>;
  updateAttendance: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  createAttendance: (row: Partial<Record<string, string>>) => Promise<unknown>;
};

const SESSION_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Rescheduled'];

export function CapacityTab({
  mentors,
  sessions,
  attendance,
  canEdit,
  userEmail,
  sheetId,
  updateSession,
  createSession,
  updateAttendance,
  createAttendance,
}: Props) {
  const toast = useToast();
  const summary = useMemo(() => capacitySummary(mentors, sessions), [mentors, sessions]);
  const attendanceMatrix = useMemo(() => buildAttendanceMatrix(sessions, attendance), [sessions, attendance]);

  const tracksFromMentors = mentors.map(m => m.track).filter(Boolean);
  const tracksFromSessions = Array.from(new Set(sessions.map(s => s.track).filter(Boolean)));
  const allTracks = Array.from(new Set([...tracksFromMentors, ...tracksFromSessions]));

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<EbSession>>({});
  const [creatingForTrack, setCreatingForTrack] = useState<string | null>(null);

  const startEdit = (s: EbSession) => {
    setEditingSessionId(s.session_id);
    setDraft({ ...s });
    setCreatingForTrack(null);
  };

  const startCreate = (track: string) => {
    const existing = sessions.filter(s => s.track === track);
    const nextNum = (existing.length + 1).toString();
    setCreatingForTrack(track);
    setEditingSessionId(null);
    setDraft({
      session_id: '',
      track,
      session_num: nextNum,
      date: '',
      topic: '',
      recording_url: '',
      passcode: '',
      curriculum_url: '',
      hours: '2',
      status: 'Scheduled',
      notes: '',
    });
  };

  const cancelEdit = () => {
    setEditingSessionId(null);
    setCreatingForTrack(null);
    setDraft({});
  };

  const saveSession = async () => {
    try {
      const now = new Date().toISOString();
      const updates: Partial<Record<string, string>> = {
        track:          draft.track || '',
        session_num:    draft.session_num || '',
        date:           draft.date || '',
        topic:          draft.topic || '',
        recording_url:  draft.recording_url || '',
        passcode:       draft.passcode || '',
        curriculum_url: draft.curriculum_url || '',
        hours:          draft.hours || '',
        status:         draft.status || 'Scheduled',
        notes:          draft.notes || '',
        updated_at:     now,
        updated_by:     userEmail,
      };
      if (editingSessionId) {
        const before = sessions.find(s => s.session_id === editingSessionId);
        await updateSession(editingSessionId, updates);
        if (before) {
          const diffs = diffForEbActivity(before, { ...before, ...updates });
          for (const d of diffs) {
            if (['updated_at', 'updated_by'].includes(d.field)) continue;
            void appendEbActivity({
              sheetId,
              tabName: 'ActivityLog',
              user_email: userEmail,
              entity_type: 'session',
              entity_id: editingSessionId,
              action: 'session_updated',
              field: d.field,
              old_value: d.old_value,
              new_value: d.new_value,
              details: `${before.track} S${before.session_num}`,
            });
          }
        }
      } else {
        const id = mintSessionId(draft.track || 'session', draft.session_num || '');
        await createSession({ session_id: id, ...updates });
        void appendEbActivity({
          sheetId,
          tabName: 'ActivityLog',
          user_email: userEmail,
          entity_type: 'session',
          entity_id: id,
          action: 'session_created',
          new_value: `${draft.track} S${draft.session_num} · ${draft.topic || ''}`,
        });
      }
      toast.success('Session saved');
      cancelEdit();
    } catch (err) {
      toast.error('Save failed', (err as Error).message);
    }
  };

  const markAttendance = async (sessionId: string, applicantId: string, attendedValue: 'Yes' | 'No' | 'Late') => {
    try {
      const id = mintAttendanceId(sessionId, applicantId);
      const existing = attendance.find(a => a.attendance_id === id);
      const now = new Date().toISOString();
      const payload: Partial<Record<string, string>> = {
        attendance_id: id,
        session_id: sessionId,
        applicant_id: applicantId,
        full_name: attendanceMatrix.participantNames.get(applicantId) || '',
        attended: attendedValue,
        updated_at: now,
        updated_by: userEmail,
      };
      if (existing) {
        await updateAttendance(id, payload);
      } else {
        await createAttendance(payload);
      }
      void appendEbActivity({
        sheetId,
        tabName: 'ActivityLog',
        user_email: userEmail,
        entity_type: 'attendance',
        entity_id: id,
        action: 'attendance_marked',
        field: 'attended',
        old_value: existing?.attended || '',
        new_value: attendedValue,
      });
    } catch (err) {
      toast.error('Attendance save failed', (err as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Programme summary"
          subtitle="Feb 2 – Apr 5, 2026 · 3 mentor-led tracks"
          overline={<><CalendarDays className="-mt-0.5 mr-1 inline h-3 w-3" /> Upskilling</>}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Sessions" value={`${summary.sessionsCompleted}/${summary.sessionsScheduled}`} />
          <Stat label="Mentored hours" value={`${summary.completedHours}`} hint={`of ${summary.totalHours} planned`} />
          <Stat label="Budget" value={`$${summary.totalBudget}`} />
          <Stat label="Spent" value={`$${Math.round(summary.spent)}`} tone={summary.spent > summary.totalBudget ? 'red' : 'teal'} />
          <Stat label="Remaining" value={`$${Math.round(summary.remaining)}`} tone="teal" />
        </div>
      </Card>

      {allTracks.length === 0 && (
        <Card>
          <p className="text-sm text-slate-500">No mentors or sessions loaded. Populate the Mentors and Training Sessions tabs.</p>
        </Card>
      )}

      {allTracks.map(track => {
        const mentor = mentors.find(m => m.track === track);
        const trackSessions = sessions.filter(s => s.track === track).sort((a, b) => (Number(a.session_num) || 0) - (Number(b.session_num) || 0));
        return (
          <Card key={track}>
            <CardHeader
              title={track}
              subtitle={mentor ? `Mentor: ${mentor.full_name} · ${mentor.email} · ${mentor.whatsapp}` : 'No mentor assigned'}
              action={canEdit ? (
                <Button variant="ghost" onClick={() => startCreate(track)}>
                  <Plus className="mr-1 h-4 w-4" /> Add session
                </Button>
              ) : null}
            />

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-navy-700 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Topic</th>
                    <th className="px-3 py-2">Recording</th>
                    <th className="px-3 py-2">Passcode</th>
                    <th className="px-3 py-2">Curriculum</th>
                    <th className="px-3 py-2">Hours</th>
                    <th className="px-3 py-2">Status</th>
                    {canEdit && <th className="px-3 py-2"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                  {trackSessions.length === 0 && creatingForTrack !== track && (
                    <tr><td colSpan={canEdit ? 9 : 8} className="px-3 py-4 text-center text-slate-500">No sessions yet.</td></tr>
                  )}
                  {trackSessions.map(s => (
                    editingSessionId === s.session_id ? (
                      <EditRow key={s.session_id} draft={draft} setDraft={setDraft} onSave={saveSession} onCancel={cancelEdit} />
                    ) : (
                      <tr key={s.session_id} className="text-sm text-navy-500 dark:text-white">
                        <td className="px-3 py-2 font-mono">{s.session_num}</td>
                        <td className="px-3 py-2">{s.date}</td>
                        <td className="px-3 py-2">{s.topic}</td>
                        <td className="px-3 py-2">{s.recording_url ? <ExtLink href={s.recording_url}>Watch</ExtLink> : '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{s.passcode}</td>
                        <td className="px-3 py-2">{s.curriculum_url ? <ExtLink href={s.curriculum_url}>Open</ExtLink> : '—'}</td>
                        <td className="px-3 py-2">{s.hours}</td>
                        <td className="px-3 py-2"><Badge tone={s.status === 'Completed' ? 'teal' : s.status === 'Cancelled' ? 'red' : 'neutral'}>{s.status || '—'}</Badge></td>
                        {canEdit && (
                          <td className="px-3 py-2 text-right">
                            <Button variant="ghost" onClick={() => startEdit(s)}><Save className="h-3 w-3" /></Button>
                          </td>
                        )}
                      </tr>
                    )
                  ))}
                  {creatingForTrack === track && (
                    <EditRow draft={draft} setDraft={setDraft} onSave={saveSession} onCancel={cancelEdit} />
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      {attendanceMatrix.participantIds.length > 0 && (
        <Card>
          <CardHeader
            title="Attendance matrix"
            subtitle={`${attendanceMatrix.participantIds.length} participants × ${attendanceMatrix.sortedSessions.length} sessions`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-navy-700">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 dark:bg-navy-700">Participant</th>
                  {attendanceMatrix.sortedSessions.map(s => (
                    <th key={s.session_id} className="px-2 py-2 text-center whitespace-nowrap">
                      <div className="text-[10px] text-slate-500">{s.track.slice(0, 3)}</div>
                      <div className="font-mono">S{s.session_num}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                {attendanceMatrix.participantIds.map(pid => {
                  const row = attendanceMatrix.matrix.get(pid)!;
                  return (
                    <tr key={pid}>
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-semibold dark:bg-navy-600">
                        {attendanceMatrix.participantNames.get(pid)}
                      </td>
                      {attendanceMatrix.sortedSessions.map(s => {
                        const cell = row.get(s.session_id);
                        const v = cell?.attended || '';
                        return (
                          <td key={s.session_id} className="px-2 py-1 text-center">
                            {canEdit ? (
                              <select
                                value={v}
                                onChange={e => markAttendance(s.session_id, pid, e.target.value as 'Yes' | 'No' | 'Late')}
                                className={`w-14 rounded-md border px-1 py-0.5 text-[10px] font-bold ${
                                  v === 'Yes' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' :
                                  v === 'No'  ? 'border-red-300 bg-red-50 text-red-700' :
                                  v === 'Late' ? 'border-amber-300 bg-amber-50 text-amber-700' :
                                  'border-slate-200 bg-white text-slate-500 dark:bg-navy-600 dark:border-navy-700 dark:text-slate-300'
                                }`}
                              >
                                <option value=""></option>
                                <option value="Yes">Yes</option>
                                <option value="No">No</option>
                                <option value="Late">Late</option>
                              </select>
                            ) : (
                              <Badge tone={v === 'Yes' ? 'teal' : v === 'No' ? 'red' : v === 'Late' ? 'orange' : 'neutral'}>
                                {v || '—'}
                              </Badge>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'teal' | 'red' }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-navy-700">
      <div className="text-2xs font-bold uppercase tracking-[0.1em] text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tone === 'red' ? 'text-brand-red' : tone === 'teal' ? 'text-brand-teal' : 'text-navy-500 dark:text-white'}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-teal hover:underline">
      <ExternalLink className="h-3 w-3" /> {children}
    </a>
  );
}

function EditRow({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: Partial<EbSession>;
  setDraft: (d: Partial<EbSession>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const inp = 'w-full rounded-md border border-slate-200 bg-brand-editable px-2 py-1 text-xs dark:border-navy-700 dark:bg-navy-700 dark:text-white';
  return (
    <tr className="bg-brand-editable/40 dark:bg-navy-700/40">
      <td className="px-3 py-2"><input className={inp} value={draft.session_num || ''} onChange={e => setDraft({ ...draft, session_num: e.target.value })} /></td>
      <td className="px-3 py-2"><input type="date" className={inp} value={draft.date || ''} onChange={e => setDraft({ ...draft, date: e.target.value })} /></td>
      <td className="px-3 py-2"><input className={inp} value={draft.topic || ''} onChange={e => setDraft({ ...draft, topic: e.target.value })} placeholder="Topic" /></td>
      <td className="px-3 py-2"><input className={inp} value={draft.recording_url || ''} onChange={e => setDraft({ ...draft, recording_url: e.target.value })} placeholder="https://" /></td>
      <td className="px-3 py-2"><input className={inp} value={draft.passcode || ''} onChange={e => setDraft({ ...draft, passcode: e.target.value })} /></td>
      <td className="px-3 py-2"><input className={inp} value={draft.curriculum_url || ''} onChange={e => setDraft({ ...draft, curriculum_url: e.target.value })} placeholder="https://" /></td>
      <td className="px-3 py-2"><input className={inp} value={draft.hours || ''} onChange={e => setDraft({ ...draft, hours: e.target.value })} /></td>
      <td className="px-3 py-2">
        <select className={inp} value={draft.status || 'Scheduled'} onChange={e => setDraft({ ...draft, status: e.target.value })}>
          {SESSION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button variant="primary" onClick={onSave}><Save className="h-3 w-3" /></Button>
          <Button variant="ghost" onClick={onCancel}><X className="h-3 w-3" /></Button>
        </div>
      </td>
    </tr>
  );
}
