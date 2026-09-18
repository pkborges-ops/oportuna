const STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "para",
  "com",
  "em",
  "e",
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
  "no",
  "na",
  "nos",
  "nas",
  "por",
  "ao",
  "aos",
  "ou",
]);

export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function termosRelevantes(texto: string): string[] {
  return [
    ...new Set(
      normalizarTexto(texto)
        .split(" ")
        .filter((termo) => termo.length > 0 && !STOPWORDS.has(termo)),
    ),
  ];
}
