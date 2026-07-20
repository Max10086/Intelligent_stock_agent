export const downloadTextFile = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const sanitizeFilenamePart = (value: string, maxLength = 80): string => {
  const trimmed = (value || '').trim();
  if (!trimmed) return 'report';
  return trimmed.replace(/[^\w.\-()+]/g, '_').replace(/_+/g, '_').slice(0, maxLength);
};
