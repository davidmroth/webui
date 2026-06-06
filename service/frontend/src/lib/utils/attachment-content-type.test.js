import test from 'node:test';
import assert from 'node:assert/strict';

import {
	getAttachmentContentFlags,
	isAudioAttachmentContentType,
	isHtmlAttachmentContentType,
	isImageAttachmentContentType,
	isInlineAttachmentContentType,
	isMarkdownAttachmentContentType,
	normalizeAttachmentContentType
} from './attachment-content-type.ts';

test('normalizeAttachmentContentType strips parameters and lowercases', () => {
	assert.equal(normalizeAttachmentContentType('Audio/Ogg; codecs=opus'), 'audio/ogg');
});

test('getAttachmentContentFlags classifies audio, image, html, and markdown attachments', () => {
	assert.deepEqual(getAttachmentContentFlags('audio/ogg; codecs=opus'), {
		isImage: false,
		isHtml: false,
		isMarkdown: false,
		isPreviewable: false,
		isAudio: true
	});
	assert.deepEqual(getAttachmentContentFlags('image/png'), {
		isImage: true,
		isHtml: false,
		isMarkdown: false,
		isPreviewable: false,
		isAudio: false
	});
	assert.deepEqual(getAttachmentContentFlags('text/html; charset=utf-8'), {
		isImage: false,
		isHtml: true,
		isMarkdown: false,
		isPreviewable: true,
		isAudio: false
	});
	assert.deepEqual(getAttachmentContentFlags('text/markdown; charset=utf-8'), {
		isImage: false,
		isHtml: false,
		isMarkdown: true,
		isPreviewable: true,
		isAudio: false
	});
});

test('attachment content type helpers preserve the intended inline policy', () => {
	assert.equal(isImageAttachmentContentType('image/webp'), true);
	assert.equal(isHtmlAttachmentContentType('text/html; charset=utf-8'), true);
	assert.equal(isMarkdownAttachmentContentType('text/markdown; charset=utf-8'), true);
	assert.equal(isAudioAttachmentContentType('audio/mpeg'), true);
	assert.equal(isInlineAttachmentContentType('audio/mpeg'), true);
	assert.equal(isInlineAttachmentContentType('image/jpeg'), true);
	assert.equal(isInlineAttachmentContentType('text/html'), false);
	assert.equal(isInlineAttachmentContentType('text/markdown'), false);
	assert.equal(isInlineAttachmentContentType('application/pdf'), false);
});