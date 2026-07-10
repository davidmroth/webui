import { extname } from 'node:path';

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
	'.c': 'text/x-c',
	'.cpp': 'text/x-c++',
	'.csv': 'text/csv; charset=utf-8',
	'.gif': 'image/gif',
	'.go': 'text/x-go',
	'.java': 'text/x-java-source',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
	'.pdf': 'application/pdf',
	'.png': 'image/png',
	'.py': 'text/x-python; charset=utf-8',
	'.rb': 'text/x-ruby; charset=utf-8',
	'.rs': 'text/rust; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.ts': 'text/typescript; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.webp': 'image/webp',
	'.xml': 'application/xml; charset=utf-8',
	'.yaml': 'application/yaml; charset=utf-8',
	'.yml': 'application/yaml; charset=utf-8'
};

export function normalizeAttachmentContentType(contentType: string): string {
	return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function guessAttachmentContentTypeFromFileName(fileName: string): string {
	return CONTENT_TYPE_BY_EXTENSION[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

export function resolveAttachmentContentType(fileName: string, reportedContentType: string): string {
	const normalized = normalizeAttachmentContentType(reportedContentType);
	if (normalized && normalized !== 'application/octet-stream') {
		return reportedContentType.split(';', 1)[0]?.trim() || reportedContentType;
	}

	return guessAttachmentContentTypeFromFileName(fileName);
}

export function isImageAttachmentContentType(contentType: string): boolean {
	return normalizeAttachmentContentType(contentType).startsWith('image/');
}

export function isHtmlAttachmentContentType(contentType: string): boolean {
	return normalizeAttachmentContentType(contentType) === 'text/html';
}

export function isMarkdownAttachmentContentType(contentType: string): boolean {
	const normalized = normalizeAttachmentContentType(contentType);
	return normalized === 'text/markdown' || normalized === 'text/x-markdown';
}

export function isAudioAttachmentContentType(contentType: string): boolean {
	return normalizeAttachmentContentType(contentType).startsWith('audio/');
}

export function getAttachmentContentFlags(contentType: string) {
	const isHtml = isHtmlAttachmentContentType(contentType);
	const isMarkdown = isMarkdownAttachmentContentType(contentType);

	return {
		isImage: isImageAttachmentContentType(contentType),
		isHtml,
		isMarkdown,
		isPreviewable: isHtml || isMarkdown,
		isAudio: isAudioAttachmentContentType(contentType)
	};
}

export function isInlineAttachmentContentType(contentType: string): boolean {
	const { isImage, isAudio } = getAttachmentContentFlags(contentType);
	return isImage || isAudio;
}