import { execute, type Migration } from './helpers';

export const migration: Migration = {
	id: '015_briefings_catalog',
	description: 'Add canonical briefing metadata and asset tables',
	up: async () => {
		await execute(`
			CREATE TABLE IF NOT EXISTS briefings (
				job_id VARCHAR(191) PRIMARY KEY,
				owner_user_id CHAR(36) NOT NULL,
				conversation_id CHAR(36) NULL,
				source_message_id CHAR(36) NULL,
				briefing_id VARCHAR(255) NULL,
				title VARCHAR(500) NULL,
				summary TEXT NULL,
				state ENUM('processing', 'ready', 'failed') NOT NULL DEFAULT 'processing',
				stage VARCHAR(64) NULL,
				progress_percent INT NULL,
				progress_detail TEXT NULL,
				sentence_total INT NULL,
				sentence_completed INT NULL,
				manifest_storage_key VARCHAR(512) NULL,
				status_storage_key VARCHAR(512) NULL,
				error_message TEXT NULL,
				validation_valid TINYINT(1) NOT NULL DEFAULT 1,
				validation_warning_count INT NOT NULL DEFAULT 0,
				validation_error_count INT NOT NULL DEFAULT 0,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				started_at DATETIME NULL,
				completed_at DATETIME NULL,
				failed_at DATETIME NULL,
				CONSTRAINT fk_briefings_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
				CONSTRAINT fk_briefings_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
				CONSTRAINT fk_briefings_source_message FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL,
				INDEX idx_briefings_owner_created (owner_user_id, created_at),
				INDEX idx_briefings_conversation (conversation_id),
				INDEX idx_briefings_state_created (state, created_at),
				INDEX idx_briefings_briefing_id (briefing_id)
			)
		`);

		await execute(`
			CREATE TABLE IF NOT EXISTS briefing_assets (
				id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
				job_id VARCHAR(191) NOT NULL,
				role VARCHAR(64) NOT NULL,
				asset_path VARCHAR(255) NOT NULL,
				storage_key VARCHAR(512) NOT NULL,
				content_type VARCHAR(120) NULL,
				size_bytes BIGINT NOT NULL DEFAULT 0,
				sha256 CHAR(64) NULL,
				cache_control VARCHAR(255) NULL,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				CONSTRAINT fk_briefing_assets_job FOREIGN KEY (job_id) REFERENCES briefings(job_id) ON DELETE CASCADE,
				UNIQUE KEY uq_briefing_assets_job_role_path (job_id, role, asset_path),
				INDEX idx_briefing_assets_job (job_id)
			)
		`);
	}
};