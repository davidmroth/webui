<script lang="ts">
  import { ChevronDown, ListChecks } from '@lucide/svelte';
  import * as Collapsible from '$lib/components/ui/collapsible';

  interface Props {
    content: string;
  }

  let { content }: Props = $props();
  let open = $state(false);

  const actionLines = $derived(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const latestAction = $derived(actionLines[actionLines.length - 1] ?? 'Working');
  const actionCountLabel = $derived(
    actionLines.length === 1 ? '1 action' : `${actionLines.length} actions`
  );
</script>

<section class="action-history" aria-label="Assistant actions">
  {#if actionLines.length <= 1}
    <div class="action-history-single">
      <span class="action-history-icon" aria-hidden="true">
        <ListChecks class="h-4 w-4" />
      </span>
      <span class="action-history-summary">
        <span class="action-history-title">Actions</span>
        <span class="action-history-latest">{latestAction}</span>
      </span>
    </div>
  {:else}
    <Collapsible.Root bind:open>
      <Collapsible.Trigger class="action-history-trigger" type="button" aria-expanded={open}>
        <span class="action-history-icon" aria-hidden="true">
          <ListChecks class="h-4 w-4" />
        </span>
        <span class="action-history-summary">
          <span class="action-history-title">Actions</span>
          <span class="action-history-latest">{latestAction}</span>
        </span>
        <span class="action-history-count">{actionCountLabel}</span>
        <ChevronDown class={`action-history-chevron h-4 w-4 ${open ? 'expanded' : ''}`} aria-hidden="true" />
      </Collapsible.Trigger>

      <Collapsible.Content>
        <ol class="action-history-list">
          {#each actionLines as actionLine}
            <li class="action-history-item">{actionLine}</li>
          {/each}
        </ol>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}
</section>

<style>
  .action-history {
    width: min(100%, 40rem);
    color: var(--text);
  }

  .action-history-single,
  :global(.action-history-trigger) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.38rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: calc(var(--app-radius) * 0.7);
    background: color-mix(in srgb, var(--panel-strong) 74%, transparent);
    text-align: left;
  }

  .action-history-single {
    grid-template-columns: auto minmax(0, 1fr);
  }

  :global(.action-history-trigger:hover) {
    border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
    background: color-mix(in srgb, var(--panel-strong) 92%, transparent);
  }

  :global(.action-history-trigger:focus-visible) {
    outline: 2px solid color-mix(in srgb, var(--text) 22%, transparent);
    outline-offset: 2px;
  }

  .action-history-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    color: var(--text-muted);
  }

  .action-history-summary {
    display: grid;
    gap: 0.12rem;
    min-width: 0;
  }

  .action-history-title {
    color: var(--text-muted);
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1;
  }

  .action-history-latest,
  .action-history-item {
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .action-history-latest {
    display: -webkit-box;
    overflow: hidden;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .action-history-count {
    color: var(--text-muted);
    font-size: 0.72rem;
    white-space: nowrap;
  }

  :global(.action-history-chevron) {
    color: var(--text-muted);
    transition: transform 140ms ease;
  }

  :global(.action-history-chevron.expanded) {
    transform: rotate(180deg);
  }

  .action-history-list {
    display: grid;
    gap: 0.42rem;
    margin: 0.45rem 0 0;
    padding: 0.15rem 0 0.1rem 2.7rem;
    color: var(--text);
  }

  .action-history-item {
    padding-left: 0.12rem;
  }

  @media (max-width: 640px) {
    .action-history-single,
    :global(.action-history-trigger) {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .action-history-single {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .action-history-count {
      display: none;
    }
  }
</style>