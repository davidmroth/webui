<script lang="ts">
  import {
    BookOpenText,
    Clock3,
    Copy,
    Edit,
    Gauge,
    GitBranch,
    RefreshCw,
    Sparkles,
    Trash2,
    WholeWord
  } from '@lucide/svelte';
  import { env as publicEnv } from '$env/dynamic/public';
  import type { ChatMessage } from '$lib/types-legacy';
  import { renderMarkdown } from '$lib/utils/markdown';

  type StatsView = 'reading' | 'generation';

  interface MessageStats {
    promptTokens: number | null;
    promptSeconds: number | null;
    promptTokensPerSecond: number | null;
    generatedTokens: number;
    generatedSeconds: number;
    generatedTokensPerSecond: number;
  }

  interface Props {
    messages: ChatMessage[];
    use24HourTime?: boolean;
    copiedMessageId?: string | null;
    onCopy?: (message: ChatMessage) => void;
    onRegenerate?: (message: ChatMessage) => void;
    onDelete?: (message: ChatMessage) => void;
    busyMessageIds?: Set<string>;
    scrollContainer?: HTMLDivElement | null;
    onScroll?: () => void;
  }

  let {
    messages,
    use24HourTime = false,
    copiedMessageId = null,
    onCopy,
    onRegenerate,
    onDelete,
    busyMessageIds,
    scrollContainer = $bindable(null),
    onScroll
  }: Props = $props();
  let statsViewByMessageId = $state<Record<string, StatsView>>({});

  const modelBadges = [
    publicEnv.PUBLIC_MODEL_SIZE_LABEL,
    publicEnv.PUBLIC_MODEL_CAPABILITY_LABEL,
    publicEnv.PUBLIC_MODEL_FILE_LABEL
  ].filter(Boolean);

  function formatRole(role: ChatMessage['role']) {
    return role === 'assistant' ? 'Assistant' : role === 'system' ? 'System' : 'You';
  }

  function hasVisibleContent(message: ChatMessage) {
    return message.content.trim().length > 0;
  }

  function isStreamingAssistant(message: ChatMessage) {
    return message.role === 'assistant' && message.status === 'streaming';
  }

  function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function buildMessageStats(message: ChatMessage, _index: number): MessageStats | null {
    if (message.role !== 'assistant') {
      return null;
    }

    // Real timings only — when the upstream provider doesn't emit llama.cpp
    // ``timings`` (OpenAI, Anthropic, ...), we hide the stats panel rather
    // than fabricating estimates from word counts and wall-clock diffs.
    const timings = message.timings;
    if (!timings || typeof timings !== 'object') {
      return null;
    }

    const promptTokens = toFiniteNumber((timings as Record<string, unknown>).prompt_n);
    const promptMs = toFiniteNumber((timings as Record<string, unknown>).prompt_ms);
    const generatedTokens = toFiniteNumber((timings as Record<string, unknown>).predicted_n);
    const generatedMs = toFiniteNumber((timings as Record<string, unknown>).predicted_ms);

    // Need at least the generation side to surface anything meaningful.
    if (generatedTokens == null || generatedMs == null || generatedMs <= 0) {
      return null;
    }

    const promptSeconds = promptMs != null && promptMs > 0 ? promptMs / 1000 : null;
    const generatedSeconds = generatedMs / 1000;

    return {
      promptTokens,
      promptSeconds,
      promptTokensPerSecond:
        promptTokens != null && promptSeconds != null && promptSeconds > 0
          ? promptTokens / promptSeconds
          : null,
      generatedTokens,
      generatedSeconds,
      generatedTokensPerSecond:
        generatedSeconds > 0 ? generatedTokens / generatedSeconds : 0
    };
  }

  function formatDuration(seconds: number | null) {
    if (!seconds || !Number.isFinite(seconds)) {
      return '0.0s';
    }

    if (seconds >= 60) {
      return `${(seconds / 60).toFixed(1)}m`;
    }

    return `${seconds.toFixed(1)}s`;
  }

  function activeStatsView(messageId: string): StatsView {
    return statsViewByMessageId[messageId] ?? 'generation';
  }

  function setStatsView(messageId: string, view: StatsView) {
    statsViewByMessageId = {
      ...statsViewByMessageId,
      [messageId]: view
    };
  }

  function formatMessageTime(value: string) {
    return new Date(value).toLocaleTimeString([], {
      hour: use24HourTime ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !use24HourTime
    });
  }
</script>

<div bind:this={scrollContainer} class="llama-message-scroll" onscroll={onScroll}>
  <div class="llama-message-stack">
    {#if messages.length === 0}
      <div class="card" style="padding: 1rem; color: var(--text-muted);">
        This conversation is empty. Send a message to enqueue the first Hermes turn.
      </div>
    {/if}

    {#each messages as message, index}
      <div class={`llama-message-row ${message.role}`}>
        <div class="llama-message-card">
          <div class="llama-message-header">
            <div class="llama-message-role">
              <span class="message-role-dot"></span>
              {formatRole(message.role)}
            </div>
            <div class="message-meta">
              {formatMessageTime(message.createdAt)}
            </div>
          </div>
          {#if isStreamingAssistant(message) && !hasVisibleContent(message)}
            <div class="assistant-typing-indicator" role="status" aria-live="polite" aria-label="Assistant is typing">
              <span class="assistant-typing-bubble" aria-hidden="true">
                <span class="assistant-typing-dot"></span>
                <span class="assistant-typing-dot"></span>
                <span class="assistant-typing-dot"></span>
              </span>
            </div>
          {:else if message.content}
            {#if message.role === 'assistant'}
              <div class="llama-message-body markdown-content">{@html renderMarkdown(message.content)}</div>
            {:else}
              <div class="llama-message-body">{message.content}</div>
            {/if}
          {/if}
          {#if message.attachments.length > 0}
            <div class="attachment-stack">
              {#each message.attachments as attachment}
                {#if attachment.downloadUrl}
                  <a class="attachment-card" href={attachment.downloadUrl} target="_blank" rel="noreferrer">
                    {#if attachment.isImage}
                      <img class="attachment-preview" src={attachment.downloadUrl} alt={attachment.fileName} />
                    {/if}
                    <div>
                      <div>{attachment.fileName}</div>
                      <div class="message-meta">{attachment.contentType} · {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</div>
                    </div>
                  </a>
                {:else}
                  <div class="attachment-card">
                    <div>
                      <div>{attachment.fileName}</div>
                      <div class="message-meta">{attachment.contentType} · {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</div>
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
          {#if isStreamingAssistant(message) && hasVisibleContent(message)}
            <div class="assistant-stream-status" role="status" aria-live="polite">
              <span class="assistant-stream-pulse"></span>
              <span>Assistant is still typing...</span>
            </div>
          {:else if message.status !== 'complete' && !isStreamingAssistant(message)}
            <div class="message-meta">Status: {message.status}</div>
          {/if}

          {#if message.role === 'assistant' && !(isStreamingAssistant(message) && !hasVisibleContent(message))}
            {@const stats = buildMessageStats(message, index)}
            <div class="assistant-meta-row">
              <div class="assistant-meta-cluster assistant-model-badges">
                {#each modelBadges as badge}
                  <div class="assistant-model-badge assistant-model-tag">{badge}</div>
                {/each}
              </div>

              {#if stats}
                {@const view = activeStatsView(message.id)}
                <div class="assistant-meta-cluster assistant-stats-row">
                  <div class="assistant-stats-toggle">
                    <button
                      type="button"
                      class:active={view === 'reading'}
                      class="stats-toggle-button"
                      disabled={stats.promptTokens === null}
                      title={stats.promptTokens === null ? 'Reading metrics unavailable' : 'Reading metrics'}
                      onclick={() => setStatsView(message.id, 'reading')}
                    >
                      <BookOpenText class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class:active={view === 'generation'}
                      class="stats-toggle-button"
                      title="Generation metrics"
                      onclick={() => setStatsView(message.id, 'generation')}
                    >
                      <Sparkles class="h-3 w-3" />
                    </button>
                  </div>

                  <div class="assistant-stat-chip" title={view === 'reading' ? 'Prompt tokens' : 'Generated tokens'}>
                    <WholeWord class="h-3 w-3" />
                    <span>
                      {view === 'reading'
                        ? `${stats.promptTokens?.toLocaleString() ?? 0} tokens`
                        : `${stats.generatedTokens.toLocaleString()} tokens`}
                    </span>
                  </div>

                  <div class="assistant-stat-chip" title={view === 'reading' ? 'Prompt processing time' : 'Generation time'}>
                    <Clock3 class="h-3 w-3" />
                    <span>
                      {view === 'reading'
                        ? formatDuration(stats.promptSeconds)
                        : formatDuration(stats.generatedSeconds)}
                    </span>
                  </div>

                  <div class="assistant-stat-chip" title={view === 'reading' ? 'Prompt processing speed' : 'Generation speed'}>
                    <Gauge class="h-3 w-3" />
                    <span>
                      {view === 'reading'
                        ? `${(stats.promptTokensPerSecond ?? 0).toFixed(2)} t/s`
                        : `${stats.generatedTokensPerSecond.toFixed(2)} t/s`}
                    </span>
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          {#if !(isStreamingAssistant(message) && !hasVisibleContent(message))}
          {@const isBusy = busyMessageIds?.has(message.id) ?? false}
          <div class={`llama-message-actions ${message.role === 'user' ? 'user-actions' : 'assistant-actions'}`} aria-label="Message actions">
            <button
              class={`message-action-icon ${copiedMessageId === message.id ? 'is-active' : ''}`}
              type="button"
              title={copiedMessageId === message.id ? 'Copied' : 'Copy'}
              onclick={() => onCopy?.(message)}
            >
              <Copy class="h-3 w-3" />
            </button>
            <button class="message-action-icon disabled" type="button" title="Edit unavailable" disabled>
              <Edit class="h-3 w-3" />
            </button>
            {#if message.role === 'assistant'}
              <button
                class="message-action-icon"
                type="button"
                title={isBusy ? 'Regenerating…' : 'Regenerate'}
                disabled={isBusy || !onRegenerate}
                onclick={() => onRegenerate?.(message)}
              >
                <RefreshCw class="h-3 w-3" />
              </button>
            {/if}
            <button class="message-action-icon disabled" type="button" title="Branch unavailable" disabled>
              <GitBranch class="h-3 w-3" />
            </button>
            <button
              class="message-action-icon"
              type="button"
              title={isBusy ? 'Working…' : 'Delete'}
              disabled={isBusy || !onDelete}
              onclick={() => onDelete?.(message)}
            >
              <Trash2 class="h-3 w-3" />
            </button>
          </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
