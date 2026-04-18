import { randomUUID } from 'node:crypto';
import { execute, pool, query } from './db';
import { getConfig } from './env';
import { getObjectBuffer, uploadObject } from './storage';
import type { ChatMessage, ConversationSummary, MessageAttachment } from '$lib/types';

interface ConversationRow {
  id: string;
  title: string;
  updated_at: Date | string;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date | string;
  status: 'complete' | 'streaming' | 'error';
}

interface AttachmentRow {
  id: string;
  message_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
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

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
  files: File[]
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
    `SELECT id, title, updated_at
     FROM conversations
     WHERE user_id = :user_id
     ORDER BY updated_at DESC`,
    { user_id: userId }
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: toIsoString(row.updated_at)
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
    `SELECT messages.id, messages.role, messages.content, messages.created_at, messages.status
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
    attachments: attachmentsByMessageId.get(row.id) ?? []
  }));
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

export async function storeAssistantMessage(conversationId: string, content: string) {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const messageId = randomUUID();
  await execute(
    `INSERT INTO messages (id, conversation_id, role, content, source, status)
     VALUES (:id, :conversation_id, 'assistant', :content, 'hermes', 'complete')`,
    { id: messageId, conversation_id: conversationId, content }
  );
  await execute(
    'UPDATE conversations SET updated_at = UTC_TIMESTAMP() WHERE id = :id',
    { id: conversationId }
  );

  return messageId;
}

export async function storeAssistantMessageWithAttachments(
  conversationId: string,
  content: string,
  files: File[] = []
) {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const messageId = await storeAssistantMessage(conversationId, content);
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
