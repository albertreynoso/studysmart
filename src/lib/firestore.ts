// Sesiones de test + stats de preguntas débiles. Reemplaza el SQLite del backend viejo.
// Colección `sessions`: un doc por intento, con las respuestas embebidas.
// ponytail: respuestas embebidas en el doc (un test nunca acerca el límite de 1MB); subcolección si algún día crece.
import { addDoc, collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { getPackage } from "./packages";
import type {
  PackageIndex,
  SessionAnswer,
  SessionPayload,
  SessionRecord,
  WeakQuestion,
} from "../components/study/types";

const NOT_CONFIGURED = "Firebase no configurado — rellena .env (ver .env.example)";
function fdb() { if (!db) throw new Error(NOT_CONFIGURED); return db; }

const SESSIONS = "sessions";

interface SessionDoc extends Omit<SessionRecord, "id"> {
  answers: SessionAnswer[];
}

export async function saveSession(payload: SessionPayload): Promise<{ id: string }> {
  const record = {
    ...payload,
    started_at: new Date().toISOString(),
    pkg_scores: pkgScores(payload.answers),
    answers: payload.answers,
  };
  const written = await addDoc(collection(fdb(), SESSIONS), record);
  return { id: written.id };
}

export async function listSessions(folder?: string): Promise<SessionRecord[]> {
  const slugs = await folderSlugs(folder);
  const docs = await loadSessionDocs();
  return docs
    .filter(([, s]) => !slugs || slugs.has(s.package_slug))
    .map(([id, s]) => toRecord(id, s));
}

export async function getWeakQuestions(folder?: string): Promise<WeakQuestion[]> {
  const slugs = await folderSlugs(folder);
  const docs = await loadSessionDocs();
  const answers = docs
    .flatMap(([, s]) => s.answers)
    .filter((a) => !slugs || slugs.has(a.package_slug));
  const correct = await loadCorrectMap(new Set(answers.map((a) => a.package_slug)));
  return tallyWeak(answers, correct);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Slugs de los paquetes en una carpeta (null = todas). Lee la colección `packages`.
async function folderSlugs(folder?: string): Promise<Set<string> | null> {
  if (!folder) return null;
  const snap = await getDocs(query(collection(fdb(), "packages"), where("folder", "==", folder)));
  return new Set(snap.docs.map((d) => (d.data() as PackageIndex).slug));
}

async function loadSessionDocs(): Promise<[string, SessionDoc][]> {
  const snap = await getDocs(query(collection(fdb(), SESSIONS), orderBy("started_at", "asc")));
  return snap.docs.map((d) => [d.id, d.data() as SessionDoc]);
}

function toRecord(id: string, s: SessionDoc): SessionRecord {
  const { answers: _drop, ...rest } = s;
  return { id, ...rest };
}

function pkgScores(answers: SessionAnswer[]): Record<string, number> {
  const tally: Record<string, [number, number]> = {};
  for (const a of answers) {
    const t = (tally[a.package_slug] ??= [0, 0]);
    t[1] += 1;
    if (a.is_correct) t[0] += 1;
  }
  return Object.fromEntries(
    Object.entries(tally).map(([slug, [ok, n]]) => [slug, n ? Math.round((ok / n) * 100) : 0]),
  );
}

// { slug: { external_id: Set(correct ids) } } desde los paquetes actuales en Storage.
async function loadCorrectMap(slugs: Set<string>): Promise<Record<string, Record<string, Set<string>>>> {
  const out: Record<string, Record<string, Set<string>>> = {};
  for (const slug of slugs) {
    const pkg = await getPackage(slug).catch(() => null);
    if (!pkg) continue;
    out[slug] = Object.fromEntries(
      pkg.questions.items.map((q) => [q.external_id, new Set(q.correct)]),
    );
  }
  return out;
}

function isCorrectNow(a: SessionAnswer, correct: Record<string, Record<string, Set<string>>>): boolean {
  const current = correct[a.package_slug]?.[a.question_external_id];
  if (!current) return a.is_correct; // pregunta ya no existe → confía en lo guardado
  const sel = new Set(a.selected);
  return sel.size === current.size && [...sel].every((s) => current.has(s));
}

function tallyWeak(answers: SessionAnswer[], correct: Record<string, Record<string, Set<string>>>): WeakQuestion[] {
  const stats: Record<string, WeakQuestion> = {};
  for (const a of answers) {
    const key = `${a.package_slug}::${a.question_external_id}`;
    const w = (stats[key] ??= {
      package_slug: a.package_slug,
      question_external_id: a.question_external_id,
      question_text: a.question_text || "",
      attempts: 0,
      wrong_count: 0,
    });
    w.attempts += 1;
    if (!isCorrectNow(a, correct)) w.wrong_count += 1;
  }
  return Object.values(stats)
    .filter((w) => w.wrong_count > 0)
    .sort((x, y) => y.wrong_count - x.wrong_count);
}
