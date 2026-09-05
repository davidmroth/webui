export interface BriefingCatalogEvent {
  ownerUserId: string;
  jobId: string;
}

type BriefingCatalogListener = (event: BriefingCatalogEvent) => void;

const listenersByOwner = new Map<string, Set<BriefingCatalogListener>>();

export function publishBriefingCatalogEvent(event: BriefingCatalogEvent) {
  const listeners = listenersByOwner.get(event.ownerUserId);
  if (!listeners) {
    return;
  }

  for (const listener of Array.from(listeners)) {
    listener(event);
  }
}

export function subscribeBriefingCatalog(
  ownerUserId: string,
  listener: BriefingCatalogListener
) {
  let listeners = listenersByOwner.get(ownerUserId);
  if (!listeners) {
    listeners = new Set();
    listenersByOwner.set(ownerUserId, listeners);
  }

  listeners.add(listener);

  return () => {
    const currentListeners = listenersByOwner.get(ownerUserId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      listenersByOwner.delete(ownerUserId);
    }
  };
}
