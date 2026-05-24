import { execute, type Migration } from './helpers';

export const migration: Migration = {
	id: '018_briefing_render_jobs',
	description: 'Queue DB-backed rerender jobs for the briefing service',
	up: async () => {
		await execute(`
			CREATE TABLE IF NOT EXISTS briefing_render_jobs (
				id CHAR(36) PRIMARY KEY,
				job_id VARCHAR(191) NOT NULL,
				briefing_version_number INT NOT NULL,
				requested_by_user_id CHAR(36) NOT NULL,
				status ENUM('queued', 'processing', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
				error_message TEXT NULL,
				claimed_at DATETIME NULL,
				completed_at DATETIME NULL,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				CONSTRAINT fk_briefing_render_jobs_job FOREIGN KEY (job_id) REFERENCES briefings(job_id) ON DELETE CASCADE,
				CONSTRAINT fk_briefing_render_jobs_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
				INDEX idx_briefing_render_jobs_status_created (status, created_at),
				INDEX idx_briefing_render_jobs_job_created (job_id, created_at)
			)
		`);
	}
};