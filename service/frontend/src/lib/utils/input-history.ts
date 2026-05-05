export const COMPOSER_INPUT_HISTORY_LIMIT = 100;

type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type InputHistoryDirection = 'backward' | 'forward';

type InputHistoryNavigationOptions = {
  entries: string[];
  currentDraft: string;
  direction: InputHistoryDirection;
  index: number | null;
  pendingDraft: string | null;
};

type InputHistoryNavigationResult = {
  nextDraft: string;
  nextIndex: number | null;
  nextPendingDraft: string | null;
};

function normalizeInputHistory(entries: unknown[], limit: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    normalized.push(entry);
  }

  return normalized.reverse().slice(-limit);
}

export function loadInputHistory(
  storage: HistoryStorage | null | undefined,
  key: string,
  limit = COMPOSER_INPUT_HISTORY_LIMIT
): string[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeInputHistory(parsed, limit);
  } catch {
    return [];
  }
}

export function saveInputHistory(
  storage: HistoryStorage | null | undefined,
  key: string,
  entries: string[],
  limit = COMPOSER_INPUT_HISTORY_LIMIT
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(normalizeInputHistory(entries, limit)));
  } catch {
    // Ignore quota and unavailable-storage failures.
  }
}

export function appendInputHistory(
  entries: string[],
  entry: string,
  limit = COMPOSER_INPUT_HISTORY_LIMIT
): string[] {
  if (!entry.trim()) {
    return entries;
  }

  return normalizeInputHistory([...entries, entry], limit);
}

export function navigateInputHistory(
  options: InputHistoryNavigationOptions
): InputHistoryNavigationResult | null {
  const { entries, currentDraft, direction, index, pendingDraft } = options;
  if (entries.length === 0) {
    return null;
  }

  if (direction === 'backward') {
    if (index === null) {
      return {
        nextDraft: entries[entries.length - 1],
        nextIndex: entries.length - 1,
        nextPendingDraft: currentDraft
      };
    }

    if (index === 0) {
      return null;
    }

    return {
      nextDraft: entries[index - 1],
      nextIndex: index - 1,
      nextPendingDraft: pendingDraft
    };
  }

  if (index === null) {
    return null;
  }

  if (index === entries.length - 1) {
    return {
      nextDraft: pendingDraft ?? '',
      nextIndex: null,
      nextPendingDraft: null
    };
  }

  return {
    nextDraft: entries[index + 1],
    nextIndex: index + 1,
    nextPendingDraft: pendingDraft
  };
}