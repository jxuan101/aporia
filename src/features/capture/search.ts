export function createCaptureSearchPattern(query: string): string {
  const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
  return `%${escapedQuery}%`;
}

export function getCaptureSearchExcerpt(
  currentText: string,
  originalText: string,
  query: string,
): string {
  const normalizedQuery = query.toLowerCase();
  const currentMatch = currentText.toLowerCase().indexOf(normalizedQuery);
  const matchingText = currentMatch >= 0 ? currentText : originalText;
  const matchIndex =
    currentMatch >= 0
      ? currentMatch
      : originalText.toLowerCase().indexOf(normalizedQuery);
  const start = Math.max(0, matchIndex - 60);
  const end = Math.min(matchingText.length, matchIndex + query.length + 60);

  return `${start > 0 ? "…" : ""}${matchingText.slice(start, end)}${
    end < matchingText.length ? "…" : ""
  }`;
}
