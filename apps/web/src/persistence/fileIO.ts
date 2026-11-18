import { serializeProject, type Project } from '@hydrobim/core';

function safeFileName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return base.length > 0 ? base : 'projeto';
}

/** Baixa um conteúdo como arquivo: texto (UTF-8) ou bytes já codificados. */
export function downloadText(
  fileName: string,
  text: string | Uint8Array<ArrayBuffer>,
  mimeType: string,
): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const projectFileBase = (project: Project): string => safeFileName(project.name);

/** Baixa o projeto como arquivo JSON versionado (`.hydrobim.json`). */
export function downloadProject(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(project.name)}.hydrobim.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsText(file);
  });
}
