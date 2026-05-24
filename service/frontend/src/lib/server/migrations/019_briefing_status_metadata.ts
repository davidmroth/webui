import { columnExists, execute, type Migration } from './helpers';

export const migration: Migration = {
	id: '019_briefing_status_metadata',
	description: 'Persist briefing render progress metadata in the canonical table',
	up: async () => {
			if (!(await columnExists('briefings', 'progress_percent'))) {
				await execute('ALTER TABLE briefings ADD COLUMN progress_percent INT NULL AFTER stage');
			}

			if (!(await columnExists('briefings', 'progress_detail'))) {
				await execute('ALTER TABLE briefings ADD COLUMN progress_detail TEXT NULL AFTER progress_percent');
			}

			if (!(await columnExists('briefings', 'sentence_total'))) {
				await execute('ALTER TABLE briefings ADD COLUMN sentence_total INT NULL AFTER progress_detail');
			}

			if (!(await columnExists('briefings', 'sentence_completed'))) {
				await execute('ALTER TABLE briefings ADD COLUMN sentence_completed INT NULL AFTER sentence_total');
			}
	}
};
