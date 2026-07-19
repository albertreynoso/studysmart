// Archivo: src/components/study/types.ts
// Capa: Interface — tipos del Banco de Estudio alineados a study_package.schema.json
// RF: RF51, RF53, RF54

export type StudyNodeLevel = "topic" | "subtopic" | "section";

export interface QuestionOption {
  id: string;
  text: string;
}

export type QuestionType = "multiple_choice" | "multiple_response" | "matching";

export interface MatchingPair {
  left: string;
  right: string;
}

export interface StudyQuestion {
  external_id: string;
  type: QuestionType;
  subtopic: string;
  section?: string | null;
  question: string;
  image?: string | null;
  image_width?: number | null;
  options: QuestionOption[]; // vacío en matching (normalizado en ingesta)
  correct: string[]; // vacío en matching
  left?: QuestionOption[]; // solo matching
  right?: QuestionOption[]; // solo matching: puede incluir distractores sin par
  correct_pairs?: MatchingPair[]; // solo matching
  explanation: string;
  package_slug?: string; // populated client-side when merging packages
}

export interface StudySection {
  external_id: string;
  name: string;
  description?: string;
  content_html?: string;
}

export interface StudySubtopic {
  external_id: string;
  name: string;
  description?: string;
  content_html?: string;
  sections?: StudySection[];
}

export interface StudyTopic {
  external_id: string;
  name: string;
  description?: string;
  content_html?: string;
  subtopics?: StudySubtopic[];
}

export interface StudyPackage {
  schema_version: "1.0";
  type: "study_package";
  theory: { topic: StudyTopic };
  questions: { topic: string; items: StudyQuestion[] };
}

export interface PackageIndex {
  slug: string;
  topic_name: string;
  topic_external_id: string;
  last_modified: string | null;
  question_count: number;
  folder?: string | null;
}

export interface IngestResponse {
  slug: string;
  topic_name: string;
  topic_external_id: string;
  theory: { created: number; skipped: number };
  questions: { created: number; skipped: number };
  question_count: number;
  new_question_external_ids: string[];
  relink: { processed: number; linked: number; unlinked: number };
}

export interface IngestErrorDetail {
  path?: string;
  message: string;
}

export interface SessionAnswer {
  package_slug: string;
  question_external_id: string;
  question_text: string;
  selected: string[];
  is_correct: boolean;
  score: number; // 0..1: fracción de aciertos (parcial en multi_response/matching)
}

export interface SessionPayload {
  package_slug: string;
  package_slugs: string[];
  topic_label: string;
  question_count: number;
  correct_count: number;
  score_pct: number;
  time_seconds: number;
  answers: SessionAnswer[];
}

export interface SessionRecord {
  id: string;
  package_slug: string;
  package_slugs: string[];
  topic_label: string;
  question_count: number;
  correct_count: number;
  score_pct: number;
  time_seconds: number;
  started_at: string;
  pkg_scores: Record<string, number>;
}

export interface WeakQuestion {
  package_slug: string;
  question_external_id: string;
  question_text: string;
  attempts: number;
  wrong_count: number;
}

export interface SelectedNode {
  level: StudyNodeLevel;
  external_id: string;
  ref_path: { topic: string; subtopic?: string; section?: string };
}
