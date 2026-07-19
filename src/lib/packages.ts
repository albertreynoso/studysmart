// Capa de datos de paquetes. Índice en Firestore (colección `packages`),
// cuerpo JSON + imágenes en Storage (`packages/<slug>.json`, `packages/<slug>/images/*`).
// Reemplaza study.ts (parte de paquetes). Firestore/Storage compartidos con Trackit (trackit-e6792).
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc } from "firebase/firestore";
import { deleteObject, getBytes, getDownloadURL, listAll, ref, uploadBytes, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "./firebase";
import type {
  PackageIndex,
  StudyPackage,
  StudyQuestion,
  StudyTopic,
} from "../components/study/types";

const NOT_CONFIGURED = "Firebase no configurado — rellena .env (ver .env.example)";
function fdb() { if (!db) throw new Error(NOT_CONFIGURED); return db; }
function fst() { if (!storage) throw new Error(NOT_CONFIGURED); return storage; }

const INDEX = "packages";
const bodyPath = (slug: string) => `packages/${slug}.json`;
const imagesDir = (slug: string) => `packages/${slug}/images`;

export async function listPackages(): Promise<PackageIndex[]> {
  const snap = await getDocs(collection(fdb(), INDEX));
  const rows = snap.docs.map((d) => d.data() as PackageIndex);
  return rows.sort((a, b) => a.topic_name.localeCompare(b.topic_name));
}

export async function getPackage(slug: string): Promise<StudyPackage> {
  const bytes = await getBytes(ref(fst(), bodyPath(slug)));
  return JSON.parse(new TextDecoder().decode(bytes)) as StudyPackage;
}

export async function getPackageIndex(slug: string): Promise<PackageIndex | null> {
  const snap = await getDoc(doc(fdb(), INDEX, slug));
  return snap.exists() ? (snap.data() as PackageIndex) : null;
}

// Live: índice compartido. Todos los clientes ven altas/renombres/borrados al instante.
export function subscribePackages(
  onList: (rows: PackageIndex[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(fdb(), INDEX),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as PackageIndex);
      onList(rows.sort((a, b) => a.topic_name.localeCompare(b.topic_name)));
    },
    (err) => onError?.(err as Error),
  );
}

// Live del cuerpo abierto: escucha last_modified del índice, refetch de Storage al cambiar.
export function subscribePackageBody(
  slug: string,
  onBody: (pkg: StudyPackage) => void,
  onError?: (err: Error) => void,
): () => void {
  let seen: string | null | undefined;
  return onSnapshot(
    doc(fdb(), INDEX, slug),
    async (snap) => {
      const stamp = (snap.data() as PackageIndex | undefined)?.last_modified ?? null;
      if (stamp === seen) return;
      seen = stamp;
      try {
        onBody(await getPackage(slug));
      } catch (err) {
        onError?.(err as Error);
      }
    },
    (err) => onError?.(err as Error),
  );
}

// Sube solo el cuerpo JSON a Storage (edición de nodos/preguntas, no toca el índice).
// onProgress(0-100) opcional: uploadBytesResumable emite bytes transferidos para la UI de subida.
async function putBody(slug: string, body: StudyPackage, onProgress?: (pct: number) => void): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(body, null, 2));
  const task = uploadBytesResumable(ref(fst(), bodyPath(slug)), bytes, { contentType: "application/json" });
  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      resolve,
    );
  });
  // Bump del índice: Storage no tiene realtime, así los suscriptores detectan el cambio.
  await setDoc(doc(fdb(), INDEX, slug), { last_modified: new Date().toISOString() }, { merge: true });
}

// Escribe cuerpo en Storage + upserta el doc índice. Usado por ingesta.
export async function savePackage(index: PackageIndex, body: StudyPackage, onProgress?: (pct: number) => void): Promise<void> {
  await putBody(index.slug, body, onProgress);
  await setDoc(doc(fdb(), INDEX, index.slug), { ...index, last_modified: new Date().toISOString() });
}

// ─── Edición in-place (reescribe solo el cuerpo en Storage) ───────────────────

function setNodeHtml(topic: StudyTopic, externalId: string, html: string): boolean {
  if (topic.external_id === externalId) { topic.content_html = html; return true; }
  for (const st of topic.subtopics ?? []) {
    if (st.external_id === externalId) { st.content_html = html; return true; }
    for (const sec of st.sections ?? []) {
      if (sec.external_id === externalId) { sec.content_html = html; return true; }
    }
  }
  return false;
}

export async function updateNodeContent(slug: string, externalId: string, html: string): Promise<boolean> {
  const pkg = await getPackage(slug);
  if (!setNodeHtml(pkg.theory.topic, externalId, html)) return false;
  await putBody(slug, pkg);
  return true;
}

const QUESTION_FIELDS: (keyof StudyQuestion)[] = [
  "question", "explanation", "image", "image_width", "options", "correct",
  "left", "right", "correct_pairs",
];

export async function updateQuestion(
  slug: string,
  externalId: string,
  fields: Partial<StudyQuestion>,
): Promise<boolean> {
  const pkg = await getPackage(slug);
  const q = pkg.questions.items.find((it) => it.external_id === externalId);
  if (!q) return false;
  const target = q as unknown as Record<string, unknown>;
  for (const k of QUESTION_FIELDS) {
    if (k in fields) target[k] = fields[k];
  }
  await putBody(slug, pkg);
  return true;
}

export async function deleteQuestionImage(slug: string, externalId: string): Promise<boolean> {
  const pkg = await getPackage(slug);
  const q = pkg.questions.items.find((it) => it.external_id === externalId);
  if (!q) return false;
  if (q.image) await deleteObject(ref(fst(), q.image)).catch(() => {});
  q.image = null;
  await putBody(slug, pkg);
  return true;
}

export async function updatePackageMeta(
  slug: string,
  fields: Partial<Pick<PackageIndex, "topic_name" | "folder">>,
): Promise<void> {
  const current = (await getDoc(doc(fdb(), INDEX, slug))).data() as PackageIndex | undefined;
  if (!current) throw new Error(`Paquete '${slug}' no encontrado`);
  await setDoc(doc(fdb(), INDEX, slug), {
    ...current,
    ...fields,
    last_modified: new Date().toISOString(),
  });
}

export async function deletePackage(slug: string): Promise<void> {
  await deleteDoc(doc(fdb(), INDEX, slug)).catch(() => {});
  await deleteObject(ref(fst(), bodyPath(slug))).catch(() => {});
  const imgs = await listAll(ref(fst(), imagesDir(slug))).catch(() => null);
  if (imgs) await Promise.all(imgs.items.map((i) => deleteObject(i)));
}

export async function uploadImage(slug: string, file: File): Promise<{ filename: string; url: string }> {
  const safe = (file.name || "image.png").replace(/[^\w.\-]/g, "_");
  const objRef = ref(fst(), `${imagesDir(slug)}/${safe}`);
  await uploadBytes(objRef, file, { contentType: file.type || "image/png" });
  return { filename: safe, url: await getDownloadURL(objRef) };
}

export function imageUrl(slug: string, filename: string): Promise<string> {
  return getDownloadURL(ref(fst(), `${imagesDir(slug)}/${filename}`));
}

// Export: descarga el JSON del paquete tal cual está en Storage.
export async function exportPackageBlob(slug: string): Promise<Blob> {
  const bytes = await getBytes(ref(fst(), bodyPath(slug)));
  return new Blob([bytes], { type: "application/json" });
}

export function countQuestions(pkg: StudyPackage): number {
  return pkg.questions?.items?.length ?? 0;
}
