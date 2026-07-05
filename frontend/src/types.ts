export type Mode = 'message' | 'email' | 'todo' | 'prompt' | 'semantic';
export type Language = 'zh-Hant' | 'en' | 'mixed' | 'yue';

export interface HistoryItem {
  id: string;
  timestamp: string;
  raw: string;
  cleaned: string;
  mode: Mode;
  language: Language;
}
