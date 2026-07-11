// Historial de sesiones, progreso y preguntas débiles. Port de juststudy.
// Cambio: studyApi.listSessions/getWeakQuestions → lib/firestore; getPackage → lib/packages.
import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  BarChart3, BookOpen, AlertTriangle, TrendingUp,
  RefreshCw, Play, Folder,
} from 'lucide-react';
import { getPackage } from '../../lib/packages';
import { listSessions, getWeakQuestions } from '../../lib/firestore';
import type { PackageIndex, StudyPackage, StudyQuestion, SessionRecord, WeakQuestion } from './types';

const LINE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f43f5e', '#84cc16'];

interface ResultsHistoryProps {
  packages: PackageIndex[];
  onStartTest: (questions: StudyQuestion[], label: string, slugs: string[]) => void;
}

type Tab = 'chart' | 'sessions' | 'weak';

export function ResultsHistory({ packages, onStartTest }: ResultsHistoryProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [weakQuestions, setWeakQuestions] = useState<WeakQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingTest, setIsLoadingTest] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('chart');

  const folders = useMemo(
    () => [...new Set(packages.map(p => p.folder).filter(Boolean) as string[])].sort(),
    [packages]
  );

  const folderPackages = useMemo(
    () => selectedFolder ? packages.filter(p => p.folder === selectedFolder) : packages,
    [packages, selectedFolder]
  );

  useEffect(() => { void loadData(); }, [selectedFolder]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [sess, weak] = await Promise.all([
        listSessions(selectedFolder ?? undefined),
        getWeakQuestions(selectedFolder ?? undefined),
      ]);
      setSessions(sess);
      setWeakQuestions(weak);
    } catch (err) {
      console.error('[studysmart] error loading history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const recommendations = useMemo(
    () => computeRecommendations(folderPackages, sessions, weakQuestions),
    [folderPackages, sessions, weakQuestions]
  );

  const handleStartWeakTest = async () => {
    const slugsNeeded = [...new Set(weakQuestions.map(q => q.package_slug))];
    if (!slugsNeeded.length) return;
    setIsLoadingTest(true);
    try {
      const pkgs: StudyPackage[] = await Promise.all(slugsNeeded.map(s => getPackage(s)));
      const weakSet = new Set(weakQuestions.map(q => `${q.package_slug}::${q.question_external_id}`));
      const questions: StudyQuestion[] = pkgs.flatMap((pkg, i) =>
        (pkg.questions?.items ?? [])
          .filter(q => weakSet.has(`${slugsNeeded[i]}::${q.external_id}`))
          .map(q => ({ ...q, package_slug: slugsNeeded[i] }))
      );
      const label = `Preguntas débiles${selectedFolder ? ` — ${selectedFolder}` : ''}`;
      onStartTest(questions, label, slugsNeeded);
    } catch (err) {
      console.error('[studysmart] error loading weak test packages:', err);
    } finally {
      setIsLoadingTest(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
      <div className="px-6 pt-6 pb-4 shrink-0 space-y-4 border-b border-border">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="text-lg font-bold text-text flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Historial & Progreso
          </h2>
          <FolderSelector folders={folders} selected={selectedFolder} onChange={setSelectedFolder} />
          {isLoading && <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />}
        </div>

        {recommendations.length > 0 && (
          <RecommendationPanel recommendations={recommendations} packages={folderPackages} />
        )}

        <div className="flex gap-1">
          {(['chart', 'sessions', 'weak'] as Tab[]).map(tab => (
            <TabButton key={tab} tab={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)} />
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {activeTab === 'chart' && (
          <ProgressChart sessions={sessions} packages={folderPackages} />
        )}
        {activeTab === 'sessions' && (
          <SessionsList sessions={sessions} />
        )}
        {activeTab === 'weak' && (
          <WeakQuestionsPanel
            weakQuestions={weakQuestions}
            packages={folderPackages}
            onStartTest={handleStartWeakTest}
            isLoading={isLoadingTest}
          />
        )}
      </div>
    </div>
  );
}

// ─── Recommendation logic ─────────────────────────────────────────────────────

interface Recommendation {
  pkg: PackageIndex;
  sessionCount: number;
  weakCount: number;
  score: number;
}

function computeRecommendations(
  packages: PackageIndex[],
  sessions: SessionRecord[],
  weakQuestions: WeakQuestion[]
): Recommendation[] {
  return packages
    .map(pkg => {
      const sessionCount = sessions.filter(s => s.package_slugs.includes(pkg.slug)).length;
      const weakCount = weakQuestions.filter(q => q.package_slug === pkg.slug).length;
      const score = weakCount * (1 / (sessionCount + 1));
      return { pkg, sessionCount, weakCount, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FolderSelector({ folders, selected, onChange }: {
  folders: string[];
  selected: string | null;
  onChange: (f: string | null) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <Folder className="w-4 h-4 text-text-muted shrink-0" />
      <select
        value={selected ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">Todos los paquetes</option>
        {folders.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
    </div>
  );
}

function TabButton({ tab, active, onClick }: { tab: Tab; active: boolean; onClick: () => void }) {
  const labels: Record<Tab, string> = { chart: 'Progreso', sessions: 'Sesiones', weak: 'Preguntas débiles' };
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'text-text-muted hover:text-text hover:bg-surface-hover'
      }`}
    >
      {labels[tab]}
    </button>
  );
}

function RecommendationPanel({ recommendations }: {
  recommendations: Recommendation[];
  packages: PackageIndex[];
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {recommendations.map(({ pkg, sessionCount, weakCount }) => (
        <div
          key={pkg.slug}
          className="flex items-start gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs max-w-xs"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-text truncate">{pkg.topic_name}</p>
            <p className="text-text-muted">{weakCount} preg. débiles · {sessionCount} sesiones</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProgressChart({ sessions, packages }: { sessions: SessionRecord[]; packages: PackageIndex[] }) {
  const slugsWithData = useMemo(
    () => [...new Set(sessions.flatMap(s => Object.keys(s.pkg_scores)))],
    [sessions]
  );

  const chartData = useMemo(() => {
    const dayCount: Record<string, number> = {};
    return [...sessions]
      .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
      .map(s => {
        const day = new Date(s.started_at).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
        dayCount[day] = (dayCount[day] || 0) + 1;
        return { label: `${day} #${dayCount[day]}`, ...s.pkg_scores };
      });
  }, [sessions]);

  if (sessions.length === 0) return <EmptyState icon={<TrendingUp />} text="Sin sesiones registradas aún." />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">{sessions.length} sesiones registradas</p>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} width={38} />
          <Tooltip formatter={(v: any) => [`${v}%`, '']} />
          <Legend formatter={slug => packages.find(p => p.slug === slug)?.topic_name ?? slug} />
          {slugsWithData.map((slug, i) => (
            <Line
              key={slug}
              type="monotone"
              dataKey={slug}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SessionsList({ sessions }: { sessions: SessionRecord[] }) {
  if (sessions.length === 0) return <EmptyState icon={<BookOpen />} text="Sin sesiones registradas aún." />;

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  return (
    <div className="space-y-2">
      {sorted.map(s => {
        const label = s.topic_label || s.package_slug;
        const date = new Date(s.started_at).toLocaleString('es-MX', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        const mins = Math.floor(s.time_seconds / 60);
        const secs = s.time_seconds % 60;
        const scoreColor = s.score_pct >= 70 ? 'text-emerald-500' : s.score_pct >= 50 ? 'text-amber-500' : 'text-red-500';
        return (
          <div key={s.id} className="flex items-center gap-4 p-3 bg-surface border border-border rounded-xl text-sm">
            <span className={`text-lg font-black w-14 shrink-0 ${scoreColor}`}>{s.score_pct}%</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-text truncate">{label}</p>
              <p className="text-xs text-text-muted">{date} · {s.correct_count}/{s.question_count} correctas · {mins}m {secs}s</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeakQuestionsPanel({ weakQuestions, packages, onStartTest, isLoading }: {
  weakQuestions: WeakQuestion[];
  packages: PackageIndex[];
  onStartTest: () => void;
  isLoading: boolean;
}) {
  if (weakQuestions.length === 0) {
    return <EmptyState icon={<BookOpen />} text="Sin preguntas débiles. ¡Buen trabajo!" />;
  }

  const byPackage = packages
    .map(pkg => ({ pkg, questions: weakQuestions.filter(q => q.package_slug === pkg.slug) }))
    .filter(g => g.questions.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">{weakQuestions.length} preguntas con al menos 1 fallo</p>
        <button
          onClick={onStartTest}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
        >
          {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Tomar test de débiles
        </button>
      </div>
      {byPackage.map(({ pkg, questions }) => (
        <div key={pkg.slug} className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-surface border-b border-border flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-bold text-text">{pkg.topic_name}</span>
            <span className="ml-auto text-xs text-text-muted">{questions.length} preguntas</span>
          </div>
          <ul className="divide-y divide-border/50">
            {questions.map(q => (
              <li key={q.question_external_id} className="px-4 py-2 flex items-start gap-3">
                <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-bold">
                  {q.wrong_count}
                </span>
                <span className="text-xs text-text leading-snug">{q.question_text || q.question_external_id}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-muted">
      <div className="w-10 h-10 opacity-30">{icon}</div>
      <p className="text-sm">{text}</p>
    </div>
  );
}
