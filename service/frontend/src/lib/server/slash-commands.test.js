import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from './db.ts';

test('slash command cache preserves confirmation metadata for fallback and Hermes sync', async () => {
  await execute('DELETE FROM slash_command_cache WHERE cache_key = :cache_key', {
    cache_key: 'hermes'
  });

  const moduleUnderTest = await import(`./slash-commands.ts?case=${Date.now()}`);

  const initial = await moduleUnderTest.getHermesSlashCommands();
  assert.equal(initial.source, 'empty');
  assert.deepEqual(initial.commands, []);

  const updated = await moduleUnderTest.updateHermesSlashCommands([
    {
      command: '/new',
      description: 'Start a new session (fresh session ID + history).',
      aliases: ['/reset'],
      requiresConfirmation: true
    },
    {
      command: '/retry',
      description: 'Retry the last message (resend to agent).'
    }
  ]);

  assert.equal(updated, true);

  const synced = await moduleUnderTest.getHermesSlashCommands();
  const syncedNew = synced.commands.find((entry) => entry.command === '/new');
  assert.equal(synced.source, 'hermes');
  assert.deepEqual(syncedNew, {
    command: '/new',
    description: 'Start a new session (fresh session ID + history).',
    aliases: ['/reset'],
    requiresConfirmation: true
  });
});