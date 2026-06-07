import type { ChatMessage } from '$lib/types-legacy';
import type { ForensicsVerdict } from './conversation-forensics';
import { looksIncompleteAssistantReply } from './conversation-forensics';

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MIN_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 5_000;

const SUPPORTED_ANALYSIS_PROFILES = ['premature_complete'] as const;

export type ChatProbeAnalysisProfile = (typeof SUPPORTED_ANALYSIS_PROFILES)[number];

export interface ChatProbeResponseSummary {
  assistantResponseCount: number;
  systemResponseCount: number;
  latestAssistantMessageId: string | null;
  latestAssistantSnippet: string;
  latestAssistantLooksIncomplete: boolean;
}

export interface ChatProbeAnalysisFinding {
  profile: ChatProbeAnalysisProfile;
  status: 'proved' | 'not_reproduced' | 'inconclusive';
  summary: string;
  evidence: ChatProbeResponseSummary;
}

export interface ChatProbeReport {
  beforeVerdict: ForensicsVerdict | null;
  afterVerdict: ForensicsVerdict | null;
  responseSummary: ChatProbeResponseSummary;
  findings: ChatProbeAnalysisFinding[];
}

export interface ChatProbeOptions {
  content: string;
  conversationId: string | null;
  title: string;
  waitForResponse: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
  analysisProfiles: ChatProbeAnalysisProfile[];
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

function normalizeAnalysisProfiles(raw: unknown): ChatProbeAnalysisProfile[] {
  if (raw == null || raw === '') {
    return [];
  }

  const values = Array.isArray(raw) ? raw : [raw];
  const profiles = values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Analysis profile names must be non-empty strings.');
    }
    const normalized = value.trim().toLowerCase();
    if (SUPPORTED_ANALYSIS_PROFILES.includes(normalized as ChatProbeAnalysisProfile)) {
      return normalized as ChatProbeAnalysisProfile;
    }
    throw new Error(`Unsupported analysis profile: ${value}`);
  });

  return [...new Set(profiles)];
}

export function normalizeChatProbeOptions(raw: Record<string, unknown>): ChatProbeOptions {
  const content = normalizeOptionalString(raw.content);
  if (!content) {
    throw new Error('Probe message content is required.');
  }

  const analysisProfiles = normalizeAnalysisProfiles(
    raw.analysisProfiles ?? raw.analysis_profiles ?? raw.proofMode ?? raw.proof_mode
  );
  const waitForResponse = normalizeBoolean(raw.waitForResponse ?? raw.wait_for_response, true);
  if (analysisProfiles.length > 0 && !waitForResponse) {
    throw new Error('Analysis profiles require waitForResponse=true.');
  }

  return {
    content,
    conversationId: normalizeOptionalString(raw.conversationId ?? raw.conversation_id),
    title: normalizeOptionalString(raw.title) ?? 'Diagnostics chat probe',
    waitForResponse,
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
    ),
    analysisProfiles
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

function summarizeProbeResponses(responseMessages: ChatMessage[]): ChatProbeResponseSummary {
  const assistantResponses = responseMessages.filter((message) => message.role === 'assistant');
  const systemResponses = responseMessages.filter((message) => message.role === 'system');
  const latestAssistant = assistantResponses.at(-1) ?? null;
  const latestAssistantContent = (latestAssistant?.content ?? '').trim();

  return {
    assistantResponseCount: assistantResponses.length,
    systemResponseCount: systemResponses.length,
    latestAssistantMessageId: latestAssistant?.id ?? null,
    latestAssistantSnippet: latestAssistantContent.slice(0, 240),
    latestAssistantLooksIncomplete: latestAssistantContent
      ? looksIncompleteAssistantReply(latestAssistantContent)
      : false
  };
}

function buildPrematureCompleteFinding(input: {
  responseMessages: ChatMessage[];
  beforeVerdict: ForensicsVerdict | null;
  afterVerdict: ForensicsVerdict | null;
  responseSummary: ChatProbeResponseSummary;
}): ChatProbeAnalysisFinding {
  const { responseSummary } = input;

  if (input.afterVerdict?.code === 'likely_premature_complete') {
    return {
      profile: 'premature_complete',
      status: 'proved',
      summary:
        'This probe reproduced a sender-side premature completion: Hermes marked the run complete, but the resulting assistant tail still looks incomplete.',
      evidence: responseSummary
    };
  }

  if (responseSummary.assistantResponseCount === 0) {
    return {
      profile: 'premature_complete',
      status: 'inconclusive',
      summary: 'The probe did not yield an assistant response, so it cannot prove or disprove premature completion.',
      evidence: responseSummary
    };
  }

  if (responseSummary.latestAssistantLooksIncomplete) {
    return {
      profile: 'premature_complete',
      status: 'inconclusive',
      summary:
        'The latest assistant reply still looks incomplete, but the broader conversation forensics did not reach a premature-complete verdict for this probe.',
      evidence: responseSummary
    };
  }

  return {
    profile: 'premature_complete',
    status: 'not_reproduced',
    summary:
      'This probe did not reproduce sender-side premature completion: the assistant produced a reply that does not look incomplete, and conversation forensics did not flag a premature complete.',
    evidence: responseSummary
  };
}

export function buildChatProbeReport(input: {
  responseMessages: ChatMessage[];
  beforeVerdict: ForensicsVerdict | null;
  afterVerdict: ForensicsVerdict | null;
  analysisProfiles: ChatProbeAnalysisProfile[];
}): ChatProbeReport {
  const responseSummary = summarizeProbeResponses(input.responseMessages);
  const findings = input.analysisProfiles.map((profile) => {
    switch (profile) {
      case 'premature_complete':
        return buildPrematureCompleteFinding({
          responseMessages: input.responseMessages,
          beforeVerdict: input.beforeVerdict,
          afterVerdict: input.afterVerdict,
          responseSummary
        });
    }
  });

  return {
    beforeVerdict: input.beforeVerdict,
    afterVerdict: input.afterVerdict,
    responseSummary,
    findings
  };
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