import { execute, type Migration } from './helpers';

export const migration: Migration = {
	id: '017_briefing_versions',
	description: 'Store canonical briefing artifacts and provenance as versioned DB records',
	up: async () => {
		await execute(`
			CREATE TABLE IF NOT EXISTS briefing_versions (
				id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
				job_id VARCHAR(191) NOT NULL,
				version_number INT NOT NULL,
				artifact_schema_version VARCHAR(64) NOT NULL,
				artifact_json JSON NOT NULL,
				provenance_json JSON NULL,
				creation_reason ENUM('initial_generation', 'regeneration', 'legacy_import') NOT NULL DEFAULT 'initial_generation',
				created_by_provider VARCHAR(128) NULL,
				created_by_model VARCHAR(191) NULL,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				CONSTRAINT fk_briefing_versions_job FOREIGN KEY (job_id) REFERENCES briefings(job_id) ON DELETE CASCADE,
				UNIQUE KEY uq_briefing_versions_job_version (job_id, version_number),
				INDEX idx_briefing_versions_job_created (job_id, created_at),
				INDEX idx_briefing_versions_reason_created (creation_reason, created_at)
			)
		`);
	}
};