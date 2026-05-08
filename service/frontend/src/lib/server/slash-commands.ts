import { createHash } from 'node:crypto';
import { execute, query } from './db';

export type HermesSlashCommand = {
  command: string;
  description: string;
  argsHint?: string;
  category?: string;
  aliases?: string[];
  requiresConfirmation?: boolean;
};

interface SlashCommandCacheRow {
  commands_json: string;
  synced_at: Date | string;
}

const SLASH_COMMAND_CACHE_KEY = 'hermes';

let cachedCommands: HermesSlashCommand[] = [];
let lastSyncedAt: string | null = null;
let cacheLoaded = false;
let cacheLoadPromise: Promise<void> | null = null;
let ensureTablePromise: Promise<void> | null = null;

function serializeCommandCatalog(commands: HermesSlashCommand[]) {
  return JSON.stringify(
    commands.map((entry) => ({
      command: entry.command,
      description: entry.description,
      ...(entry.argsHint ? { argsHint: entry.argsHint } : {}),
      ...(entry.category ? { category: entry.category } : {}),
      ...(entry.aliases && entry.aliases.length > 0 ? { aliases: entry.aliases } : {}),
      ...(entry.requiresConfirmation ? { requiresConfirmation: true } : {})
    }))
  );
}

export function getHermesSlashCommandCatalogHash(commands: HermesSlashCommand[]) {
  return createHash('sha256').update(serializeCommandCatalog(commands)).digest('hex');
}

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
  const requiresConfirmation = candidate.requiresConfirmation === true;

  return {
    command,
    description,
    ...(argsHint ? { argsHint } : {}),
    ...(category ? { category } : {}),
    ...(aliases && aliases.length > 0 ? { aliases } : {}),
    ...(requiresConfirmation ? { requiresConfirmation } : {})
  };
}

async function loadCachedCommands() {
  await ensureSlashCommandCacheTable();

  if (cacheLoaded) {
    return;
  }
  if (cacheLoadPromise) {
    return cacheLoadPromise;
  }

  cacheLoadPromise = (async () => {
    try {
      const rows = await query<SlashCommandCacheRow>(
        `SELECT commands_json, synced_at
         FROM slash_command_cache
         WHERE cache_key = :cache_key
         LIMIT 1`,
        { cache_key: SLASH_COMMAND_CACHE_KEY }
      );
      const row = rows[0];
      if (!row) {
        cacheLoaded = true;
        return;
      }

      const parsed = JSON.parse(String(row.commands_json)) as unknown;
      const next = Array.isArray(parsed)
        ? parsed.map(normalizeCommand).filter((entry): entry is HermesSlashCommand => Boolean(entry))
        : [];

      cachedCommands = next;
      lastSyncedAt = row.synced_at instanceof Date ? row.synced_at.toISOString() : new Date(row.synced_at).toISOString();
      cacheLoaded = true;
    } catch {
      cacheLoaded = true;
    } finally {
      cacheLoadPromise = null;
    }
  })();

  return cacheLoadPromise;
}

async function ensureSlashCommandCacheTable() {
  if (ensureTablePromise) {
    return ensureTablePromise;
  }

  ensureTablePromise = execute(`
    CREATE TABLE IF NOT EXISTS slash_command_cache (
      cache_key VARCHAR(64) PRIMARY KEY,
      commands_json LONGTEXT NOT NULL,
      synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `).then(() => undefined).catch((error) => {
    ensureTablePromise = null;
    throw error;
  });

  return ensureTablePromise;
}

export async function updateHermesSlashCommands(input: unknown) {
  await ensureSlashCommandCacheTable();

  const list = Array.isArray(input) ? input : [];
  const next = list
    .map(normalizeCommand)
    .filter((entry): entry is HermesSlashCommand => Boolean(entry));

  if (next.length === 0) {
    return null;
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

  const syncedAt = new Date();
  cachedCommands = deduped;
  lastSyncedAt = syncedAt.toISOString();
  cacheLoaded = true;

  await execute(
    `INSERT INTO slash_command_cache (cache_key, commands_json, synced_at)
     VALUES (:cache_key, :commands_json, :synced_at)
     ON DUPLICATE KEY UPDATE
       commands_json = VALUES(commands_json),
       synced_at = VALUES(synced_at)`,
    {
      cache_key: SLASH_COMMAND_CACHE_KEY,
      commands_json: JSON.stringify(deduped),
      synced_at: syncedAt,
    }
  );

  return {
    acceptedCount: deduped.length,
    catalogHash: getHermesSlashCommandCatalogHash(deduped),
    syncedAt: lastSyncedAt
  } as const;
}

export async function getHermesSlashCommands() {
  await loadCachedCommands();

  return {
    commands: cachedCommands,
    source: lastSyncedAt ? 'hermes' : 'empty',
    syncedAt: lastSyncedAt
  } as const;
}
