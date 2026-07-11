// Port de study_ingest.slugify: NFKD → sin diacríticos → lower → no-alnum a '-' → trim → 60 chars.
export function slugify(text: string): string {
  if (!text) return "";
  const ascii = text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return slug.replace(/^-+|-+$/g, "").slice(0, 60);
}
