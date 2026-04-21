import { randomUUID } from 'node:crypto';
import { execute, pool, query } from './db';
import { getConfig } from './env';
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

interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date | string;
  status: 'complete' | 'streaming' | 'error';
  timings?: string | object | null;
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

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    downloadUrl: `/api/attachments/${row.id}/download`,
    isImage: row.content_type.startsWith('image/')
  };
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
      isImage: contentType.startsWith('image/')
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
  await execute(
    'INSERT INTO conversations (id, user_id, title) VALUES (:id, :user_id, :title)',
    { id, user_id: userId, title }
  );
  return id;
}

export async function listMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
  const rows = await query<MessageRow>(
    `SELECT messages.id, messages.role, messages.content, messages.created_at, messages.status, messages.timings
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id AND conversations.user_id = :user_id
     ORDER BY messages.created_at ASC`,
    { conversation_id: conversationId, user_id: userId }
  );

  const attachmentsByMessageId = await listAttachmentsByMessageIds(rows.map((row) => row.id));

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: toIsoString(row.created_at),
    status: row.status,
    attachments: attachmentsByMessageId.get(row.id) ?? [],
    timings: parseTimings(row.timings)
  }));
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
  const rows = await query<{ id: string; status: 'complete' | 'streaming' | 'error' }>(
    `SELECT messages.id, messages.status
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
       AND messages.role = 'assistant'
     ORDER BY messages.created_at DESC
     LIMIT 1`,
    { conversation_id: conversationId, user_id: userId }
  );
  return rows[0] ?? null;
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
export async function appendAssistantChunk(messageId: string, seq: number, delta: string) {
  await execute(
    `INSERT IGNORE INTO hermes_message_chunks (message_id, seq, delta)
     VALUES (:message_id, :seq, :delta)`,
    { message_id: messageId, seq, delta }
  );
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
export async function openStreamingAssistantMessage(conversationId: string): Promise<string> {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }
  const messageId = randomUUID();
  await execute(
    `INSERT INTO messages (id, conversation_id, role, content, source, status)
     VALUES (:id, :conversation_id, 'assistant', '', 'hermes', 'streaming')`,
    { id: messageId, conversation_id: conversationId }
  );
  await execute(
    'UPDATE conversations SET updated_at = UTC_TIMESTAMP() WHERE id = :id',
    { id: conversationId }
  );
  return messageId;
}

/**
 * Finalize a streaming assistant message by writing the final assembled
 * content and marking it complete.
 */
export async function finalizeStreamingAssistantMessage(
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
  }

  // mysql2 OkPacket has affectedRows; the helper returns its result. We treat
  // either a cancelled event OR a closed streaming message as a success signal.
  const affected =
    typeof eventResult === 'object' && eventResult !== null && 'affectedRows' in eventResult
      ? Number((eventResult as { affectedRows?: number }).affectedRows ?? 0)
      : 0;
  return affected > 0 || streamingId !== null;
}

export async function enqueueUserMessage(userId: string, conversationId: string, content: string, files: File[] = []) {
  const messageId = randomUUID();
  const eventId = randomUUID();
  await execute(
    `INSERT INTO messages (id, conversation_id, role, content, source, status)
     VALUES (:id, :conversation_id, 'user', :content, 'browser', 'complete')`,
    { id: messageId, conversation_id: conversationId, content }
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
  await execute(
    'UPDATE conversations SET updated_at = UTC_TIMESTAMP() WHERE id = :id AND user_id = :user_id',
    { id: conversationId, user_id: userId }
  );

  return { messageId, eventId };
}

export async function dequeueHermesEvent() {
  const leaseSeconds = Math.max(30, getConfig().hermesEventLeaseSeconds);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT hermes_events.id, hermes_events.conversation_id, conversations.title AS conversation_title,
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
  options: { timings?: unknown } = {}
) {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const messageId = randomUUID();
  const timingsJson = serializeTimingsForStorage(options.timings);
  await execute(
    `INSERT INTO messages (id, conversation_id, role, content, source, status, timings)
     VALUES (:id, :conversation_id, 'assistant', :content, 'hermes', 'complete', :timings)`,
    { id: messageId, conversation_id: conversationId, content, timings: timingsJson }
  );
  await execute(
    'UPDATE conversations SET updated_at = UTC_TIMESTAMP() WHERE id = :id',
    { id: conversationId }
  );

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
  options: { timings?: unknown } = {}
) {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const messageId = await storeAssistantMessage(conversationId, content, options);
  await saveAttachmentsForMessage(ownerId, conversationId, messageId, files);
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
  const rows = await query<{ id: string }>(
    `SELECT messages.id
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE messages.id = :message_id
       AND messages.conversation_id = :conversation_id
       AND conversations.user_id = :user_id
     LIMIT 1`,
    { message_id: messageId, conversation_id: conversationId, user_id: userId }
  );
  if (rows.length === 0) {
    return false;
  }

  // Cascade-delete in correct order: events → attachments → message.
  await execute(
    'DELETE FROM hermes_events WHERE message_id = :message_id',
    { message_id: messageId }
  );
  await execute(
    'DELETE FROM attachments WHERE message_id = :message_id',
    { message_id: messageId }
  );
  await execute(
    'DELETE FROM messages WHERE id = :message_id',
    { message_id: messageId }
  );
  await execute(
    'UPDATE conversations SET updated_at = UTC_TIMESTAMP() WHERE id = :id AND user_id = :user_id',
    { id: conversationId, user_id: userId }
  );

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
  // Verify ownership and that the message is an assistant message.
  const target = await query<{ id: string; created_at: Date | string }>(
    `SELECT messages.id, messages.created_at
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

  // Find the most recent user message before the assistant message.
  const userRows = await query<{ id: string; content: string }>(
    `SELECT id, content
     FROM messages
     WHERE conversation_id = :conversation_id
       AND role = 'user'
       AND created_at <= :anchor
     ORDER BY created_at DESC
     LIMIT 1`,
    { conversation_id: conversationId, anchor: target[0].created_at }
  );
  if (userRows.length === 0) {
    return null;
  }

  const previousUser = userRows[0];

  // Delete the prior assistant message + any attached events.
  await execute(
    'DELETE FROM hermes_events WHERE message_id = :message_id',
    { message_id: assistantMessageId }
  );
  await execute(
    'DELETE FROM attachments WHERE message_id = :message_id',
    { message_id: assistantMessageId }
  );
  await execute(
    'DELETE FROM messages WHERE id = :message_id',
    { message_id: assistantMessageId }
  );

  // Re-enqueue the prior user message for Hermes.
  const eventId = randomUUID();
  await execute(
    `INSERT INTO hermes_events (id, user_id, conversation_id, message_id, event_type, status, payload)
     VALUES (:id, :user_id, :conversation_id, :message_id, 'message', 'queued', :payload)`,
    {
      id: eventId,
      user_id: userId,
      conversation_id: conversationId,
      message_id: previousUser.id,
      payload: JSON.stringify({ text: previousUser.content, regenerate: true })
    }
  );
  await execute(
    'UPDATE conversations SET updated_at = UTC_TIMESTAMP() WHERE id = :id AND user_id = :user_id',
    { id: conversationId, user_id: userId }
  );

  return { eventId, userMessageId: previousUser.id };
}
