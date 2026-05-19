import { execute, type Migration } from './helpers';

export const migration: Migration = {
	id: '016_backfill_briefings_from_messages',
	description: 'Backfill canonical briefing rows from assistant message references',
	up: async () => {
		await execute(`
			INSERT INTO briefings (
				job_id,
				owner_user_id,
				conversation_id,
				source_message_id,
				briefing_id,
				title,
				summary,
				state,
				validation_valid,
				validation_warning_count,
				validation_error_count,
				started_at,
				completed_at,
				created_at,
				updated_at
			)
			SELECT
				JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.jobId')) AS job_id,
				conversations.user_id AS owner_user_id,
				messages.conversation_id AS conversation_id,
				messages.id AS source_message_id,
				JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.briefingId')) AS briefing_id,
				JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.title')) AS title,
				NULLIF(JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.summary')), '') AS summary,
				'ready' AS state,
				CASE
					WHEN JSON_EXTRACT(messages.extra, '$.briefingReference.validation.valid') = CAST(false AS JSON)
						THEN 0
					ELSE 1
				END AS validation_valid,
				COALESCE(
					CAST(JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.validation.warningCount')) AS UNSIGNED),
					0
				) AS validation_warning_count,
				COALESCE(
					CAST(JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.validation.errorCount')) AS UNSIGNED),
					0
				) AS validation_error_count,
				messages.created_at AS started_at,
				messages.created_at AS completed_at,
				messages.created_at AS created_at,
				messages.created_at AS updated_at
			FROM messages
			INNER JOIN conversations ON conversations.id = messages.conversation_id
			WHERE messages.role = 'assistant'
				AND JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.jobId')) IS NOT NULL
				AND messages.id = (
					SELECT candidate.id
					FROM messages AS candidate
					INNER JOIN conversations AS candidate_conversations
						ON candidate_conversations.id = candidate.conversation_id
					WHERE candidate.role = 'assistant'
						AND candidate_conversations.user_id = conversations.user_id
						AND JSON_UNQUOTE(JSON_EXTRACT(candidate.extra, '$.briefingReference.jobId')) =
							JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.jobId'))
					ORDER BY COALESCE(candidate.msg_timestamp, candidate.created_at) DESC,
						candidate.created_at DESC,
						candidate.id DESC
					LIMIT 1
				)
			ON DUPLICATE KEY UPDATE
				owner_user_id = COALESCE(briefings.owner_user_id, VALUES(owner_user_id)),
				conversation_id = COALESCE(briefings.conversation_id, VALUES(conversation_id)),
				source_message_id = COALESCE(briefings.source_message_id, VALUES(source_message_id)),
				briefing_id = COALESCE(briefings.briefing_id, VALUES(briefing_id)),
				title = COALESCE(briefings.title, VALUES(title)),
				summary = COALESCE(briefings.summary, VALUES(summary)),
				validation_valid = VALUES(validation_valid),
				validation_warning_count = GREATEST(briefings.validation_warning_count, VALUES(validation_warning_count)),
				validation_error_count = GREATEST(briefings.validation_error_count, VALUES(validation_error_count)),
				started_at = COALESCE(briefings.started_at, VALUES(started_at)),
				completed_at = COALESCE(briefings.completed_at, VALUES(completed_at))
		`);
	}
};