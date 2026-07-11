// Configuración del test (paso 2 del flujo "Tomar test"), como modal. Port de juststudy (sin cambios).
import { useMemo, useState } from 'react';
import { Settings, ArrowRight, ArrowLeft } from 'lucide-react';
import type { StudyQuestion } from './types';

export interface TestConfig {
  selectionMode: 'range' | 'random';
  rangeStart: number;
  rangeEnd: number;
  randomCount: number;
  immediateFeedback: boolean;
  shuffleOptions: boolean;
  shuffleQuestions: boolean;
}

// Aplica selección (rango/aleatorio) y barajado según la configuración elegida.
export function buildTestQuestions(pool: StudyQuestion[], config: TestConfig): StudyQuestion[] {
  const total = pool.length;
  let selected = selectByMode(pool, config, total);
  if (config.shuffleQuestions) selected = [...selected].sort(() => 0.5 - Math.random());
  if (!config.shuffleOptions) return selected;
  return selected.map(question => ({ ...question, options: [...question.options].sort(() => 0.5 - Math.random()) }));
}

function selectByMode(pool: StudyQuestion[], config: TestConfig, total: number): StudyQuestion[] {
  if (config.selectionMode === 'range') {
    const start = Math.max(1, Math.min(config.rangeStart, total)) - 1;
    const end = Math.max(1, Math.min(config.rangeEnd, total));
    return pool.slice(start, end);
  }
  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(config.randomCount, total));
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (val: boolean) => void;
}

function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? 'bg-primary' : 'bg-border'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-md ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function readBool(key: string, fallback: boolean): boolean {
  const saved = localStorage.getItem(key);
  return saved !== null ? saved === 'true' : fallback;
}

function persistBool(key: string, value: boolean): void {
  localStorage.setItem(key, String(value));
}

interface TestConfigModalProps {
  pool: StudyQuestion[];
  label: string;
  onBack: () => void;
  onStart: (questions: StudyQuestion[], immediateFeedback: boolean) => void;
}

export function TestConfigModal({ pool, label, onBack, onStart }: TestConfigModalProps) {
  const total = pool.length;
  const [selectionMode, setSelectionMode] = useState<'range' | 'random'>('range');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(Math.min(20, total));
  const [randomCount, setRandomCount] = useState(Math.min(10, total));
  const [immediateFeedback, setImmediateFeedback] = useState(() => readBool('test_immediate_feedback', true));
  const [shuffleOptions, setShuffleOptions] = useState(() => readBool('test_shuffle_options', false));
  const [shuffleQuestions, setShuffleQuestions] = useState(() => readBool('test_shuffle_questions', false));

  const rangeError = useMemo(() => validateRange(selectionMode, rangeStart, rangeEnd, total), [selectionMode, rangeStart, rangeEnd, total]);
  const randomError = useMemo(() => validateRandom(selectionMode, randomCount, total), [selectionMode, randomCount, total]);
  const hasValidationError = !!(rangeError || randomError);

  const toggleImmediate = (val: boolean) => { setImmediateFeedback(val); persistBool('test_immediate_feedback', val); };
  const toggleShuffleOptions = (val: boolean) => { setShuffleOptions(val); persistBool('test_shuffle_options', val); };
  const toggleShuffleQuestions = (val: boolean) => { setShuffleQuestions(val); persistBool('test_shuffle_questions', val); };

  const handleStart = () => {
    if (hasValidationError) return;
    const config: TestConfig = { selectionMode, rangeStart, rangeEnd, randomCount, immediateFeedback, shuffleOptions, shuffleQuestions };
    const questions = buildTestQuestions(pool, config);
    if (questions.length === 0) return;
    onStart(questions, immediateFeedback);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={onBack}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center space-y-1 border-b border-border/40 p-6 shrink-0">
          <Settings className="w-8 h-8 text-primary mx-auto" />
          <h3 className="text-lg font-bold text-text">Configuración del Test</h3>
          <p className="text-xs text-text-muted truncate">
            <span className="text-primary font-bold">{total}</span> preguntas en {label}
          </p>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex rounded-lg overflow-hidden border border-border text-xs font-semibold">
            <ModeButton active={selectionMode === 'range'} onClick={() => setSelectionMode('range')} label="Rango de Preguntas" />
            <ModeButton active={selectionMode === 'random'} onClick={() => setSelectionMode('random')} label="Preguntas Aleatorias" />
          </div>

          {selectionMode === 'range' ? (
            <RangeFields
              total={total}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onStartChange={setRangeStart}
              onEndChange={setRangeEnd}
              error={rangeError}
            />
          ) : (
            <RandomFields total={total} randomCount={randomCount} onChange={setRandomCount} error={randomError} />
          )}

          <ConfigToggle label="Corrección inmediata" hint="Ver explicaciones al presionar Responder" checked={immediateFeedback} onChange={toggleImmediate} />
          <ConfigToggle label="Barajar opciones" hint="Mostrar las opciones en orden aleatorio" checked={shuffleOptions} onChange={toggleShuffleOptions} />
          <ConfigToggle label="Barajar preguntas" hint="Mostrar las preguntas en orden aleatorio" checked={shuffleQuestions} onChange={toggleShuffleQuestions} />
        </div>

        <div className="grid grid-cols-2 gap-3 p-6 border-t border-border shrink-0">
          <button
            onClick={onBack}
            className="py-2.5 text-sm text-text-muted hover:text-text border border-border rounded-xl hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Atrás
          </button>
          <button
            onClick={handleStart}
            disabled={hasValidationError}
            className="py-2.5 text-sm bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            Comenzar Test
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function validateRange(mode: 'range' | 'random', start: number, end: number, total: number): string | null {
  if (mode !== 'range') return null;
  if (start < 1) return 'El número de inicio debe ser al menos 1.';
  if (end > total) return `El número de fin no puede exceder el total de preguntas (${total}).`;
  if (start > end) return 'El valor de inicio debe ser menor o igual al final.';
  return null;
}

function validateRandom(mode: 'range' | 'random', count: number, total: number): string | null {
  if (mode !== 'random') return null;
  if (count < 1) return 'Debes evaluar al menos 1 pregunta.';
  if (count > total) return `La cantidad de preguntas no puede exceder las disponibles (${total}).`;
  return null;
}

function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-surface hover:bg-surface-hover text-text-muted'}`}
    >
      {label}
    </button>
  );
}

interface RangeFieldsProps {
  total: number;
  rangeStart: number;
  rangeEnd: number;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
  error: string | null;
}

function RangeFields({ total, rangeStart, rangeEnd, onStartChange, onEndChange, error }: RangeFieldsProps) {
  const startInvalid = rangeStart < 1 || rangeStart > rangeEnd;
  const endInvalid = rangeEnd > total || rangeStart > rangeEnd;
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted font-medium">Elige el rango exacto de preguntas a evaluar:</p>
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="Desde" value={rangeStart} max={total} invalid={startInvalid} onChange={onStartChange} />
        <NumberField label="Hasta (inclusive)" value={rangeEnd} max={total} invalid={endInvalid} onChange={onEndChange} />
      </div>
      {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
      <p className="text-[11px] text-text-muted">
        Preguntas seleccionadas: <span className="font-bold text-text">{Math.max(0, rangeEnd - rangeStart + 1)}</span>
      </p>
    </div>
  );
}

function RandomFields({ total, randomCount, onChange, error }: { total: number; randomCount: number; onChange: (v: number) => void; error: string | null }) {
  return (
    <div className="space-y-3">
      <NumberField label="Cantidad de preguntas a evaluar" value={randomCount} max={total} invalid={!!error} onChange={onChange} />
      {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
      <p className="text-[11px] text-text-muted">Se seleccionarán de manera aleatoria del grupo total.</p>
    </div>
  );
}

function NumberField({ label, value, max, invalid, onChange }: { label: string; value: number; max: number; invalid: boolean; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-bold text-text-muted uppercase">{label}</label>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
        className={`w-full bg-background border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 ${
          invalid ? 'border-red-500 focus:ring-red-500' : 'border-border focus:ring-primary'
        }`}
      />
    </div>
  );
}

function ConfigToggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-3.5 bg-background border border-border rounded-xl">
      <div>
        <p className="text-xs font-bold text-text">{label}</p>
        <p className="text-[10px] text-text-muted">{hint}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}
