import { execute, query } from './db';
import { syncBriefingJobFromStorage } from './briefing-catalog';

interface BriefingOwnerRow {
	owner_user_id: string;
}

interface BriefingShareRow {
	job_id: string;
	owner_user_id: string;
	is_public: number | boolean;
}

type QueryFn = <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
type ExecuteFn = (sql: string, params?: Record<string, unknown>) => Promise<unknown>;

interface BriefingSharingDeps {
	queryFn?: QueryFn;
	executeFn?: ExecuteFn;
}

export interface BriefingShareState {
	jobId: string;
	ownerUserId: string | null;
	isPublic: boolean;
}

export interface BriefingViewerAccess {
	jobId: string;
	ownerUserId: string | null;
	isPublic: boolean;
	canView: boolean;
	canManage: boolean;
}

function normalizeJobId(jobId: string) {
	return jobId.trim();
}

function normalizeShareState(jobId: string, row: BriefingShareRow | null): BriefingShareState {
	return {
		jobId,
		ownerUserId: row?.owner_user_id ?? null,
		isPublic: row?.is_public === true || row?.is_public === 1
	};
}

export async function findBriefingOwnerUserId(
	jobId: string,
	deps: BriefingSharingDeps = {}
): Promise<string | null> {
	const normalizedJobId = normalizeJobId(jobId);
	if (!normalizedJobId) {
		return null;
	}

	const queryFn = deps.queryFn ?? query;
	let rows = await queryFn<BriefingOwnerRow>(
		`SELECT owner_user_id
		 FROM briefings
		 WHERE job_id = :job_id
		 LIMIT 1`,
		{ job_id: normalizedJobId }
	);
	if (rows[0]?.owner_user_id) {
		return rows[0].owner_user_id;
	}

	await syncBriefingJobFromStorage(normalizedJobId, { queryFn });
	rows = await queryFn<BriefingOwnerRow>(
		`SELECT owner_user_id
		 FROM briefings
		 WHERE job_id = :job_id
		 LIMIT 1`,
		{ job_id: normalizedJobId }
	);

	return rows[0]?.owner_user_id ?? null;
}

export async function getBriefingShareState(
	jobId: string,
	deps: BriefingSharingDeps = {}
): Promise<BriefingShareState> {
	const normalizedJobId = normalizeJobId(jobId);
	if (!normalizedJobId) {
		return { jobId: normalizedJobId, ownerUserId: null, isPublic: false };
	}

	const queryFn = deps.queryFn ?? query;
	const rows = await queryFn<BriefingShareRow>(
		`SELECT job_id, owner_user_id, is_public
		 FROM briefing_shares
		 WHERE job_id = :job_id
		 LIMIT 1`,
		{ job_id: normalizedJobId }
	);

	const share = normalizeShareState(normalizedJobId, rows[0] ?? null);
	if (share.ownerUserId) {
		return share;
	}

	const ownerUserId = await findBriefingOwnerUserId(normalizedJobId, deps);
	return {
		...share,
		ownerUserId
	};
	}

export async function getBriefingViewerAccess(
	jobId: string,
	viewerUserId: string | null,
	deps: BriefingSharingDeps = {}
): Promise<BriefingViewerAccess> {
	const share = await getBriefingShareState(jobId, deps);
	const normalizedViewerUserId = viewerUserId?.trim() || null;
	const canManage = Boolean(
		normalizedViewerUserId && (!share.ownerUserId || normalizedViewerUserId === share.ownerUserId)
	);

	return {
		jobId: share.jobId,
		ownerUserId: share.ownerUserId,
		isPublic: share.isPublic,
		canView: share.isPublic || normalizedViewerUserId !== null,
		canManage
	};
}

export async function setBriefingPublicState(
	jobId: string,
	viewerUserId: string,
	isPublic: boolean,
	deps: BriefingSharingDeps = {}
): Promise<BriefingShareState> {
	const normalizedJobId = normalizeJobId(jobId);
	const normalizedViewerUserId = viewerUserId.trim();
	if (!normalizedJobId) {
		throw new Error('A briefing job id is required.');
	}
	if (!normalizedViewerUserId) {
		throw new Error('A viewer user id is required.');
	}

	const share = await getBriefingShareState(normalizedJobId, deps);
	if (share.ownerUserId && share.ownerUserId !== normalizedViewerUserId) {
		throw new Error('Only the briefing owner can change sharing.');
	}

	const executeFn = deps.executeFn ?? execute;
	await executeFn(
		`INSERT INTO briefing_shares (job_id, owner_user_id, is_public)
		 VALUES (:job_id, :owner_user_id, :is_public)
		 ON DUPLICATE KEY UPDATE
		   owner_user_id = VALUES(owner_user_id),
		   is_public = VALUES(is_public),
		   updated_at = CURRENT_TIMESTAMP`,
		{
			job_id: normalizedJobId,
			owner_user_id: normalizedViewerUserId,
			is_public: isPublic ? 1 : 0
		}
	);

	return {
		jobId: normalizedJobId,
		ownerUserId: share.ownerUserId ?? normalizedViewerUserId,
		isPublic
	};
}