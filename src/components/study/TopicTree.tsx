// TOC lateral del Banco de Estudio, 3 niveles colapsables. Port de juststudy (sin cambios).
import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, BookOpen, FileText } from 'lucide-react';
import type { StudyTopic, StudySubtopic, StudySection, SelectedNode } from './types';

interface TopicTreeProps {
  topic: StudyTopic;
  selected: SelectedNode | null;
  onSelect: (node: SelectedNode) => void;
  expandAll?: boolean;
  disabled?: boolean;
}

const isActive = (selected: SelectedNode | null, externalId: string): boolean =>
  selected?.external_id === externalId;

export function TopicTree({ topic, selected, onSelect, expandAll = false, disabled = false }: TopicTreeProps) {
  const subtopics = topic.subtopics ?? [];

  return (
    <div className="flex flex-col p-2 select-none text-sm">
      <NodeRow
        label={topic.name}
        icon={<BookOpen className="w-4 h-4" />}
        active={isActive(selected, topic.external_id)}
        depth={0}
        disabled={disabled}
        onClick={() =>
          onSelect({
            level: 'topic',
            external_id: topic.external_id,
            ref_path: { topic: topic.name },
          })
        }
      />
      <ul className="mt-1 space-y-0.5">
        {subtopics.map(st => (
          <SubtopicRow
            key={st.external_id}
            topicName={topic.name}
            subtopic={st}
            selected={selected}
            onSelect={onSelect}
            expandAll={expandAll}
            disabled={disabled}
          />
        ))}
      </ul>
    </div>
  );
}

interface SubtopicRowProps {
  topicName: string;
  subtopic: StudySubtopic;
  selected: SelectedNode | null;
  onSelect: (node: SelectedNode) => void;
  expandAll?: boolean;
  disabled?: boolean;
}

function SubtopicRow({ topicName, subtopic, selected, onSelect, expandAll = false, disabled = false }: SubtopicRowProps) {
  const sections = subtopic.sections ?? [];
  const hasSections = sections.length > 0;
  const containsSelected = useMemo(
    () => selected ? subtopicContainsSelected(subtopic, selected) : false,
    [subtopic, selected]
  );
  const [expanded, setExpanded] = useState(expandAll || containsSelected);

  return (
    <li>
      <NodeRow
        label={subtopic.name}
        icon={<ChevronToggle expanded={expanded} hasChildren={hasSections} onToggle={() => setExpanded(e => !e)} />}
        active={isActive(selected, subtopic.external_id)}
        depth={1}
        disabled={disabled}
        onClick={() =>
          onSelect({
            level: 'subtopic',
            external_id: subtopic.external_id,
            ref_path: { topic: topicName, subtopic: subtopic.name },
          })
        }
      />
      {expanded && hasSections && (
        <ul className="mt-0.5 space-y-0.5">
          {sections.map(sec => (
            <SectionRow
              key={sec.external_id}
              topicName={topicName}
              subtopicName={subtopic.name}
              section={sec}
              active={isActive(selected, sec.external_id)}
              onSelect={onSelect}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface SectionRowProps {
  topicName: string;
  subtopicName: string;
  section: StudySection;
  active: boolean;
  onSelect: (node: SelectedNode) => void;
  disabled?: boolean;
}

function SectionRow({ topicName, subtopicName, section, active, onSelect, disabled = false }: SectionRowProps) {
  return (
    <li>
      <NodeRow
        label={section.name}
        icon={<FileText className="w-3.5 h-3.5 text-text-muted" />}
        active={active}
        depth={2}
        disabled={disabled}
        onClick={() =>
          onSelect({
            level: 'section',
            external_id: section.external_id,
            ref_path: { topic: topicName, subtopic: subtopicName, section: section.name },
          })
        }
      />
    </li>
  );
}

interface NodeRowProps {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  depth: number;
  onClick: () => void;
  disabled?: boolean;
}

function NodeRow({ label, icon, active, depth, onClick, disabled = false }: NodeRowProps) {
  const paddingLeft = depth === 0 ? 'pl-2' : depth === 1 ? 'pl-4' : 'pl-9';
  const tone = disabled
    ? 'text-text-muted cursor-not-allowed'
    : active
      ? 'bg-primary/15 text-primary font-medium'
      : 'text-text-muted hover:bg-surface-hover hover:text-text';
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 ${paddingLeft} pr-2 py-1.5 rounded text-left transition-colors ${tone}`}
    >
      <span className="shrink-0 w-4 flex items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

interface ChevronToggleProps {
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
}

function ChevronToggle({ expanded, hasChildren, onToggle }: ChevronToggleProps) {
  if (!hasChildren) return <span className="w-3.5 h-3.5 inline-block" />;
  return (
    <span
      role="button"
      onClick={e => {
        e.stopPropagation();
        onToggle();
      }}
      className="w-3.5 h-3.5 flex items-center justify-center cursor-pointer text-text-muted hover:text-text"
    >
      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
    </span>
  );
}

function subtopicContainsSelected(subtopic: StudySubtopic, selected: SelectedNode): boolean {
  if (selected.external_id === subtopic.external_id) return true;
  return (subtopic.sections ?? []).some(s => s.external_id === selected.external_id);
}
