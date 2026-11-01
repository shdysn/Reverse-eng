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
  '.svg': 'xml',
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.9.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
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
  '.bmp',
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

export function isImageFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.9.png')) return true;
  const ext = path.extname(lower);
  return ext in IMAGE_MIME_TYPES;
}

export function getImageMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.9.png')) return 'image/png';
  const ext = path.extname(lower);
  return IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
}

export function isBinaryFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.9.png')) return true;
  const ext = path.extname(lower);
  return BINARY_EXTENSIONS.has(ext);
}
