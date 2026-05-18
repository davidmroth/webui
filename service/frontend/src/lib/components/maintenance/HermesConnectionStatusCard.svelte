<script lang="ts">
  import {
    startMaintenanceHermesConnectionStatusPolling,
    type MaintenanceHermesConnectionStatus
  } from '$lib/services/maintenance-hermes-status';

  type Props = {
    initialStatus: MaintenanceHermesConnectionStatus;
  };

  let { initialStatus }: Props = $props();

  let status = $state(initialStatus);
  let pollError = $state<string | null>(null);

  function stateBadgeClasses(state: MaintenanceHermesConnectionStatus['state']) {
    if (state === 'connected') {
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
    }
    if (state === 'reconnecting') {
      return 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
    }
    if (state === 'degraded') {
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    }
    if (state === 'misconfigured') {
      return 'bg-destructive/15 text-destructive';
    }
    return 'bg-muted text-muted-foreground';
  }

  function stateDotClasses(state: MaintenanceHermesConnectionStatus['state']) {
    if (state === 'connected') {
      return 'bg-emerald-500 motion-safe:animate-pulse';
    }
    if (state === 'reconnecting') {
      return 'bg-sky-500 motion-safe:animate-pulse';
    }
    if (state === 'degraded') {
      return 'bg-amber-500';
    }
    if (state === 'misconfigured') {
      return 'bg-destructive';
    }
    return 'bg-muted-foreground/70';
  }

  function formatAge(seconds: number | null) {
    if (seconds == null) {
      return 'never';
    }
    if (seconds < 60) {
      return `${seconds}s ago`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainderSeconds = seconds % 60;
    if (minutes < 60) {
      return `${minutes}m ${remainderSeconds}s ago`;
    }

    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;
    return `${hours}h ${remainderMinutes}m ago`;
  }

  function formatTime(value: string | null) {
    if (!value) {
      return 'n/a';
    }

    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  $effect(() => {
    status = initialStatus;
  });

  $effect(() => {
    const stopPolling = startMaintenanceHermesConnectionStatusPolling({
      intervalMs: 5_000,
      onUpdate(nextStatus) {
        status = nextStatus;
        pollError = null;
      },
      onError(message) {
        pollError = message;
      }
    });

    return () => {
      stopPolling();
    };
  });
</script>

<section class="rounded-xl border border-border bg-card p-5 shadow-sm" aria-live="polite">
  <div class="flex flex-col gap-4">
    <div class="min-w-0">
      <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Hermes connection</div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${stateBadgeClasses(status.state)}`}>
          <span class={`h-2.5 w-2.5 rounded-full ${stateDotClasses(status.state)}`}></span>
          {status.label}
        </span>
        <span class="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
          Live refresh every 5s
        </span>
      </div>
      <p class="mt-3 text-sm text-muted-foreground">{status.summary}</p>
    </div>

    <div class="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      <div class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Updated</div>
      <div class="mt-1 font-medium">{formatTime(status.polledAt)}</div>
    </div>
  </div>

  <div class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
    <div class="rounded-lg border border-border bg-muted/30 p-3 [overflow-wrap:anywhere]">
      <div class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Heartbeat</div>
      <div class="mt-2 font-medium">{status.workerHeartbeat.isOnline ? 'Fresh' : 'Stale'}</div>
      <div class="mt-1 text-muted-foreground">Last seen: {formatAge(status.workerHeartbeat.ageSeconds)}</div>
      <div class="mt-1 text-muted-foreground">Source: {status.workerHeartbeat.source ?? 'n/a'}</div>
    </div>

    <div class="rounded-lg border border-border bg-muted/30 p-3 [overflow-wrap:anywhere]">
      <div class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Queue</div>
      <div class="mt-2 font-medium">{status.queue.queued} queued</div>
      <div class="mt-1 text-muted-foreground">Processing: {status.queue.processing}</div>
      <div class="mt-1 text-muted-foreground">Stale: {status.queue.staleProcessing}</div>
      {#if status.queue.error}
        <div class="mt-2 text-destructive">{status.queue.error}</div>
      {/if}
    </div>

    <div class="rounded-lg border border-border bg-muted/30 p-3 [overflow-wrap:anywhere]">
      <div class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Pending inbox</div>
      <div class="mt-2 font-medium">{status.pendingEvent.exists ? 'Present' : 'None'}</div>
      <div class="mt-1 text-muted-foreground">Status: {status.pendingEvent.status ?? 'n/a'}</div>
      <div class="mt-1 text-muted-foreground">Age: {formatAge(status.pendingEvent.ageSeconds)}</div>
    </div>

    <div class="rounded-lg border border-border bg-muted/30 p-3 [overflow-wrap:anywhere]">
      <div class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Receiver auth</div>
      <div class="mt-2 font-medium">{status.hermesServiceTokenConfigured ? 'Configured' : 'Missing token'}</div>
      <div class="mt-1 text-muted-foreground">
        Last auth failure: {status.workerHeartbeat.authFailure.seen ? formatAge(status.workerHeartbeat.authFailure.ageSeconds) : 'none'}
      </div>
      <div class="mt-1 text-muted-foreground">Reason: {status.workerHeartbeat.authFailure.reason ?? 'n/a'}</div>
    </div>
  </div>

  {#if pollError}
    <p class="mt-3 text-sm text-amber-700 dark:text-amber-300">Live refresh paused briefly: {pollError}</p>
  {/if}
</section>