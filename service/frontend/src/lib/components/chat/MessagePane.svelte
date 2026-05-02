<script lang="ts">
  import {
    BookOpenText,
    Check,
    Clock3,
    Copy,
    Edit,
    Gauge,
    RefreshCw,
    Sparkles,
    Trash2,
    WholeWord
  } from '@lucide/svelte';
  import MessageAttachments from '$lib/components/chat/MessageAttachments.svelte';
  import { env as publicEnv } from '$env/dynamic/public';
  import ActionHistory from '$lib/components/chat/ActionHistory.svelte';
  import type { ChatMessage, MessageAttachment } from '$lib/types-legacy';
  import { readTimingSummary } from '$lib/utils/chat-timings';
  import { isHermesSystemStatusContent } from '$lib/utils/hermes-system-status';
  import { renderMarkdown } from '$lib/utils/markdown';

  type StatsView = 'reading' | 'generation' | 'completion';

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
    userDisplayName?: string;
    use24HourTime?: boolean;
    copiedMessageId?: string | null;
    editingMessageId?: string | null;
    editingDraft?: string;
    onCopy?: (message: ChatMessage) => void;
    onEdit?: (message: ChatMessage) => void;
    onEditDraftChange?: (value: string) => void;
    onCancelEdit?: () => void;
    onSaveEdit?: (message: ChatMessage) => void;
    onRegenerate?: (message: ChatMessage) => void;
    onSelectRevision?: (message: ChatMessage, targetMessageId: string) => void;
    onDelete?: (message: ChatMessage) => void;
    busyMessageIds?: Set<string>;
    scrollContainer?: HTMLDivElement | null;
    bottomSentinel?: HTMLDivElement | null;
    onScroll?: () => void;
  }

  let {
    messages,
    userDisplayName = 'You',
    use24HourTime = false,
    copiedMessageId = null,
    editingMessageId = null,
    editingDraft = '',
    onCopy,
    onEdit,
    onEditDraftChange,
    onCancelEdit,
    onSaveEdit,
    onRegenerate,
    onSelectRevision,
    onDelete,
    busyMessageIds,
    scrollContainer = $bindable(null),
    bottomSentinel = $bindable(null),
    onScroll
  }: Props = $props();
  let statsViewByMessageId = $state<Record<string, StatsView>>({});

  const modelBadges = [
    publicEnv.PUBLIC_MODEL_SIZE_LABEL,
    publicEnv.PUBLIC_MODEL_CAPABILITY_LABEL,
    publicEnv.PUBLIC_MODEL_FILE_LABEL
  ].filter(Boolean);

  function autosizeTextarea(node: HTMLTextAreaElement) {
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    resize();
    requestAnimationFrame(resize);
    node.addEventListener('input', resize);
    return {
      destroy() {
        node.removeEventListener('input', resize);
      }
    };
  }

  function formatRole(role: ChatMessage['role']) {
    return role === 'assistant' ? 'Assistant' : role === 'system' ? 'System' : userDisplayName;
  }

  function isSystemStatusMessage(message: ChatMessage) {
    if (message.role !== 'assistant') {
      return false;
    }

    return isHermesSystemStatusContent(message.content);
  }

  function isToolProgressMessage(message: ChatMessage) {
    return message.displayType === 'tool_progress';
  }

  function effectiveRole(message: ChatMessage): ChatMessage['role'] {
    if (isToolProgressMessage(message)) {
      return 'system';
    }

    return isSystemStatusMessage(message) ? 'system' : message.role;
  }

  function hasVisibleContent(message: ChatMessage) {
    return message.content.trim().length > 0;
  }

  function isStreamingAssistant(message: ChatMessage) {
    return message.role === 'assistant' && message.status === 'streaming';
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

    const summary = readTimingSummary(timings);
    const promptTokens = summary.promptTokens;
    const promptMs = summary.promptMs;
    const generatedTokens = summary.generatedTokens;
    const generatedMs = summary.generatedMs;

    // Need at least the generation side to surface anything meaningful.
    if (generatedTokens == null || generatedMs == null || generatedMs <= 0) {
      return null;
    }

    const promptSeconds = promptMs != null && promptMs > 0 ? promptMs / 1000 : null;
    const generatedSeconds = generatedMs / 1000;

    return {
      promptTokens,
      promptSeconds,
      promptTokensPerSecond: summary.promptTokensPerSecond,
      generatedTokens,
      generatedSeconds,
      generatedTokensPerSecond: summary.generatedTokensPerSecond ?? 0
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

  function completedMessageTime(message: ChatMessage) {
    if (message.status !== 'complete') {
      return null;
    }

    return formatMessageTime(message.updatedAt ?? message.createdAt);
  }

  function showMessageHeader(role: ChatMessage['role']) {
    return role === 'system';
  }

  function hasRevisionNavigation(message: ChatMessage) {
    return (
      message.role === 'user' &&
      (message.revisionTotal ?? 1) > 1 &&
      (message.revisionSiblingIds?.length ?? 0) > 1
    );
  }

  function previousRevisionId(message: ChatMessage) {
    if (!message.revisionSiblingIds || message.revisionSiblingIds.length < 2) {
      return null;
    }

    const currentIndex = message.revisionIndex ?? 0;
    return currentIndex > 0 ? message.revisionSiblingIds[currentIndex - 1] : null;
  }

  function nextRevisionId(message: ChatMessage) {
    if (!message.revisionSiblingIds || message.revisionSiblingIds.length < 2) {
      return null;
    }

    const currentIndex = message.revisionIndex ?? 0;
    return currentIndex < message.revisionSiblingIds.length - 1
      ? message.revisionSiblingIds[currentIndex + 1]
      : null;
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
      {@const displayRole = effectiveRole(message)}
      <div class={`llama-message-row ${displayRole}`}>
        <div class="llama-message-card">
          {#if showMessageHeader(displayRole) && !isToolProgressMessage(message)}
            <div class="llama-message-header">
              <div class="llama-message-role">
                <span class="message-role-dot"></span>
                {formatRole(displayRole)}
              </div>
              <div class="message-meta">
                {formatMessageTime(message.createdAt)}
              </div>
            </div>
          {/if}
          {#if isStreamingAssistant(message) && !hasVisibleContent(message)}
            <div
              class="assistant-typing-indicator assistant-typing-indicator--placeholder"
              role="status"
              aria-live="polite"
              aria-label="Assistant is responding"
            >
              <span class="assistant-typing-loader" aria-hidden="true">
                {#each [0, 1, 2, 3, 4, 5, 6, 7, 8] as delayStep}
                  <span class="assistant-typing-square" style={`--assistant-loader-delay: ${delayStep * 0.07}s`}></span>
                {/each}
              </span>
            </div>
          {:else if displayRole === 'user' && editingMessageId === message.id}
            <div class="message-edit-shell">
              <textarea
                class="message-edit-textarea"
                rows="1"
                use:autosizeTextarea
                value={editingDraft}
                oninput={(event) =>
                  onEditDraftChange?.((event.currentTarget as HTMLTextAreaElement).value)}
              ></textarea>
              <div class="message-edit-actions">
                <button
                  class="message-edit-button message-edit-button--secondary"
                  type="button"
                  onclick={() => onCancelEdit?.()}
                >
                  Cancel
                </button>
                <button
                  class="message-edit-button message-edit-button--primary"
                  type="button"
                  disabled={!editingDraft.trim()}
                  onclick={() => onSaveEdit?.(message)}
                >
                  Save
                </button>
              </div>
            </div>
          {:else if isToolProgressMessage(message)}
            <ActionHistory content={message.content} />
          {:else if message.content}
            {#if displayRole === 'assistant'}
              <div class="llama-message-body markdown-content">{@html renderMarkdown(message.content)}</div>
            {:else}
              <div class="llama-message-body">{message.content}</div>
            {/if}
          {/if}
          <MessageAttachments attachments={message.attachments} />
          {#if isStreamingAssistant(message) && hasVisibleContent(message)}
            <div class="assistant-stream-status" role="status" aria-live="polite" aria-label="Assistant is responding">
              <span class="assistant-typing-loader assistant-typing-loader--compact" aria-hidden="true">
                {#each [0, 1, 2, 3, 4, 5, 6, 7, 8] as delayStep}
                  <span class="assistant-typing-square" style={`--assistant-loader-delay: ${delayStep * 0.07}s`}></span>
                {/each}
              </span>
              <span class="assistant-typing-label">Responding</span>
            </div>
          {:else if message.status !== 'complete' && !isStreamingAssistant(message)}
            <div class="message-meta">Status: {message.status}</div>
          {/if}

          {#if displayRole === 'assistant' && !(isStreamingAssistant(message) && !hasVisibleContent(message))}
            {@const stats = buildMessageStats(message, index)}
            <div class="assistant-meta-row">
              <div class="assistant-meta-cluster assistant-model-badges">
                {#each modelBadges as badge}
                  <div class="assistant-model-badge assistant-model-tag">{badge}</div>
                {/each}
              </div>

              {#if stats}
                {@const view = activeStatsView(message.id)}
                {@const completedAt = completedMessageTime(message)}
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
                    <button
                      type="button"
                      class:active={view === 'completion'}
                      class="stats-toggle-button"
                      disabled={!completedAt}
                      title={completedAt ? 'Completion time' : 'Completion time unavailable'}
                      onclick={() => setStatsView(message.id, 'completion')}
                    >
                      <Check class="h-3 w-3" />
                    </button>
                  </div>

                  {#if view === 'completion' && completedAt}
                    <div class="assistant-stat-chip" title="Completed in your local time">
                      <Clock3 class="h-3 w-3" />
                      <span>{completedAt}</span>
                    </div>
                  {:else}
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
                  {/if}
                </div>
              {/if}
            </div>
          {/if}

          {#if !(isStreamingAssistant(message) && !hasVisibleContent(message))}
            {@const isBusy = busyMessageIds?.has(message.id) ?? false}
            {#if displayRole === 'assistant'}
              <div class="llama-message-actions assistant-actions" aria-label="Message actions">
                <button
                  class={`message-action-icon ${copiedMessageId === message.id ? 'is-active' : ''}`}
                  type="button"
                  title={copiedMessageId === message.id ? 'Copied' : 'Copy'}
                  onclick={() => onCopy?.(message)}
                >
                  <Copy class="h-3 w-3" />
                </button>
                <button
                  class="message-action-icon"
                  type="button"
                  title={isBusy ? 'Regenerating…' : 'Regenerate'}
                  disabled={isBusy || !onRegenerate}
                  onclick={() => onRegenerate?.(message)}
                >
                  <RefreshCw class="h-3 w-3" />
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
          {/if}
        </div>
        {#if !(isStreamingAssistant(message) && !hasVisibleContent(message)) && editingMessageId !== message.id}
          {#if displayRole === 'user'}
            <div class="user-controls-outside">
              <div class="llama-message-actions user-actions user-actions-outside" aria-label="Message actions">
                <button
                  class={`message-action-icon ${copiedMessageId === message.id ? 'is-active' : ''}`}
                  type="button"
                  title={copiedMessageId === message.id ? 'Copied' : 'Copy'}
                  onclick={() => onCopy?.(message)}
                >
                  <Copy class="h-3 w-3" />
                </button>
                <button
                  class={`message-action-icon user-edit-action ${editingMessageId === message.id ? 'is-active' : ''}`}
                  type="button"
                  title={editingMessageId === message.id ? 'Editing' : 'Edit and resubmit'}
                  disabled={editingMessageId !== null && editingMessageId !== message.id}
                  onclick={() => onEdit?.(message)}
                >
                  <Edit class="h-3 w-3" />
                </button>
              </div>
              {#if hasRevisionNavigation(message)}
                <div class="message-revision-switcher message-revision-switcher--inline" aria-label="Message revisions">
                  <button
                    class="message-revision-button"
                    type="button"
                    aria-label="Previous revision"
                    disabled={!previousRevisionId(message)}
                    onclick={() => {
                      const targetMessageId = previousRevisionId(message);
                      if (targetMessageId) {
                        onSelectRevision?.(message, targetMessageId);
                      }
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M15 6L9 12L15 18" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path>
                    </svg>
                  </button>
                  <span>{(message.revisionIndex ?? 0) + 1} / {message.revisionTotal ?? 1}</span>
                  <button
                    class="message-revision-button"
                    type="button"
                    aria-label="Next revision"
                    disabled={!nextRevisionId(message)}
                    onclick={() => {
                      const targetMessageId = nextRevisionId(message);
                      if (targetMessageId) {
                        onSelectRevision?.(message, targetMessageId);
                      }
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path>
                    </svg>
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/each}

    <div bind:this={bottomSentinel} aria-hidden="true" style="height: 1px;"></div>
  </div>
</div>
