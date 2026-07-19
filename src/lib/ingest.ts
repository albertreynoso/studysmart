// Ingesta client-side de paquetes de estudio. Port de backend/services/study_ingest.py:
// valida, autogenera external_ids, fusiona aditivamente y persiste (Storage + índice Firestore).
import { getPackage, getPackageIndex, savePackage } from "./packages";
import { slugify } from "./slug";
import type { IngestResponse, PackageIndex, StudyPackage } from "../components/study/types";

type Dict = Record<string, any>;
export interface IngestErrorDetail {
  errors?: { path?: string; message: string }[];
  message?: string;
}

export class IngestError extends Error {
  readonly status: number;
  readonly detail: IngestErrorDetail;
  constructor(status: number, detail: IngestErrorDetail) {
    super(detail.message ?? "Error de ingesta");
    this.status = status;
    this.detail = detail;
  }
}

interface Counts {
  theoryCreated: number;
  theorySkipped: number;
  questionsCreated: number;
  questionsSkipped: number;
  newIds: string[];
}
const zero = (): Counts => ({ theoryCreated: 0, theorySkipped: 0, questionsCreated: 0, questionsSkipped: 0, newIds: [] });

// ─── Validación (checks estructurales alineados al schema) ───────────────────

function validate(p: Dict): { path?: string; message: string }[] {
  const errors: { path?: string; message: string }[] = [];
  if (p?.schema_version !== "1.0") errors.push({ path: "schema_version", message: 'Debe ser "1.0"' });
  if (p?.type !== "study_package") errors.push({ path: "type", message: 'Debe ser "study_package"' });
  const topicName = p?.theory?.topic?.name;
  if (p?.theory?.topic && !topicName) errors.push({ path: "theory.topic.name", message: "Falta el nombre del topic" });
  (p?.questions?.items ?? []).forEach((q: Dict, i: number) => validateQuestion(q, i, errors));
  return errors;
}

const QUESTION_TYPES = new Set(["multiple_choice", "multiple_response", "matching"]);

function validateQuestion(q: Dict, i: number, errors: { path?: string; message: string }[]): void {
  const at = `questions.items[${i}]`;
  if (!QUESTION_TYPES.has(q?.type)) errors.push({ path: `${at}.type`, message: 'Debe ser "multiple_choice", "multiple_response" o "matching"' });
  if (!q?.question) errors.push({ path: `${at}.question`, message: "Enunciado vacío" });
  if (q?.explanation === undefined) errors.push({ path: `${at}.explanation`, message: "Falta explicación" });
  if (q?.type === "matching") validateMatching(q, at, errors);
  else validateChoice(q, at, errors);
}

function validateChoice(q: Dict, at: string, errors: { path?: string; message: string }[]): void {
  const minOptions = q?.type === "multiple_response" ? 5 : 2;
  const minCorrect = q?.type === "multiple_response" ? 2 : 1;
  if (!Array.isArray(q?.options) || q.options.length < minOptions) errors.push({ path: `${at}.options`, message: `Mínimo ${minOptions} opciones` });
  if (!Array.isArray(q?.correct) || q.correct.length < minCorrect) errors.push({ path: `${at}.correct`, message: `Mínimo ${minCorrect} respuesta(s) correcta(s)` });
}

function validateMatching(q: Dict, at: string, errors: { path?: string; message: string }[]): void {
  if (!Array.isArray(q?.left) || q.left.length < 2) errors.push({ path: `${at}.left`, message: "Mínimo 2 conceptos en 'left'" });
  if (!Array.isArray(q?.right) || q.right.length < 2) errors.push({ path: `${at}.right`, message: "Mínimo 2 definiciones en 'right'" });
  if (!Array.isArray(q?.correct_pairs) || q.correct_pairs.length < 2) errors.push({ path: `${at}.correct_pairs`, message: "Mínimo 2 pares en 'correct_pairs'" });
}

// Matching no trae options/correct: se normalizan a [] para que el resto del
// código (TestView, editor, sesiones) pueda iterar sin guards por tipo.
function normalizeQuestions(p: Dict): void {
  for (const q of p?.questions?.items ?? []) {
    if (q?.type !== "matching") continue;
    q.options ??= [];
    q.correct ??= [];
  }
}

// ─── Autogeneración de external_ids ──────────────────────────────────────────

function nextUnique(base: string, used: Set<string>, fallback: string): string {
  let candidate = base || fallback;
  if (!used.has(candidate)) return candidate;
  let n = 2;
  while (used.has(`${candidate}-${n}`)) n += 1;
  return `${candidate}-${n}`;
}

function claimId(node: Dict, used: Set<string>, fallback: string): void {
  if (node.external_id) { used.add(node.external_id); return; }
  const seed = node.name || node.question || "";
  node.external_id = nextUnique(slugify(seed), used, fallback);
  used.add(node.external_id);
}

function fillIds(items: Dict[], prefix: string, childKey?: string): void {
  const used = new Set<string>();
  items.forEach((it, i) => {
    claimId(it, used, `${prefix}-${i + 1}`);
    if (childKey) fillIds(it[childKey] ?? [], childKey === "subtopics" ? "subtopic" : "section", childKey === "subtopics" ? "sections" : undefined);
  });
}

function autogenerateIds(p: Dict): void {
  const topic = p?.theory?.topic;
  if (topic && !topic.external_id) topic.external_id = slugify(topic.name || "") || "topic";
  if (topic) fillIds(topic.subtopics ?? [], "subtopic", "sections");
  fillIds(p?.questions?.items ?? [], "q");
}

// ─── Merge aditivo ───────────────────────────────────────────────────────────

function findByIdOrName(items: Dict[], target: Dict): Dict | undefined {
  if (target.external_id) { const m = items.find((it) => it.external_id === target.external_id); if (m) return m; }
  if (target.name) return items.find((it) => it.name === target.name);
  return undefined;
}

function mergeSections(existing: Dict[], incoming: Dict[], c: Counts): void {
  for (const inc of incoming) {
    if (findByIdOrName(existing, inc)) { c.theorySkipped += 1; continue; }
    existing.push(inc); c.theoryCreated += 1;
  }
}

function mergeSubtopics(existing: Dict[], incoming: Dict[], c: Counts): void {
  for (const inc of incoming) {
    const match = findByIdOrName(existing, inc);
    if (match) {
      c.theorySkipped += 1;
      match.sections ??= [];
      mergeSections(match.sections, inc.sections ?? [], c);
      continue;
    }
    existing.push(inc); c.theoryCreated += 1;
  }
}

function mergeTheory(existingTopic: Dict, incomingTheory: Dict, c: Counts): void {
  const incSubtopics = incomingTheory?.topic?.subtopics ?? incomingTheory?.subtopics ?? [];
  existingTopic.subtopics ??= [];
  mergeSubtopics(existingTopic.subtopics, incSubtopics, c);
}

function mergeQuestions(existing: Dict[], incoming: Dict[], targetSubtopic: string | undefined, c: Counts): void {
  const ids = new Set(existing.map((q) => q.external_id).filter(Boolean));
  for (const inc of incoming) {
    if (ids.has(inc.external_id)) { c.questionsSkipped += 1; continue; }
    if (targetSubtopic && !inc.subtopic) inc.subtopic = targetSubtopic;
    existing.push(inc); c.questionsCreated += 1; c.newIds.push(inc.external_id);
  }
}

// ─── Persistencia ────────────────────────────────────────────────────────────

function canonicalNew(p: Dict): StudyPackage {
  const topic = p?.theory?.topic ?? {};
  return {
    schema_version: "1.0",
    type: "study_package",
    theory: { topic },
    questions: { topic: topic.name ?? "", items: p?.questions?.items ?? [] },
  };
}

function mergeIntoExisting(existing: StudyPackage, p: Dict, c: Counts): StudyPackage {
  const topic = existing.theory.topic as Dict;
  mergeTheory(topic, p?.theory ?? {}, c);
  const incQs = p?.questions ?? {};
  existing.questions ??= { topic: topic.name ?? "", items: [] };
  existing.questions.items ??= [];
  mergeQuestions(existing.questions.items, incQs.items ?? [], incQs.target_subtopic, c);
  return existing;
}

async function loadExisting(slug: string): Promise<StudyPackage | null> {
  return getPackage(slug).catch(() => null);
}

export async function ingest(payload: unknown, onProgress?: (pct: number) => void): Promise<IngestResponse> {
  const p = payload as Dict;
  const errors = validate(p);
  if (errors.length) throw new IngestError(422, { errors });
  normalizeQuestions(p);
  autogenerateIds(p);

  const isPatch = Boolean(p?.target?.topic);
  const topicName: string = isPatch ? p.target.topic : (p?.theory?.topic?.name ?? "");
  const slug = slugify(topicName) || "package";
  const existing = await loadExisting(slug);
  if (isPatch && !existing) {
    throw new IngestError(404, {
      message: `El paquete '${topicName}' no existe. Sube un JSON sin 'target' (bulk) para crearlo.`,
    });
  }

  const counts = zero();
  const body = existing ? mergeIntoExisting(existing, p, counts) : createNew(p, counts);
  const folder = (await getPackageIndex(slug))?.folder ?? null;
  const questionCount = body.questions?.items?.length ?? 0;
  const index: PackageIndex = {
    slug,
    topic_name: body.theory.topic.name,
    topic_external_id: body.theory.topic.external_id,
    last_modified: null,
    question_count: questionCount,
    folder,
  };
  await savePackage(index, body, onProgress);
  return buildResponse(index, counts, questionCount);
}

function createNew(p: Dict, c: Counts): StudyPackage {
  const body = canonicalNew(p);
  const subtopics = body.theory.topic.subtopics ?? [];
  c.theoryCreated = subtopics.length + subtopics.reduce((n, st) => n + (st.sections?.length ?? 0), 0);
  c.questionsCreated = body.questions.items.length;
  c.newIds = body.questions.items.map((q) => q.external_id);
  return body;
}

function buildResponse(index: PackageIndex, c: Counts, questionCount: number): IngestResponse {
  return {
    slug: index.slug,
    topic_name: index.topic_name,
    topic_external_id: index.topic_external_id,
    theory: { created: c.theoryCreated, skipped: c.theorySkipped },
    questions: { created: c.questionsCreated, skipped: c.questionsSkipped },
    question_count: questionCount,
    new_question_external_ids: c.newIds,
    relink: { processed: 0, linked: 0, unlinked: 0 },
  };
}
