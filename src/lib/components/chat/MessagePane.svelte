<script lang="ts">
  import {
    BookOpenText,
    Clock3,
    Copy,
    Edit,
    Gauge,
    GitBranch,
    Package,
    RefreshCw,
    Sparkles,
    Trash2,
    WholeWord
  } from '@lucide/svelte';
  import { env as publicEnv } from '$env/dynamic/public';
  import type { ChatMessage } from '$lib/types';

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
    copiedMessageId?: string | null;
    onCopy?: (message: ChatMessage) => void;
    scrollContainer?: HTMLDivElement | null;
    onScroll?: () => void;
  }

  let {
    messages,
    copiedMessageId = null,
    onCopy,
    scrollContainer = $bindable(null),
    onScroll
  }: Props = $props();
  let statsViewByMessageId = $state<Record<string, StatsView>>({});

  const modelDisplayName = publicEnv.PUBLIC_MODEL_DISPLAY_NAME || 'Assistant';
  const modelBadges = [
    publicEnv.PUBLIC_MODEL_SIZE_LABEL,
    publicEnv.PUBLIC_MODEL_CAPABILITY_LABEL,
    publicEnv.PUBLIC_MODEL_FILE_LABEL
  ].filter(Boolean);

  function formatRole(role: ChatMessage['role']) {
    return role === 'assistant' ? 'Assistant' : role === 'system' ? 'System' : 'You';
  }

  function estimateTokenCount(content: string) {
    const normalized = content.trim();
    if (!normalized) {
      return 0;
    }

    return Math.max(1, normalized.split(/\s+/).length);
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function buildMessageStats(message: ChatMessage, index: number): MessageStats | null {
    if (message.role !== 'assistant') {
      return null;
    }

    const generatedTokens = estimateTokenCount(message.content);
    const previousUser = [...messages.slice(0, index)].reverse().find((entry) => entry.role === 'user');
    const promptTokens = previousUser ? estimateTokenCount(previousUser.content) : null;

    const diffSeconds = previousUser
      ? (new Date(message.createdAt).getTime() - new Date(previousUser.createdAt).getTime()) / 1000
      : null;

    const totalSeconds = diffSeconds && Number.isFinite(diffSeconds) && diffSeconds > 0
      ? clamp(diffSeconds, 0.1, 120)
      : clamp(generatedTokens / 100, 0.1, 12);

    const promptSeconds = promptTokens
      ? clamp(Math.min(totalSeconds * 0.4, promptTokens / 120), 0.05, totalSeconds)
      : null;

    const generatedSeconds = clamp(totalSeconds - (promptSeconds ?? 0), 0.05, 120);

    return {
      promptTokens,
      promptSeconds,
      promptTokensPerSecond:
        promptTokens && promptSeconds ? promptTokens / promptSeconds : null,
      generatedTokens,
      generatedSeconds,
      generatedTokensPerSecond: generatedTokens / generatedSeconds
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
              {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          {#if message.content}
            <div class="llama-message-body">{message.content}</div>
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
          {#if message.status !== 'complete'}
            <div class="message-meta">Status: {message.status}</div>
          {/if}

          {#if message.role === 'assistant'}
            {@const stats = buildMessageStats(message, index)}
            <div class="assistant-meta-row">
              <div class="assistant-meta-cluster assistant-model-badges">
                <div class="assistant-model-badge assistant-model-name" title={`${modelDisplayName} model`}>
                  <Package class="h-3 w-3" />
                  <span>{modelDisplayName}</span>
                </div>

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
              <button class="message-action-icon disabled" type="button" title="Regenerate unavailable" disabled>
                <RefreshCw class="h-3 w-3" />
              </button>
            {/if}
            <button class="message-action-icon disabled" type="button" title="Branch unavailable" disabled>
              <GitBranch class="h-3 w-3" />
            </button>
            <button class="message-action-icon disabled" type="button" title="Delete unavailable" disabled>
              <Trash2 class="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
