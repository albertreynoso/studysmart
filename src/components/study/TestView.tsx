// Sistema de tests interactivos del Banco de Estudio. Port de juststudy.
// Cambio: studyApi.saveSession (REST) → saveSession() de lib/firestore. Sin backend: BASE=''.
import { useState, useMemo, useEffect } from 'react';
import {
  HelpCircle,
  Award,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  XCircle,
  BookOpen,
  ArrowLeft,
  Timer
} from 'lucide-react';
import { saveSession } from '../../lib/firestore';
import type { StudyQuestion, SessionPayload } from './types';

const getImageUrl = (url?: string | null) => url ?? '';

interface TestViewProps {
  questions: StudyQuestion[];
  topicName: string;
  immediateFeedback: boolean;
  onClose: () => void;
  onReconfigure?: () => void;
  onSessionSaved?: () => void;
}

type TestState = 'running' | 'results';

interface UserAnswer {
  questionId: string;
  selectedOptionIds: string[];
  isCorrect: boolean;
  score: number; // 0..1: fracción de aciertos (parcial en multi/matching)
}

const fmtScore = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// Aciertos de una pregunta multi-parte (multi_response/matching). null si es de una sola respuesta.
function partialTally(q: StudyQuestion, a?: UserAnswer): { hits: number; total: number } | null {
  if (q.type === 'matching') {
    const pairs = q.correct_pairs ?? [];
    const sel = new Map((a?.selectedOptionIds ?? []).map(s => s.split(':') as [string, string]));
    return { hits: pairs.filter(p => sel.get(p.left) === p.right).length, total: pairs.length };
  }
  const isMulti = q.type === 'multiple_response' || q.correct.length > 1;
  if (!isMulti) return null;
  const correctSet = new Set(q.correct);
  const hits = (a?.selectedOptionIds ?? []).filter(id => correctSet.has(id)).length;
  return { hits, total: q.correct.length };
}

export function TestView({ questions, topicName, immediateFeedback, onClose, onReconfigure, onSessionSaved }: TestViewProps) {
  const [state, setState] = useState<TestState>('running');
  const [testQuestions] = useState<StudyQuestion[]>(questions);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, UserAnswer>>({});
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [matchAssignments, setMatchAssignments] = useState<Record<string, string>>({});
  const [hasSubmittedAnswer, setHasSubmittedAnswer] = useState(false);
  const [startTime, setStartTime] = useState<number>(() => Date.now());
  const [timeSpentSeconds, setTimeSpentSeconds] = useState(0);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);

  useEffect(() => {
    if (!lightboxSrc) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxSrc(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lightboxSrc]);

  // Cronómetro en vivo mientras el test está en curso.
  useEffect(() => {
    if (state !== 'running') return;
    const tick = () => setLiveElapsed(Math.floor((Date.now() - startTime) / 1000));
    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [state, startTime]);

  const currentQuestion = testQuestions[currentIdx];
  const isMatching = currentQuestion?.type === 'matching';
  const isMultiSelect = currentQuestion
    ? currentQuestion.type === 'multiple_response' || currentQuestion.correct.length > 1
    : false;
  const matchingLeft = currentQuestion?.left ?? [];
  const canSubmit = isMatching
    ? matchingLeft.length > 0 && matchingLeft.every(item => matchAssignments[item.id])
    : selectedOptions.length > 0;

  const currentAnswer = currentQuestion ? answers[currentQuestion.external_id] : undefined;
  const currentTally = hasSubmittedAnswer && currentQuestion ? partialTally(currentQuestion, currentAnswer) : null;
  const currentVerdict: 'correct' | 'partial' | 'wrong' = currentAnswer?.isCorrect
    ? 'correct'
    : (currentAnswer?.score ?? 0) > 0 ? 'partial' : 'wrong';

  const handleOptionToggle = (optionId: string) => {
    if (hasSubmittedAnswer) return;

    if (isMultiSelect) {
      setSelectedOptions(prev =>
        prev.includes(optionId)
          ? prev.filter(id => id !== optionId)
          : [...prev, optionId]
      );
    } else {
      setSelectedOptions([optionId]);
    }
  };

  const handleMatchAssign = (leftId: string, rightId: string) => {
    if (hasSubmittedAnswer) return;
    setMatchAssignments(prev => ({ ...prev, [leftId]: rightId }));
  };

  // selected se serializa como "leftId:rightId" para reusar SessionAnswer.selected.
  const evaluateMatching = () => {
    const pairs = currentQuestion.correct_pairs ?? [];
    const hits = pairs.filter(p => matchAssignments[p.left] === p.right).length;
    const score = pairs.length === 0 ? 0 : hits / pairs.length;
    const selected = matchingLeft.map(item => `${item.id}:${matchAssignments[item.id] ?? ''}`);
    return { isCorrect: score === 1, score, selected };
  };

  const evaluateChoice = () => {
    const correctSet = new Set(currentQuestion.correct);
    const selectedSet = new Set(selectedOptions);
    const hits = [...selectedSet].filter(id => correctSet.has(id)).length;
    const wrong = selectedSet.size - hits;
    // ponytail: penaliza sobre-selección; sin ello, marcar todo daría 100%. Clamp a [0,1].
    const score = correctSet.size === 0 ? 0 : Math.max(0, (hits - wrong) / correctSet.size);
    return { isCorrect: score === 1, score, selected: selectedOptions };
  };

  const handleSubmitAnswer = () => {
    if (!canSubmit || hasSubmittedAnswer) return;

    const { isCorrect, score, selected } = isMatching ? evaluateMatching() : evaluateChoice();

    const updatedAnswers: Record<string, UserAnswer> = {
      ...answers,
      [currentQuestion.external_id]: {
        questionId: currentQuestion.external_id,
        selectedOptionIds: selected,
        isCorrect,
        score,
      },
    };

    setAnswers(updatedAnswers);
    setHasSubmittedAnswer(true);

    if (!immediateFeedback) {
      // Must pass updatedAnswers explicitly: calling handleNextQuestion synchronously
      // means the setAnswers above hasn't flushed yet — closure would be stale.
      handleNextQuestion(updatedAnswers);
    }
  };

  const persistSession = async (finalAnswers: Record<string, UserAnswer>, elapsed: number) => {
    const slugs = [...new Set(testQuestions.map(q => q.package_slug).filter(Boolean) as string[])];
    const primarySlug = slugs[0] ?? 'unknown';
    const correctCount = Object.values(finalAnswers).reduce((sum, a) => sum + a.score, 0);
    const payload: SessionPayload = {
      package_slug: primarySlug,
      package_slugs: slugs.length ? slugs : [primarySlug],
      topic_label: topicName,
      question_count: testQuestions.length,
      correct_count: Math.round(correctCount * 10) / 10,
      score_pct: testQuestions.length ? Math.round((correctCount / testQuestions.length) * 100) : 0,
      time_seconds: elapsed,
      answers: testQuestions.map(q => ({
        package_slug: q.package_slug ?? primarySlug,
        question_external_id: q.external_id,
        question_text: q.question,
        selected: finalAnswers[q.external_id]?.selectedOptionIds ?? [],
        is_correct: finalAnswers[q.external_id]?.isCorrect ?? false,
        score: finalAnswers[q.external_id]?.score ?? 0,
      })),
    };
    try {
      await saveSession(payload);
      onSessionSaved?.();
    } catch (err) {
      console.error('[studysmart] error saving session:', err);
    }
  };

  const handleNextQuestion = (finalAnswers?: Record<string, UserAnswer>) => {
    const answersToSave = finalAnswers ?? answers;
    if (currentIdx < testQuestions.length - 1) {
      setCurrentIdx(prev => prev + 1);
      setSelectedOptions([]);
      setMatchAssignments({});
      setHasSubmittedAnswer(false);
    } else {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      setTimeSpentSeconds(elapsed);
      setState('results');
      void persistSession(answersToSave, elapsed);
    }
  };

  const handleRetry = () => {
    setShowRetryConfirm(false);
    setAnswers({});
    setSelectedOptions([]);
    setMatchAssignments({});
    setHasSubmittedAnswer(false);
    setCurrentIdx(0);
    setTimeSpentSeconds(0);
    setLiveElapsed(0);
    setStartTime(Date.now());
    setState('running');
  };

  const correctAnswersCount = useMemo(() => {
    return Object.values(answers).reduce((sum, a) => sum + a.score, 0);
  }, [answers]);

  const scorePercentage = useMemo(() => {
    if (testQuestions.length === 0) return 0;
    return Math.round((correctAnswersCount / testQuestions.length) * 100);
  }, [correctAnswersCount, testQuestions]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden p-6 animate-in fade-in duration-200">
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt="Imagen ampliada"
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <span className="absolute top-4 right-4 text-white/60 text-xs">ESC o click para cerrar</span>
        </div>
      )}
      {/* Top action bar */}
      <div className="flex items-center justify-between border-b border-border pb-4 mb-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
            title="Volver al Lector"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-text truncate max-w-lg">Test: {topicName}</h2>
            <p className="text-xs text-text-muted">Banco de Preguntas interactivo</p>
          </div>
        </div>
        {state === 'running' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-semibold text-text-muted tabular-nums">
              <Timer className="w-4 h-4 text-primary animate-pulse" />
              <span>{formatTime(liveElapsed)}</span>
            </div>
            <div className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-semibold text-text-muted">
              Progreso: {currentIdx + 1} de {testQuestions.length}
            </div>
          </div>
        )}
        {state === 'results' && testQuestions.length > 0 && (
          <button
            onClick={() => setShowRetryConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            Reintentar
          </button>
        )}
      </div>

      {showRetryConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
          onClick={() => setShowRetryConfirm(false)}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5">
              <RotateCcw className="w-5 h-5 text-primary shrink-0" />
              <h3 className="text-base font-bold text-text">Reintentar test</h3>
            </div>
            <p className="text-sm text-text-muted">
              Se reiniciará <span className="font-semibold text-text">{topicName}</span> con las mismas preguntas. Tu resultado actual ya quedó guardado.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => setShowRetryConfirm(false)}
                className="py-2.5 bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-hover text-xs font-semibold rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleRetry}
                className="py-2.5 bg-primary text-primary-foreground hover:opacity-90 text-xs font-semibold rounded-xl transition-all"
              >
                Reintentar
              </button>
            </div>
          </div>
        </div>
      )}

      {testQuestions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-surface border border-border rounded-xl">
          <HelpCircle className="w-12 h-12 text-text-muted/40 mb-3" />
          <h3 className="text-lg font-semibold text-text mb-1">No hay preguntas disponibles</h3>
          <p className="text-sm text-text-muted max-w-sm">
            Este tema no cuenta con preguntas en el paquete de estudio actual. Ingesta un JSON con preguntas para empezar.
          </p>
        </div>
      ) : state === 'running' ? (
        // ─── RUNNING STATE ───
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto max-w-2xl mx-auto w-full gap-4 pb-6">
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-text-muted">
              <span>Progreso del Test</span>
              <span>{Math.round(((currentIdx) / testQuestions.length) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${((currentIdx) / testQuestions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Question card */}
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm space-y-6 flex flex-col">
            <div className="space-y-2 border-b border-border/40 pb-4">
              <span className="inline-flex px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">
                Pregunta {currentIdx + 1}
              </span>
              <h3 className="text-lg font-semibold text-text leading-snug">
                {currentQuestion.question}
              </h3>
              {currentQuestion.image && (
                <div className="flex justify-center mt-4 mb-2">
                  <img
                    src={getImageUrl(currentQuestion.image)}
                    alt="Referencia visual"
                    onClick={() => setLightboxSrc(getImageUrl(currentQuestion.image))}
                    className="w-full h-auto rounded-xl border border-border shadow-sm bg-background cursor-zoom-in hover:opacity-90 transition-opacity"
                  />
                </div>
              )}
            </div>

            {/* Matching: un select por concepto */}
            {isMatching && (
              <div className="space-y-2.5">
                {matchingLeft.map(item => {
                  const assigned = matchAssignments[item.id] ?? '';
                  const correctRight = currentQuestion.correct_pairs?.find(p => p.left === item.id)?.right;
                  const showSuccess = hasSubmittedAnswer && assigned === correctRight;
                  const showFailure = hasSubmittedAnswer && assigned !== correctRight;

                  let rowStyles = 'border-border';
                  if (showSuccess) rowStyles = 'border-emerald-500 bg-emerald-500/10';
                  if (showFailure) rowStyles = 'border-red-500 bg-red-500/10';

                  return (
                    <div key={item.id} className={`p-3.5 border rounded-xl text-sm transition-all ${rowStyles}`}>
                      <div className="flex items-center gap-3">
                        <span className="flex-1 font-medium text-text">{item.text}</span>
                        <select
                          value={assigned}
                          onChange={e => handleMatchAssign(item.id, e.target.value)}
                          disabled={hasSubmittedAnswer}
                          className="flex-1 bg-background border border-border rounded-lg px-2.5 py-2 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-70"
                        >
                          <option value="">— Selecciona —</option>
                          {(currentQuestion.right ?? []).map(r => (
                            <option key={r.id} value={r.id}>{r.text}</option>
                          ))}
                        </select>
                        <div className="shrink-0 w-5">
                          {showSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                          {showFailure && <XCircle className="w-5 h-5 text-red-500" />}
                        </div>
                      </div>
                      {showFailure && (
                        <p className="mt-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          Correcta: {(currentQuestion.right ?? []).find(r => r.id === correctRight)?.text ?? '—'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Options list */}
            {!isMatching && (
            <div className="space-y-2.5">
              {currentQuestion.options.map(option => {
                const isSelected = selectedOptions.includes(option.id);
                const isCorrectOption = currentQuestion.correct.includes(option.id);
                const showSuccess = hasSubmittedAnswer && isCorrectOption;
                const showFailure = hasSubmittedAnswer && isSelected && !isCorrectOption;

                let optionStyles = 'border-border hover:border-primary/50 hover:bg-surface-hover text-text';
                if (isSelected) optionStyles = 'border-primary bg-primary/5 text-text';
                if (showSuccess) optionStyles = 'border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300';
                if (showFailure) optionStyles = 'border-red-500 bg-red-500/10 text-red-800 dark:text-red-300';

                return (
                  <button
                    key={option.id}
                    onClick={() => handleOptionToggle(option.id)}
                    disabled={hasSubmittedAnswer}
                    className={`w-full flex items-center justify-between p-3.5 border rounded-xl text-left text-sm font-medium transition-all ${optionStyles}`}
                  >
                    <div className="flex items-center gap-3 pr-2">
                      <div className="shrink-0 flex items-center justify-center">
                        {isMultiSelect ? (
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background'
                          }`}>
                            {isSelected && (
                              <svg className="w-2.5 h-2.5 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background'
                          }`}>
                            {isSelected && (
                              <div className="w-1.5 h-1.5 rounded-full bg-background" />
                            )}
                          </div>
                        )}
                      </div>
                      <span>{option.text}</span>
                    </div>
                    <div className="shrink-0">
                      {showSuccess && isSelected && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                      {showSuccess && !isSelected && (
                        <span className="text-[10px] font-bold text-emerald-600 uppercase">Faltó</span>
                      )}
                      {showFailure && <XCircle className="w-5 h-5 text-red-500" />}
                    </div>
                  </button>
                );
              })}
            </div>
            )}

            {/* Answer check action */}
            {!hasSubmittedAnswer ? (
              <button
                onClick={handleSubmitAnswer}
                disabled={!canSubmit}
                className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-xs"
              >
                Responder
              </button>
            ) : (
              <div className="space-y-4 pt-4 border-t border-border/40 animate-in slide-in-from-bottom-2 duration-200">
                <div
                  className={`p-4 rounded-xl flex gap-3 ${
                    currentVerdict === 'correct'
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300'
                      : currentVerdict === 'partial'
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300'
                      : 'bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-300'
                  }`}
                >
                  <div className="shrink-0 mt-0.5">
                    {currentVerdict === 'correct' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : currentVerdict === 'partial' ? (
                      <CheckCircle2 className="w-5 h-5 text-amber-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold">
                      {currentVerdict === 'correct'
                        ? '¡Respuesta Correcta!'
                        : currentVerdict === 'partial'
                        ? 'Respuesta Parcial'
                        : 'Respuesta Incorrecta'}
                      {currentTally && (
                        <span className="ml-1.5 font-semibold opacity-80">
                          · {currentTally.hits} de {currentTally.total} aciertos
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] leading-relaxed opacity-90">
                      {currentQuestion.explanation}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => handleNextQuestion()}
                  className="w-full py-3 bg-text text-background font-semibold rounded-xl hover:opacity-90 transition-all text-xs flex items-center justify-center gap-1.5"
                >
                  {currentIdx < testQuestions.length - 1 ? 'Siguiente Pregunta' : 'Ver Resultados'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        // ─── RESULTS STATE ───
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto max-w-2xl mx-auto w-full gap-6 pb-6">
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col items-center text-center space-y-4">
            <Award className="w-12 h-12 text-primary" />
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-text">Test Completado</h3>
              <p className="text-xs text-text-muted">Has terminado de evaluar tus conocimientos en esta sección</p>
            </div>

            <div className="grid grid-cols-3 gap-4 w-full pt-4 border-t border-border/40">
              <div className="p-3 bg-background border border-border rounded-xl space-y-1 text-center">
                <p className="text-[10px] font-bold text-text-muted uppercase">Puntuación</p>
                <p className="text-lg font-black text-primary">{scorePercentage}%</p>
              </div>
              <div className="p-3 bg-background border border-border rounded-xl space-y-1 text-center">
                <p className="text-[10px] font-bold text-text-muted uppercase">Aciertos</p>
                <p className="text-lg font-black text-text">
                  {correctAnswersCount} / {testQuestions.length}
                </p>
              </div>
              <div className="p-3 bg-background border border-border rounded-xl space-y-1 text-center">
                <p className="text-[10px] font-bold text-text-muted uppercase">Tiempo</p>
                <p className="text-lg font-black text-text">{formatTime(timeSpentSeconds)}</p>
              </div>
            </div>

            <div className="pt-2 w-full">
              <p className="text-xs font-bold text-text-muted">
                {scorePercentage >= 90
                  ? '🏆 ¡Excelente! Dominas perfectamente este contenido.'
                  : scorePercentage >= 70
                  ? '👏 ¡Buen trabajo! Tienes un sólido entendimiento.'
                  : scorePercentage >= 50
                  ? '👍 Aprobado. Te sugerimos repasar los puntos débiles.'
                  : '📚 Te recomendamos releer la teoría y volver a intentarlo.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 w-full pt-2">
              <button
                onClick={() => onReconfigure?.()}
                className="py-2.5 bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-hover text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Configurar Nuevo Test
              </button>
              <button
                onClick={onClose}
                className="py-2.5 bg-primary text-primary-foreground hover:opacity-90 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all"
              >
                <BookOpen className="w-4 h-4" />
                Volver al Lector
              </button>
            </div>
          </div>

          {/* Detailed Question Review List */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-text uppercase tracking-wider">Revisión de Preguntas</h4>
            <div className="space-y-3.5">
              {testQuestions.map((question, i) => {
                const answer = answers[question.external_id];
                const tally = partialTally(question, answer);
                const verdict: 'correct' | 'partial' | 'wrong' = answer?.isCorrect
                  ? 'correct'
                  : (answer?.score ?? 0) > 0 ? 'partial' : 'wrong';
                return (
                  <div
                    key={question.external_id}
                    className="p-5 bg-surface border border-border rounded-xl space-y-3 shadow-xs animate-in fade-in duration-200"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-text-muted uppercase">Pregunta {i + 1}</span>
                        <h5 className="text-xs font-semibold text-text leading-snug">{question.question}</h5>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          verdict === 'correct'
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : verdict === 'partial'
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-red-500/10 text-red-600'
                        }`}
                      >
                        {verdict === 'correct' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Correcta
                          </>
                        ) : verdict === 'partial' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Parcial{tally ? ` ${tally.hits}/${tally.total}` : ''}
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" />
                            Incorrecta
                          </>
                        )}
                      </span>
                    </div>

                    <div className="space-y-1.5 pl-2 border-l-2 border-border/60">
                      {question.type === 'matching' && (question.left ?? []).map(item => {
                        // selectedOptionIds guarda "leftId:rightId"
                        const chosenId = answer?.selectedOptionIds
                          .map(s => s.split(':'))
                          .find(([leftId]) => leftId === item.id)?.[1];
                        const correctId = question.correct_pairs?.find(p => p.left === item.id)?.right;
                        const rightText = (id?: string) => (question.right ?? []).find(r => r.id === id)?.text ?? '—';
                        const pairOk = Boolean(chosenId) && chosenId === correctId;
                        return (
                          <div key={item.id} className={`text-[11px] flex gap-2 items-center flex-wrap ${pairOk ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}`}>
                            <span className="text-text-muted font-normal">{item.text} →</span>
                            <span>{rightText(chosenId)}</span>
                            {!pairOk && (
                              <span className="text-[9px] bg-emerald-500/10 text-emerald-600 px-1 rounded">
                                Correcta: {rightText(correctId)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {question.type !== 'matching' && question.options.map(opt => {
                        const wasSelected = answer?.selectedOptionIds.includes(opt.id);
                        const isCorrect = question.correct.includes(opt.id);

                        let optStyles = 'text-text-muted';
                        if (isCorrect) optStyles = 'text-emerald-600 font-semibold';
                        if (wasSelected && !isCorrect) optStyles = 'text-red-500 font-semibold line-through';

                        return (
                          <div key={opt.id} className={`text-[11px] flex gap-2 items-center ${optStyles}`}>
                            <span className="uppercase font-extrabold text-[10px] bg-border px-1.5 py-0.5 rounded text-text-muted">
                              {opt.id}
                            </span>
                            <span>{opt.text}</span>
                            {isCorrect && <span className="text-[9px] bg-emerald-500/10 px-1 rounded">Correcta</span>}
                            {isCorrect && wasSelected && (
                              <span className="text-[9px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1 rounded font-bold">Acertada</span>
                            )}
                            {isCorrect && !wasSelected && (
                              <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1 rounded">No elegida</span>
                            )}
                            {wasSelected && !isCorrect && (
                              <span className="text-[9px] bg-red-500/10 px-1 rounded">Elegida</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="p-3 bg-background border border-border rounded-lg text-[10px] leading-relaxed text-text-muted">
                      <span className="font-bold text-text-muted block mb-0.5">Explicación:</span>
                      {question.explanation}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
