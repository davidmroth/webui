<script lang="ts">
  import {
    describeNotificationServiceWorker,
    getNotificationPermission,
    getNotificationServiceWorkerRegistration,
    readNotificationEnvironmentSnapshot,
    requestNotificationPermission,
    showPageNotification,
    showServiceWorkerNotification
  } from '$lib/utils/notifications';

  let { data, form } = $props();
  const SHOULD_ALLOW_SERVICE_WORKER_REGISTRATION = import.meta.env.PROD;

  type NotificationDiagnostic = {
    timestamp: string;
    label: string;
    value: string;
  };

  let notificationLog = $state<NotificationDiagnostic[]>([]);
  let isFiringNotification = $state(false);

  function logNotificationDiagnostic(label: string, value: unknown) {
    const entry: NotificationDiagnostic = {
      timestamp: new Date().toLocaleTimeString([], { hour12: false }),
      label,
      value: typeof value === 'string' ? value : JSON.stringify(value)
    };
    notificationLog = [entry, ...notificationLog].slice(0, 50);
  }

  function readNotificationEnvironment() {
    return readNotificationEnvironmentSnapshot();
  }

  async function describeServiceWorker() {
    return describeNotificationServiceWorker(1500);
  }

  async function inspectNotificationEnvironment() {
    logNotificationDiagnostic('environment', readNotificationEnvironment());
    const sw = await describeServiceWorker();
    logNotificationDiagnostic('serviceWorker', sw);
  }

  async function registerServiceWorkerManually() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      logNotificationDiagnostic('sw.register', 'serviceWorker not supported in this browser');
      return;
    }

    if (!SHOULD_ALLOW_SERVICE_WORKER_REGISTRATION) {
      logNotificationDiagnostic(
        'sw.register.skipped',
        'Service-worker registration is disabled in development for this app. Use a production build to test /sw.js registration.'
      );
      return;
    }

    // Dump every existing registration on this origin so we can see whether
    // the auto-registration ran but landed on a different scope.
    try {
      const all = await navigator.serviceWorker.getRegistrations();
      logNotificationDiagnostic(
        'sw.getRegistrations',
        all.map((reg) => ({
          scope: reg.scope,
          installingState: reg.installing?.state ?? null,
          waitingState: reg.waiting?.state ?? null,
          activeState: reg.active?.state ?? null,
          activeScript: reg.active?.scriptURL ?? null
        }))
      );
    } catch (error) {
      logNotificationDiagnostic(
        'sw.getRegistrations.error',
        error instanceof Error ? error.message : String(error)
      );
    }

    // Try every plausible SW URL so we can tell prod-build vs vite-dev.
    const candidates: { url: string; type: 'classic' | 'module' }[] = [
      { url: '/sw.js', type: 'classic' }
    ];

    for (const candidate of candidates) {
      try {
        const probe = await fetch(candidate.url, { cache: 'no-store' });
        logNotificationDiagnostic(`sw.fetch ${candidate.url}`, {
          status: probe.status,
          contentType: probe.headers.get('content-type'),
          contentLength: probe.headers.get('content-length')
        });
        if (!probe.ok) continue;

        const ct = probe.headers.get('content-type') ?? '';
        if (!ct.includes('javascript')) {
          logNotificationDiagnostic(
            `sw.fetch ${candidate.url}.warning`,
            `served with content-type "${ct}" (browsers reject SWs not served as JS)`
          );
          continue;
        }

        const registration = await navigator.serviceWorker.register(candidate.url, {
          scope: '/',
          type: candidate.type,
          updateViaCache: 'none'
        });
        logNotificationDiagnostic(`sw.register.ok ${candidate.url}`, {
          scope: registration.scope,
          installingState: registration.installing?.state ?? null,
          waitingState: registration.waiting?.state ?? null,
          activeState: registration.active?.state ?? null
        });
        window.setTimeout(() => {
          void inspectNotificationEnvironment();
        }, 1500);
        return;
      } catch (error) {
        logNotificationDiagnostic(
          `sw.register.error ${candidate.url}`,
          error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        );
      }
    }

    logNotificationDiagnostic(
      'sw.register.summary',
      'No service-worker URL was successfully registered. See entries above for the per-URL reason.'
    );
  }

  async function unregisterAllServiceWorkers() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      logNotificationDiagnostic('sw.unregister', 'serviceWorker not supported');
      return;
    }
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) {
        logNotificationDiagnostic('sw.unregister', 'no registrations found');
        return;
      }
      for (const reg of regs) {
        const ok = await reg.unregister();
        logNotificationDiagnostic('sw.unregister', { scope: reg.scope, ok });
      }
    } catch (error) {
      logNotificationDiagnostic(
        'sw.unregister.error',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async function requestNotificationPermissionFromMaintenance() {
    if (getNotificationPermission() == null) {
      logNotificationDiagnostic('permission.requestPermission', 'Notification API unavailable');
      return;
    }
    try {
      const result = await requestNotificationPermission();
      logNotificationDiagnostic('permission.requestPermission', result ?? 'unsupported');
    } catch (error) {
      logNotificationDiagnostic(
        'permission.requestPermission.error',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async function fireTestNotification() {
    if (isFiringNotification) {
      return;
    }
    isFiringNotification = true;

    try {
      logNotificationDiagnostic('test.start', readNotificationEnvironment());

      const permission = getNotificationPermission();
      if (permission == null) {
        logNotificationDiagnostic('test.error', 'Notification API not available in this browser.');
        return;
      }

      if (permission !== 'granted') {
        logNotificationDiagnostic(
          'test.permission',
          `permission is "${permission}"; click "Request permission" first.`
        );
        return;
      }

      const title = 'Hermes notification test';
      const body = `Fired at ${new Date().toLocaleTimeString()} from /maintenance.`;
      const tag = `maintenance-test-${Date.now()}`;

      // Try service-worker delivery first (Android-friendly).
      let serviceWorkerDelivered = false;
      try {
        serviceWorkerDelivered = await showServiceWorkerNotification(
          { title, body, tag, url: '/maintenance' },
          { timeoutMs: 1500 }
        );
        if (serviceWorkerDelivered) {
          logNotificationDiagnostic('test.sw.showNotification', 'resolved OK');
        } else {
          logNotificationDiagnostic(
            'test.sw.showNotification',
            'no usable service worker registration; falling back to page Notification API'
          );
        }
      } catch (error) {
        logNotificationDiagnostic(
          'test.sw.error',
          error instanceof Error ? error.message : String(error)
        );
      }

      // Always fire the page-level Notification too — useful for desktop diagnosis.
      try {
        showPageNotification({ title: title + ' (page)', body, tag: `${tag}-page` });
        logNotificationDiagnostic(
          'test.page.Notification',
          serviceWorkerDelivered ? 'fired (alongside SW notification)' : 'fired (SW unavailable)'
        );
      } catch (error) {
        logNotificationDiagnostic(
          'test.page.error',
          error instanceof Error ? error.message : String(error)
        );
      }

      // Prove the notification was actually created (vs. silently suppressed
      // by an OS-level setting). If getNotifications() returns our entry,
      // the browser API succeeded — any "I don't see a banner" problem is
      // then 100% an OS / Focus / Notification Center issue.
      try {
        const reg = await getNotificationServiceWorkerRegistration(1500);
        if (reg) {
          const live = await reg.getNotifications();
          logNotificationDiagnostic(
            'test.sw.getNotifications',
            live.map((n) => ({ title: n.title, body: n.body, tag: n.tag }))
          );
        }
      } catch (error) {
        logNotificationDiagnostic(
          'test.sw.getNotifications.error',
          error instanceof Error ? error.message : String(error)
        );
      }
    } finally {
      isFiringNotification = false;
    }
  }

  async function fireDelayedNotification(delaySeconds: number) {
    logNotificationDiagnostic(
      'test.delayed.scheduled',
      `Will fire in ${delaySeconds}s — switch tabs / minimize the window now.`
    );
    window.setTimeout(() => {
      void fireTestNotification();
    }, delaySeconds * 1000);
  }

  function formatBytes(bytes: number | null | undefined) {
    if (!bytes || !Number.isFinite(bytes)) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function formatDuration(seconds: number | null | undefined) {
    if (!seconds || !Number.isFinite(seconds)) {
      return '0s';
    }
    if (seconds >= 3600) {
      return `${(seconds / 3600).toFixed(1)}h`;
    }
    if (seconds >= 60) {
      return `${(seconds / 60).toFixed(1)}m`;
    }
    return `${seconds}s`;
  }

  function pretty(value: unknown) {
    return JSON.stringify(value, null, 2);
  }

  function verdictClasses(code: string) {
    if (code === 'receiver-ready') {
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
    }
    if (code === 'upstream-likely' || code === 'sender-no-attachments' || code === 'worker-heartbeat-stale') {
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    }
    return 'bg-destructive/15 text-destructive';
  }
</script>

<svelte:head>
  <title>Maintenance</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
  <div class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Hermes WebUI</p>
        <h1 class="text-3xl font-semibold tracking-tight">Maintenance</h1>
        <p class="mt-2 max-w-3xl text-sm text-muted-foreground">
          Token-protected diagnostics for the currently running webui instance.
        </p>
      </div>

      {#if data.authorized}
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            onclick={() => window.location.reload()}
          >
            Refresh
          </button>
          <form method="POST" action="?/logout">
            <button class="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" type="submit">
              Lock page
            </button>
          </form>
        </div>
      {/if}
    </div>

    {#if !data.enabled}
      <section class="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 class="text-lg font-semibold">Maintenance page disabled</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          Set <code>MAINTENANCE_TOKEN</code> in the environment to enable this page.
        </p>
      </section>
    {:else if !data.authorized}
      <section class="mx-auto w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 class="text-lg font-semibold">Enter maintenance token</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          This page exposes internal build and runtime diagnostics. Access requires the maintenance token.
        </p>

        {#if data.tokenError || form?.error}
          <div class="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {form?.error ?? data.tokenError}
          </div>
        {/if}

        <form class="mt-5 flex flex-col gap-3" method="POST" action="?/login">
          <label class="flex flex-col gap-2 text-sm font-medium">
            Token
            <input
              class="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              type="password"
              name="token"
              autocomplete="current-password"
              required
            />
          </label>
          <button class="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" type="submit">
            Unlock maintenance view
          </button>
        </form>
      </section>
    {:else if data.snapshot}
      {@const snapshot = data.snapshot!}

      <section class="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">Notification plumbing test</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Fires real browser notifications using the same code paths as the chat page (service-worker
              <code>showNotification</code> + page <code>Notification</code> fallback). On Android,
              page-level <code>Notification</code> is essentially a no-op — only service-worker
              notifications surface in the system tray. If <em>Inspect environment</em> shows
              <code>existingScope: null</code>, click <em>Register service worker</em> in a production build and
              watch the log for the failure reason. Development mode keeps service-worker registration
              disabled.
            </p>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            onclick={requestNotificationPermissionFromMaintenance}
          >
            Request permission
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            onclick={inspectNotificationEnvironment}
          >
            Inspect environment
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
            disabled={!SHOULD_ALLOW_SERVICE_WORKER_REGISTRATION}
            title={
              SHOULD_ALLOW_SERVICE_WORKER_REGISTRATION
                ? 'Register /sw.js for this origin'
                : 'Service-worker registration is only available in production builds'
            }
            onclick={registerServiceWorkerManually}
          >
            Register service worker
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            onclick={unregisterAllServiceWorkers}
          >
            Unregister SW
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            disabled={isFiringNotification}
            onclick={fireTestNotification}
          >
            Fire test notification now
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            onclick={() => fireDelayedNotification(5)}
          >
            Fire in 5s (switch away)
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            onclick={() => fireDelayedNotification(15)}
          >
            Fire in 15s
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            onclick={() => (notificationLog = [])}
          >
            Clear log
          </button>
        </div>

        <div class="mt-4 rounded-lg border border-border bg-muted/40 p-4 text-sm">
          {#if notificationLog.length === 0}
            <p class="text-muted-foreground">
              No diagnostics yet. Click <em>Inspect environment</em> to see permission state, service-worker
              status, focus, and visibility — then <em>Fire test notification now</em>.
            </p>
          {:else}
            <ol class="space-y-2 font-mono text-xs">
              {#each notificationLog as entry}
                <li class="rounded-md bg-background p-2">
                  <div class="text-muted-foreground">[{entry.timestamp}] {entry.label}</div>
                  <pre class="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{entry.value}</pre>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      </section>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div class="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Build</div>
          <div class="mt-3 text-2xl font-semibold [overflow-wrap:anywhere]">{snapshot.build.frontend}</div>
          <div class="mt-2 text-sm text-muted-foreground">Source: {snapshot.build.source}</div>
          <div class="mt-3 space-y-1 text-sm [overflow-wrap:anywhere]">
            <div>Tag: {snapshot.build.gitTag ?? 'n/a'}</div>
            <div>Branch: {snapshot.build.gitBranch ?? 'n/a'}</div>
            <div>Commit: {snapshot.build.gitCommit ?? 'n/a'}</div>
            <div>Commit short: {snapshot.build.gitCommitShort ?? 'n/a'}</div>
            <div>Built: {snapshot.build.buildTime ?? 'n/a'}</div>
          </div>
        </div>

        <div class="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Runtime</div>
          <div class="mt-3 text-2xl font-semibold [overflow-wrap:anywhere]">{snapshot.runtime.env}</div>
          <div class="mt-2 text-sm text-muted-foreground">Node {snapshot.runtime.nodeVersion}</div>
          <div class="mt-3 space-y-1 text-sm [overflow-wrap:anywhere]">
            <div>Uptime: {formatDuration(snapshot.runtime.uptimeSeconds)}</div>
            <div>PID: {snapshot.runtime.pid}</div>
            <div>Host: {snapshot.runtime.hostname}</div>
          </div>
        </div>

        <div class="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Hermes Queue</div>
          <div class="mt-3 text-2xl font-semibold">{snapshot.queue.queued}</div>
          <div class="mt-2 text-sm text-muted-foreground">queued events</div>
          <div class="mt-3 space-y-1 text-sm [overflow-wrap:anywhere]">
            <div>Processing: {snapshot.queue.processing}</div>
            <div>Stale: {snapshot.queue.staleProcessing}</div>
            <div>Acked: {snapshot.queue.acked}</div>
            <div>
              Worker heartbeat: {snapshot.workerHeartbeat.isOnline ? 'fresh' : 'stale'}
              {#if snapshot.workerHeartbeat.lastSeenAt}
                ({snapshot.workerHeartbeat.ageSeconds}s ago)
              {/if}
            </div>
          </div>
        </div>

        <div class="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Memory</div>
          <div class="mt-3 text-2xl font-semibold">{formatBytes(snapshot.runtime.memory.heapUsed)}</div>
          <div class="mt-2 text-sm text-muted-foreground">heap used</div>
          <div class="mt-3 space-y-1 text-sm [overflow-wrap:anywhere]">
            <div>Heap total: {formatBytes(snapshot.runtime.memory.heapTotal)}</div>
            <div>RSS: {formatBytes(snapshot.runtime.memory.rss)}</div>
            <div>External: {formatBytes(snapshot.runtime.memory.external)}</div>
          </div>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div class="rounded-xl border border-border bg-card p-5 shadow-sm xl:col-span-2">
          <h2 class="text-lg font-semibold">System checks</h2>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <div class="min-w-0 rounded-lg border border-border bg-muted/40 p-4">
              <div class="flex items-center justify-between gap-3">
                <h3 class="font-medium">Database</h3>
                <span class={`rounded-full px-2 py-1 text-xs font-medium ${snapshot.database.ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                  {snapshot.database.ok ? 'OK' : 'Error'}
                </span>
              </div>
              <dl class="mt-3 space-y-1 text-sm [overflow-wrap:anywhere]">
                <div>Version: {snapshot.database.version ?? 'n/a'}</div>
                <div>Server time: {snapshot.database.serverTime ?? 'n/a'}</div>
                <div>Users: {snapshot.database.counts?.users ?? 'n/a'}</div>
                <div>Conversations: {snapshot.database.counts?.conversations ?? 'n/a'}</div>
                <div>Messages: {snapshot.database.counts?.messages ?? 'n/a'}</div>
                <div>Attachments: {snapshot.database.counts?.attachments ?? 'n/a'}</div>
                <div>Web sessions: {snapshot.database.counts?.activeSessions ?? 'n/a'}</div>
              </dl>
              {#if snapshot.database.error}
                <p class="mt-3 text-sm text-destructive">{snapshot.database.error}</p>
              {/if}
            </div>

            <div class="min-w-0 rounded-lg border border-border bg-muted/40 p-4">
              <div class="flex items-center justify-between gap-3">
                <h3 class="font-medium">Object storage</h3>
                <span class={`rounded-full px-2 py-1 text-xs font-medium ${snapshot.storage.ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                  {snapshot.storage.ok ? 'OK' : 'Error'}
                </span>
              </div>
              <dl class="mt-3 space-y-1 text-sm [overflow-wrap:anywhere]">
                <div>Endpoint: {snapshot.storage.endpoint}:{snapshot.storage.port}</div>
                <div>Bucket: {snapshot.storage.bucket}</div>
                <div>SSL: {snapshot.storage.useSsl ? 'enabled' : 'disabled'}</div>
                <div>Bucket exists: {snapshot.storage.bucketExists ? 'yes' : 'no'}</div>
              </dl>
              {#if snapshot.storage.error}
                <p class="mt-3 text-sm text-destructive">{snapshot.storage.error}</p>
              {/if}
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-border bg-card p-5 shadow-sm xl:col-span-2">
          <h2 class="text-lg font-semibold">File delivery diagnosis</h2>
          <p class="mt-2 text-sm text-muted-foreground">
            Receiver-side diagnosis only. This verifies what webui can prove locally, not the live Hermes sender target or tool schema.
          </p>

          <div class="mt-4 rounded-lg border border-border bg-muted/40 p-4">
            <div>
              <div class="font-medium">{snapshot.fileDeliveryDiagnosis.verdict}</div>
              <p class="mt-1 text-sm text-muted-foreground">{snapshot.fileDeliveryDiagnosis.summary}</p>
            </div>

            <div class="mt-3">
              <span class={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${verdictClasses(snapshot.fileDeliveryDiagnosis.code)}`}>
                {snapshot.fileDeliveryDiagnosis.code}
              </span>
            </div>

            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <div class="min-w-0 rounded-md bg-background p-3 text-sm [overflow-wrap:anywhere]">
                <div><span class="font-medium">Metadata mode:</span> {snapshot.build.metadataMode}</div>
                <div><span class="font-medium">Last attachment:</span> {snapshot.database.attachmentStats.lastAttachmentAt ?? 'never'}</div>
                <div><span class="font-medium">Last assistant attachment:</span> {snapshot.database.attachmentStats.lastAssistantAttachmentAt ?? 'never'}</div>
                <div><span class="font-medium">Assistant attachment signal:</span> {snapshot.database.attachmentStats.assistantAttachmentSignal}</div>
              </div>
              <div class="min-w-0 rounded-md bg-background p-3 text-sm [overflow-wrap:anywhere]">
                <div><span class="font-medium">Total attachments:</span> {snapshot.database.attachmentStats.totalCount}</div>
                <div><span class="font-medium">Assistant attachments:</span> {snapshot.database.attachmentStats.assistantCount}</div>
                <div><span class="font-medium">User attachments:</span> {snapshot.database.attachmentStats.userCount}</div>
                <div><span class="font-medium">Verification scope:</span> {snapshot.fileDeliveryDiagnosis.verificationScope}</div>
              </div>
            </div>

            <div class="mt-4 grid gap-2 text-sm [overflow-wrap:anywhere]">
              <div><span class="font-medium">Database OK:</span> {snapshot.fileDeliveryDiagnosis.checks.databaseOk ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Storage OK:</span> {snapshot.fileDeliveryDiagnosis.checks.storageOk ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Bucket exists:</span> {snapshot.fileDeliveryDiagnosis.checks.bucketExists ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Hermes token configured:</span> {snapshot.fileDeliveryDiagnosis.checks.hermesServiceTokenConfigured ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Queue not stuck:</span> {snapshot.fileDeliveryDiagnosis.checks.queueNotStuck ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Worker heartbeat fresh:</span> {snapshot.fileDeliveryDiagnosis.checks.workerHeartbeatFresh ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Recent worker auth failure:</span> {snapshot.fileDeliveryDiagnosis.checks.workerAuthFailureRecent ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Queued without worker:</span> {snapshot.fileDeliveryDiagnosis.checks.queuedWithoutWorker ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Recent sender trace seen:</span> {snapshot.fileDeliveryDiagnosis.checks.recentSenderTraceSeen ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Recent sender trace with attachment:</span> {snapshot.fileDeliveryDiagnosis.checks.recentSenderTraceWithAttachment ? 'yes' : 'no'}</div>
              <div><span class="font-medium">Sender config verified:</span> {snapshot.fileDeliveryDiagnosis.senderConfigVerified ? 'yes' : 'no'}</div>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 class="text-lg font-semibold">Recent Hermes delivery traces</h2>
          <p class="mt-2 text-sm text-muted-foreground">
            Sender-declared webchat delivery attempts that actually reached this deployment. Use this to compare what Hermes said it posted against what the receiver stored.
          </p>
          <p class="mt-2 text-sm text-muted-foreground">
            When the receiver sees a top-level assistant <code>timings</code> payload, the trace route is tagged as <code>webchat_adapter+timings</code>.
          </p>

          <div class="mt-4 grid gap-3 md:grid-cols-2 text-sm">
            <div class="rounded-md bg-muted/40 p-4">
              <div><span class="font-medium">Total traces:</span> {snapshot.deliveryTraces.totalCount}</div>
              <div><span class="font-medium">Accepted:</span> {snapshot.deliveryTraces.acceptedCount}</div>
              <div><span class="font-medium">Rejected:</span> {snapshot.deliveryTraces.rejectedCount}</div>
              <div><span class="font-medium">With attachments:</span> {snapshot.deliveryTraces.withAttachmentsCount}</div>
              <div><span class="font-medium">Last received:</span> {snapshot.deliveryTraces.lastReceivedAt ?? 'never'}</div>
            </div>

            <div class="rounded-md bg-muted/40 p-4">
              <div><span class="font-medium">Trace query OK:</span> {snapshot.deliveryTraces.ok ? 'yes' : 'no'}</div>
              {#if snapshot.deliveryTraces.error}
                <div class="text-destructive">{snapshot.deliveryTraces.error}</div>
              {/if}
              {#if !snapshot.deliveryTraces.totalCount}
                <div class="mt-2 text-muted-foreground">No Hermes delivery traces have reached this deployment yet.</div>
              {/if}
            </div>
          </div>

          {#if snapshot.deliveryTraces.recent.length > 0}
            <div class="mt-4 space-y-3">
              {#each snapshot.deliveryTraces.recent as trace}
                <div class="min-w-0 rounded-lg border border-border bg-muted/30 p-4 text-sm">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0 [overflow-wrap:anywhere]">
                      <div class="font-medium">{trace.route} at {trace.createdAt}</div>
                      <div class="mt-1 text-muted-foreground">Target: {trace.senderTargetUrl ?? 'n/a'}</div>
                    </div>
                    <span class={`rounded-full px-2 py-1 text-xs font-medium ${trace.receiverStatus === 'accepted' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                      {trace.receiverStatus}
                    </span>
                  </div>

                  <div class="mt-3 grid gap-2 md:grid-cols-2 [overflow-wrap:anywhere]">
                    <div>Conversation: {trace.conversationId}</div>
                    <div>Receiver message: {trace.receiverMessageId ?? 'n/a'}</div>
                    <div>Trace id: {trace.senderTraceId ?? 'n/a'}</div>
                    <div>Sender host: {trace.senderHostname ?? 'n/a'}</div>
                    <div>Session: {trace.senderSessionPlatform ?? 'n/a'} / {trace.senderSessionChatId ?? 'n/a'}</div>
                    <div>Content length: {trace.contentLength}</div>
                    <div>Attachment count: {trace.attachmentCount}</div>
                    <div>Attachment names: {trace.attachmentNames.length ? trace.attachmentNames.join(', ') : 'none'}</div>
                  </div>

                  {#if trace.errorText}
                    <p class="mt-3 text-destructive">{trace.errorText}</p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 class="text-lg font-semibold">Recent assistant timings</h2>
          <p class="mt-2 text-sm text-muted-foreground">
            llama.cpp-style inference timings as stored on the most-recent assistant messages. Used to verify that the upstream sender is forwarding <code>timings</code> and that they are being persisted into the <code>messages.timings</code> JSON column. Older messages predating the timings work will show <em>none</em>.
          </p>

          <div class="mt-4 grid gap-3 md:grid-cols-2 text-sm">
            <div class="rounded-md bg-muted/40 p-4">
              <div><span class="font-medium">Total assistant messages:</span> {snapshot.recentAssistantTimings.totalAssistantCount}</div>
              <div><span class="font-medium">With timings:</span> {snapshot.recentAssistantTimings.withTimingsCount}</div>
              <div><span class="font-medium">Without timings:</span> {snapshot.recentAssistantTimings.withoutTimingsCount}</div>
              <div><span class="font-medium">Last with timings:</span> {snapshot.recentAssistantTimings.lastWithTimingsAt ?? 'never'}</div>
            </div>
            <div class="rounded-md bg-muted/40 p-4">
              <div><span class="font-medium">Query OK:</span> {snapshot.recentAssistantTimings.ok ? 'yes' : 'no'}</div>
              {#if snapshot.recentAssistantTimings.error}
                <div class="text-destructive">{snapshot.recentAssistantTimings.error}</div>
              {/if}
              {#if snapshot.recentAssistantTimings.totalAssistantCount > 0 && snapshot.recentAssistantTimings.withTimingsCount === 0}
                <div class="mt-2 text-muted-foreground">
                  No assistant message has stored timings yet. Either the upstream provider is not llama.cpp (no <code>timings</code> emitted), or the sender/receiver pipeline is not forwarding them. Send a fresh message via webchat to test.
                </div>
              {/if}
            </div>
          </div>

          {#if snapshot.recentAssistantTimings.recent.length > 0}
            <div class="mt-4 space-y-3">
              {#each snapshot.recentAssistantTimings.recent as msg}
                <div class="min-w-0 rounded-lg border border-border bg-muted/30 p-4 text-sm">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                      <div class="font-medium">{msg.createdAt ?? 'unknown time'}</div>
                      <div class="mt-1 text-muted-foreground break-all">id: {msg.id}</div>
                      <div class="text-muted-foreground break-all">conversation: {msg.conversationId}</div>
                    </div>
                    <span class={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${msg.timings ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                      {msg.timings ? 'has timings' : 'no timings'}
                    </span>
                  </div>
                  <div class="mt-2 text-muted-foreground [overflow-wrap:anywhere]">
                    Content ({msg.contentLength} chars): <span class="text-foreground">{msg.contentSnippet || '(empty)'}{msg.contentLength > msg.contentSnippet.length ? '\u2026' : ''}</span>
                  </div>
                  {#if msg.timingsRaw}
                    <pre class="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-background/60 p-3 text-xs [overflow-wrap:anywhere]">{msg.timingsRaw}</pre>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="mt-4 text-sm text-muted-foreground">No assistant messages found.</div>
          {/if}
        </div>

        <div class="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 class="text-lg font-semibold">Request and config</h2>
          <dl class="mt-4 space-y-2 text-sm [overflow-wrap:anywhere]">
            <div><span class="font-medium">Collected at:</span> {snapshot.collectedAt}</div>
            <div><span class="font-medium">Origin:</span> {snapshot.request.origin}</div>
            <div><span class="font-medium">Host:</span> {snapshot.request.forwardedHost ?? snapshot.request.host ?? 'n/a'}</div>
            <div><span class="font-medium">Forwarded proto:</span> {snapshot.request.forwardedProto ?? 'n/a'}</div>
            <div><span class="font-medium">App name:</span> {snapshot.config.publicAppName}</div>
            <div><span class="font-medium">DB target:</span> {snapshot.config.database.host}:{snapshot.config.database.port}/{snapshot.config.database.name}</div>
            <div><span class="font-medium">Storage target:</span> {snapshot.config.objectStorage.endpoint}:{snapshot.config.objectStorage.port}/{snapshot.config.objectStorage.bucket}</div>
            <div><span class="font-medium">Storage prefix:</span> {snapshot.config.objectStorage.prefix || '(none)'}</div>
            <div><span class="font-medium">Hermes token configured:</span> {snapshot.config.hermesServiceTokenConfigured ? 'yes' : 'no'}</div>
            <div><span class="font-medium">Maintenance token configured:</span> {snapshot.config.maintenanceTokenConfigured ? 'yes' : 'no'}</div>
          </dl>
        </div>
      </section>

      <section class="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 class="text-lg font-semibold">Raw snapshot</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          Copy this block when debugging deployment mismatches, stale containers, queue issues, or missing build metadata.
        </p>
        <pre class="mt-4 max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-[11px] leading-5 [overflow-wrap:anywhere] sm:text-xs">{pretty(snapshot)}</pre>
      </section>
    {:else}
      <section class="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 class="text-lg font-semibold">Maintenance snapshot unavailable</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          The page is unlocked, but no snapshot was returned for this request. Refresh to try again.
        </p>
      </section>
    {/if}
  </div>
</div>