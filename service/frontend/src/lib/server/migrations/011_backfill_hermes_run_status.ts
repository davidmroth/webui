import { execute, type Migration } from './helpers';

export const migration: Migration = {
  id: '011_backfill_hermes_run_status',
  description: 'Backfill Hermes run status for events that existed before durable run state',
  up: async () => {
    await execute(
      `UPDATE hermes_events
       SET run_status = CASE
         WHEN status = 'acked' THEN 'completed'
         WHEN status = 'cancelled' THEN 'cancelled'
         WHEN status = 'processing' THEN 'processing'
         ELSE 'queued'
       END,
       run_completed_at = CASE
         WHEN status = 'acked' THEN COALESCE(run_completed_at, acked_at, UTC_TIMESTAMP())
         WHEN status = 'cancelled' THEN COALESCE(run_completed_at, cancelled_at, UTC_TIMESTAMP())
         ELSE run_completed_at
       END
       WHERE run_status = 'queued'
         AND status IN ('acked', 'cancelled', 'processing')`
    );
  }
};
