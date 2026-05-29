import { columnExists, execute, type Migration } from './helpers';

export const migration: Migration = {
  id: '020_hermes_tool_transcript',
  description: 'Add tool role and tool_call_id for Hermes structured tool history',
  up: async () => {
    await execute(
      "ALTER TABLE messages MODIFY COLUMN role ENUM('user', 'assistant', 'system', 'tool') NOT NULL"
    );
    if (!(await columnExists('messages', 'tool_call_id'))) {
      await execute(
        'ALTER TABLE messages ADD COLUMN tool_call_id VARCHAR(128) NULL AFTER tool_calls'
      );
    }
  }
};
