// Contenedor del Banco de Estudio (TOC + Reader + Ingesta + Tests). Port de juststudy.
// Cambio: studyApi (REST) → lib/packages (Firestore índice + Storage cuerpo). Export = blob client-side.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Download, FileQuestion, RefreshCw, Trash2, SlidersHorizontal, Pencil, ArrowRight, ArrowLeft, ChevronRight, GraduationCap, BarChart3, Settings, ChevronDown, Eye, X, Folders } from 'lucide-react';
import { listPackages, getPackage, subscribePackages, subscribePackageBody, updatePackageMeta, updateNodeContent, deletePackage, exportPackageBlob } from '../../lib/packages';
import { TopicTree } from './TopicTree';
import { TheoryReader } from './TheoryReader';
import { IngestPanel } from './IngestPanel';
import { TestView } from './TestView';
import { TestConfigModal } from './TestSetup';
import { QuestionEditor } from './QuestionEditor';
import { ResultsHistory } from './ResultsHistory';
import { FolderManager } from './FolderManager';
import type {
  PackageIndex,
  StudyPackage,
  SelectedNode,
  StudySubtopic,
  StudySection,
  StudyQuestion,
} from './types';

type LeftPanelMode = 'tree' | 'ingest';

export function BankView() {
  const [packages, setPackages] = useState<PackageIndex[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [activePackage, setActivePackage] = useState<StudyPackage | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [leftMode, setLeftMode] = useState<LeftPanelMode>('tree');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nodeOverrides, setNodeOverrides] = useState<Record<string, string>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaFolder, setMetaFolder] = useState('');
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [testPickerOpen, setTestPickerOpen] = useState(false);
  const [testConfigOpen, setTestConfigOpen] = useState(false);
  const [isFetchingTest, setIsFetchingTest] = useState(false);
  const [testPool, setTestPool] = useState<StudyQuestion[]>([]);
  const [testRunQuestions, setTestRunQuestions] = useState<StudyQuestion[]>([]);
  const [testImmediate, setTestImmediate] = useState(true);
  const [mergedTestLabel, setMergedTestLabel] = useState('');
  const [isHistorial, setIsHistorial] = useState(false);
  const [isTemarioOpen, setIsTemarioOpen] = useState(false);
  const [isLoadingPackage, setIsLoadingPackage] = useState(false);
  const [isFoldersOpen, setIsFoldersOpen] = useState(false);
  const [isMovingFolders, setIsMovingFolders] = useState(false);
  const [isHome, setIsHome] = useState(true);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const bootstrapped = useRef(false);
  const applyPathRef = useRef<(pathname: string) => void>(() => {});

  // Live: índice compartido entre todos los usuarios. refreshPackages queda para awaits imperativos.
  useEffect(() => subscribePackages(
    list => {
      setPackages(list);
      setIsLoadingList(false);
      if (list.length === 0) { setIsHome(false); setLeftMode('ingest'); }
      // Ruteo inicial: al primer snapshot ya podemos desambiguar carpeta vs slug suelto.
      if (!bootstrapped.current) {
        bootstrapped.current = true;
        if (list.length > 0) applyPath(window.location.pathname, list);
      }
    },
    err => setLoadError(err.message),
  ), []);

  const refreshPackages = async () => {
    try {
      const list = await listPackages();
      setPackages(list);
      if (list.length === 0) {
        setIsHome(false);
        setLeftMode('ingest');
      }
    } catch (err) {
      setLoadError((err as Error).message);
    }
  };

  // Entra a un paquete desde la pantalla inicial; el efecto de activeSlug lo carga.
  const openPackage = (slug: string) => {
    resetViews();
    setIsHome(false);
    setIsEditingMeta(false);
    setActiveSlug(slug);
    setLeftMode('tree');
    setIsLoadingPackage(true);
  };

  // Sale del paquete (o vista actual) a home; conserva activeFolder para volver
  // a la carpeta de origen si se entró desde una.
  const backToList = () => {
    resetViews();
    setIsEditingMeta(false);
    setActiveSlug(null);
    setActivePackage(null);
    setIsHome(true);
  };

  // Back del header: paquete → carpeta/raíz; carpeta → raíz.
  const headerBack = () => {
    if (!isHome) { backToList(); return; }
    setActiveFolder(null);
  };

  useEffect(() => {
    if (!activeSlug) {
      setActivePackage(null);
      return;
    }
    setLoadError(null);
    setNodeOverrides({});
    setIsTesting(false);
    setIsLoadingPackage(true);
    let first = true;
    return subscribePackageBody(
      activeSlug,
      pkg => {
        setActivePackage(pkg);
        if (!first) return; // refetch en vivo: conserva la navegación del usuario
        first = false;
        const topic = pkg.theory.topic;
        setSelectedNode({ level: 'topic', external_id: topic.external_id, ref_path: { topic: topic.name } });
        setIsEditing(true);
        setIsLoadingPackage(false);
      },
      err => { setLoadError(err.message); setIsLoadingPackage(false); },
    );
  }, [activeSlug]);

  const selectedContent = useMemo(() => {
    const externalId = selectedNode?.external_id;
    if (externalId && externalId in nodeOverrides) return nodeOverrides[externalId];
    return resolveSelectedContent(activePackage, selectedNode);
  }, [activePackage, selectedNode, nodeOverrides]);

  // Apaga todas las vistas mutuamente excluyentes del panel principal.
  const resetViews = () => {
    setIsHistorial(false);
    setIsTesting(false);
    setIsEditing(false);
    setTestPickerOpen(false);
    setTestConfigOpen(false);
    setLeftMode('tree');
  };

  const handleOpenTestPicker = () => {
    setTestPickerOpen(true);
  };

  // Paso 1 → 2: carga el pool de preguntas de los paquetes elegidos y abre la config.
  const handleSelectPackages = async (slugs: string[]) => {
    if (slugs.length === 0) return;
    setIsFetchingTest(true);
    try {
      const pkgs = await Promise.all(slugs.map(s => getPackage(s)));
      const questions = pkgs.flatMap((pkg, i) =>
        (pkg.questions?.items ?? []).map(q => ({ ...q, package_slug: slugs[i] }))
      );
      const label = pkgs.length === 1
        ? pkgs[0].theory.topic.name
        : pkgs.map(p => p.theory.topic.name).join(' + ');
      setTestPool(questions);
      setMergedTestLabel(label);
      setTestPickerOpen(false);
      setTestConfigOpen(true);
    } catch (err) {
      console.error('Error cargando paquetes para test:', err);
    } finally {
      setIsFetchingTest(false);
    }
  };

  // Paso 2: arranca el test con las preguntas ya procesadas según la config.
  const handleStartConfiguredTest = (questions: StudyQuestion[], immediateFeedback: boolean) => {
    setTestRunQuestions(questions);
    setTestImmediate(immediateFeedback);
    setTestConfigOpen(false);
    resetViews();
    setIsHome(false);
    setIsTesting(true);
  };

  // Test directo desde Historial (preguntas débiles): sin paso de configuración.
  const handleStartPreloadedTest = (questions: StudyQuestion[], label: string) => {
    setTestPool(questions);
    setTestRunQuestions(questions);
    setTestImmediate(localStorage.getItem('test_immediate_feedback') !== 'false');
    setMergedTestLabel(label);
    resetViews();
    setIsHome(false);
    setIsTesting(true);
  };

  const handleOpenMeta = () => {
    const pkg = packages.find(p => p.slug === activeSlug);
    if (!pkg) return;
    setMetaTitle(pkg.topic_name);
    setMetaFolder(pkg.folder ?? '');
    setIsEditingMeta(true);
  };

  const handleSaveMeta = async () => {
    if (!activeSlug) return;
    setIsSavingMeta(true);
    try {
      await updatePackageMeta(activeSlug, {
        topic_name: metaTitle.trim() || undefined,
        folder: metaFolder.trim() || null,
      });
      await refreshPackages();
      setIsEditingMeta(false);
    } catch (err) {
      console.error('Error guardando metadatos:', err);
    } finally {
      setIsSavingMeta(false);
    }
  };

  // Reasigna en lote el campo `folder` de los paquetes indicados.
  const movePackagesToFolder = async (slugs: string[], folder: string | null) => {
    if (slugs.length === 0) return;
    setIsMovingFolders(true);
    try {
      await Promise.all(slugs.map(slug => updatePackageMeta(slug, { folder })));
      await refreshPackages();
    } catch (err) {
      console.error('Error moviendo paquetes de carpeta:', err);
    } finally {
      setIsMovingFolders(false);
    }
  };

  // Rename inline desde la tarjeta. La suscripción live refresca la lista al escribir.
  const renamePackage = async (slug: string, title: string) => {
    const next = title.trim();
    const current = packages.find(p => p.slug === slug);
    if (!next || !current || next === current.topic_name) return;
    try {
      await updatePackageMeta(slug, { topic_name: next });
    } catch (err) {
      console.error('Error renombrando paquete:', err);
    }
  };

  const slugsInFolder = (name: string) => packages.filter(p => p.folder === name).map(p => p.slug);

  const handleRenameFolder = (oldName: string, nextName: string) => movePackagesToFolder(slugsInFolder(oldName), nextName);
  const handleDeleteFolder = (name: string) => movePackagesToFolder(slugsInFolder(name), null);

  // Rename inline de la carpeta abierta desde el header. Actualiza activeFolder
  // tras mover los paquetes: si no, FolderScreen filtra por el nombre viejo → vacío.
  const renameActiveFolder = async (title: string) => {
    const next = title.trim();
    if (!activeFolder || !next || next === activeFolder) return;
    await handleRenameFolder(activeFolder, next);
    setActiveFolder(next);
  };

  const handleSaveNode = useCallback(async (externalId: string, contentHtml: string) => {
    if (!activeSlug) return;
    setNodeOverrides(prev => ({ ...prev, [externalId]: contentHtml }));
    try {
      await updateNodeContent(activeSlug, externalId, contentHtml);
    } catch (err) {
      console.error('Error guardando nodo:', err);
    }
  }, [activeSlug]);

  // URL → estado (ruteo inicial y botones atrás/adelante del navegador).
  const applyPath = (pathname: string, pkgs: PackageIndex[]) => {
    const { folder, slug } = parsePath(pkgs, pathname);
    if (slug) {
      setActiveFolder(folder);
      openPackage(slug);
      return;
    }
    resetViews();
    setActiveSlug(null);
    setActivePackage(null);
    setIsEditingMeta(false);
    setIsHome(true);
    setActiveFolder(folder);
  };
  applyPathRef.current = (pathname: string) => applyPath(pathname, packages);

  // Estado → URL: refleja carpeta/banco abierto. Vistas no direccionables no tocan la URL.
  useEffect(() => {
    if (!bootstrapped.current) return;
    const path = pathFor(packages, isHome, activeFolder, activeSlug);
    if (path && path !== window.location.pathname) {
      window.history.pushState(null, '', path);
    }
  }, [packages, isHome, activeFolder, activeSlug]);

  useEffect(() => {
    const onPop = () => applyPathRef.current(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background text-text">
      <BankHeader
        isHome={isHome}
        activeFolder={activeFolder}
        onBack={headerBack}
        activeName={packages.find(p => p.slug === activeSlug)?.topic_name}
        onRenameActive={activeSlug ? (title: string) => void renamePackage(activeSlug, title) : undefined}
        onRenameFolder={activeFolder ? (title: string) => void renameActiveFolder(title) : undefined}
        onOpenIngest={() => { resetViews(); setIsHome(false); setLeftMode('ingest'); }}
        onTakeTest={handleOpenTestPicker}
        onShowHistorial={() => { resetViews(); setIsHome(false); setLeftMode('tree'); setIsHistorial(true); }}
        onOpenTemario={activePackage ? () => setIsTemarioOpen(true) : undefined}
        onOpenFolders={packages.length > 0 ? () => setIsFoldersOpen(true) : undefined}
        onEditQuestions={!isMobile && activePackage?.questions?.items?.length ? () => { resetViews(); setLeftMode('tree'); setIsEditing(true); } : undefined}
        isEditing={isEditing}
        onOpenMeta={activeSlug ? handleOpenMeta : undefined}
        onExport={activeSlug ? () => void exportPackage(activeSlug) : undefined}
        onDelete={activeSlug ? () => handleDelete(activeSlug, refreshPackages, setActiveSlug) : undefined}
      />
      {isEditingMeta && (
        <MetaEditorModal
          packages={packages}
          title={metaTitle}
          folder={metaFolder}
          onTitleChange={setMetaTitle}
          onFolderChange={setMetaFolder}
          onSave={handleSaveMeta}
          onCancel={() => setIsEditingMeta(false)}
          isSaving={isSavingMeta}
        />
      )}
      {testPickerOpen && (
        <TestPackagePicker
          packages={packages}
          defaultSlugs={activeSlug ? [activeSlug] : []}
          onNext={handleSelectPackages}
          onCancel={() => setTestPickerOpen(false)}
          isLoading={isFetchingTest}
        />
      )}
      {testConfigOpen && (
        <TestConfigModal
          pool={testPool}
          label={mergedTestLabel}
          onBack={() => { setTestConfigOpen(false); setTestPickerOpen(true); }}
          onStart={handleStartConfiguredTest}
        />
      )}
      {isFoldersOpen && (
        <FolderManager
          packages={packages}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onMovePackages={movePackagesToFolder}
          onClose={() => setIsFoldersOpen(false)}
          isBusy={isMovingFolders}
        />
      )}
      {isTemarioOpen && activePackage && (
        <TemarioModal
          topic={activePackage.theory.topic}
          selected={selectedNode}
          onSelect={node => {
            setSelectedNode(node);
            setIsTesting(false);
            setIsEditing(false);
            setIsHistorial(false);
            setIsTemarioOpen(false);
          }}
          onClose={() => setIsTemarioOpen(false)}
        />
      )}
      <div className="flex flex-1 min-h-0">
        <section className="flex-1 min-w-0 flex flex-col">
          {loadError && (
            <div className="px-4 py-2 text-sm text-red-500 border-b border-border shrink-0">{loadError}</div>
          )}
          {isHome && isLoadingList ? (
            <div className="flex-1 flex items-center justify-center text-text-muted gap-2 text-sm">
              <RefreshCw className="w-5 h-5 animate-spin" />
              Cargando paquetes…
            </div>
          ) : isHome && activeFolder ? (
            <FolderScreen packages={packages} folder={activeFolder} onOpen={openPackage} />
          ) : isHome ? (
            <HomeScreen packages={packages} onOpen={openPackage} onOpenFolder={setActiveFolder} />
          ) : leftMode === 'ingest' || packages.length === 0 ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <IngestPanel
                onIngested={async response => {
                  await refreshPackages();
                  resetViews();
                  setIsHome(false);
                  setActiveSlug(response.slug);
                  setIsLoadingPackage(true);
                }}
              />
            </div>
          ) : isHistorial ? (
            <ResultsHistory
              packages={packages}
              onStartTest={(questions, label) => handleStartPreloadedTest(questions, label)}
            />
          ) : isLoadingPackage ? (
            <div className="flex-1 flex items-center justify-center text-text-muted gap-2 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Cargando…
            </div>
          ) : isTesting ? (
            <TestView
              questions={testRunQuestions}
              topicName={mergedTestLabel}
              immediateFeedback={testImmediate}
              onReconfigure={() => { resetViews(); setTestConfigOpen(true); }}
              onClose={() => { resetViews(); if (activePackage) setIsEditing(true); else setIsHome(true); }}
            />
          ) : isEditing && !isMobile && activePackage && activeSlug ? (
            <QuestionEditor
              packageSlug={activeSlug}
              questions={activePackage.questions?.items ?? []}
              onPackageUpdated={() => {
                getPackage(activeSlug).then(setActivePackage).catch(console.error);
              }}
            />
          ) : (
            <TheoryReader
              selected={selectedNode}
              contentHtml={selectedContent}
              slug={activeSlug ?? undefined}
              onSave={handleSaveNode}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// Parsea /carpeta/slug o /slug. Un segmento suelto es slug si existe en el índice, si no carpeta.
function parsePath(pkgs: PackageIndex[], pathname: string): { folder: string | null; slug: string | null } {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { folder: null, slug: null };
  if (parts.length >= 2) return { folder: parts[0], slug: parts[1] };
  const seg = parts[0];
  if (pkgs.some(p => p.slug === seg)) return { folder: null, slug: seg };
  return { folder: seg, slug: null };
}

// URL canónica del estado. La carpeta del banco sale del índice (autoritativa). null = no direccionable.
function pathFor(pkgs: PackageIndex[], isHome: boolean, activeFolder: string | null, activeSlug: string | null): string | null {
  if (activeSlug) {
    const pkg = pkgs.find(p => p.slug === activeSlug);
    return pkg?.folder ? `/${encodeURIComponent(pkg.folder)}/${activeSlug}` : `/${activeSlug}`;
  }
  if (isHome) return activeFolder ? `/${encodeURIComponent(activeFolder)}` : '/';
  return null;
}

function resolveSelectedContent(pkg: StudyPackage | null, selected: SelectedNode | null): string {
  if (!pkg || !selected) return '';
  const topic = pkg.theory.topic;
  if (selected.level === 'topic') return topic.content_html ?? '';
  const subtopics = topic.subtopics ?? [];
  if (selected.level === 'subtopic') return findSubtopic(subtopics, selected.external_id)?.content_html ?? '';
  return findSection(subtopics, selected.external_id)?.content_html ?? '';
}

function findSubtopic(items: StudySubtopic[], externalId: string): StudySubtopic | undefined {
  return items.find(s => s.external_id === externalId);
}

function findSection(items: StudySubtopic[], externalId: string): StudySection | undefined {
  for (const st of items) {
    const match = (st.sections ?? []).find(s => s.external_id === externalId);
    if (match) return match;
  }
  return undefined;
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Export client-side: baja el JSON del paquete desde Storage como archivo.
async function exportPackage(slug: string): Promise<void> {
  try {
    const blob = await exportPackageBlob(slug);
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${slug}.json`);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error exportando paquete:', err);
  }
}

interface BankHeaderProps {
  isHome: boolean;
  activeFolder: string | null;
  onBack: () => void;
  activeName?: string;
  onRenameActive?: (title: string) => void;
  onRenameFolder?: (title: string) => void;
  onOpenIngest: () => void;
  onTakeTest: () => void;
  onShowHistorial: () => void;
  onOpenTemario?: () => void;
  onOpenFolders?: () => void;
  onEditQuestions?: () => void;
  isEditing?: boolean;
  onOpenMeta?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}

function BankHeader({ isHome, activeFolder, onBack, activeName, onRenameActive, onRenameFolder, onOpenIngest, onTakeTest, onShowHistorial, onOpenTemario, onOpenFolders, onEditQuestions, isEditing, onOpenMeta, onExport, onDelete }: BankHeaderProps) {
  const showBack = !isHome || !!activeFolder;
  const crumb = !isHome ? activeName : activeFolder;
  const editablePackage = !isHome && !!activeName && !!onRenameActive;
  const editableFolder = isHome && !!activeFolder && !!onRenameFolder;
  return (
    <header className="h-14 px-4 flex items-center gap-2 border-b border-border shrink-0 bg-surface">
      {showBack ? (
        <>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
          {editablePackage ? (
            <EditableCrumb name={activeName!} onRename={onRenameActive!} />
          ) : editableFolder ? (
            <EditableCrumb name={activeFolder!} onRename={onRenameFolder!} icon={<Folders className="w-4 h-4 text-primary shrink-0" />} />
          ) : crumb && (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-text truncate max-w-[220px]">
              {isHome && activeFolder && <Folders className="w-4 h-4 text-primary shrink-0" />}
              {crumb}
            </span>
          )}
        </>
      ) : (
        <h1 className="text-base font-bold text-text">Banco de Estudio</h1>
      )}
      <div className="flex-1" />
      <ConfigMenu
        onOpenIngest={onOpenIngest}
        onOpenTemario={onOpenTemario}
        onOpenFolders={onOpenFolders}
        onEditQuestions={onEditQuestions}
        isEditing={isEditing}
        onOpenMeta={onOpenMeta}
        onExport={onExport}
        onDelete={onDelete}
      />
      <HeaderButton icon={<BarChart3 className="w-4 h-4" />} label="Historial" onClick={onShowHistorial} />
      <button
        onClick={onTakeTest}
        className="flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity shrink-0"
      >
        <FileQuestion className="w-4 h-4" />
        Tomar test
      </button>
    </header>
  );
}

// Nombre del paquete abierto, editable in-place. Guarda en blur/Enter (renamePackage).
function EditableCrumb({ name, onRename, icon }: { name: string; onRename: (title: string) => void; icon?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(name); setEditing(false); }
        }}
        className="w-[840px] min-w-0 text-sm font-semibold bg-background border border-primary rounded px-2 py-1 max-w-[840px] focus:outline-none focus:ring-2 focus:ring-primary"
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(name); setEditing(true); }}
      title="Clic para renombrar"
      className="flex items-center gap-1.5 text-sm font-semibold text-text truncate max-w-[840px] cursor-text hover:underline decoration-dotted"
    >
      {icon}
      {name}
    </button>
  );
}

interface ConfigMenuProps {
  onOpenIngest: () => void;
  onOpenTemario?: () => void;
  onOpenFolders?: () => void;
  onEditQuestions?: () => void;
  isEditing?: boolean;
  onOpenMeta?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}

function ConfigMenu(props: ConfigMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, isOpen, () => setIsOpen(false));

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={() => setIsOpen(open => !open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${isOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text hover:bg-surface-hover'}`}
      >
        <Settings className="w-4 h-4" />
        Configuración
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && <ConfigMenuList {...props} onClose={() => setIsOpen(false)} />}
    </div>
  );
}

function ConfigMenuList({ onOpenIngest, onOpenTemario, onOpenFolders, onEditQuestions, isEditing, onOpenMeta, onExport, onDelete, onClose }: ConfigMenuProps & { onClose: () => void }) {
  const pick = (action: () => void) => () => { action(); onClose(); };
  return (
    <div className="absolute right-0 top-full mt-1 w-56 py-1 rounded-lg border border-border bg-surface shadow-lg z-50">
      {onOpenTemario && (
        <>
          <MenuItem icon={<Eye className="w-4 h-4" />} label="Temario" onClick={pick(onOpenTemario)} />
          <div className="my-1 h-px bg-border" />
        </>
      )}
      <MenuItem icon={<Plus className="w-4 h-4" />} label="Importar" onClick={pick(onOpenIngest)} />
      {onOpenFolders && <MenuItem icon={<Folders className="w-4 h-4" />} label="Carpetas" onClick={pick(onOpenFolders)} />}
      {onEditQuestions && <MenuItem icon={<SlidersHorizontal className="w-4 h-4" />} label="Configurar preguntas" isActive={isEditing} onClick={pick(onEditQuestions)} />}
      {onOpenMeta && <MenuItem icon={<Pencil className="w-4 h-4" />} label="Editar" onClick={pick(onOpenMeta)} />}
      {onExport && <MenuItem icon={<Download className="w-4 h-4" />} label="Exportar JSON" onClick={pick(onExport)} />}
      {onDelete && (
        <>
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={<Trash2 className="w-4 h-4" />} label="Eliminar" isDanger onClick={pick(onDelete)} />
        </>
      )}
    </div>
  );
}

function menuItemTone(isDanger?: boolean, isActive?: boolean): string {
  if (isDanger) return 'text-red-500 hover:bg-red-500/10';
  if (isActive) return 'text-primary bg-primary/10';
  return 'text-text-muted hover:text-text hover:bg-surface-hover';
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  isDanger?: boolean;
}

function MenuItem({ icon, label, onClick, isActive, isDanger }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left transition-colors ${menuItemTone(isDanger, isActive)}`}
    >
      {icon}
      {label}
    </button>
  );
}

function useIsMobile(): boolean {
  const query = '(max-width: 768px)';
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, isActive: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!isActive) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [ref, isActive, onOutside]);
}

interface HomeScreenProps {
  packages: PackageIndex[];
  onOpen: (slug: string) => void;
  onOpenFolder: (name: string) => void;
}

// Buscador reutilizable de paquetes.
function PkgSearch({ query, onChange }: { query: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => onChange(e.target.value)}
        placeholder="Buscar paquete…"
        className="w-full bg-background border border-border rounded-md pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {query && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text"
          aria-label="Limpiar"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function PkgGrid({ items, onOpen }: { items: PackageIndex[]; onOpen: (slug: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map(pkg => <PackageCard key={pkg.slug} pkg={pkg} onOpen={onOpen} />)}
    </div>
  );
}

function HomeEmpty({ msg }: { msg: string }) {
  return <p className="text-center text-sm text-text-muted py-12">{msg}</p>;
}

// Pantalla inicial: carpetas + paquetes sueltos. Al buscar, resultados planos.
function HomeScreen({ packages, onOpen, onOpenFolder }: HomeScreenProps) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const nameMatch = (pkg: PackageIndex) => !term || pkg.topic_name.toLowerCase().includes(term);
  const folders = [...new Set(packages.filter(p => p.folder).map(p => p.folder!))].sort();
  const loose = packages.filter(p => !p.folder && nameMatch(p));
  const results = packages.filter(nameMatch);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <PkgSearch query={query} onChange={setQuery} />
        {term ? (
          results.length === 0 ? <HomeEmpty msg={`Sin resultados para "${query}".`} /> : <PkgGrid items={results} onOpen={onOpen} />
        ) : packages.length === 0 ? (
          <HomeEmpty msg="Sin paquetes. Importa uno desde Configuración." />
        ) : (
          <>
            {folders.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {folders.map(folder => (
                  <FolderCard
                    key={folder}
                    name={folder}
                    count={packages.filter(p => p.folder === folder).length}
                    onOpen={onOpenFolder}
                  />
                ))}
              </div>
            )}
            {loose.length > 0 && (
              <section className="space-y-3">
                {folders.length > 0 && (
                  <h3 className="text-sm font-semibold text-text-muted">Sin carpeta</h3>
                )}
                <PkgGrid items={loose} onOpen={onOpen} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Pantalla de carpeta: solo sus paquetes. El back vive en el header (BankView).
function FolderScreen({ packages, folder, onOpen }: { packages: PackageIndex[]; folder: string; onOpen: (slug: string) => void }) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const items = packages.filter(
    p => p.folder === folder && (!term || p.topic_name.toLowerCase().includes(term)),
  );
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <PkgSearch query={query} onChange={setQuery} />
        {items.length === 0
          ? <HomeEmpty msg={term ? `Sin resultados para "${query}".` : 'Carpeta vacía.'} />
          : <PkgGrid items={items} onOpen={onOpen} />}
      </div>
    </div>
  );
}

function FolderCard({ name, count, onOpen }: { name: string; count: number; onOpen: (name: string) => void }) {
  return (
    <button
      onClick={() => onOpen(name)}
      className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl border border-border bg-surface hover:bg-surface-hover transition-colors"
    >
      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Folders className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text truncate">{name}</p>
        <p className="text-xs text-text-muted">{count === 0 ? 'Vacía' : `${count} paquete(s)`}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
    </button>
  );
}

function PackageCard({ pkg, onOpen }: { pkg: PackageIndex; onOpen: (slug: string) => void }) {
  return (
    <button
      onClick={() => onOpen(pkg.slug)}
      className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl border border-border bg-surface hover:bg-surface-hover transition-colors"
    >
      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <GraduationCap className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text truncate">{pkg.topic_name}</p>
        <p className="text-xs text-text-muted">{pkg.question_count} preguntas</p>
      </div>
      <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
    </button>
  );
}

interface HeaderButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function HeaderButton({ icon, label, onClick }: HeaderButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}

interface TemarioModalProps {
  topic: StudyPackage['theory']['topic'];
  selected: SelectedNode | null;
  onSelect: (node: SelectedNode) => void;
  onClose: () => void;
}

function TemarioModal({ topic, selected, onSelect, onClose }: TemarioModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold text-text">Temario</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-2 py-2">
          <TopicTree topic={topic} selected={selected} onSelect={onSelect} expandAll disabled />
        </div>
      </div>
    </div>
  );
}

interface MetaEditorModalProps {
  packages: PackageIndex[];
  title: string;
  folder: string;
  onTitleChange: (v: string) => void;
  onFolderChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}

function MetaEditorModal({ packages, title, folder, onTitleChange, onFolderChange, onSave, onCancel, isSaving }: MetaEditorModalProps) {
  const existingFolders = [...new Set(packages.map(p => p.folder).filter((f): f is string => Boolean(f)))].sort();
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={onCancel}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold text-text">Editar paquete</h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="px-5 py-4 space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Título</span>
            <input
              type="text"
              value={title}
              onChange={e => onTitleChange(e.target.value)}
              placeholder="Título"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Carpeta</span>
            <input
              list="meta-folders-list"
              value={folder}
              onChange={e => onFolderChange(e.target.value)}
              placeholder="Carpeta (opcional)"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <datalist id="meta-folders-list">
              {existingFolders.map(f => <option key={f} value={f} />)}
            </datalist>
          </label>
        </div>
        <footer className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded-md hover:bg-surface-hover transition-colors">
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={isSaving || !title.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface TestPackagePickerProps {
  packages: PackageIndex[];
  defaultSlugs: string[];
  onNext: (slugs: string[]) => void;
  onCancel: () => void;
  isLoading: boolean;
}

function TestPackagePicker({ packages, defaultSlugs, onNext, onCancel, isLoading }: TestPackagePickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSlugs));

  const toggle = (slug: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const totalQuestions = packages
    .filter(p => selected.has(p.slug))
    .reduce((sum, p) => sum + p.question_count, 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
        <div className="text-center space-y-1 border-b border-border/40 pb-4">
          <FileQuestion className="w-8 h-8 text-primary mx-auto" />
          <h3 className="text-lg font-bold text-text">Seleccionar paquetes</h3>
          <p className="text-xs text-text-muted">Elige uno o más bancos para combinar en el test</p>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {packages.map(pkg => (
            <label
              key={pkg.slug}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                selected.has(pkg.slug)
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-surface-hover'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(pkg.slug)}
                onChange={() => toggle(pkg.slug)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                selected.has(pkg.slug) ? 'border-primary bg-primary' : 'border-border bg-background'
              }`}>
                {selected.has(pkg.slug) && (
                  <svg className="w-2.5 h-2.5 stroke-white" fill="none" viewBox="0 0 24 24" strokeWidth="4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text truncate">{pkg.topic_name}</p>
                {pkg.folder && <p className="text-[10px] text-text-muted">{pkg.folder}</p>}
              </div>
              <span className="text-xs text-text-muted shrink-0">{pkg.question_count} preg.</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-text-muted text-center">
          {selected.size === 0
            ? 'Selecciona al menos un paquete'
            : `${totalQuestions} preguntas en total`}
        </p>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="py-2.5 text-sm text-text-muted hover:text-text border border-border rounded-xl hover:bg-surface-hover disabled:opacity-40 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onNext([...selected])}
            disabled={selected.size === 0 || isLoading}
            className="py-2.5 text-sm bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Cargando…
              </>
            ) : (
              <>
                Siguiente
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

async function handleDelete(slug: string, refresh: () => Promise<void>, setActive: (s: string | null) => void): Promise<void> {
  if (!confirm(`¿Eliminar el paquete "${slug}"? Esta acción borra el JSON y sus imágenes de la nube.`)) return;
  await deletePackage(slug);
  setActive(null);
  await refresh();
}
