import test from 'node:test';
import assert from 'node:assert/strict';

test('slash command cache preserves confirmation metadata for fallback and Hermes sync', async () => {
  const moduleUnderTest = await import(`./slash-commands.ts?case=${Date.now()}`);

  const initial = moduleUnderTest.getHermesSlashCommands();
  assert.equal(initial.source, 'empty');
  assert.deepEqual(initial.commands, []);

  const updated = moduleUnderTest.updateHermesSlashCommands([
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

  const synced = moduleUnderTest.getHermesSlashCommands();
  const syncedNew = synced.commands.find((entry) => entry.command === '/new');
  assert.equal(synced.source, 'hermes');
  assert.deepEqual(syncedNew, {
    command: '/new',
    description: 'Start a new session (fresh session ID + history).',
    aliases: ['/reset'],
    requiresConfirmation: true
  });
});