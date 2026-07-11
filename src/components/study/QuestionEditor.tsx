// Editor de preguntas del Banco de Estudio. Port de juststudy.
// Cambio: studyApi.updateQuestion/uploadImage/deleteQuestionImage → lib/packages (Storage). Imágenes = URLs absolutas.
import { useState, useMemo, useEffect } from 'react';
import { Search, ImagePlus, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
import { updateQuestion, uploadImage, deleteQuestionImage } from '../../lib/packages';
import type { StudyQuestion, QuestionOption } from './types';

const getImageUrl = (url?: string | null) => url ?? '';

interface QuestionEditorProps {
  packageSlug: string;
  questions: StudyQuestion[];
  onPackageUpdated: () => void;
}

export function QuestionEditor({ packageSlug, questions, onPackageUpdated }: QuestionEditorProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const indexMap = useMemo(
    () => new Map(questions.map((q, i) => [q.external_id, i + 1])),
    [questions]
  );

  const filtered = useMemo(() => {
    if (!searchTerm) return questions;
    const lower = searchTerm.toLowerCase();
    return questions.filter(q =>
      q.question.toLowerCase().includes(lower) ||
      (q.explanation?.toLowerCase() || '').includes(lower)
    );
  }, [questions, searchTerm]);

  return (
    <div className="flex flex-col h-full bg-background text-text">
      <div className="p-4 border-b border-border bg-surface shrink-0 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Buscar preguntas..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="text-sm text-text-muted">
          {filtered.length} preguntas
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {filtered.map(q => (
          <QuestionEditorCard
            key={q.external_id}
            number={indexMap.get(q.external_id) ?? 0}
            packageSlug={packageSlug}
            question={q}
            onUpdate={onPackageUpdated}
          />
        ))}
      </div>
    </div>
  );
}

function QuestionEditorCard({ packageSlug, number, question, onUpdate }: { packageSlug: string, number: number, question: StudyQuestion, onUpdate: () => void }) {
  const [qText, setQText] = useState(question.question);
  const [explanation, setExplanation] = useState(question.explanation ?? '');
  const [options, setOptions] = useState<QuestionOption[]>(question.options || []);
  const [status, setStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localCorrect, setLocalCorrect] = useState<string[]>(question.correct ?? []);
  const [isUploading, setIsUploading] = useState(false);
  const [leftItems, setLeftItems] = useState<QuestionOption[]>(question.left ?? []);
  const [rightItems, setRightItems] = useState<QuestionOption[]>(question.right ?? []);

  useEffect(() => { setLocalCorrect(question.correct ?? []); }, [question.correct]);

  const saveField = async (fields: Partial<StudyQuestion>) => {
    setStatus('saving');
    setErrorMsg(null);
    try {
      await updateQuestion(packageSlug, question.external_id, fields);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
      onUpdate();
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido');
      setStatus('error');
    }
  };

  const handleBlurText = () => {
    if (qText !== question.question || explanation !== (question.explanation ?? '')) {
      saveField({ question: qText, explanation });
    }
  };

  const handleOptionChange = (id: string, text: string) => {
    setOptions(opts => opts.map(o => o.id === id ? { ...o, text } : o));
  };

  const handleBlurOptions = () => {
    const hasChanged = JSON.stringify(options) !== JSON.stringify(question.options);
    if (hasChanged) {
      saveField({ options });
    }
  };

  const handleSideChange = (side: 'left' | 'right', id: string, text: string) => {
    const setter = side === 'left' ? setLeftItems : setRightItems;
    setter(items => items.map(o => o.id === id ? { ...o, text } : o));
  };

  const handleBlurSides = () => {
    const hasChanged =
      JSON.stringify(leftItems) !== JSON.stringify(question.left ?? []) ||
      JSON.stringify(rightItems) !== JSON.stringify(question.right ?? []);
    if (hasChanged) {
      saveField({ left: leftItems, right: rightItems });
    }
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setErrorMsg(null);
    try {
      const res = await uploadImage(packageSlug, file);
      await saveField({ image: res.url });
    } catch (err) {
      console.error('Error subiendo imagen', err);
      setErrorMsg(err instanceof Error ? err.message : 'Error al subir imagen');
      setStatus('error');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleToggleCorrect = (optId: string) => {
    const next = localCorrect.includes(optId)
      ? localCorrect.filter(id => id !== optId)
      : [...localCorrect, optId];
    if (next.length === 0) return;
    setLocalCorrect(next);
    saveField({ correct: next });
  };

  const handleDeleteImage = async () => {
    if (!confirm('¿Eliminar esta imagen?')) return;
    setStatus('saving');
    try {
      await deleteQuestionImage(packageSlug, question.external_id);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
      onUpdate();
    } catch (err) {
      console.error('Error eliminando imagen', err);
      setStatus('error');
    }
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-5 flex flex-col gap-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-text-muted select-none">#{number}</span>
        <div className="flex items-center gap-2 text-sm">
          {status === 'saving' && <span className="text-blue-500 flex items-center gap-1"><Loader2 className="w-4 h-4 animate-spin"/> Guardando...</span>}
          {status === 'saved' && <span className="text-green-500 flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> Guardado</span>}
          {status === 'error' && <span className="text-red-500 flex items-center gap-1 max-w-xs truncate" title={errorMsg ?? 'Error'}>{errorMsg || 'Error'}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Enunciado</label>
        <textarea
          value={qText}
          onChange={e => setQText(e.target.value)}
          onBlur={handleBlurText}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:ring-2 focus:ring-primary resize-y"
        />
      </div>

      {question.type === 'matching' && (
        <div className="flex flex-col gap-2 mt-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Pares (concepto → definición)</label>
          {(question.correct_pairs ?? []).map(pair => {
            const leftItem = leftItems.find(o => o.id === pair.left);
            const rightItem = rightItems.find(o => o.id === pair.right);
            if (!leftItem || !rightItem) return null;
            return (
              <div key={pair.left} className="flex items-center gap-2">
                <input
                  type="text"
                  value={leftItem.text}
                  onChange={e => handleSideChange('left', leftItem.id, e.target.value)}
                  onBlur={handleBlurSides}
                  className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="text-text-muted text-xs shrink-0 select-none">→</span>
                <input
                  type="text"
                  value={rightItem.text}
                  onChange={e => handleSideChange('right', rightItem.id, e.target.value)}
                  onBlur={handleBlurSides}
                  className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            );
          })}
          {rightItems.some(r => !(question.correct_pairs ?? []).some(p => p.right === r.id)) && (
            <>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider mt-1">Distractores (sin par)</label>
              {rightItems
                .filter(r => !(question.correct_pairs ?? []).some(p => p.right === r.id))
                .map(r => (
                  <input
                    key={r.id}
                    type="text"
                    value={r.text}
                    onChange={e => handleSideChange('right', r.id, e.target.value)}
                    onBlur={handleBlurSides}
                    className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                ))}
            </>
          )}
        </div>
      )}

      {question.type !== 'matching' && (
      <div className="flex flex-col gap-2 mt-2">
        <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Opciones</label>
        {options.map((opt, idx) => (
          <div key={opt.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleToggleCorrect(opt.id)}
              title={localCorrect.includes(opt.id) ? 'Respuesta correcta (click para quitar)' : 'Marcar como correcta'}
              className={`text-xs font-medium w-6 h-6 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-colors ${localCorrect.includes(opt.id) ? 'bg-green-500/20 text-green-500 hover:bg-red-500/20 hover:text-red-400' : 'bg-background border border-border hover:bg-green-500/20 hover:text-green-500'}`}
            >
              {String.fromCharCode(65 + idx)}
            </button>
            <input
              type="text"
              value={opt.text}
              onChange={e => handleOptionChange(opt.id, e.target.value)}
              onBlur={handleBlurOptions}
              className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        ))}
      </div>
      )}

      <div className="flex flex-col gap-1 mt-2">
        <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Explicación</label>
        <textarea
          value={explanation}
          onChange={e => setExplanation(e.target.value)}
          onBlur={handleBlurText}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:ring-2 focus:ring-primary resize-y"
        />
      </div>

      <div className="flex flex-col gap-2 pt-3 border-t border-border mt-2">
        <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Imagen de Referencia</label>
        {question.image ? (
          <div className="flex flex-col gap-2">
            <img
              src={getImageUrl(question.image)}
              alt="Referencia"
              className="max-h-48 w-auto rounded-md border border-border object-contain"
            />
            <button onClick={handleDeleteImage} className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 transition-colors self-start">
              <Trash2 className="w-3.5 h-3.5" /> Eliminar Imagen
            </button>
          </div>
        ) : (
          <div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-md cursor-pointer hover:bg-surface-hover transition-colors text-sm font-medium">
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {isUploading ? 'Subiendo...' : 'Añadir Imagen'}
              <input type="file" accept="image/*" className="hidden" onChange={handleUploadImage} disabled={isUploading} />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
