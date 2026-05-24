import type {
	BriefingAssetLink,
	BriefingSection,
	BriefingSourceRef,
	BriefingTimelineCue,
	BriefingValidationResult
} from '$lib/types/briefing';

export interface CanonicalBriefingArtifact {
	schemaVersion: string;
	jobId: string;
	briefingId: string | null;
	title: string;
	topic: string;
	summary: string | null;
	generatedAt: string;
	locale: string;
	generatedBy: string;
	validation: BriefingValidationResult;
	assets: BriefingAssetLink[];
	audioAsset: BriefingAssetLink | null;
	sections: BriefingSection[];
	sources: BriefingSourceRef[];
	timelineCues: BriefingTimelineCue[];
}

export interface BriefingGenerationProvenance {
	schemaVersion: string;
	originalPrompt: string;
	systemPrompt: string | null;
	requestedChanges: string[];
	sourceSummary: string | null;
	sourceUrls: string[];
	provider: string | null;
	model: string | null;
	conversationId: string | null;
	sourceMessageId: string | null;
	toolName: string | null;
	metadata: Record<string, unknown>;
}

export type BriefingVersionCreationReason =
	| 'initial_generation'
	| 'regeneration'
	| 'legacy_import';