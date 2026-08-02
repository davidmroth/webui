import { columnExists, execute, type Migration } from './helpers';

export const migration: Migration = {
  id: '022_hermes_event_last_progress',
  description:
    'Track last Hermes progress timestamp so long tool loops do not expire the turn lease',
  up: async () => {
    if (!(await columnExists('hermes_events', 'last_progress_at'))) {
      await execute(
        'ALTER TABLE hermes_events ADD COLUMN last_progress_at DATETIME NULL AFTER claimed_at'
      );
    }

    // Existing in-flight / historical rows: treat claim time as last progress.
    await execute(
      `UPDATE hermes_events
       SET last_progress_at = claimed_at
       WHERE last_progress_at IS NULL
         AND claimed_at IS NOT NULL`
    );
  }
};
