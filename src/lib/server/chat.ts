import { randomUUID } from 'node:crypto';
import { execute, pool, query } from './db';
import type { ChatMessage, ConversationSummary } from '$lib/types';

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

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: toIsoString(row.created_at),
    status: row.status
  }));
}

export async function enqueueUserMessage(userId: string, conversationId: string, content: string) {
  const messageId = randomUUID();
  const eventId = randomUUID();
  await execute(
    `INSERT INTO messages (id, conversation_id, role, content, source, status)
     VALUES (:id, :conversation_id, 'user', :content, 'browser', 'complete')`,
    { id: messageId, conversation_id: conversationId, content }
  );
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
       ORDER BY hermes_events.created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
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

    return {
      eventId: row.id,
      conversationId: row.conversation_id,
      conversationName: row.conversation_title,
      userId: row.user_id,
      userName: row.display_name,
      messageId: row.message_id,
      text: row.content,
      createdAt: toIsoString(row.created_at)
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

export async function storeAssistantMessage(conversationId: string, content: string) {
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
