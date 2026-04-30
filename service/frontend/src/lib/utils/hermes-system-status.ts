const hermesSystemStatusPatterns = [
	/^⚡ Interrupting current task\b/i,
	/^💾 Skill ['"].+['"] updated\.?$/i,
	/^⏳ Gateway\b/i,
	/^⏳ Still working\.\.\./i,
	/^Operation interrupted:/i,
	/^Your current task will be interrupted\b/i,
	/^\[System note:/i,
	/^⚠(?:️)? (Gateway\b|Provider authentication failed:|Proxy (mode requires aiohttp\b|URL not configured\b|error\b|connection error\b))/i
];

export function isHermesSystemStatusContent(content: string): boolean {
	const normalized = content.trim();
	return (
		normalized.length > 0 &&
		hermesSystemStatusPatterns.some((pattern) => pattern.test(normalized))
	);
}
