// Drop zone + paste JSON para subir paquetes study_package. Port de juststudy.
// Cambio: studyApi.ingest (REST) → ingest() client-side (lib/ingest).
import { useRef, useState } from 'react';
import { UploadCloud, AlertCircle, CheckCircle2, ClipboardPaste, FileJson } from 'lucide-react';
import { ingest, IngestError } from '../../lib/ingest';
import type { IngestResponse } from './types';

interface IngestPanelProps {
  onIngested: (response: IngestResponse) => void;
}

type InputMode = 'file' | 'paste';

type IngestState =
  | { kind: 'idle' }
  | { kind: 'parsing' | 'uploading' }
  | { kind: 'success'; response: IngestResponse }
  | { kind: 'error'; status: number; errors: Array<{ path?: string; message: string }> };

async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

function describeIngestError(err: unknown): { status: number; errors: Array<{ path?: string; message: string }> } {
  if (err instanceof IngestError) {
    const detail = err.detail;
    if (detail.errors && detail.errors.length > 0) return { status: err.status, errors: detail.errors };
    return { status: err.status, errors: [{ message: detail.message ?? `Error ${err.status}` }] };
  }
  return { status: 0, errors: [{ message: err instanceof Error ? err.message : 'Error desconocido' }] };
}

export function IngestPanel({ onIngested }: IngestPanelProps) {
  const [state, setState] = useState<IngestState>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<InputMode>('file');
  const [jsonText, setJsonText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitPayload = async (payload: unknown) => {
    setState({ kind: 'uploading' });
    try {
      const response = await ingest(payload);
      setState({ kind: 'success', response });
      onIngested(response);
    } catch (err) {
      setState({ kind: 'error', ...describeIngestError(err) });
    }
  };

  const handleFile = async (file: File) => {
    setState({ kind: 'parsing' });
    let payload: unknown;
    try {
      payload = await readJsonFile(file);
    } catch (err) {
      setState({ kind: 'error', status: 0, errors: [{ message: `JSON inválido: ${(err as Error).message}` }] });
      return;
    }
    await submitPayload(payload);
  };

  const handlePaste = async () => {
    setState({ kind: 'parsing' });
    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch (err) {
      setState({ kind: 'error', status: 0, errors: [{ message: `JSON inválido: ${(err as Error).message}` }] });
      return;
    }
    await submitPayload(payload);
  };

  const onPick = () => fileInputRef.current?.click();

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const isLoading = state.kind === 'parsing' || state.kind === 'uploading';

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex rounded-md overflow-hidden border border-border text-xs font-medium">
        <button
          onClick={() => setMode('file')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors
            ${mode === 'file' ? 'bg-primary text-primary-foreground' : 'bg-surface text-text-muted hover:text-text hover:bg-surface-hover'}`}
        >
          <FileJson className="w-3.5 h-3.5" />
          Archivo
        </button>
        <button
          onClick={() => setMode('paste')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors
            ${mode === 'paste' ? 'bg-primary text-primary-foreground' : 'bg-surface text-text-muted hover:text-text hover:bg-surface-hover'}`}
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          Pegar JSON
        </button>
      </div>

      {mode === 'file' ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={onPick}
          className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors
            ${dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-surface-hover'}`}
        >
          <UploadCloud className="w-8 h-8 text-text-muted mb-2" />
          <p className="text-sm font-medium text-text">Subir paquete JSON</p>
          <p className="text-xs text-text-muted mt-1">Arrastra o haz click para seleccionar</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onInputChange}
            className="hidden"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            placeholder={`Pega aquí tu JSON, por ejemplo:\n{\n  "schema_version": "1.0",\n  "type": "study_package",\n  "theory": { ... },\n  "questions": { "items": [...] }\n}`}
            className="w-full h-48 rounded-md border border-border bg-background text-text text-xs font-mono p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-text-muted"
            disabled={isLoading}
          />
          <button
            onClick={() => void handlePaste()}
            disabled={isLoading || !jsonText.trim()}
            className="w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium
              hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Procesando…' : 'Ingestar JSON'}
          </button>
        </div>
      )}

      <div className="rounded-md bg-surface border border-border p-3 text-xs text-text-muted space-y-1">
        <p className="font-medium text-text">💡 Modos de ingesta</p>
        <p><span className="text-primary font-medium">Sin "target"</span> → Crea o fusiona un paquete completo (bulk)</p>
        <p><span className="text-primary font-medium">Con "target"</span> → Agrega preguntas a un paquete ya existente (patch)</p>
        <p className="pt-1">Para rangos (ej: preguntas 21-40) usa <code className="text-text bg-surface-hover px-1 rounded">external_id</code> como <code className="text-text bg-surface-hover px-1 rounded">q-021</code>…<code className="text-text bg-surface-hover px-1 rounded">q-040</code></p>
      </div>

      <IngestStatus state={state} />
    </div>
  );
}

function IngestStatus({ state }: { state: IngestState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'parsing' || state.kind === 'uploading') {
    return (
      <div className="text-sm text-text-muted">
        {state.kind === 'parsing' ? 'Leyendo JSON…' : 'Subiendo y procesando…'}
      </div>
    );
  }
  if (state.kind === 'success') return <SuccessSummary response={state.response} />;
  if (state.kind === 'error') return <ErrorList status={state.status} errors={state.errors} />;
  return null;
}

function SuccessSummary({ response }: { response: IngestResponse }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-sm">
      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium text-text">Ingesta completada: {response.topic_name}</p>
        <p className="text-text-muted text-xs mt-1">
          Teoría: {response.theory.created} nuevos, {response.theory.skipped} existentes ·
          Preguntas: {response.questions.created} nuevas, {response.questions.skipped} existentes ·
          Total: {response.question_count}
        </p>
      </div>
    </div>
  );
}

function ErrorList({ status, errors }: { status: number; errors: Array<{ path?: string; message: string }> }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm">
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium text-text">Error de ingesta {status ? `(${status})` : ''}</p>
        <ul className="mt-2 space-y-1 text-xs text-text-muted">
          {errors.map((err, i) => (
            <li key={i}>
              {err.path && <code className="text-red-400">{err.path}</code>}{err.path ? ': ' : ''}{err.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
