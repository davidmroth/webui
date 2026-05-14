import { execute, indexExists, type Migration } from './helpers';

export const migration: Migration = {
	id: '014_briefing_shares',
	description: 'Persist per-briefing public sharing controls',
	async up() {
		await execute(`
			CREATE TABLE IF NOT EXISTS briefing_shares (
				job_id VARCHAR(191) PRIMARY KEY,
				owner_user_id CHAR(36) NOT NULL,
				is_public TINYINT(1) NOT NULL DEFAULT 0,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				CONSTRAINT fk_briefing_shares_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
			)
		`);

		if (!(await indexExists('briefing_shares', 'idx_briefing_shares_owner'))) {
			await execute('ALTER TABLE briefing_shares ADD INDEX idx_briefing_shares_owner (owner_user_id)');
		}
	}
};