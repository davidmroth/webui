interface BriefingArchiveStreamOptions {
  basePath?: string;
  onBriefing: () => void;
  EventSourceImpl?: typeof EventSource;
}

function streamPath(basePath = '') {
  return `${basePath.replace(/\/+$/, '')}/api/briefings/catalog/stream`;
}

export function startBriefingArchiveStream(options: BriefingArchiveStreamOptions) {
  if (typeof EventSource === 'undefined' && !options.EventSourceImpl) {
    return () => {};
  }

  const EventSourceCtor = options.EventSourceImpl ?? EventSource;
  const source = new EventSourceCtor(streamPath(options.basePath));
  source.addEventListener('briefing', options.onBriefing);

  return () => {
    source.removeEventListener('briefing', options.onBriefing);
    source.close();
  };
}
