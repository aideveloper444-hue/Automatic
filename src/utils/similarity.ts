export function calculateTextSimilarity(a: string, b: string): number {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim();
  const left = normalize(a);
  const right = normalize(b);

  if (!left || !right) {
    return 0;
  }

  const leftWords = new Set(left.split(/\s+/));
  const rightWords = new Set(right.split(/\s+/));

  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;

  return union === 0 ? 0 : intersection / union;
}
