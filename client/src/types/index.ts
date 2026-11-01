export * from '@android-re/shared';

export interface EditorTab {
  id: string; // file path
  name: string;
  path: string;
  content: string;
  savedContent: string;
  language: string;
  isDirty: boolean;
  editable: boolean;
  size: number;
}

export interface NotificationItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
}
