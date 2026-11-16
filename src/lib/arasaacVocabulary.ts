import catalog from "../data/board-catalog.generated.json" with { type: "json" };

// Only public vocabulary and its checked-in linguistic variants may leave Comunica.
const variants = [
  "casa de banho", "parque infantil", "cão", "cinzento", "autocarro", "saltar",
  "ferida", "vomitar", "comichão", "vertigens", "enjoo", "dificuldade respiratória",
  "receita médica", "adeus",
];
const formatTerm = (term: string) => term.normalize("NFC").trim().replace(/\s+/g, " ");
const localKey = (term: string) => formatTerm(term).toLocaleLowerCase("pt-BR");
const accentless = (term: string) => localKey(term).normalize("NFD").replace(/\p{M}/gu, "");
const knownTerms = new Map<string, string>();
for (const term of [...catalog.flatMap((item) => [item.label, ...item.relatedTerms]), ...variants]) {
  const normalized = formatTerm(term);
  knownTerms.set(localKey(normalized), normalized);
}

export function resolveArasaacPublicTerm(term: string): string | undefined {
  if (term.length > 100) return undefined;
  const key = localKey(term);
  const exact = knownTerms.get(key);
  if (exact || !key) return exact;
  // Some words, such as “E” and “É”, differ only by accent. Prefer exact matches.
  const wanted = accentless(key);
  const matches = [...knownTerms].filter(([candidate]) => accentless(candidate) === wanted);
  return matches.length === 1 ? matches[0][1] : undefined;
}

export function getArasaacPublicTerms(query = ""): string[] {
  const word = accentless(query);
  const terms = [...knownTerms.values()];
  if (!word) return terms;
  return terms.filter((term) => {
    const candidate = accentless(term);
    return candidate.startsWith(word) || (word.length >= 2 && candidate.includes(word));
  }).sort((left, right) => {
    return Number(accentless(right) === word) - Number(accentless(left) === word)
      || Number(accentless(right).startsWith(word)) - Number(accentless(left).startsWith(word));
  });
}
