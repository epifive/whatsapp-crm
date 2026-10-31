import { db } from "@/lib/db";

/**
 * Finds the knowledge base passages most relevant to a question. Plain keyword scoring (no
 * vector database to install): articles are split into paragraphs, scored by how many of the
 * question's words they contain (rarer words count more), and the best fit in the budget.
 */
const CHUNK = 900;
const BUDGET = 4500;
const STOP = new Set(
  "a an and are as at be but by can do does for from have how i if in is it me my of on or our please so that the their there this to was we what when where which who why will with you your hai hain ka ki ke ko kya se me mein aur hum tum aap".split(" "),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export function chunkArticle(title: string, content: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const para of content.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (current && current.length + p.length > CHUNK) {
      parts.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${p}` : p;
    while (current.length > CHUNK * 1.5) {
      parts.push(current.slice(0, CHUNK));
      current = current.slice(CHUNK);
    }
  }
  if (current) parts.push(current);
  return parts.map((p) => `# ${title}\n${p}`);
}

export function rankChunks(chunks: string[], question: string, budget = BUDGET): string[] {
  const q = [...new Set(words(question))];
  if (!q.length) return [];
  const docs = chunks.map((c) => new Set(words(c)));
  // Inverse document frequency: a word that appears everywhere says little
  const idf = new Map(q.map((w) => [w, Math.log(1 + chunks.length / (1 + docs.filter((d) => d.has(w)).length))]));
  const scored = chunks
    .map((c, i) => ({ c, score: q.reduce((s, w) => s + (docs[i]!.has(w) ? idf.get(w)! : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const out: string[] = [];
  let used = 0;
  for (const { c } of scored) {
    if (used + c.length > budget) continue;
    out.push(c);
    used += c.length;
  }
  return out;
}

/** Relevant knowledge for a question, ready to paste into a prompt ("" when none) */
export async function knowledgeFor(orgId: string, question: string): Promise<string> {
  const articles = await db.knowledgeArticle.findMany({ where: { orgId, isActive: true }, select: { title: true, content: true } });
  if (!articles.length) return "";
  const chunks = articles.flatMap((a) => chunkArticle(a.title, a.content));
  // Small knowledge bases fit whole; bigger ones are filtered by relevance
  const total = chunks.reduce((n, c) => n + c.length, 0);
  return (total <= BUDGET ? chunks : rankChunks(chunks, question)).join("\n\n---\n\n");
}
