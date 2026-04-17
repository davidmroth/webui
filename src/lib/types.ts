export interface SessionUser {
  id: string;
  userId: string;
  displayName: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  status: 'complete' | 'streaming' | 'error';
}
