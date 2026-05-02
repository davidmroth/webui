export function normalizeAttachmentContentType(contentType: string): string {
	return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function isImageAttachmentContentType(contentType: string): boolean {
	return normalizeAttachmentContentType(contentType).startsWith('image/');
}

export function isHtmlAttachmentContentType(contentType: string): boolean {
	return normalizeAttachmentContentType(contentType) === 'text/html';
}

export function isAudioAttachmentContentType(contentType: string): boolean {
	return normalizeAttachmentContentType(contentType).startsWith('audio/');
}

export function getAttachmentContentFlags(contentType: string) {
	return {
		isImage: isImageAttachmentContentType(contentType),
		isHtml: isHtmlAttachmentContentType(contentType),
		isAudio: isAudioAttachmentContentType(contentType)
	};
}

export function isInlineAttachmentContentType(contentType: string): boolean {
	const { isImage, isAudio } = getAttachmentContentFlags(contentType);
	return isImage || isAudio;
}