import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { execute, pool, query } from './db';
import { publishConversationStreamEvent } from './conversation-stream';
import { getConfig } from './env';
import { sendPushReplyNotification } from './push-notifications';
import { getObjectBuffer, uploadObject } from './storage';
import { getHermesWorkerHeartbeat } from './hermes-heartbeat';
import type { ChatMessage, ConversationSummary, MessageAttachment } from '$lib/types-legacy';

interface ConversationRow {
  id: string;
  title: string;
  updated_at: Date | string;
  processing_count?: number | string;
  queued_count?: number | string;
}

interface ConversationStateRow {
  id: string;
  created_at: Date | string;
  curr_node: string | null;
  title: string;
}

interface MessageRow {
  id: string;
  parent_id?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
  status: 'complete' | 'streaming' | 'error';
  source?: 'browser' | 'hermes';
  extra?: string | object | null;
  timings?: string | object | null;
  type?: 'text' | 'root';
  msg_timestamp?: number | string;
}

interface ConversationRecordRow {
  id: string;
  title: string;
  created_at: Date | string;
  updated_at: Date | string;
  last_modified: number | string;
  curr_node: string | null;
  forked_from_conversation_id: string | null;
}

interface ExportMessageRow extends MessageRow {
  source: 'browser' | 'hermes';
  reasoning_content?: string | null;
  tool_calls?: string | object | null;
  model?: string | null;
}

interface AttachmentCloneRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  storage_bucket: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

interface MessageNode {
  row: MessageRow;
  children: string[];
}

interface AttachmentRow {
  id: string;
  message_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
}

interface AttachmentUpload {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface EventRow {
  id: string;
  conversation_id: string;
  conversation_title: string;
  curr_node: string | null;
  last_modified: number | string;
  user_id: string;
  display_name: string;
  message_id: string;
  content: string;
  created_at: Date | string;
}

interface HermesQueueStatsRow {
  queued: number;
  processing: number;
  acked: number;
  stale_processing: number;
}

type ServerQueryFn = <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;

interface ResolveAssistantParentMessageIdDeps {
  queryFn?: ServerQueryFn;
  getConversationStateFn?: (conversationId: string) => Promise<ConversationStateRow | null>;
  ensureConversationRootMessageFn?: (conversationId: string) => Promise<string>;
}

interface UpdateAssistantMessageDeps {
  queryFn?: ServerQueryFn;
  executeFn?: typeof execute;
  updateConversationStateFn?: typeof updateConversationState;
  publishConversationStreamEventFn?: typeof publishConversationStreamEvent;
  notifyAssistantReplyCompletionFn?: typeof notifyAssistantReplyCompletion;
  getConversationStateFn?: (conversationId: string) => Promise<ConversationStateRow | null>;
}

interface HermesDeliveryTraceRow {
  id: string;
  sender_trace_id: string | null;
  conversation_id: string;
  receiver_message_id: string | null;
  route: string;
  sender_base_url: string | null;
  sender_target_url: string | null;
  sender_hostname: string | null;
  sender_session_platform: string | null;
  sender_session_chat_id: string | null;
  attachment_count: number | string;
  attachment_names: string | string[] | null;
  content_length: number | string;
  receiver_status: 'accepted' | 'rejected';
  error_text: string | null;
  created_at: Date | string;
}

export interface HermesDeliveryTrace {
  id: string;
  senderTraceId: string | null;
  conversationId: string;
  receiverMessageId: string | null;
  route: string;
  senderBaseUrl: string | null;
  senderTargetUrl: string | null;
  senderHostname: string | null;
  senderSessionPlatform: string | null;
  senderSessionChatId: string | null;
  attachmentCount: number;
  attachmentNames: string[];
  contentLength: number;
  receiverStatus: 'accepted' | 'rejected';
  errorText: string | null;
  createdAt: string;
}

export interface RecordHermesDeliveryTraceInput {
  senderTraceId?: string | null;
  conversationId: string;
  receiverMessageId?: string | null;
  route?: string | null;
  senderBaseUrl?: string | null;
  senderTargetUrl?: string | null;
  senderHostname?: string | null;
  senderSessionPlatform?: string | null;
  senderSessionChatId?: string | null;
  attachmentCount?: number;
  attachmentNames?: string[];
  contentLength?: number;
  receiverStatus?: 'accepted' | 'rejected';
  errorText?: string | null;
}

interface ConversationExportMessage {
  id: string;
  parentId: string | null;
  childIds: string[];
  role: 'user' | 'assistant' | 'system';
  source: 'browser' | 'hermes';
  type: 'text' | 'root';
  content: string;
  status: 'complete' | 'streaming' | 'error';
  createdAt: string;
  timestamp: number;
  reasoningContent: string | null;
  toolCalls: unknown;
  extra: unknown;
  timings: ChatMessage['timings'];
  model: string | null;
  attachments: MessageAttachment[];
}

export interface ConversationExportPayload {
  schemaVersion: 1;
  exportedAt: string;
  conversation: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    lastModified: number;
    currNode: string | null;
    forkedFromConversationId: string | null;
  };
  visibleMessageIds: string[];
  messages: ConversationExportMessage[];
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toUnixMilliseconds(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function normalizeMessageTimestamp(row: Pick<MessageRow, 'msg_timestamp' | 'created_at'>): number {
  const explicit = Number(row.msg_timestamp ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return toUnixMilliseconds(row.created_at);
}

function compareMessageRows(a: MessageRow, b: MessageRow): number {
  const timestampDiff = normalizeMessageTimestamp(a) - normalizeMessageTimestamp(b);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  const createdDiff = toUnixMilliseconds(a.created_at) - toUnixMilliseconds(b.created_at);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return a.id.localeCompare(b.id);
}

function deriveConversationTitle(content: string): string {
  const firstNonEmptyLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const normalized = (firstNonEmptyLine ?? content.trim().replace(/\s+/g, ' ') ?? '').trim();
  return (normalized || 'New conversation').slice(0, 200);
}

function normalizeConversationTitle(title: string): string {
  const normalized = title.trim();
  return (normalized || 'New conversation').slice(0, 200);
}

function parseMessageExtra(raw: string | object | null | undefined): Record<string, unknown> | null {
  if (raw == null) {
    return null;
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }

  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getRevisionGroupId(row: Pick<MessageRow, 'extra'>): string | null {
  const extra = parseMessageExtra(row.extra);
  const revisionGroupId = extra?.revisionGroupId;
  return typeof revisionGroupId === 'string' && revisionGroupId.trim().length > 0
    ? revisionGroupId.trim()
    : null;
}

function serializeMessageExtra(input: Record<string, unknown> | null | undefined): string | null {
  if (!input || Object.keys(input).length === 0) {
    return null;
  }

  try {
    return JSON.stringify(input);
  } catch {
    return null;
  }
}

function parseJsonColumn(raw: string | object | null | undefined): unknown {
  if (raw == null) {
    return null;
  }

  if (typeof raw === 'object') {
    return raw;
  }

  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function buildMessageTree(rows: MessageRow[]) {
  const nodes = new Map<string, MessageNode>();

  for (const row of rows) {
    nodes.set(row.id, { row, children: [] });
  }

  for (const row of rows) {
    if (!row.parent_id) {
      continue;
    }
    const parent = nodes.get(row.parent_id);
    if (!parent) {
      continue;
    }
    parent.children.push(row.id);
  }

  for (const node of nodes.values()) {
    node.children.sort((leftId, rightId) => {
      const left = nodes.get(leftId)?.row;
      const right = nodes.get(rightId)?.row;
      if (!left || !right) {
        return 0;
      }
      return compareMessageRows(left, right);
    });
  }

  return nodes;
}

function findLatestMessageId(nodes: Map<string, MessageNode>): string | null {
  const visibleNodes = Array.from(nodes.values())
    .map((node) => node.row)
    .filter((row) => row.type !== 'root')
    .sort(compareMessageRows);

  return visibleNodes.at(-1)?.id ?? null;
}

function resolveConversationLeafId(nodes: Map<string, MessageNode>, currNode: string | null): string | null {
  if (currNode && nodes.has(currNode)) {
    return currNode;
  }

  return findLatestMessageId(nodes) ?? Array.from(nodes.values()).find((node) => node.row.type === 'root')?.row.id ?? null;
}

function collectBranchRows(nodes: Map<string, MessageNode>, leafId: string | null): MessageRow[] {
  if (!leafId) {
    return [];
  }

  const path: MessageRow[] = [];
  let currentId: string | null = leafId;

  while (currentId) {
    const current: MessageRow | undefined = nodes.get(currentId)?.row;
    if (!current) {
      break;
    }
    path.push(current);
    currentId = current.parent_id ?? null;
  }

  path.reverse();
  return path;
}

function resolveVisibleConversationRows(
  nodes: Map<string, MessageNode>,
  currNode: string | null
): MessageRow[] {
  const activeRows = collectBranchRows(nodes, resolveConversationLeafId(nodes, currNode)).filter(
    (row) => row.type !== 'root'
  );
  if (activeRows.length > 0) {
    return activeRows;
  }

  // Some legacy conversations can carry malformed branch pointers after schema
  // upgrades. Fall back to the full non-root timeline instead of rendering an
  // empty history.
  return Array.from(nodes.values())
    .map((node) => node.row)
    .filter((row) => row.type !== 'root')
    .sort(compareMessageRows);
}

function findDeepestDescendant(nodes: Map<string, MessageNode>, startId: string): string {
  let currentId = startId;

  while (true) {
    const current = nodes.get(currentId);
    if (!current) {
      return currentId;
    }

    const visibleChildren = current.children.filter((childId) => nodes.get(childId)?.row.type !== 'root');
    if (visibleChildren.length === 0) {
      return currentId;
    }

    currentId = visibleChildren[visibleChildren.length - 1];
  }
}

function collectDescendantIds(nodes: Map<string, MessageNode>, startId: string): string[] {
  const descendants: string[] = [];
  const queue = [...(nodes.get(startId)?.children ?? [])];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) {
      continue;
    }
    descendants.push(currentId);
    queue.push(...(nodes.get(currentId)?.children ?? []));
  }

  return descendants;
}

function firstUserMessageInBranch(path: MessageRow[]): MessageRow | null {
  return path.find((row) => row.role === 'user' && row.type !== 'root') ?? null;
}

async function getConversationState(conversationId: string): Promise<ConversationStateRow | null> {
  const rows = await query<ConversationStateRow>(
    `SELECT id, created_at, curr_node, title
     FROM conversations
     WHERE id = :id
     LIMIT 1`,
    { id: conversationId }
  );

  return rows[0] ?? null;
}

async function ensureConversationRootMessage(conversationId: string): Promise<string> {
  const existingRootRows = await query<{ id: string }>(
    `SELECT id
     FROM messages
     WHERE conversation_id = :conversation_id
       AND type = 'root'
     ORDER BY created_at ASC
     LIMIT 1`,
    { conversation_id: conversationId }
  );

  if (existingRootRows[0]?.id) {
    return existingRootRows[0].id;
  }

  const conversation = await getConversationState(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const rootId = randomUUID();
  const timestamp = toUnixMilliseconds(conversation.created_at);
  await execute(
    `INSERT INTO messages (
       id,
       conversation_id,
       parent_id,
       role,
       content,
       source,
       status,
       created_at,
       type,
       msg_timestamp
     ) VALUES (
       :id,
       :conversation_id,
       NULL,
       'system',
       '',
       'hermes',
       'complete',
       :created_at,
       'root',
       :msg_timestamp
     )`,
    {
      id: rootId,
      conversation_id: conversationId,
      created_at: conversation.created_at,
      msg_timestamp: timestamp
    }
  );

  await execute(
    `UPDATE messages
     SET parent_id = :root_id
     WHERE conversation_id = :conversation_id
       AND id <> :root_id
       AND parent_id IS NULL`,
    { root_id: rootId, conversation_id: conversationId }
  );

  if (!conversation.curr_node) {
    await execute(
      `UPDATE conversations
       SET curr_node = :curr_node,
           last_modified = :last_modified,
           updated_at = UTC_TIMESTAMP()
       WHERE id = :id`,
      { curr_node: rootId, last_modified: Date.now(), id: conversationId }
    );
  }

  return rootId;
}

async function resolveConversationParentMessageId(
  conversationId: string,
  requestedParentId?: string | null
): Promise<string> {
  const rootId = await ensureConversationRootMessage(conversationId);

  if (requestedParentId) {
    const rows = await query<{ id: string }>(
      `SELECT id
       FROM messages
       WHERE id = :id AND conversation_id = :conversation_id
       LIMIT 1`,
      { id: requestedParentId, conversation_id: conversationId }
    );
    if (rows[0]?.id) {
      return rows[0].id;
    }
  }

  const conversation = await getConversationState(conversationId);
  if (conversation?.curr_node) {
    return conversation.curr_node;
  }

  return rootId;
}

export async function resolveAssistantParentMessageId(
  conversationId: string,
  preferredUserMessageId?: string | null,
  deps: ResolveAssistantParentMessageIdDeps = {}
): Promise<string> {
  const queryFn = deps.queryFn ?? query;
  const getConversationStateFn = deps.getConversationStateFn ?? getConversationState;
  const ensureConversationRootMessageFn =
    deps.ensureConversationRootMessageFn ?? ensureConversationRootMessage;

  if (preferredUserMessageId) {
    const rows = await queryFn<{ id: string }>(
      `SELECT id
       FROM messages
       WHERE id = :id
         AND conversation_id = :conversation_id
         AND role = 'user'
       LIMIT 1`,
      { id: preferredUserMessageId, conversation_id: conversationId }
    );
    if (rows[0]?.id) {
      return rows[0].id;
    }
  }

  const conversation = await getConversationStateFn(conversationId);
  if (conversation?.curr_node) {
    const currentRows = await queryFn<{ id: string; type?: 'text' | 'root' }>(
      `SELECT id, type
       FROM messages
       WHERE id = :id
         AND conversation_id = :conversation_id
         AND role = 'user'
       LIMIT 1`,
      { id: conversation.curr_node, conversation_id: conversationId }
    );
    if (currentRows[0]?.id && currentRows[0].type !== 'root') {
      return currentRows[0].id;
    }
  }

  const processingRows = await queryFn<{ message_id: string }>(
    `SELECT hermes_events.message_id
     FROM hermes_events
     INNER JOIN messages ON messages.id = hermes_events.message_id
     WHERE hermes_events.conversation_id = :conversation_id
       AND hermes_events.status = 'processing'
       AND messages.role = 'user'
     ORDER BY hermes_events.claimed_at DESC, hermes_events.created_at DESC
     LIMIT 1`,
    { conversation_id: conversationId }
  );
  if (processingRows[0]?.message_id) {
    return processingRows[0].message_id;
  }

  const latestUserRows = await queryFn<{ id: string }>(
    `SELECT id
     FROM messages
     WHERE conversation_id = :conversation_id
       AND role = 'user'
     ORDER BY msg_timestamp DESC, created_at DESC
     LIMIT 1`,
    { conversation_id: conversationId }
  );
  if (latestUserRows[0]?.id) {
    return latestUserRows[0].id;
  }

  return ensureConversationRootMessageFn(conversationId);
}

async function updateConversationState(
  conversationId: string,
  options: { currNode?: string | null; title?: string } = {}
) {
  const assignments = ['updated_at = UTC_TIMESTAMP()', 'last_modified = :last_modified'];
  const params: Record<string, unknown> = {
    id: conversationId,
    last_modified: Date.now()
  };

  if ('currNode' in options) {
    assignments.push('curr_node = :curr_node');
    params.curr_node = options.currNode ?? null;
  }

  if (typeof options.title === 'string') {
    assignments.push('title = :title');
    params.title = options.title;
  }

  await execute(
    `UPDATE conversations
     SET ${assignments.join(', ')}
     WHERE id = :id`,
    params
  );
}

async function cloneAttachmentsForMessage(sourceMessageId: string, destinationMessageId: string) {
  const rows = await query<AttachmentCloneRow>(
    `SELECT id, user_id, conversation_id, storage_bucket, storage_key, file_name, content_type, size_bytes
     FROM attachments
     WHERE message_id = :message_id
     ORDER BY created_at ASC`,
    { message_id: sourceMessageId }
  );

  for (const row of rows) {
    await execute(
      `INSERT INTO attachments (
         id,
         user_id,
         conversation_id,
         message_id,
         storage_bucket,
         storage_key,
         file_name,
         content_type,
         size_bytes
       ) VALUES (
         :id,
         :user_id,
         :conversation_id,
         :message_id,
         :storage_bucket,
         :storage_key,
         :file_name,
         :content_type,
         :size_bytes
       )`,
      {
        id: randomUUID(),
        user_id: row.user_id,
        conversation_id: row.conversation_id,
        message_id: destinationMessageId,
        storage_bucket: row.storage_bucket,
        storage_key: row.storage_key,
        file_name: row.file_name,
        content_type: row.content_type,
        size_bytes: row.size_bytes
      }
    );
  }
}

async function markMessageRevisionGroup(messageId: string, revisionGroupId: string) {
  await execute(
    `UPDATE messages
     SET extra = JSON_SET(COALESCE(extra, JSON_OBJECT()), '$.revisionGroupId', :revision_group_id)
     WHERE id = :id`,
    { id: messageId, revision_group_id: revisionGroupId }
  );
}

async function getProcessingEventRevisionGroupId(conversationId: string): Promise<string | null> {
  const rows = await query<{ payload: string | object | null }>(
    `SELECT payload
     FROM hermes_events
     WHERE conversation_id = :conversation_id
       AND status = 'processing'
     ORDER BY claimed_at DESC, created_at DESC
     LIMIT 1`,
    { conversation_id: conversationId }
  );

  const payload = parseMessageExtra(rows[0]?.payload ?? null);
  const revisionGroupId = payload?.assistant_revision_group_id;
  return typeof revisionGroupId === 'string' && revisionGroupId.trim().length > 0
    ? revisionGroupId.trim()
    : null;
}

function parseAttachmentNames(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function mapHermesDeliveryTrace(row: HermesDeliveryTraceRow): HermesDeliveryTrace {
  return {
    id: row.id,
    senderTraceId: row.sender_trace_id,
    conversationId: row.conversation_id,
    receiverMessageId: row.receiver_message_id,
    route: row.route,
    senderBaseUrl: row.sender_base_url,
    senderTargetUrl: row.sender_target_url,
    senderHostname: row.sender_hostname,
    senderSessionPlatform: row.sender_session_platform,
    senderSessionChatId: row.sender_session_chat_id,
    attachmentCount: Number(row.attachment_count ?? 0),
    attachmentNames: parseAttachmentNames(row.attachment_names),
    contentLength: Number(row.content_length ?? 0),
    receiverStatus: row.receiver_status,
    errorText: row.error_text,
    createdAt: toIsoString(row.created_at)
  };
}

function mapAttachment(row: AttachmentRow): MessageAttachment {
  const isHtml = isHtmlContentType(row.content_type);

  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    downloadUrl: `/api/attachments/${row.id}/download`,
    previewUrl: isHtml ? `/api/attachments/${row.id}/preview` : undefined,
    isImage: row.content_type.startsWith('image/'),
    isHtml
  };
}

function isHtmlContentType(contentType: string): boolean {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() === 'text/html';
}

async function listAttachmentsByMessageIds(messageIds: string[]) {
  if (messageIds.length === 0) {
    return new Map<string, MessageAttachment[]>();
  }

  const placeholders = messageIds.map((_, index) => `:message_id_${index}`).join(', ');
  const params: Record<string, string> = {};
  messageIds.forEach((messageId, index) => {
    params[`message_id_${index}`] = messageId;
  });

  const rows = await query<AttachmentRow>(
    `SELECT id, message_id, file_name, content_type, size_bytes, storage_key
     FROM attachments
     WHERE message_id IN (${placeholders})
     ORDER BY created_at ASC`,
    params
  );

  const grouped = new Map<string, MessageAttachment[]>();
  for (const row of rows) {
    const existing = grouped.get(row.message_id) ?? [];
    existing.push(mapAttachment(row));
    grouped.set(row.message_id, existing);
  }
  return grouped;
}

async function getConversationOwnerId(conversationId: string): Promise<string | null> {
  const rows = await query<{ user_id: string }>(
    'SELECT user_id FROM conversations WHERE id = :id LIMIT 1',
    { id: conversationId }
  );
  return rows[0]?.user_id ?? null;
}

async function getConversationRecordForUser(
  userId: string,
  conversationId: string
): Promise<ConversationRecordRow | null> {
  const rows = await query<ConversationRecordRow>(
    `SELECT id,
            title,
            created_at,
            updated_at,
            last_modified,
            curr_node,
            forked_from_conversation_id
     FROM conversations
     WHERE id = :conversation_id
       AND user_id = :user_id
     LIMIT 1`,
    { conversation_id: conversationId, user_id: userId }
  );

  return rows[0] ?? null;
}

async function notifyAssistantReplyCompletion(options: {
  conversationId: string;
  messageId: string;
  content: string;
}) {
  try {
    const ownerId = await getConversationOwnerId(options.conversationId);
    if (!ownerId) {
      return;
    }

    const conversation = await getConversationRecordForUser(ownerId, options.conversationId);
    await sendPushReplyNotification({
      userId: ownerId,
      conversationId: options.conversationId,
      conversationTitle: conversation?.title ?? 'New chat',
      messageId: options.messageId,
      content: options.content
    });
  } catch (error) {
    console.error('Failed to queue assistant push notification', {
      conversationId: options.conversationId,
      messageId: options.messageId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function saveAttachmentsForMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  files: AttachmentUpload[]
) {
  const config = getConfig();
  const stored: MessageAttachment[] = [];

  for (const file of files) {
    if (!file || file.size === 0) {
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'application/octet-stream';
    const fileName = file.name || 'attachment';
    const uploaded = await uploadObject({
      conversationId,
      messageId,
      fileName,
      contentType,
      buffer
    });
    const attachmentId = randomUUID();
    const isHtml = isHtmlContentType(contentType);
    await execute(
      `INSERT INTO attachments (
         id, user_id, conversation_id, message_id, storage_bucket, storage_key, file_name, content_type, size_bytes
       ) VALUES (
         :id, :user_id, :conversation_id, :message_id, :storage_bucket, :storage_key, :file_name, :content_type, :size_bytes
       )`,
      {
        id: attachmentId,
        user_id: userId,
        conversation_id: conversationId,
        message_id: messageId,
        storage_bucket: config.objectStorageBucket,
        storage_key: uploaded.key,
        file_name: fileName,
        content_type: contentType,
        size_bytes: uploaded.sizeBytes
      }
    );
    stored.push({
      id: attachmentId,
      fileName,
      contentType,
      sizeBytes: uploaded.sizeBytes,
      downloadUrl: `/api/attachments/${attachmentId}/download`,
      previewUrl: isHtml ? `/api/attachments/${attachmentId}/preview` : undefined,
      isImage: contentType.startsWith('image/'),
      isHtml
    });
  }

  return stored;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const rows = await query<ConversationRow>(
    `SELECT conversations.id,
            conversations.title,
            conversations.updated_at,
            COALESCE(SUM(CASE WHEN hermes_events.status = 'processing' THEN 1 ELSE 0 END), 0) AS processing_count,
            COALESCE(SUM(CASE WHEN hermes_events.status = 'queued' THEN 1 ELSE 0 END), 0) AS queued_count
     FROM conversations
     LEFT JOIN hermes_events ON hermes_events.conversation_id = conversations.id
     WHERE conversations.user_id = :user_id
     GROUP BY conversations.id, conversations.title, conversations.updated_at
     ORDER BY conversations.updated_at DESC`,
    { user_id: userId }
  );

  const workerHeartbeat = getHermesWorkerHeartbeat();
  const workerOnline = workerHeartbeat.isOnline;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: toIsoString(row.updated_at),
    assistantBusy:
      Number(row.processing_count ?? 0) > 0 || (Number(row.queued_count ?? 0) > 0 && workerOnline),
    assistantStalled: Number(row.queued_count ?? 0) > 0 && !workerOnline
  }));
}

export async function createConversation(userId: string, title = 'New conversation') {
  const id = randomUUID();
  const rootId = randomUUID();
  const now = Date.now();

  await execute(
    `INSERT INTO conversations (id, user_id, title, curr_node, last_modified)
     VALUES (:id, :user_id, :title, :curr_node, :last_modified)`,
    { id, user_id: userId, title, curr_node: rootId, last_modified: now }
  );
  await execute(
    `INSERT INTO messages (
       id,
       conversation_id,
       parent_id,
       role,
       content,
       source,
       status,
       type,
       msg_timestamp
     ) VALUES (
       :id,
       :conversation_id,
       NULL,
       'system',
       '',
       'hermes',
       'complete',
       'root',
       :msg_timestamp
     )`,
    { id: rootId, conversation_id: id, msg_timestamp: now }
  );
  return id;
}

export async function renameConversationForUser(
  userId: string,
  conversationId: string,
  title: string
): Promise<boolean> {
  const conversation = await getConversationRecordForUser(userId, conversationId);
  if (!conversation) {
    return false;
  }

  await updateConversationState(conversationId, { title: normalizeConversationTitle(title) });
  return true;
}

export async function deleteConversationForUser(
  userId: string,
  conversationId: string
): Promise<boolean> {
  const conversation = await getConversationRecordForUser(userId, conversationId);
  if (!conversation) {
    return false;
  }

  await execute(
    `DELETE attachments
     FROM attachments
     INNER JOIN conversations ON conversations.id = attachments.conversation_id
     WHERE attachments.conversation_id = :conversation_id
       AND conversations.user_id = :user_id`,
    { conversation_id: conversationId, user_id: userId }
  );

  await execute(
    `DELETE FROM conversations
     WHERE id = :conversation_id
       AND user_id = :user_id`,
    { conversation_id: conversationId, user_id: userId }
  );

  return true;
}

export async function exportConversationForUser(
  userId: string,
  conversationId: string
): Promise<ConversationExportPayload | null> {
  const conversation = await getConversationRecordForUser(userId, conversationId);
  if (!conversation) {
    return null;
  }

  const rows = await query<ExportMessageRow>(
    `SELECT messages.id,
            messages.parent_id,
            messages.role,
            messages.content,
            messages.created_at,
            messages.status,
            messages.extra,
            messages.timings,
            messages.type,
            messages.msg_timestamp,
            messages.source,
            messages.reasoning_content,
            messages.tool_calls,
            messages.model
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
     ORDER BY messages.msg_timestamp ASC, messages.created_at ASC, messages.id ASC`,
    { conversation_id: conversationId, user_id: userId }
  );

  const messageTree = buildMessageTree(rows);
  const nonRootRows = rows.filter((row) => row.type !== 'root');
  const nonRootIds = new Set(nonRootRows.map((row) => row.id));
  const attachmentsByMessageId = await listAttachmentsByMessageIds(nonRootRows.map((row) => row.id));
  const visibleMessageIds = resolveVisibleConversationRows(messageTree, conversation.curr_node)
    .filter((row) => row.type !== 'root')
    .map((row) => row.id);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: toIsoString(conversation.created_at),
      updatedAt: toIsoString(conversation.updated_at),
      lastModified: Number(conversation.last_modified ?? 0),
      currNode:
        conversation.curr_node && nonRootIds.has(conversation.curr_node)
          ? conversation.curr_node
          : null,
      forkedFromConversationId: conversation.forked_from_conversation_id ?? null
    },
    visibleMessageIds,
    messages: nonRootRows.map((row) => ({
      id: row.id,
      parentId: row.parent_id && nonRootIds.has(row.parent_id) ? row.parent_id : null,
      childIds: (messageTree.get(row.id)?.children ?? []).filter((childId) => nonRootIds.has(childId)),
      role: row.role,
      source: row.source,
      type: row.type ?? 'text',
      content: row.content,
      status: row.status,
      createdAt: toIsoString(row.created_at),
      timestamp: normalizeMessageTimestamp(row),
      reasoningContent: row.reasoning_content ?? null,
      toolCalls: parseJsonColumn(row.tool_calls),
      extra: parseJsonColumn(row.extra),
      timings: parseTimings(row.timings),
      model: row.model ?? null,
      attachments: attachmentsByMessageId.get(row.id) ?? []
    }))
  };
}

export async function exportConversationForHermes(
  conversationId: string
): Promise<ConversationExportPayload | null> {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    return null;
  }

  return exportConversationForUser(ownerId, conversationId);
}

export async function listMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
  const conversationRows = await query<ConversationStateRow>(
    `SELECT conversations.id, conversations.created_at, conversations.curr_node, conversations.title
     FROM conversations
     WHERE conversations.id = :conversation_id
       AND conversations.user_id = :user_id
     LIMIT 1`,
    { conversation_id: conversationId, user_id: userId }
  );

  const conversation = conversationRows[0];
  if (!conversation) {
    return [];
  }

  const rows = await query<MessageRow>(
    `SELECT messages.id,
            messages.parent_id,
            messages.role,
            messages.content,
            messages.created_at,
            messages.updated_at,
            messages.status,
            messages.extra,
            messages.timings,
            messages.type,
            messages.msg_timestamp
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id AND conversations.user_id = :user_id
     ORDER BY messages.msg_timestamp ASC, messages.created_at ASC, messages.id ASC`,
    { conversation_id: conversationId, user_id: userId }
  );

  const messageTree = buildMessageTree(rows);
  const activeRows = resolveVisibleConversationRows(messageTree, conversation.curr_node);
  const attachmentsByMessageId = await listAttachmentsByMessageIds(activeRows.map((row) => row.id));

  return activeRows.map((row) => {
    const revisionGroupId = getRevisionGroupId(row);
    const siblingIds = row.parent_id && revisionGroupId
      ? (messageTree.get(row.parent_id)?.children ?? []).filter((childId) => {
          const siblingRow = messageTree.get(childId)?.row;
          return Boolean(
            siblingRow &&
              siblingRow.type !== 'root' &&
              siblingRow.role === row.role &&
              getRevisionGroupId(siblingRow) === revisionGroupId
          );
        })
      : [row.id];

    return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    status: row.status,
    attachments: attachmentsByMessageId.get(row.id) ?? [],
    timings: parseTimings(row.timings),
    revisionSiblingIds: siblingIds,
    revisionIndex: Math.max(0, siblingIds.indexOf(row.id)),
    revisionTotal: siblingIds.length
  };
  });
}

/**
 * Normalize the ``messages.timings`` JSON column into a plain object. MySQL's
 * mysql2 driver may return it as a parsed object (when the JSON column type is
 * recognized) or as a string (older drivers / aggregated queries). Returns
 * ``null`` for missing / invalid values rather than throwing — the UI treats
 * absent timings as "hide the stats panel".
 */
function parseTimings(raw: string | object | null | undefined) {
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'object') {
    return raw as ChatMessage['timings'];
  }
  if (typeof raw === 'string') {
    if (raw.trim() === '') {
      return null;
    }
    try {
      return JSON.parse(raw) as ChatMessage['timings'];
    } catch {
      return null;
    }
  }
  return null;
}

export async function isConversationBusy(userId: string, conversationId: string): Promise<boolean> {
  const rows = await query<{ queued: number | string; processing: number | string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN hermes_events.status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
       COALESCE(SUM(CASE WHEN hermes_events.status = 'processing' THEN 1 ELSE 0 END), 0) AS processing
     FROM hermes_events
     INNER JOIN conversations ON conversations.id = hermes_events.conversation_id
     WHERE hermes_events.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
       AND hermes_events.status IN ('queued', 'processing')`,
    { conversation_id: conversationId, user_id: userId }
  );

  const queued = Number(rows[0]?.queued ?? 0);
  const processing = Number(rows[0]?.processing ?? 0);
  if (processing > 0) {
    return true;
  }

  if (queued > 0) {
    return getHermesWorkerHeartbeat().isOnline;
  }

  // Also treat any in-progress streaming assistant message as busy.
  const streamingRows = await query<{ pending: number | string }>(
    `SELECT COUNT(*) AS pending
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
       AND messages.status = 'streaming'`,
    { conversation_id: conversationId, user_id: userId }
  );
  return Number(streamingRows[0]?.pending ?? 0) > 0;
}

/**
 * Locate the streaming assistant message id (if any) for a conversation owned
 * by the user. Used by the SSE endpoint and the Stop button.
 */
export async function findActiveAssistantMessage(
  userId: string,
  conversationId: string
): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT messages.id
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
       AND messages.role = 'assistant'
       AND messages.status = 'streaming'
     ORDER BY messages.created_at DESC
     LIMIT 1`,
    { conversation_id: conversationId, user_id: userId }
  );
  return rows[0]?.id ?? null;
}

export async function findLatestAssistantMessage(
  userId: string,
  conversationId: string
): Promise<{ id: string; status: 'complete' | 'streaming' | 'error' } | null> {
  const conversationRows = await query<ConversationStateRow>(
    `SELECT conversations.id, conversations.created_at, conversations.curr_node, conversations.title
     FROM conversations
     WHERE conversations.id = :conversation_id
       AND conversations.user_id = :user_id
     LIMIT 1`,
    { conversation_id: conversationId, user_id: userId }
  );

  const conversation = conversationRows[0];
  if (!conversation) {
    return null;
  }

  const rows = await query<MessageRow>(
    `SELECT messages.id,
            messages.parent_id,
            messages.role,
            messages.content,
            messages.created_at,
            messages.status,
            messages.type,
            messages.msg_timestamp
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
     ORDER BY messages.msg_timestamp ASC, messages.created_at ASC, messages.id ASC`,
    { conversation_id: conversationId, user_id: userId }
  );

  const messageTree = buildMessageTree(rows);
  const activeRows = resolveVisibleConversationRows(messageTree, conversation.curr_node);
  const assistantRows = activeRows.filter(
    (row): row is MessageRow & { status: 'complete' | 'streaming' | 'error' } => row.role === 'assistant'
  );

  const latest = assistantRows.at(-1);
  return latest ? { id: latest.id, status: latest.status } : null;
}

/**
 * Get the message status + accumulated content for streaming. Used to decide
 * when to close the SSE stream.
 */
export async function getMessageStatus(messageId: string) {
  const rows = await query<{ id: string; status: 'complete' | 'streaming' | 'error'; content: string }>(
    'SELECT id, status, content FROM messages WHERE id = :id LIMIT 1',
    { id: messageId }
  );
  return rows[0] ?? null;
}

/**
 * Append a streaming chunk for an assistant message. The (message_id, seq)
 * unique key prevents duplicate writes if the producer retries.
 */
export async function appendAssistantChunk(
  conversationId: string,
  messageId: string,
  seq: number,
  delta: string
) {
  await execute(
    `INSERT IGNORE INTO hermes_message_chunks (message_id, seq, delta)
     VALUES (:message_id, :seq, :delta)`,
    { message_id: messageId, seq, delta }
  );
  publishConversationStreamEvent({
    type: 'delta',
    conversationId,
    messageId,
    seq,
    delta
  });
}

/**
 * Read all chunks for a message above a given sequence number. Used by SSE.
 */
export async function listAssistantChunks(messageId: string, afterSeq: number) {
  return query<{ seq: number; delta: string }>(
    `SELECT seq, delta
     FROM hermes_message_chunks
     WHERE message_id = :message_id AND seq > :after_seq
     ORDER BY seq ASC`,
    { message_id: messageId, after_seq: afterSeq }
  );
}

/**
 * Open a new streaming assistant message. Seeds an empty row that chunks will
 * be appended to. Returns the message id.
 */
export async function openStreamingAssistantMessage(
  conversationId: string,
  options: { userMessageId?: string | null } = {}
): Promise<string> {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const parentMessageId = await resolveAssistantParentMessageId(
    conversationId,
    options.userMessageId
  );
  const assistantRevisionGroupId = await getProcessingEventRevisionGroupId(conversationId);
  const messageId = randomUUID();
  const messageTimestamp = Date.now();
  await execute(
    `INSERT INTO messages (id, conversation_id, parent_id, role, content, source, status, extra, type, msg_timestamp)
     VALUES (:id, :conversation_id, :parent_id, 'assistant', '', 'hermes', 'streaming', :extra, 'text', :msg_timestamp)`,
    {
      id: messageId,
      conversation_id: conversationId,
      parent_id: parentMessageId,
      extra: serializeMessageExtra(
        assistantRevisionGroupId ? { revisionGroupId: assistantRevisionGroupId } : null
      ),
      msg_timestamp: messageTimestamp
    }
  );
  await updateConversationState(conversationId, { currNode: messageId });
  publishConversationStreamEvent({ type: 'message', conversationId, messageId });
  return messageId;
}

/**
 * Finalize a streaming assistant message by writing the final assembled
 * content and marking it complete.
 */
export async function finalizeStreamingAssistantMessage(
  conversationId: string,
  messageId: string,
  finalContent: string,
  options: { timings?: unknown } = {}
) {
  const timingsJson = serializeTimingsForStorage(options.timings);
  if (timingsJson === null) {
    await execute(
      `UPDATE messages
       SET content = :content, status = 'complete'
       WHERE id = :id`,
      { id: messageId, content: finalContent }
    );
  } else {
    await execute(
      `UPDATE messages
       SET content = :content, status = 'complete', timings = :timings
       WHERE id = :id`,
      { id: messageId, content: finalContent, timings: timingsJson }
    );
  }
  await execute(
    `UPDATE conversations c
     JOIN messages m ON m.conversation_id = c.id
     SET c.updated_at = UTC_TIMESTAMP(),
         c.last_modified = :last_modified,
         c.curr_node = :curr_node
     WHERE m.id = :id`,
    { id: messageId, last_modified: Date.now(), curr_node: messageId }
  );
  publishConversationStreamEvent({
    type: 'done',
    conversationId,
    messageId,
    status: 'complete'
  });
  void notifyAssistantReplyCompletion({
    conversationId,
    messageId,
    content: finalContent
  });
}

async function resolveUpdatableAssistantMessage(
  conversationId: string,
  messageId: string,
  deps: UpdateAssistantMessageDeps = {}
): Promise<void> {
  const queryFn = deps.queryFn ?? query;
  const getConversationStateFn = deps.getConversationStateFn ?? getConversationState;
  const conversation = await getConversationStateFn(conversationId);

  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const rows = await queryFn<MessageRow>(
    `SELECT messages.id,
            messages.parent_id,
            messages.role,
            messages.content,
            messages.created_at,
            messages.updated_at,
            messages.status,
            messages.type,
            messages.source,
            messages.msg_timestamp
     FROM messages
     WHERE messages.conversation_id = :conversation_id
       AND messages.source = 'hermes'
       AND messages.role IN ('assistant', 'system')
     ORDER BY messages.msg_timestamp ASC, messages.created_at ASC, messages.id ASC`,
    { conversation_id: conversationId }
  );

  const target = rows.find((row) => row.id === messageId);
  if (!target) {
    throw new Error(`Assistant message not found for update: ${messageId}`);
  }

  if (target.status === 'streaming') {
    return;
  }

  const messageTree = buildMessageTree(rows);
  const latestVisible = resolveVisibleConversationRows(messageTree, conversation.curr_node).at(-1);
  if (!latestVisible || latestVisible.id !== messageId) {
    throw new Error(`Rejected stale assistant update target: ${messageId}`);
  }
}

export async function updateAssistantMessage(
  conversationId: string,
  messageId: string,
  content: string,
  options: { timings?: unknown } = {},
  deps: UpdateAssistantMessageDeps = {}
) {
  const executeFn = deps.executeFn ?? execute;
  const updateConversationStateFn = deps.updateConversationStateFn ?? updateConversationState;
  const publishConversationStreamEventFn =
    deps.publishConversationStreamEventFn ?? publishConversationStreamEvent;
  const notifyAssistantReplyCompletionFn =
    deps.notifyAssistantReplyCompletionFn ?? notifyAssistantReplyCompletion;

  await resolveUpdatableAssistantMessage(conversationId, messageId, deps);

  const timingsJson = serializeTimingsForStorage(options.timings);
  if (timingsJson === null) {
    await executeFn(
      `UPDATE messages
       SET content = :content, status = 'complete'
       WHERE id = :id AND conversation_id = :conversation_id AND source = 'hermes' AND role IN ('assistant', 'system')`,
      { id: messageId, conversation_id: conversationId, content }
    );
  } else {
    await executeFn(
      `UPDATE messages
       SET content = :content, status = 'complete', timings = :timings
       WHERE id = :id AND conversation_id = :conversation_id AND source = 'hermes' AND role IN ('assistant', 'system')`,
      { id: messageId, conversation_id: conversationId, content, timings: timingsJson }
    );
  }

  await updateConversationStateFn(conversationId, { currNode: messageId });
  publishConversationStreamEventFn({
    type: 'done',
    conversationId,
    messageId,
    status: 'complete'
  });
  void notifyAssistantReplyCompletionFn({
    conversationId,
    messageId,
    content
  });
}

/**
 * Cancel the in-flight assistant turn for a conversation: marks any queued or
 * processing events cancelled and finalizes any streaming assistant message
 * with whatever has been received so far. Returns true if any rows changed.
 */
export async function cancelActiveAssistantTurn(
  userId: string,
  conversationId: string
): Promise<boolean> {
  const eventResult = await execute(
    `UPDATE hermes_events
     INNER JOIN conversations ON conversations.id = hermes_events.conversation_id
     SET hermes_events.status = 'cancelled', hermes_events.cancelled_at = UTC_TIMESTAMP()
     WHERE hermes_events.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
       AND hermes_events.status IN ('queued', 'processing')`,
    { conversation_id: conversationId, user_id: userId }
  );

  const streamingId = await findActiveAssistantMessage(userId, conversationId);
  if (streamingId) {
    const chunks = await listAssistantChunks(streamingId, -1);
    const assembled = chunks.map((row) => row.delta).join('');
    await execute(
      `UPDATE messages SET status = 'complete', content = :content WHERE id = :id`,
      { id: streamingId, content: assembled }
    );
    publishConversationStreamEvent({
      type: 'done',
      conversationId,
      messageId: streamingId,
      status: 'complete'
    });
  }

  // mysql2 OkPacket has affectedRows; the helper returns its result. We treat
  // either a cancelled event OR a closed streaming message as a success signal.
  const affected =
    typeof eventResult === 'object' && eventResult !== null && 'affectedRows' in eventResult
      ? Number((eventResult as { affectedRows?: number }).affectedRows ?? 0)
      : 0;
  return affected > 0 || streamingId !== null;
}

export async function enqueueUserMessage(
  userId: string,
  conversationId: string,
  content: string,
  files: File[] = [],
  options: { parentMessageId?: string | null } = {}
) {
  const messageId = randomUUID();
  const eventId = randomUUID();
  const parentMessageId = await resolveConversationParentMessageId(
    conversationId,
    options.parentMessageId
  );
  const rootId = await ensureConversationRootMessage(conversationId);
  const nextTitle = parentMessageId === rootId ? deriveConversationTitle(content) : undefined;
  const messageTimestamp = Date.now();
  await execute(
    `INSERT INTO messages (id, conversation_id, parent_id, role, content, source, status, type, msg_timestamp)
     VALUES (:id, :conversation_id, :parent_id, 'user', :content, 'browser', 'complete', 'text', :msg_timestamp)`,
    {
      id: messageId,
      conversation_id: conversationId,
      parent_id: parentMessageId,
      content,
      msg_timestamp: messageTimestamp
    }
  );
  await saveAttachmentsForMessage(userId, conversationId, messageId, files);
  await execute(
    `INSERT INTO hermes_events (id, user_id, conversation_id, message_id, event_type, status, payload)
     VALUES (:id, :user_id, :conversation_id, :message_id, 'message', 'queued', :payload)`,
    {
      id: eventId,
      user_id: userId,
      conversation_id: conversationId,
      message_id: messageId,
      payload: JSON.stringify({ text: content })
    }
  );
  await updateConversationState(conversationId, {
    currNode: messageId,
    ...(nextTitle ? { title: nextTitle } : {})
  });

  return { messageId, eventId };
}

export async function dequeueHermesEvent() {
  const leaseSeconds = Math.max(30, getConfig().hermesEventLeaseSeconds);
  const connection = (await pool.getConnection()) as any;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT hermes_events.id, hermes_events.conversation_id, conversations.title AS conversation_title,
              conversations.curr_node, conversations.last_modified,
              users.user_id, users.display_name, hermes_events.message_id,
              messages.content, hermes_events.created_at
       FROM hermes_events
       INNER JOIN conversations ON conversations.id = hermes_events.conversation_id
       INNER JOIN users ON users.id = hermes_events.user_id
       INNER JOIN messages ON messages.id = hermes_events.message_id
       WHERE hermes_events.status = 'queued'
          OR (
            hermes_events.status = 'processing'
            AND hermes_events.claimed_at IS NOT NULL
            AND hermes_events.claimed_at < UTC_TIMESTAMP() - INTERVAL ? SECOND
          )
       ORDER BY
         CASE WHEN hermes_events.status = 'queued' THEN 0 ELSE 1 END,
         COALESCE(hermes_events.claimed_at, hermes_events.created_at) ASC,
         hermes_events.created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [leaseSeconds]
    );

     const row = (rows as EventRow[])[0];
    if (!row) {
      await connection.commit();
      return null;
    }

    await connection.execute(
      `UPDATE hermes_events
       SET status = 'processing', claimed_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [row.id]
    );
    await connection.commit();

    const attachments = await query<AttachmentRow>(
      `SELECT id, message_id, file_name, content_type, size_bytes, storage_key
       FROM attachments
       WHERE message_id = :message_id
       ORDER BY created_at ASC`,
      { message_id: row.message_id }
    );

    return {
      eventId: row.id,
      conversationId: row.conversation_id,
      conversationName: row.conversation_title,
      sessionPlatform: 'webui-conversation',
      sessionChatId: row.conversation_id,
      contextUrl: `/api/internal/hermes/conversations/${row.conversation_id}/context`,
      contextVersion: {
        currNode: row.curr_node,
        lastModified: Number(row.last_modified ?? 0)
      },
      userId: row.user_id,
      userName: row.display_name,
      messageId: row.message_id,
      text: row.content,
      createdAt: toIsoString(row.created_at),
      attachments: attachments.map((attachment) => ({
        attachmentId: attachment.id,
        fileName: attachment.file_name,
        contentType: attachment.content_type,
        sizeBytes: attachment.size_bytes,
        internalDownloadUrl: `/api/internal/hermes/attachments/${attachment.id}/download`
      }))
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function ackHermesEvent(eventId: string) {
  await execute(
    `UPDATE hermes_events
     SET status = 'acked', acked_at = UTC_TIMESTAMP()
     WHERE id = :id`,
    { id: eventId }
  );
}

export async function getHermesQueueStats() {
  const leaseSeconds = Math.max(30, getConfig().hermesEventLeaseSeconds);
  const rows = await query<HermesQueueStatsRow>(
    `SELECT
       SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN status = 'acked' THEN 1 ELSE 0 END) AS acked,
       SUM(
         CASE
           WHEN status = 'processing'
            AND claimed_at IS NOT NULL
            AND claimed_at < UTC_TIMESTAMP() - INTERVAL :lease_seconds SECOND
           THEN 1
           ELSE 0
         END
       ) AS stale_processing
     FROM hermes_events`,
    { lease_seconds: leaseSeconds }
  );

  return {
    queued: Number(rows[0]?.queued ?? 0),
    processing: Number(rows[0]?.processing ?? 0),
    acked: Number(rows[0]?.acked ?? 0),
    staleProcessing: Number(rows[0]?.stale_processing ?? 0),
    leaseSeconds
  };
}

export async function recordHermesDeliveryTrace(input: RecordHermesDeliveryTraceInput) {
  const traceId = randomUUID();
  await execute(
    `INSERT INTO hermes_delivery_traces (
       id,
       sender_trace_id,
       conversation_id,
       receiver_message_id,
       route,
       sender_base_url,
       sender_target_url,
       sender_hostname,
       sender_session_platform,
       sender_session_chat_id,
       attachment_count,
       attachment_names,
       content_length,
       receiver_status,
       error_text
     ) VALUES (
       :id,
       :sender_trace_id,
       :conversation_id,
       :receiver_message_id,
       :route,
       :sender_base_url,
       :sender_target_url,
       :sender_hostname,
       :sender_session_platform,
       :sender_session_chat_id,
       :attachment_count,
       :attachment_names,
       :content_length,
       :receiver_status,
       :error_text
     )`,
    {
      id: traceId,
      sender_trace_id: input.senderTraceId ?? null,
      conversation_id: input.conversationId,
      receiver_message_id: input.receiverMessageId ?? null,
      route: input.route?.trim() || 'unknown',
      sender_base_url: input.senderBaseUrl?.trim() || null,
      sender_target_url: input.senderTargetUrl?.trim() || null,
      sender_hostname: input.senderHostname?.trim() || null,
      sender_session_platform: input.senderSessionPlatform?.trim() || null,
      sender_session_chat_id: input.senderSessionChatId?.trim() || null,
      attachment_count: Math.max(0, Number(input.attachmentCount ?? 0)),
      attachment_names:
        input.attachmentNames && input.attachmentNames.length > 0
          ? JSON.stringify(input.attachmentNames)
          : null,
      content_length: Math.max(0, Number(input.contentLength ?? 0)),
      receiver_status: input.receiverStatus ?? 'accepted',
      error_text: input.errorText?.trim() || null
    }
  );

  return traceId;
}

export async function listRecentHermesDeliveryTraces(limit = 10): Promise<HermesDeliveryTrace[]> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 20));
  const rows = await query<HermesDeliveryTraceRow>(
    `SELECT
       id,
       sender_trace_id,
       conversation_id,
       receiver_message_id,
       route,
       sender_base_url,
       sender_target_url,
       sender_hostname,
       sender_session_platform,
       sender_session_chat_id,
       attachment_count,
       attachment_names,
       content_length,
       receiver_status,
       error_text,
       created_at
     FROM hermes_delivery_traces
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`
  );

  return rows.map(mapHermesDeliveryTrace);
}

export async function storeAssistantMessage(
  conversationId: string,
  content: string,
  options: {
    timings?: unknown;
    role?: 'assistant' | 'system';
    userMessageId?: string | null;
    publishDoneEvent?: boolean;
    notifyPush?: boolean;
  } = {}
) {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const messageId = randomUUID();
  const parentMessageId = await resolveAssistantParentMessageId(
    conversationId,
    options.userMessageId
  );
  const assistantRevisionGroupId = await getProcessingEventRevisionGroupId(conversationId);
  const messageTimestamp = Date.now();
  const timingsJson = serializeTimingsForStorage(options.timings);
  const role = options.role === 'system' ? 'system' : 'assistant';
  await execute(
    `INSERT INTO messages (id, conversation_id, parent_id, role, content, source, status, extra, timings, type, msg_timestamp)
     VALUES (:id, :conversation_id, :parent_id, :role, :content, 'hermes', 'complete', :extra, :timings, 'text', :msg_timestamp)`,
    {
      id: messageId,
      conversation_id: conversationId,
      parent_id: parentMessageId,
      role,
      content,
      extra: serializeMessageExtra(
        assistantRevisionGroupId ? { revisionGroupId: assistantRevisionGroupId } : null
      ),
      timings: timingsJson,
      msg_timestamp: messageTimestamp
    }
  );
  await updateConversationState(conversationId, { currNode: messageId });
  publishConversationStreamEvent({ type: 'message', conversationId, messageId });
  if (options.publishDoneEvent !== false) {
    publishConversationStreamEvent({
      type: 'done',
      conversationId,
      messageId,
      status: 'complete'
    });
  }

  if (role === 'assistant' && options.notifyPush !== false) {
    void notifyAssistantReplyCompletion({
      conversationId,
      messageId,
      content
    });
  }

  return messageId;
}

/**
 * Coerce a timings payload into a JSON string suitable for the
 * ``messages.timings`` column. Returns ``null`` for empty / invalid input so
 * the column stays NULL rather than holding `"null"` or `"{}"`.
 */
function serializeTimingsForStorage(timings: unknown): string | null {
  if (timings == null) {
    return null;
  }
  if (typeof timings !== 'object') {
    return null;
  }
  if (Array.isArray(timings)) {
    return null;
  }
  if (Object.keys(timings as object).length === 0) {
    return null;
  }
  try {
    return JSON.stringify(timings);
  } catch {
    return null;
  }
}

export async function storeAssistantMessageWithAttachments(
  conversationId: string,
  content: string,
  files: AttachmentUpload[] = [],
  options: {
    timings?: unknown;
    role?: 'assistant' | 'system';
    userMessageId?: string | null;
  } = {}
) {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const messageId = await storeAssistantMessage(conversationId, content, {
    ...options,
    publishDoneEvent: false,
    notifyPush: false
  });
  await saveAttachmentsForMessage(ownerId, conversationId, messageId, files);
  publishConversationStreamEvent({
    type: 'done',
    conversationId,
    messageId,
    status: 'complete'
  });
  if ((options.role ?? 'assistant') === 'assistant') {
    void notifyAssistantReplyCompletion({
      conversationId,
      messageId,
      content
    });
  }
  return messageId;
}

export async function getAttachmentForUser(userId: string, attachmentId: string) {
  const rows = await query<AttachmentRow>(
    `SELECT attachments.id, attachments.message_id, attachments.file_name, attachments.content_type, attachments.size_bytes, attachments.storage_key
     FROM attachments
     INNER JOIN conversations ON conversations.id = attachments.conversation_id
     WHERE attachments.id = :attachment_id AND conversations.user_id = :user_id
     LIMIT 1`,
    { attachment_id: attachmentId, user_id: userId }
  );
  return rows[0] ?? null;
}

export async function getAttachmentForInternal(attachmentId: string) {
  const rows = await query<AttachmentRow>(
    `SELECT id, message_id, file_name, content_type, size_bytes, storage_key
     FROM attachments
     WHERE id = :attachment_id
     LIMIT 1`,
    { attachment_id: attachmentId }
  );
  return rows[0] ?? null;
}

export async function getAttachmentBuffer(storageKey: string) {
  return getObjectBuffer(storageKey);
}

/**
 * Delete a single message owned by the user. Removes attachments and any queued
 * Hermes events tied to it. Returns true if a message was deleted.
 */
export async function deleteMessageForUser(
  userId: string,
  conversationId: string,
  messageId: string
): Promise<boolean> {
  const conversationRows = await query<ConversationStateRow>(
    `SELECT conversations.id, conversations.created_at, conversations.curr_node, conversations.title
     FROM conversations
     WHERE conversations.id = :conversation_id
       AND conversations.user_id = :user_id
     LIMIT 1`,
    { conversation_id: conversationId, user_id: userId }
  );
  const conversation = conversationRows[0];
  if (!conversation) {
    return false;
  }

  const rows = await query<MessageRow>(
    `SELECT messages.id,
            messages.parent_id,
            messages.role,
            messages.content,
            messages.created_at,
            messages.status,
            messages.type,
            messages.msg_timestamp
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
     ORDER BY messages.msg_timestamp ASC, messages.created_at ASC, messages.id ASC`,
    { conversation_id: conversationId, user_id: userId }
  );

  const messageTree = buildMessageTree(rows);
  const target = messageTree.get(messageId)?.row;
  if (!target || target.type === 'root') {
    return false;
  }

  const deleteIds = [messageId, ...collectDescendantIds(messageTree, messageId)];
  const deleteIdSet = new Set(deleteIds);
  const remainingRows = rows.filter((row) => !deleteIdSet.has(row.id));
  const remainingTree = buildMessageTree(remainingRows);
  let nextCurrNode = conversation.curr_node;

  if (!nextCurrNode || deleteIdSet.has(nextCurrNode) || !remainingTree.has(nextCurrNode)) {
    if (target.parent_id && remainingTree.has(target.parent_id)) {
      nextCurrNode = findDeepestDescendant(remainingTree, target.parent_id);
    } else {
      nextCurrNode = resolveConversationLeafId(remainingTree, null);
    }
  }

  const nextFirstUser = firstUserMessageInBranch(collectBranchRows(remainingTree, nextCurrNode));
  const placeholders = deleteIds.map((_, index) => `:message_id_${index}`).join(', ');
  const params = Object.fromEntries(deleteIds.map((id, index) => [`message_id_${index}`, id]));

  await execute(
    `DELETE FROM hermes_events
     WHERE message_id IN (${placeholders})`,
    params
  );
  await execute(
    `DELETE FROM attachments
     WHERE message_id IN (${placeholders})`,
    params
  );
  await execute(
    `DELETE FROM messages
     WHERE id IN (${placeholders})`,
    params
  );
  await updateConversationState(conversationId, {
    currNode: nextCurrNode,
    title: nextFirstUser ? deriveConversationTitle(nextFirstUser.content) : 'New conversation'
  });

  return true;
}

/**
 * Regenerate a previous assistant turn. Deletes the assistant message and
 * re-enqueues the immediately-preceding user message for Hermes to reprocess.
 * Returns the new event id, or null if the message could not be regenerated.
 */
export async function regenerateAssistantMessage(
  userId: string,
  conversationId: string,
  assistantMessageId: string
): Promise<{ eventId: string; userMessageId: string } | null> {
  const target = await query<{ id: string; parent_id: string | null; extra?: string | object | null }>(
    `SELECT messages.id, messages.parent_id, messages.extra
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.id = :message_id
       AND messages.conversation_id = :conversation_id
       AND messages.role = 'assistant'
       AND conversations.user_id = :user_id
     LIMIT 1`,
    { message_id: assistantMessageId, conversation_id: conversationId, user_id: userId }
  );
  if (target.length === 0) {
    return null;
  }

  const userRows = await query<{ id: string; content: string }>(
    `SELECT id, content
     FROM messages
     WHERE id = :message_id
       AND conversation_id = :conversation_id
       AND role = 'user'
     LIMIT 1`,
    { message_id: target[0].parent_id, conversation_id: conversationId }
  );
  if (userRows.length === 0) {
    return null;
  }

  const previousUser = userRows[0];
  const assistantRevisionGroupId = getRevisionGroupId(target[0]) ?? assistantMessageId;
  if (!getRevisionGroupId(target[0])) {
    await markMessageRevisionGroup(assistantMessageId, assistantRevisionGroupId);
  }
  const eventId = randomUUID();
  await execute(
    `INSERT INTO hermes_events (id, user_id, conversation_id, message_id, event_type, status, payload)
     VALUES (:id, :user_id, :conversation_id, :message_id, 'message', 'queued', :payload)`,
    {
      id: eventId,
      user_id: userId,
      conversation_id: conversationId,
      message_id: previousUser.id,
      payload: JSON.stringify({
        text: previousUser.content,
        regenerate: true,
        assistant_revision_group_id: assistantRevisionGroupId
      })
    }
  );
  await updateConversationState(conversationId, { currNode: previousUser.id });

  return { eventId, userMessageId: previousUser.id };
}

export async function editUserMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  content: string
): Promise<{ messageId: string; eventId: string } | null> {
  const targetRows = await query<{ id: string; parent_id: string | null; extra?: string | object | null }>(
    `SELECT messages.id, messages.parent_id, messages.extra
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.id = :message_id
       AND messages.conversation_id = :conversation_id
       AND messages.role = 'user'
       AND conversations.user_id = :user_id
     LIMIT 1`,
    { message_id: messageId, conversation_id: conversationId, user_id: userId }
  );
  if (targetRows.length === 0) {
    return null;
  }

  const rootId = await ensureConversationRootMessage(conversationId);
  const parentMessageId = targetRows[0].parent_id ?? rootId;
  const revisionGroupId = getRevisionGroupId(targetRows[0]) ?? messageId;
  if (!getRevisionGroupId(targetRows[0])) {
    await markMessageRevisionGroup(messageId, revisionGroupId);
  }
  const nextMessageId = randomUUID();
  const eventId = randomUUID();
  const messageTimestamp = Date.now();
  await execute(
    `INSERT INTO messages (id, conversation_id, parent_id, role, content, source, status, extra, type, msg_timestamp)
     VALUES (:id, :conversation_id, :parent_id, 'user', :content, 'browser', 'complete', :extra, 'text', :msg_timestamp)`,
    {
      id: nextMessageId,
      conversation_id: conversationId,
      parent_id: parentMessageId,
      content,
      extra: serializeMessageExtra({ revisionGroupId }),
      msg_timestamp: messageTimestamp
    }
  );
  await cloneAttachmentsForMessage(messageId, nextMessageId);
  await execute(
    `INSERT INTO hermes_events (id, user_id, conversation_id, message_id, event_type, status, payload)
     VALUES (:id, :user_id, :conversation_id, :message_id, 'message', 'queued', :payload)`,
    {
      id: eventId,
      user_id: userId,
      conversation_id: conversationId,
      message_id: nextMessageId,
      payload: JSON.stringify({ text: content, edited_from_message_id: messageId })
    }
  );
  await updateConversationState(conversationId, {
    currNode: nextMessageId,
    ...(parentMessageId === rootId ? { title: deriveConversationTitle(content) } : {})
  });

  return { messageId: nextMessageId, eventId };
}

export async function selectMessageRevision(
  userId: string,
  conversationId: string,
  messageId: string
): Promise<{ messageId: string; leafMessageId: string } | null> {
  const rows = await query<MessageRow>(
    `SELECT messages.id,
            messages.parent_id,
            messages.role,
            messages.content,
            messages.created_at,
            messages.status,
            messages.type,
            messages.msg_timestamp
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
     ORDER BY messages.msg_timestamp ASC, messages.created_at ASC, messages.id ASC`,
    { conversation_id: conversationId, user_id: userId }
  );

  const messageTree = buildMessageTree(rows);
  if (!messageTree.has(messageId)) {
    return null;
  }

  const leafMessageId = findDeepestDescendant(messageTree, messageId);
  const firstUser = firstUserMessageInBranch(collectBranchRows(messageTree, leafMessageId));
  await updateConversationState(conversationId, {
    currNode: leafMessageId,
    ...(firstUser ? { title: deriveConversationTitle(firstUser.content) } : {})
  });

  return { messageId, leafMessageId };
}
