<script lang="ts">
  import { browser } from '$app/environment';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { base } from '$app/paths';
  import { estimateBriefingRenderProgress, fetchBriefingPreview } from '$lib/services/briefing-preview';
  import type { BriefingPreview } from '$lib/types/briefing';
  import { ArrowLeft, Trash2 } from '@lucide/svelte';
  import { scale } from 'svelte/transition';

  let { data, form } = $props();
  let deletingJobId = $state<string | null>(null);
  let deletedJobIds = $state<string[]>([]);
  let deleteError = $state<string | null>(null);
  let nowMs = $state(Date.now());
  let livePreviewByJobId = $state<Record<string, BriefingPreview>>({});

  const RING_RADIUS = 18;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  function clampPercent(value: number) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function ringOffset(percent: number) {
    return RING_CIRCUMFERENCE - (clampPercent(percent) / 100) * RING_CIRCUMFERENCE;
  }

  function isDeleting(jobId: string) {
    return deletingJobId === jobId;
  }

  function isDeleted(jobId: string) {
    return deletedJobIds.includes(jobId);
  }

  function markDeleted(jobId: string) {
    if (!deletedJobIds.includes(jobId)) {
      deletedJobIds = [...deletedJobIds, jobId];
    }
  }

  function enhanceDelete(jobId: string, title: string) {
    return ({ cancel }: { cancel: () => void }) => {
      if (!window.confirm(`Delete briefing "${title}"?`)) {
        cancel();
        return;
      }

      deletingJobId = jobId;
      deleteError = null;

      return async ({ result }: { result: import('@sveltejs/kit').ActionResult }) => {
        if (result.type === 'success') {
          markDeleted(jobId);
          await new Promise((resolve) => window.setTimeout(resolve, 220));
          deletedJobIds = deletedJobIds.filter((candidate) => candidate !== jobId);
          deletingJobId = null;
          await invalidateAll();
          return;
        }

        deletingJobId = null;
        if (result.type === 'failure' && result.data && typeof result.data === 'object' && 'error' in result.data && typeof result.data.error === 'string') {
          deleteError = result.data.error;
          return;
        }

        deleteError = 'Unable to delete the briefing.';
      };
    };
  }

  function buildPageHref(page: number) {
    const params = new URLSearchParams();
    if (page > 1) {
      params.set('page', String(page));
    }

    const query = params.toString();
    return query ? `/briefings?${query}` : '/briefings';
  }

  function formatDate(value: string | number | Date | null | undefined) {
    if (!value) {
      return 'Unknown date';
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        return 'Unknown date';
      }

      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(value);
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const normalized = new Date(value > 1e12 ? value : value * 1000);
      if (Number.isNaN(normalized.getTime())) {
        return 'Unknown date';
      }

      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(normalized);
    }

    if (typeof value !== 'string') {
      return 'Unknown date';
    }

    const trimmed = value.trim();
    if (/^\d{13}$/.test(trimmed)) {
      const asMilliseconds = Number(trimmed);
      if (Number.isFinite(asMilliseconds)) {
        return new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(asMilliseconds));
      }
    }

    if (/^\d{10}$/.test(trimmed)) {
      const asSeconds = Number(trimmed);
      if (Number.isFinite(asSeconds)) {
        return new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(asSeconds * 1000));
      }
    }

    const normalized = new Date(trimmed);
    if (Number.isNaN(normalized.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(normalized);
  }

  function isFailed(item: (typeof data.briefings.items)[number]) {
    const live = livePreviewByJobId[item.reference.jobId];
    if (live?.state === 'failed') {
      return true;
    }

    return item.state === 'failed';
  }

  function isProcessing(item: (typeof data.briefings.items)[number]) {
    const live = livePreviewByJobId[item.reference.jobId];
    if (live?.state === 'processing') {
      return true;
    }

    if (live?.state === 'ready' || live?.state === 'failed') {
      return false;
    }

    return item.state === 'processing';
  }

  function pendingProgressPercent(item: (typeof data.briefings.items)[number]) {
    if (!isProcessing(item)) {
      return null;
    }

    const live = livePreviewByJobId[item.reference.jobId];
    if (live?.state === 'processing') {
      return estimateBriefingRenderProgress(
        {
          createdAt: live.createdAt,
          renderProgress: live.renderProgress
        },
        nowMs
      ).percent;
    }

    const fallbackCreatedAt = item.createdAt ?? item.reference.generatedAt ?? new Date().toISOString();
    return estimateBriefingRenderProgress(
      {
        createdAt: fallbackCreatedAt,
        renderProgress: null
      },
      nowMs
    ).percent;
  }

  function primaryActionLabel(item: (typeof data.briefings.items)[number]) {
    if (isFailed(item)) {
      return 'View failure';
    }

    if (isProcessing(item)) {
      return 'View status';
    }

    return 'Open';
  }

  function primaryActionClass(item: (typeof data.briefings.items)[number]) {
    if (isProcessing(item)) {
      return 'inline-flex items-center justify-center rounded-full border border-amber-300/70 bg-amber-200/70 px-5 py-2 text-sm font-medium text-amber-950 transition-colors hover:bg-amber-200';
    }

    return 'primary-button';
  }

  $effect(() => {
    if (!browser) {
      return;
    }

    // Installed PWAs often resume from a suspended state without re-running the
    // load, so the archive can show a stale snapshot from the last time it was
    // opened. Re-pull the list whenever the app regains visibility/focus.
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void invalidateAll();
      }
    };

    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);

    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  });

  $effect(() => {
    if (!browser) {
      return;
    }

    const hasPending = data.briefings.items.some((item) => isProcessing(item));
    if (!hasPending) {
      return;
    }

    nowMs = Date.now();
    const timer = window.setInterval(() => {
      nowMs = Date.now();
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  });

  $effect(() => {
    if (!browser || typeof EventSource === 'undefined') {
      return;
    }

    const pendingByConversation = new Map<string, string[]>();
    for (const item of data.briefings.items) {
      if (!isProcessing(item) || !item.conversationId) {
        continue;
      }

      const current = pendingByConversation.get(item.conversationId);
      if (current) {
        if (!current.includes(item.reference.jobId)) {
          current.push(item.reference.jobId);
        }
      } else {
        pendingByConversation.set(item.conversationId, [item.reference.jobId]);
      }
    }

    if (pendingByConversation.size === 0) {
      return;
    }

    let disposed = false;
    const timers = new Map<string, number>();
    const streams: Array<{ conversationId: string; stream: EventSource; handler: () => void }> = [];

    const refreshConversationPendingBriefings = async (conversationId: string) => {
      const jobIds = pendingByConversation.get(conversationId) ?? [];
      if (jobIds.length === 0) {
        return;
      }

      const previews = await Promise.all(
        jobIds.map(async (jobId) => {
          try {
            const preview = await fetchBriefingPreview(jobId);
            return { jobId, preview };
          } catch {
            return null;
          }
        })
      );

      if (disposed) {
        return;
      }

      let next = livePreviewByJobId;
      let changed = false;
      for (const entry of previews) {
        if (!entry) {
          continue;
        }

        if (!changed) {
          next = { ...livePreviewByJobId };
          changed = true;
        }
        next[entry.jobId] = entry.preview;
      }

      if (changed) {
        livePreviewByJobId = next;
      }
    };

    const scheduleRefresh = (conversationId: string) => {
      if (timers.has(conversationId)) {
        return;
      }

      const timer = window.setTimeout(() => {
        timers.delete(conversationId);
        void refreshConversationPendingBriefings(conversationId);
      }, 220);
      timers.set(conversationId, timer);
    };

    for (const [conversationId] of pendingByConversation) {
      const stream = new EventSource(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages/stream`
      );
      const handler = () => {
        scheduleRefresh(conversationId);
      };

      stream.addEventListener('status', handler);
      stream.addEventListener('message', handler);
      stream.addEventListener('done', handler);
      streams.push({ conversationId, stream, handler });

      void refreshConversationPendingBriefings(conversationId);
    }

    return () => {
      disposed = true;
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();

      for (const { stream, handler } of streams) {
        stream.removeEventListener('status', handler);
        stream.removeEventListener('message', handler);
        stream.removeEventListener('done', handler);
        stream.close();
      }
    };
  });
</script>

<svelte:head>
  <title>Briefings</title>
</svelte:head>

<div class="min-h-screen bg-background">
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
    <header class="flex flex-col gap-2">
      <div>
        <a
          class="primary-button px-4 py-2 text-sm shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href={`${base}/chat`}
        >
          <ArrowLeft class="h-4 w-4" />
          <span>Back to chat</span>
        </a>
      </div>
      <p class="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Archive</p>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="text-3xl font-semibold tracking-tight">Briefings</h1>
          <p class="max-w-2xl text-sm text-muted-foreground">
            Briefings generated in your conversations, newest first.
          </p>
        </div>
        <p class="text-sm text-muted-foreground">
          {data.briefings.total} total {data.briefings.total === 1 ? 'briefing' : 'briefings'}
        </p>
      </div>
    </header>

    {#if deleteError ?? form?.error}
      <div class="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {deleteError ?? form?.error}
      </div>
    {/if}

    {#if data.briefings.items.length === 0}
      <section class="rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
        <h2 class="text-lg font-semibold">No briefings yet</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          Generate a briefing from chat and it will appear here.
        </p>
        <a
          class="primary-button mt-5"
          href="/chat"
        >
          Open chat
        </a>
      </section>
    {:else}
      <section class="grid gap-4">
        {#each data.briefings.items as item (item.reference.jobId)}
          {#if !isDeleted(item.reference.jobId)}
          <article
            class={`relative overflow-hidden rounded-3xl border p-5 shadow-sm transition-opacity duration-200 ${isFailed(item) ? 'border-destructive/30 bg-destructive/5 ring-1 ring-destructive/15' : isProcessing(item) ? 'border-amber-300/45 bg-amber-50/40 ring-1 ring-amber-300/30' : 'border-border bg-card'} ${isDeleting(item.reference.jobId) ? 'pointer-events-none opacity-60' : ''}`}
            out:scale={{ duration: 220, start: 0.97 }}
          >
            {#if isDeleting(item.reference.jobId)}
              <div class="absolute inset-0 z-10 flex items-center justify-center bg-background/75 backdrop-blur-[1px]">
                <div class="flex items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
                  <div class="app-loading-spinner h-5 w-5"></div>
                  <span>Deleting briefing…</span>
                </div>
              </div>
            {/if}
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{item.isPublic ? 'Public' : 'Private'}</span>
                  <span aria-hidden="true">•</span>
                  <span>{formatDate(item.reference.generatedAt ?? item.createdAt)}</span>
					{#if isFailed(item)}
						<span aria-hidden="true">•</span>
						<span class="rounded-full bg-destructive/12 px-2 py-1 text-destructive">Failed</span>
          {:else if isProcessing(item)}
            <span aria-hidden="true">•</span>
            <span class="rounded-full bg-amber-200/70 px-2 py-1 text-amber-900">Pending</span>
					{/if}
                </div>
                <h2 class="mt-2 text-xl font-semibold tracking-tight">{item.reference.title}</h2>
                <p class="mt-2 text-xs text-muted-foreground">
                  Job ID:
                  <span class="ml-1 font-mono break-all text-[0.72rem]">{item.reference.jobId}</span>
                </p>
                {#if item.reference.summary}
                  <p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{item.reference.summary}</p>
                {/if}
                <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  <span>Conversation: {item.conversationTitle ?? 'Archived briefing'}</span>
					{#if isFailed(item)}
						<span class="font-medium text-destructive">Status: Briefing export failed</span>
          {:else if isProcessing(item)}
            <span class="font-medium text-amber-900">Status: Pending export completion</span>
					{/if}
                  <span>
                    Validation: {item.reference.validation.valid ? 'Valid' : 'Needs review'}
                    ({item.reference.validation.warningCount} warnings, {item.reference.validation.errorCount} errors)
                  </span>
                </div>
              </div>

              <div class="flex shrink-0 flex-col gap-3 lg:min-h-full lg:items-end">
                <div class="flex flex-wrap gap-2 lg:justify-end">
                  <a
                    class={primaryActionClass(item)}
                    href={item.reference.standaloneHtmlUrl}
                    data-sveltekit-reload
                  >
      						{primaryActionLabel(item)}
                  </a>
                  {#if item.conversationId}
                    <a
                      class="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium"
                      href={`/chat?conversation=${encodeURIComponent(item.conversationId)}`}
                    >
                      Open conversation
                    </a>
                  {/if}
                </div>

                <div class={`flex gap-2 lg:mt-auto lg:self-end ${isProcessing(item) ? 'lg:pr-16' : ''}`}>
                  <form
                    method="POST"
                    action="?/delete"
                    use:enhance={enhanceDelete(item.reference.jobId, item.reference.title)}
                  >
                    <input type="hidden" name="jobId" value={item.reference.jobId} />
                    <input type="hidden" name="page" value={data.briefings.page} />
                    <button
                      aria-label={`Delete ${item.reference.title}`}
                      disabled={isDeleting(item.reference.jobId)}
                      class="group inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-background/80 text-muted-foreground transition-all duration-200 hover:w-28 hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive focus-visible:w-28 focus-visible:border-destructive/30 focus-visible:bg-destructive/5 focus-visible:px-4 focus-visible:text-destructive"
                      type="submit"
                    >
                      <Trash2 class="h-4 w-4 shrink-0" />
                      <span class="max-w-0 overflow-hidden whitespace-nowrap pl-0 text-sm font-medium opacity-0 transition-all duration-200 group-hover:max-w-16 group-hover:pl-2 group-hover:opacity-100 group-focus-visible:max-w-16 group-focus-visible:pl-2 group-focus-visible:opacity-100">
                        Delete
                      </span>
                    </button>
                  </form>
                </div>
              </div>
            </div>

            {#if isProcessing(item)}
              <div
                class="pointer-events-none absolute bottom-4 right-4 grid h-12 w-12 place-items-center rounded-full border border-amber-300/60 bg-background/90 text-[0.65rem] font-semibold text-amber-950 shadow-sm"
                role="status"
                aria-label={`Briefing generation progress ${pendingProgressPercent(item) ?? 0} percent`}
              >
                <svg
                  class="absolute inset-0 h-full w-full -rotate-90"
                  viewBox="0 0 44 44"
                  aria-hidden="true"
                >
                  <circle
                    cx="22"
                    cy="22"
                    r={RING_RADIUS}
                    fill="none"
                    stroke="rgba(253, 224, 71, 0.45)"
                    stroke-width="4"
                  />
                  <circle
                    cx="22"
                    cy="22"
                    r={RING_RADIUS}
                    fill="none"
                    stroke="rgba(217, 119, 6, 0.96)"
                    stroke-width="4"
                    stroke-linecap="round"
                    stroke-dasharray={RING_CIRCUMFERENCE}
                    stroke-dashoffset={ringOffset(pendingProgressPercent(item) ?? 0)}
                    class="transition-all duration-500 ease-out"
                  />
                </svg>
                <span class="relative z-10">{pendingProgressPercent(item) ?? 0}%</span>
              </div>
            {/if}
          </article>
          {/if}
        {/each}
      </section>

      <nav class="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
        <a
          aria-disabled={!data.briefings.hasPreviousPage}
          class={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium ${data.briefings.hasPreviousPage ? 'border border-border bg-background' : 'cursor-not-allowed border border-border text-muted-foreground opacity-60'}`}
          href={data.briefings.hasPreviousPage ? buildPageHref(data.briefings.page - 1) : undefined}
        >
          Previous
        </a>

        <p class="text-sm text-muted-foreground">
          Page {data.briefings.page} of {data.briefings.totalPages}
        </p>

        <a
          aria-disabled={!data.briefings.hasNextPage}
          class={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium ${data.briefings.hasNextPage ? 'border border-border bg-background' : 'cursor-not-allowed border border-border text-muted-foreground opacity-60'}`}
          href={data.briefings.hasNextPage ? buildPageHref(data.briefings.page + 1) : undefined}
        >
          Next
        </a>
      </nav>
    {/if}
  </div>
</div>