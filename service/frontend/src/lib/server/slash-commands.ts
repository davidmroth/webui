export type HermesSlashCommand = {
  command: string;
  description: string;
  argsHint?: string;
  category?: string;
  aliases?: string[];
};

const FALLBACK_COMMANDS: HermesSlashCommand[] = [
  {
    command: '/new',
    description: 'Start a new session (fresh session ID + history).'
  },
  {
    command: '/retry',
    description: 'Retry the last message (resend to agent).'
  },
  {
    command: '/undo',
    description: 'Remove the last user/assistant exchange.'
  }
];

let cachedCommands: HermesSlashCommand[] = [...FALLBACK_COMMANDS];
let lastSyncedAt: string | null = null;

function normalizeCommand(entry: unknown): HermesSlashCommand | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const candidate = entry as Record<string, unknown>;
  const command = typeof candidate.command === 'string' ? candidate.command.trim() : '';
  if (!command.startsWith('/')) {
    return null;
  }

  const description =
    typeof candidate.description === 'string' && candidate.description.trim()
      ? candidate.description.trim()
      : 'Hermes command';

  const argsHint =
    typeof candidate.argsHint === 'string' && candidate.argsHint.trim()
      ? candidate.argsHint.trim()
      : undefined;
  const category =
    typeof candidate.category === 'string' && candidate.category.trim()
      ? candidate.category.trim()
      : undefined;
  const aliases = Array.isArray(candidate.aliases)
    ? candidate.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.startsWith('/'))
    : undefined;

  return {
    command,
    description,
    ...(argsHint ? { argsHint } : {}),
    ...(category ? { category } : {}),
    ...(aliases && aliases.length > 0 ? { aliases } : {})
  };
}

export function updateHermesSlashCommands(input: unknown) {
  const list = Array.isArray(input) ? input : [];
  const next = list
    .map(normalizeCommand)
    .filter((entry): entry is HermesSlashCommand => Boolean(entry));

  if (next.length === 0) {
    return false;
  }

  const deduped: HermesSlashCommand[] = [];
  const seen = new Set<string>();
  for (const entry of next) {
    if (seen.has(entry.command)) {
      continue;
    }
    seen.add(entry.command);
    deduped.push(entry);
  }

  cachedCommands = deduped;
  lastSyncedAt = new Date().toISOString();
  return true;
}

export function getHermesSlashCommands() {
  return {
    commands: cachedCommands,
    source: lastSyncedAt ? 'hermes' : 'fallback',
    syncedAt: lastSyncedAt
  } as const;
}
