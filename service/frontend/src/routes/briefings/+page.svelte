<script lang="ts">
  let { data } = $props();

  function buildPageHref(page: number) {
    const params = new URLSearchParams();
    if (page > 1) {
      params.set('page', String(page));
    }

    const query = params.toString();
    return query ? `/briefings?${query}` : '/briefings';
  }

  function formatDate(value: string | null | undefined) {
    if (!value) {
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
</script>

<svelte:head>
  <title>Briefings</title>
</svelte:head>

<div class="min-h-screen bg-background">
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
    <header class="flex flex-col gap-2">
      <p class="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Archive</p>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="text-3xl font-semibold tracking-tight">Briefings</h1>
          <p class="max-w-2xl text-sm text-muted-foreground">
            Published briefings generated in your conversations, newest first.
          </p>
        </div>
        <p class="text-sm text-muted-foreground">
          {data.briefings.total} total {data.briefings.total === 1 ? 'briefing' : 'briefings'}
        </p>
      </div>
    </header>

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
        {#each data.briefings.items as item}
          <article class="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{item.isPublic ? 'Public' : 'Private'}</span>
                  <span aria-hidden="true">•</span>
                  <span>{formatDate(item.reference.generatedAt ?? item.createdAt)}</span>
                </div>
                <h2 class="mt-2 text-xl font-semibold tracking-tight">{item.reference.title}</h2>
                {#if item.reference.summary}
                  <p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{item.reference.summary}</p>
                {/if}
                <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  <span>Conversation: {item.conversationTitle}</span>
                  <span>
                    Validation: {item.reference.validation.valid ? 'Valid' : 'Needs review'}
                    ({item.reference.validation.warningCount} warnings, {item.reference.validation.errorCount} errors)
                  </span>
                </div>
              </div>

              <div class="flex shrink-0 flex-wrap gap-2">
                <a
                  class="primary-button"
                  href={item.reference.previewUrl}
                >
                  Open player
                </a>
                <a
                  class="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium"
                  href={item.reference.standaloneHtmlUrl}
                >
                  Standalone page
                </a>
                <a
                  class="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium"
                  href={`/chat?conversation=${encodeURIComponent(item.conversationId)}`}
                >
                  Open conversation
                </a>
              </div>
            </div>
          </article>
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