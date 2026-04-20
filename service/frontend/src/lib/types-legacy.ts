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
  assistantStalled?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  status: 'complete' | 'streaming' | 'error';
  attachments: MessageAttachment[];
  /**
   * Real llama.cpp-style inference timings for assistant messages, when the
   * upstream provider emits them. ``null``/``undefined`` for providers that
   * don't (OpenAI, Anthropic, etc.) — the UI hides its stats panel when
   * these are absent rather than fabricating estimates.
   */
  timings?: import('./types/chat').ChatMessageTimings | null;
}
