import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

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

export interface PostAssistantMessageInput {
  conversationId: string;
  content?: string;
  attachments?: HermesAssistantAttachment[];
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

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.go': 'text/x-go',
  '.java': 'text/x-java-source',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.py': 'text/x-python; charset=utf-8',
  '.rb': 'text/x-ruby; charset=utf-8',
  '.rs': 'text/rust; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ts': 'text/typescript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8'
};

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
  return CONTENT_TYPE_BY_EXTENSION[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
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
        content,
        attachments,
        ...(input.timings ? { timings: input.timings } : {})
      })
    }
  );

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  if (!payload || typeof payload !== 'object' || payload.ok !== true || typeof payload.messageId !== 'string') {
    throw new Error('Hermes WebUI returned an unexpected response payload.');
  }

  return payload as AssistantPostSuccess;
}