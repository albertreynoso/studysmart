// Vista y editor de teoría estilo Obsidian. Port de juststudy.
// Cambio: studyApi.uploadImage (REST) → uploadImage() de lib/packages (Storage).
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ImagePlus } from 'lucide-react';
import { uploadImage } from '../../lib/packages';
import type { SelectedNode } from './types';

interface TheoryReaderProps {
  selected: SelectedNode | null;
  contentHtml: string;
  slug?: string;
  onSave?: (externalId: string, contentHtml: string) => void;
}

function buildBreadcrumb(selected: SelectedNode | null): string {
  if (!selected) return '';
  const parts = [selected.ref_path.topic];
  if (selected.ref_path.subtopic) parts.push(selected.ref_path.subtopic);
  if (selected.ref_path.section) parts.push(selected.ref_path.section);
  return parts.join(' / ');
}

function countWordsAndChars(html: string): { words: number; chars: number } {
  if (typeof document === 'undefined') return { words: 0, chars: 0 };
  const div = document.createElement('div');
  div.innerHTML = html;
  const text = (div.textContent ?? '').trim();
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return { words, chars: text.length };
}

export function TheoryReader({ selected, contentHtml, slug, onSave }: TheoryReaderProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeIdRef = useRef<string | null>(null);

  const breadcrumb = buildBreadcrumb(selected);
  const { words, chars } = useMemo(() => countWordsAndChars(contentHtml), [contentHtml]);
  const isEditable = Boolean(onSave);

  // Sync innerHTML when node changes or content first arrives for a node
  useEffect(() => {
    if (!editorRef.current) return;
    const newId = selected?.external_id ?? null;
    const editorEmpty = !editorRef.current.innerHTML;
    if (newId !== activeIdRef.current || editorEmpty) {
      editorRef.current.innerHTML = contentHtml || '';
      activeIdRef.current = newId;
    }
  }, [selected?.external_id, contentHtml]);

  // Cleanup debounce on unmount
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  const scheduleSave = useCallback(() => {
    if (!onSave || !selected) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onSave(selected.external_id, editorRef.current?.innerHTML ?? '');
    }, 1000);
  }, [onSave, selected]);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !slug) return;
    e.target.value = '';
    try {
      const { url } = await uploadImage(slug, file);
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, `<img src="${url}" style="max-width:100%"><br>`);
      scheduleSave();
    } catch {
      // upload failure doesn't block editing
    }
  }, [slug, scheduleSave]);

  if (!selected) {
    return <EmptyState message="Selecciona un Topic, Subtopic o Section en el árbol lateral." />;
  }

  return (
    <div className="obsidian-view flex-1 flex flex-col overflow-hidden">
      {isEditable && slug && (
        <div className="px-4 py-1.5 border-b border-border flex items-center gap-2 bg-surface shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-surface-hover rounded transition-colors"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            Insertar imagen
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelect}
          />
        </div>
      )}
      <div className="obsidian-breadcrumb">
        <span className="truncate">{breadcrumb}</span>
      </div>
      <div className="obsidian-content flex-1 overflow-auto">
        <div
          ref={editorRef}
          className="obsidian-article"
          contentEditable={isEditable}
          suppressContentEditableWarning
          onInput={scheduleSave}
        />
      </div>
      <div className="obsidian-statusbar">
        <span>{words.toLocaleString()} palabras</span>
        <span className="opacity-50">·</span>
        <span>{chars.toLocaleString()} caracteres</span>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8 text-center text-text-muted">
      <p className="max-w-sm text-sm">{message}</p>
    </div>
  );
}
