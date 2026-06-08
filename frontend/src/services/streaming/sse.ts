export function extractSseChunk(
  buffer: string,
): { chunk: string; remaining: string } | null {
  const lfBoundary = buffer.indexOf("\n\n");
  const crlfBoundary = buffer.indexOf("\r\n\r\n");

  if (lfBoundary === -1 && crlfBoundary === -1) {
    return null;
  }

  if (crlfBoundary !== -1 && (lfBoundary === -1 || crlfBoundary < lfBoundary)) {
    return {
      chunk: buffer.slice(0, crlfBoundary),
      remaining: buffer.slice(crlfBoundary + 4),
    };
  }

  return {
    chunk: buffer.slice(0, lfBoundary),
    remaining: buffer.slice(lfBoundary + 2),
  };
}
