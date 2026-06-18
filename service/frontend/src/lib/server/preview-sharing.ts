import { query, execute } from './db';

interface PreviewShareRow {
	share_id: string;
	attachment_id: string;
	owner_user_id: string;
	is_public: number | boolean;
}

interface AttachmentOwnerRow {
	user_id: string;
}

type QueryFn = <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
type ExecuteFn = (sql: string, params?: Record<string, unknown>) => Promise<unknown>;

interface PreviewSharingDeps {
	queryFn?: QueryFn;
	executeFn?: ExecuteFn;
}

export interface PreviewShareState {
	shareId: string;
	attachmentId: string;
	ownerUserId: string | null;
	isPublic: boolean;
}

export interface PreviewViewerAccess {
	shareId: string;
	attachmentId: string;
	ownerUserId: string | null;
	isPublic: boolean;
	canView: boolean;
	canManage: boolean;
}

function normalizeShareId(shareId: string) {
	return shareId.trim();
}

function normalizeAttachmentId(attachmentId: string) {
	return attachmentId.trim();
}

function normalizeShareState(row: PreviewShareRow | null): PreviewShareState {
	return {
		shareId: row?.share_id ?? '',
		attachmentId: row?.attachment_id ?? '',
		ownerUserId: row?.owner_user_id ?? null,
		isPublic: row?.is_public === true || row?.is_public === 1
	};
}

export async function getPreviewShareState(
	attachmentId: string,
	deps: PreviewSharingDeps = {}
): Promise<PreviewShareState> {
	const normalizedAttachmentId = normalizeAttachmentId(attachmentId);
	if (!normalizedAttachmentId) {
		return { shareId: '', attachmentId: normalizedAttachmentId, ownerUserId: null, isPublic: false };
	}

	const queryFn = deps.queryFn ?? query;
	const rows = await queryFn<PreviewShareRow>(
		`SELECT share_id, attachment_id, owner_user_id, is_public
		 FROM preview_shares
		 WHERE attachment_id = :attachment_id
		 LIMIT 1`,
		{ attachment_id: normalizedAttachmentId }
	);

	return normalizeShareState(rows[0] ?? null);
}

export async function getPreviewShareByShareId(
	shareId: string,
	deps: PreviewSharingDeps = {}
): Promise<PreviewShareState> {
	const normalizedShareId = normalizeShareId(shareId);
	if (!normalizedShareId) {
		return { shareId: normalizedShareId, attachmentId: '', ownerUserId: null, isPublic: false };
	}

	const queryFn = deps.queryFn ?? query;
	const rows = await queryFn<PreviewShareRow>(
		`SELECT share_id, attachment_id, owner_user_id, is_public
		 FROM preview_shares
		 WHERE share_id = :share_id
		 LIMIT 1`,
		{ share_id: normalizedShareId }
	);

	return normalizeShareState(rows[0] ?? null);
}

export async function getPreviewViewerAccess(
	shareId: string,
	viewerUserId: string | null,
	deps: PreviewSharingDeps = {}
): Promise<PreviewViewerAccess> {
	const share = await getPreviewShareByShareId(shareId, deps);
	const normalizedViewerUserId = viewerUserId?.trim() || null;
	const canManage = Boolean(
		normalizedViewerUserId && (!share.ownerUserId || normalizedViewerUserId === share.ownerUserId)
	);

	return {
		shareId: share.shareId,
		attachmentId: share.attachmentId,
		ownerUserId: share.ownerUserId,
		isPublic: share.isPublic,
		canView: share.isPublic || normalizedViewerUserId !== null,
		canManage
	};
}

export async function ensurePreviewShare(
	attachmentId: string,
	userId: string,
	deps: PreviewSharingDeps = {}
): Promise<PreviewShareState> {
	const normalizedAttachmentId = normalizeAttachmentId(attachmentId);
	const normalizedUserId = userId.trim();

	if (!normalizedAttachmentId) {
		throw new Error('An attachment id is required.');
	}
	if (!normalizedUserId) {
		throw new Error('A user id is required.');
	}

	const queryFn = deps.queryFn ?? query;
	const executeFn = deps.executeFn ?? execute;

	// Check if share already exists
	const existingRows = await queryFn<PreviewShareRow>(
		`SELECT share_id, attachment_id, owner_user_id, is_public
		 FROM preview_shares
		 WHERE attachment_id = :attachment_id
		 LIMIT 1`,
		{ attachment_id: normalizedAttachmentId }
	);

	if (existingRows[0]) {
		return normalizeShareState(existingRows[0]);
	}

	// Verify the attachment belongs to this user
	const ownerRows = await queryFn<AttachmentOwnerRow>(
		`SELECT users.user_id
		 FROM attachments
		 INNER JOIN conversations ON conversations.id = attachments.conversation_id
		 WHERE attachments.id = :attachment_id AND conversations.user_id = :user_id
		 LIMIT 1`,
		{ attachment_id: normalizedAttachmentId, user_id: normalizedUserId }
	);

	if (!ownerRows[0]) {
		throw new Error('Attachment not found.');
	}

	// Create new share
	const shareId = crypto.randomUUID();
	await executeFn(
		`INSERT INTO preview_shares (share_id, attachment_id, owner_user_id, is_public)
		 VALUES (:share_id, :attachment_id, :owner_user_id, 0)`,
		{
			share_id: shareId,
			attachment_id: normalizedAttachmentId,
			owner_user_id: normalizedUserId
		}
	);

	return {
		shareId,
		attachmentId: normalizedAttachmentId,
		ownerUserId: normalizedUserId,
		isPublic: false
	};
}

export async function setPreviewPublicState(
	shareId: string,
	viewerUserId: string,
	isPublic: boolean,
	deps: PreviewSharingDeps = {}
): Promise<PreviewShareState> {
	const normalizedShareId = normalizeShareId(shareId);
	const normalizedViewerUserId = viewerUserId.trim();

	if (!normalizedShareId) {
		throw new Error('A share id is required.');
	}
	if (!normalizedViewerUserId) {
		throw new Error('A user id is required.');
	}

	const queryFn = deps.queryFn ?? query;
	const executeFn = deps.executeFn ?? execute;

	const rows = await queryFn<PreviewShareRow>(
		`SELECT share_id, attachment_id, owner_user_id, is_public
		 FROM preview_shares
		 WHERE share_id = :share_id
		 LIMIT 1`,
		{ share_id: normalizedShareId }
	);

	const share = normalizeShareState(rows[0] ?? null);

	if (share.ownerUserId && share.ownerUserId !== normalizedViewerUserId) {
		throw new Error('Only the preview owner can change sharing.');
	}

	await executeFn(
		`UPDATE preview_shares
		 SET is_public = :is_public, updated_at = NOW()
		 WHERE share_id = :share_id`,
		{ share_id: normalizedShareId, is_public: isPublic ? 1 : 0 }
	);

	return {
		...share,
		isPublic
	};
}
