// Gestor de carpetas del Banco de Estudio (renombrar, eliminar, reasignar en lote). Port de juststudy (sin cambios).
import { useMemo, useState } from 'react';
import { Folders, Trash2, Check, X, Pencil, FolderInput } from 'lucide-react';
import type { PackageIndex } from './types';

const NO_FOLDER = '__none__';

interface FolderManagerProps {
  packages: PackageIndex[];
  onRenameFolder: (oldName: string, nextName: string) => void;
  onDeleteFolder: (name: string) => void;
  onMovePackages: (slugs: string[], folder: string | null) => void;
  onClose: () => void;
  isBusy?: boolean;
}

function folderNamesOf(packages: PackageIndex[]): string[] {
  return [...new Set(packages.map(p => p.folder).filter((f): f is string => Boolean(f)))].sort();
}

export function FolderManager({ packages, onRenameFolder, onDeleteFolder, onMovePackages, onClose, isBusy }: FolderManagerProps) {
  const folders = useMemo(() => folderNamesOf(packages), [packages]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (slug: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    return next;
  });

  const moveSelected = (folder: string | null) => {
    if (selected.size === 0) return;
    onMovePackages([...selected], folder);
    setSelected(new Set());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Folders className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold text-text">Carpetas</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-hover transition-colors" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          <FolderList
            folders={folders}
            packages={packages}
            onRename={onRenameFolder}
            onDelete={onDeleteFolder}
            isBusy={isBusy}
          />
          <PackageSelector packages={packages} selected={selected} onToggle={toggle} />
        </div>

        <BulkMoveBar folders={folders} count={selected.size} onMove={moveSelected} isBusy={isBusy} />
      </div>
    </div>
  );
}

interface FolderListProps {
  folders: string[];
  packages: PackageIndex[];
  onRename: (oldName: string, nextName: string) => void;
  onDelete: (name: string) => void;
  isBusy?: boolean;
}

function FolderList({ folders, packages, onRename, onDelete, isBusy }: FolderListProps) {
  if (folders.length === 0) {
    return <p className="text-xs text-text-muted">Aún no hay carpetas. Selecciona paquetes abajo y muévelos a una carpeta nueva.</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Carpetas existentes</p>
      {folders.map(name => (
        <FolderRow
          key={name}
          name={name}
          count={packages.filter(p => p.folder === name).length}
          existing={folders}
          onRename={onRename}
          onDelete={onDelete}
          isBusy={isBusy}
        />
      ))}
    </div>
  );
}

interface FolderRowProps {
  name: string;
  count: number;
  existing: string[];
  onRename: (oldName: string, nextName: string) => void;
  onDelete: (name: string) => void;
  isBusy?: boolean;
}

function FolderRow({ name, count, existing, onRename, onDelete, isBusy }: FolderRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== name && !existing.includes(next)) onRename(name, next);
    else setDraft(name);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg border border-primary bg-primary/5">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(name); setEditing(false); } }}
          className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <IconButton onClick={commit} title="Guardar"><Check className="w-4 h-4 text-emerald-500" /></IconButton>
        <IconButton onClick={() => { setDraft(name); setEditing(false); }} title="Cancelar"><X className="w-4 h-4" /></IconButton>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-surface-hover transition-colors">
      <Folders className="w-4 h-4 text-text-muted shrink-0" />
      <span className="flex-1 text-sm text-text truncate">{name}</span>
      <span className="text-[10px] text-text-muted shrink-0">{count} paq.</span>
      <IconButton onClick={() => setEditing(true)} title="Renombrar" disabled={isBusy}><Pencil className="w-4 h-4" /></IconButton>
      <IconButton onClick={() => onDelete(name)} title="Eliminar carpeta" disabled={isBusy}><Trash2 className="w-4 h-4 text-red-500" /></IconButton>
    </div>
  );
}

interface PackageSelectorProps {
  packages: PackageIndex[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
}

function PackageSelector({ packages, selected, onToggle }: PackageSelectorProps) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Paquetes</p>
      {packages.map(pkg => (
        <label
          key={pkg.slug}
          className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
            selected.has(pkg.slug) ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-hover'
          }`}
        >
          <CheckBox checked={selected.has(pkg.slug)} onChange={() => onToggle(pkg.slug)} />
          <span className="flex-1 text-sm text-text truncate">{pkg.topic_name}</span>
          <span className="text-[10px] text-text-muted shrink-0">{pkg.folder ?? 'Sin carpeta'}</span>
        </label>
      ))}
    </div>
  );
}

interface BulkMoveBarProps {
  folders: string[];
  count: number;
  onMove: (folder: string | null) => void;
  isBusy?: boolean;
}

function BulkMoveBar({ folders, count, onMove, isBusy }: BulkMoveBarProps) {
  const [target, setTarget] = useState<string>(NO_FOLDER);
  const [newName, setNewName] = useState('');

  const resolveTarget = (): string | null => {
    if (target === NO_FOLDER) return null;
    if (target === '__new__') return newName.trim() || null;
    return target;
  };

  const disabled = count === 0 || isBusy || (target === '__new__' && !newName.trim());

  return (
    <div className="border-t border-border p-4 space-y-2 shrink-0">
      <div className="flex items-center gap-2">
        <FolderInput className="w-4 h-4 text-text-muted shrink-0" />
        <select
          value={target}
          onChange={e => setTarget(e.target.value)}
          className="flex-1 bg-background border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value={NO_FOLDER}>Sin carpeta</option>
          {folders.map(f => <option key={f} value={f}>{f}</option>)}
          <option value="__new__">➕ Nueva carpeta…</option>
        </select>
        {target === '__new__' && (
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nombre"
            className="w-32 bg-background border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        )}
        <button
          onClick={() => onMove(resolveTarget())}
          disabled={disabled}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
        >
          Mover
        </button>
      </div>
      <p className="text-[11px] text-text-muted">
        {count === 0 ? 'Selecciona paquetes para moverlos.' : `${count} paquete(s) seleccionado(s).`}
      </p>
    </div>
  );
}

function IconButton({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-40 transition-colors shrink-0"
    >
      {children}
    </button>
  );
}

function CheckBox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <>
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${checked ? 'border-primary bg-primary' : 'border-border bg-background'}`}>
        {checked && (
          <svg className="w-2.5 h-2.5 stroke-white" fill="none" viewBox="0 0 24 24" strokeWidth="4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </div>
    </>
  );
}
