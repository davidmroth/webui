import type { ChatMessage } from '$lib/types-legacy';

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MIN_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 5_000;

export interface ChatProbeOptions {
  content: string;
  conversationId: string | null;
  title: string;
  waitForResponse: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface ChatProbeWaitResult {
  status: 'completed' | 'timed_out';
  messages: ChatMessage[];
  responseMessages: ChatMessage[];
  elapsedMs: number;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizeBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

export function normalizeChatProbeOptions(raw: Record<string, unknown>): ChatProbeOptions {
  const content = normalizeOptionalString(raw.content);
  if (!content) {
    throw new Error('Probe message content is required.');
  }

  return {
    content,
    conversationId: normalizeOptionalString(raw.conversationId ?? raw.conversation_id),
    title: normalizeOptionalString(raw.title) ?? 'Diagnostics chat probe',
    waitForResponse: normalizeBoolean(raw.waitForResponse ?? raw.wait_for_response, true),
    timeoutMs: normalizeBoundedNumber(
      raw.timeoutMs ?? raw.timeout_ms,
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    ),
    pollIntervalMs: normalizeBoundedNumber(
      raw.pollIntervalMs ?? raw.poll_interval_ms,
      DEFAULT_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS,
      MAX_POLL_INTERVAL_MS
    )
  };
}


export function findProbeResponseMessages(messages: ChatMessage[], userMessageId: string): ChatMessage[] {
  const userMessageIndex = messages.findIndex((message) => message.id === userMessageId);
  if (userMessageIndex < 0) {
    return [];
  }

  return messages
    .slice(userMessageIndex + 1)
    .filter((message) => message.role === 'assistant' || message.role === 'system');
}

export async function waitForProbeResponses(input: {
  loadMessages: () => Promise<ChatMessage[]>;
  userMessageId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): Promise<ChatProbeWaitResult> {
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  let messages = await input.loadMessages();
  let responseMessages = findProbeResponseMessages(messages, input.userMessageId);

  while (responseMessages.length === 0 && now() - startedAt < input.timeoutMs) {
    const remainingMs = Math.max(0, input.timeoutMs - (now() - startedAt));
    await sleep(Math.min(input.pollIntervalMs, remainingMs));
    messages = await input.loadMessages();
    responseMessages = findProbeResponseMessages(messages, input.userMessageId);
  }

  return {
    status: responseMessages.length > 0 ? 'completed' : 'timed_out',
    messages,
    responseMessages,
    elapsedMs: Math.max(0, now() - startedAt)
  };
}