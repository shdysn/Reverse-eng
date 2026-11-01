import path from 'node:path';

const TEXT_EXTENSIONS: Record<string, string> = {
  '.java': 'java',
  '.smali': 'smali',
  '.xml': 'xml',
  '.json': 'json',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.css': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.md': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.properties': 'plaintext',
  '.txt': 'plaintext',
  '.gradle': 'groovy',
  '.pro': 'plaintext',
};

const BINARY_EXTENSIONS = new Set([
  '.apk',
  '.dex',
  '.so',
  '.arsc',
  '.class',
  '.jar',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.9.png',
  '.wav',
  '.mp3',
  '.ogg',
  '.ttf',
  '.otf',
]);

export function getFileLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS[ext] || 'plaintext';
}

export function isBinaryFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.9.png')) return true;
  const ext = path.extname(lower);
  return BINARY_EXTENSIONS.has(ext);
}
