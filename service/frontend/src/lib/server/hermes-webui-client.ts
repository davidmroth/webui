import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { guessAttachmentContentTypeFromFileName } from '$lib/utils/attachment-content-type';

export type HermesAssistantAttachment =
  | {
      fileName: string;
      contentType?: string;
		text: string;
	}
  | {
      fileName: string;
      contentType?: string;
      base64Data: string;
    };

export interface HermesWebUIClientConfig {
  baseUrl: string;
  serviceToken: string;
  fetchImpl?: typeof fetch;
}

export interface HermesSenderTraceInput {
  traceId?: string | null;
  route?: string | null;
  senderBaseUrl?: string | null;
  senderTargetUrl?: string | null;
  senderHostname?: string | null;
  sessionPlatform?: string | null;
  sessionChatId?: string | null;
  attachmentCount?: number;
  attachmentNames?: string[];
  contentLength?: number;
}

export interface PostAssistantMessageInput {
  conversationId: string;
  userMessageId?: string | null;
  role?: 'assistant' | 'system';
  content?: string;
  attachments?: HermesAssistantAttachment[];
  senderTrace?: HermesSenderTraceInput | null;
  /**
   * Optional llama.cpp-style timings captured by the agent for the final LLM
   * call this turn. Forwarded to the WebUI as a top-level field; absent for
   * providers that don't emit timings.
   */
  timings?: Record<string, unknown> | null;
}

interface AssistantPostSuccess {
  ok: true;
  messageId: string;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function buildAssistantUrl(baseUrl: string, conversationId: string) {
  return `${normalizeBaseUrl(baseUrl)}/api/internal/hermes/conversations/${encodeURIComponent(conversationId)}/assistant`;
}

function buildErrorMessage(status: number, payload: unknown) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return `Hermes WebUI request failed (${status}): ${payload.error}`;
  }

  return `Hermes WebUI request failed with status ${status}.`;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export function createTextAttachment(
  fileName: string,
  text: string,
  contentType = 'text/plain; charset=utf-8'
): HermesAssistantAttachment {
  return {
    fileName,
    contentType,
    text
  };
}

export function guessContentType(fileName: string) {
  return guessAttachmentContentTypeFromFileName(fileName);
}

export async function createFileAttachmentFromPath(
  filePath: string,
  options: { fileName?: string; contentType?: string } = {}
): Promise<HermesAssistantAttachment> {
  const buffer = await readFile(filePath);
  const fileName = options.fileName?.trim() || basename(filePath);
  const contentType = options.contentType?.trim() || guessContentType(fileName);

  return {
    fileName,
    contentType,
    base64Data: buffer.toString('base64')
  };
}

export async function postAssistantMessage(
  config: HermesWebUIClientConfig,
  input: PostAssistantMessageInput
): Promise<AssistantPostSuccess> {
  const content = input.content?.trim() ?? '';
  const attachments = input.attachments ?? [];

  if (!input.conversationId.trim()) {
    throw new Error('conversationId is required.');
  }

  if (!content && attachments.length === 0) {
    throw new Error('Assistant content or at least one attachment is required.');
  }

  const response = await (config.fetchImpl ?? fetch)(
    buildAssistantUrl(config.baseUrl, input.conversationId),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.serviceToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...(input.role ? { role: input.role } : {}),
        content,
        attachments,
        ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
        ...(input.senderTrace ? { senderTrace: input.senderTrace } : {}),
        ...(input.timings ? { timings: input.timings } : {})
      })
    }
  );

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Hermes WebUI returned an unexpected response payload.');
  }

  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord.ok !== true || typeof payloadRecord.messageId !== 'string') {
    throw new Error('Hermes WebUI returned an unexpected response payload.');
  }

  return {
    ok: true,
    messageId: payloadRecord.messageId
  };
}