export interface SessionUser {
  id: string;
  userId: string;
  displayName: string;
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  isImage: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  assistantBusy?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  status: 'complete' | 'streaming' | 'error';
  attachments: MessageAttachment[];
}
