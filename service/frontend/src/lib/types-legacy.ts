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
  previewUrl?: string;
  isImage: boolean;
  isHtml: boolean;
  isAudio: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  assistantBusy?: boolean;
  assistantStalled?: boolean;
}

export type HermesRunStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'stale';

export interface ConversationRunState {
  status: HermesRunStatus;
  active: boolean;
  stalled: boolean;
  eventId?: string;
  messageId?: string;
  createdAt?: string;
  claimedAt?: string | null;
  completedAt?: string | null;
  lastActivityAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface BriefingReferenceValidation {
  valid: boolean;
  warningCount: number;
  errorCount: number;
}

export interface BriefingReference {
  schemaVersion: 'briefing-reference/v1';
  jobId: string;
  briefingId: string;
  title: string;
  summary?: string | null;
  generatedAt?: string | null;
  previewUrl: string;
  validation: BriefingReferenceValidation;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  displayType?: 'tool_progress';
  content: string;
  createdAt: string;
  updatedAt?: string;
  status: 'complete' | 'streaming' | 'error';
  attachments: MessageAttachment[];
  briefingReference?: BriefingReference | null;
  revisionSiblingIds?: string[];
  revisionIndex?: number;
  revisionTotal?: number;
  /**
   * Real llama.cpp-style inference timings for assistant messages, when the
   * upstream provider emits them. ``null``/``undefined`` for providers that
   * don't (OpenAI, Anthropic, etc.) — the UI hides its stats panel when
   * these are absent rather than fabricating estimates.
   */
  timings?: import('./types/chat').ChatMessageTimings | null;
}
