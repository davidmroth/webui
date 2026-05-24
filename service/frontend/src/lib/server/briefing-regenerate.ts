import { enqueueUserMessage } from './chat';
import { getBriefingRecord, getLatestBriefingVersion } from './briefing-records';

interface QueueBriefingRegenerationDeps {
	getBriefingRecordFn?: typeof getBriefingRecord;
	getLatestBriefingVersionFn?: typeof getLatestBriefingVersion;
	enqueueUserMessageFn?: typeof enqueueUserMessage;
}

function formatRequestedChanges(requestedChanges: string[]) {
	if (requestedChanges.length === 0) {
		return '- No explicit changes were provided. Recreate the briefing faithfully from the saved context and improve it only where the current policies require.';
	}

	return requestedChanges.map((entry) => `- ${entry}`).join('\n');
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
	return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function buildRegenerationInstruction(jobId: string, artifact: NonNullable<Awaited<ReturnType<typeof getLatestBriefingVersion>>>, requestedChanges: string[]) {
	const provenance = artifact.provenance;
	const sourceUrls = uniqueNonEmpty([...(provenance?.sourceUrls ?? []), ...artifact.artifact.sources.map((source) => source.url)]);

	return [
		`Use the regenerate_briefing tool to regenerate the briefing for job ${jobId}.`,
		'',
		'Preserve the original intent and use the saved provenance below as the authoritative reconstruction context.',
		'',
		'Saved briefing context:',
		`- Previous title: ${artifact.artifact.title}`,
		`- Previous topic: ${artifact.artifact.topic}`,
		`- Previous summary: ${artifact.artifact.summary ?? 'Unavailable'}`,
		`- Previous briefing id: ${artifact.artifact.briefingId ?? 'Unavailable'}`,
		`- Original prompt: ${provenance?.originalPrompt ?? 'Unavailable'}`,
		`- System prompt: ${provenance?.systemPrompt ?? 'Unavailable'}`,
		`- Source summary: ${provenance?.sourceSummary ?? 'Unavailable'}`,
		`- Previously used sources: ${sourceUrls.length > 0 ? sourceUrls.join(', ') : 'Unavailable'}`,
		`- Previous generation model: ${provenance?.model ?? artifact.createdByModel ?? 'Unavailable'}`,
		`- Previous generation provider: ${provenance?.provider ?? artifact.createdByProvider ?? 'Unavailable'}`,
		'',
		'Requested changes:',
		formatRequestedChanges(requestedChanges),
		'',
		'Create a new canonical briefing version and keep the result suitable for the WebUI briefing renderer.'
	].join('\n');
}

export async function queueBriefingRegenerationRequest(
	userId: string,
	jobId: string,
	requestedChanges: string[] = [],
	deps: QueueBriefingRegenerationDeps = {}
) {
	const getBriefingRecordFn = deps.getBriefingRecordFn ?? getBriefingRecord;
	const getLatestBriefingVersionFn = deps.getLatestBriefingVersionFn ?? getLatestBriefingVersion;
	const enqueueUserMessageFn = deps.enqueueUserMessageFn ?? enqueueUserMessage;

	const [record, latestVersion] = await Promise.all([
		getBriefingRecordFn(jobId),
		getLatestBriefingVersionFn(jobId)
	]);

	if (!record || record.ownerUserId !== userId || !record.conversationId || !latestVersion) {
		return null;
	}

	const content = buildRegenerationInstruction(jobId, latestVersion, requestedChanges);
	const queued = await enqueueUserMessageFn(userId, record.conversationId, content);
	return {
		conversationId: record.conversationId,
		messageId: queued.messageId,
		eventId: queued.eventId
	};
}