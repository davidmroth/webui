export type BriefingCueKind = 'section' | 'sentence' | 'metric' | 'illustration' | 'citation';
export type BriefingAssetRole = 'audio' | 'standalone_html' | 'player_css' | 'player_js' | 'illustration';
export type BriefingIllustrationKind = 'illustration' | 'map' | 'chart';
export type BriefingRenderStage =
	| 'queued'
	| 'rendering_narration'
	| 'encoding_audio'
	| 'assembling_briefing'
	| 'packaging_assets'
	| 'completed'
	| 'failed';

export interface BriefingRenderProgress {
	stage: BriefingRenderStage;
	percent: number | null;
	detail: string | null;
	sentenceTotal: number | null;
	sentenceCompleted: number | null;
}

export interface BriefingValidationResult {
	valid: boolean;
	warnings: string[];
	errors: string[];
}

export interface BriefingTimelineCue {
	cueId: string;
	elementId: string;
	kind: BriefingCueKind;
	start: number;
	end: number;
	label: string;
}

export interface BriefingAssetLink {
	role: BriefingAssetRole;
	path: string;
	url: string;
	contentType: string;
	sizeBytes: number;
	sha256: string;
	cacheControl: string;
}

export interface BriefingSourceRef {
	id: string;
	title: string;
	publisher: string;
	url: string;
	accessedAt: string | null;
	excerpt: string | null;
}

export interface BriefingCitationRef {
	id: string;
	label: string;
	sourceId: string;
	note: string | null;
	source: BriefingSourceRef | null;
	cue: BriefingTimelineCue | null;
}

export interface BriefingMetricCard {
	id: string;
	label: string;
	value: string;
	trend: string | null;
	cue: BriefingTimelineCue | null;
}

export interface BriefingSentenceSpan {
	id: string;
	text: string;
	start: number;
	end: number;
	cue: BriefingTimelineCue | null;
}

export interface BriefingIllustrationBlock {
	id: string;
	title: string;
	caption: string;
	kind: BriefingIllustrationKind;
	asset: BriefingAssetLink | null;
	cue: BriefingTimelineCue | null;
}

export interface BriefingSection {
	id: string;
	title: string;
	narration: string;
	body: string[];
	metrics: BriefingMetricCard[];
	illustrations: BriefingIllustrationBlock[];
	citations: BriefingCitationRef[];
	sentences: BriefingSentenceSpan[];
	start: number;
	end: number;
	cue: BriefingTimelineCue | null;
}

export interface BriefingPreviewReady {
	state: 'ready';
	status: 'completed';
	jobId: string;
	briefingId: string;
	title: string;
	topic: string;
	summary: string | null;
	generatedAt: string;
	locale: string;
	generatedBy: string;
	validation: BriefingValidationResult;
	audioAsset: BriefingAssetLink | null;
	exportHtmlAsset: BriefingAssetLink | null;
	assets: BriefingAssetLink[];
	sections: BriefingSection[];
	sources: BriefingSourceRef[];
	timelineCues: BriefingTimelineCue[];
}

export interface BriefingPreviewProcessing {
	state: 'processing';
	status: 'processing';
	jobId: string;
	briefingId: string | null;
	createdAt: string;
	completedAt: string | null;
	error: string | null;
	validation: BriefingValidationResult | null;
	assetCount: number;
	renderProgress: BriefingRenderProgress | null;
}

export interface BriefingPreviewFailed {
	state: 'failed';
	status: 'failed';
	jobId: string;
	briefingId: string | null;
	createdAt: string;
	completedAt: string | null;
	error: string | null;
	validation: BriefingValidationResult | null;
	assetCount: number;
	renderProgress: BriefingRenderProgress | null;
}

export interface BriefingPreviewMissing {
	state: 'missing';
	status: 'missing';
	jobId: string;
	message: string;
}

export interface BriefingPreviewError {
	state: 'error';
	status: 'error';
	jobId: string;
	message: string;
	detail: string | null;
}

export type BriefingPreview =
	| BriefingPreviewReady
	| BriefingPreviewProcessing
	| BriefingPreviewFailed
	| BriefingPreviewMissing
	| BriefingPreviewError;
