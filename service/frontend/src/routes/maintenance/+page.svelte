<script lang="ts">
  let { data, form } = $props();

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
        <div class="flex items-center gap-3">
          <a class="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent" href="/maintenance">
            Refresh
          </a>
          <form method="POST" action="?/logout">
            <button class="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" type="submit">
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
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Build</div>
          <div class="mt-3 text-2xl font-semibold">{snapshot.build.frontend}</div>
          <div class="mt-2 text-sm text-muted-foreground">Source: {snapshot.build.source}</div>
          <div class="mt-3 space-y-1 text-sm">
            <div>Tag: {snapshot.build.gitTag ?? 'n/a'}</div>
            <div>Branch: {snapshot.build.gitBranch ?? 'n/a'}</div>
            <div>Commit: {snapshot.build.gitCommit ?? 'n/a'}</div>
            <div>Commit short: {snapshot.build.gitCommitShort ?? 'n/a'}</div>
            <div>Built: {snapshot.build.buildTime ?? 'n/a'}</div>
          </div>
        </div>

        <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Runtime</div>
          <div class="mt-3 text-2xl font-semibold">{snapshot.runtime.env}</div>
          <div class="mt-2 text-sm text-muted-foreground">Node {snapshot.runtime.nodeVersion}</div>
          <div class="mt-3 space-y-1 text-sm">
            <div>Uptime: {formatDuration(snapshot.runtime.uptimeSeconds)}</div>
            <div>PID: {snapshot.runtime.pid}</div>
            <div>Host: {snapshot.runtime.hostname}</div>
          </div>
        </div>

        <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Hermes Queue</div>
          <div class="mt-3 text-2xl font-semibold">{snapshot.queue.queued}</div>
          <div class="mt-2 text-sm text-muted-foreground">queued events</div>
          <div class="mt-3 space-y-1 text-sm">
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

        <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Memory</div>
          <div class="mt-3 text-2xl font-semibold">{formatBytes(snapshot.runtime.memory.heapUsed)}</div>
          <div class="mt-2 text-sm text-muted-foreground">heap used</div>
          <div class="mt-3 space-y-1 text-sm">
            <div>Heap total: {formatBytes(snapshot.runtime.memory.heapTotal)}</div>
            <div>RSS: {formatBytes(snapshot.runtime.memory.rss)}</div>
            <div>External: {formatBytes(snapshot.runtime.memory.external)}</div>
          </div>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 class="text-lg font-semibold">System checks</h2>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <div class="rounded-lg border border-border bg-muted/40 p-4">
              <div class="flex items-center justify-between gap-3">
                <h3 class="font-medium">Database</h3>
                <span class={`rounded-full px-2 py-1 text-xs font-medium ${snapshot.database.ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                  {snapshot.database.ok ? 'OK' : 'Error'}
                </span>
              </div>
              <dl class="mt-3 space-y-1 text-sm">
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

            <div class="rounded-lg border border-border bg-muted/40 p-4">
              <div class="flex items-center justify-between gap-3">
                <h3 class="font-medium">Object storage</h3>
                <span class={`rounded-full px-2 py-1 text-xs font-medium ${snapshot.storage.ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                  {snapshot.storage.ok ? 'OK' : 'Error'}
                </span>
              </div>
              <dl class="mt-3 space-y-1 text-sm">
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
              <div class="rounded-md bg-background p-3 text-sm">
                <div><span class="font-medium">Metadata mode:</span> {snapshot.build.metadataMode}</div>
                <div><span class="font-medium">Last attachment:</span> {snapshot.database.attachmentStats.lastAttachmentAt ?? 'never'}</div>
                <div><span class="font-medium">Last assistant attachment:</span> {snapshot.database.attachmentStats.lastAssistantAttachmentAt ?? 'never'}</div>
                <div><span class="font-medium">Assistant attachment signal:</span> {snapshot.database.attachmentStats.assistantAttachmentSignal}</div>
              </div>
              <div class="rounded-md bg-background p-3 text-sm">
                <div><span class="font-medium">Total attachments:</span> {snapshot.database.attachmentStats.totalCount}</div>
                <div><span class="font-medium">Assistant attachments:</span> {snapshot.database.attachmentStats.assistantCount}</div>
                <div><span class="font-medium">User attachments:</span> {snapshot.database.attachmentStats.userCount}</div>
                <div><span class="font-medium">Verification scope:</span> {snapshot.fileDeliveryDiagnosis.verificationScope}</div>
              </div>
            </div>

            <div class="mt-4 grid gap-2 text-sm">
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
                <div class="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="font-medium">{trace.route} at {trace.createdAt}</div>
                      <div class="mt-1 text-muted-foreground">Target: {trace.senderTargetUrl ?? 'n/a'}</div>
                    </div>
                    <span class={`rounded-full px-2 py-1 text-xs font-medium ${trace.receiverStatus === 'accepted' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                      {trace.receiverStatus}
                    </span>
                  </div>

                  <div class="mt-3 grid gap-2 md:grid-cols-2">
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
          <h2 class="text-lg font-semibold">Request and config</h2>
          <dl class="mt-4 space-y-2 text-sm">
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
        <pre class="mt-4 overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-5">{pretty(snapshot)}</pre>
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