<script lang="ts">
  import {
    BarChart2,
    CalendarClock,
    Check,
    Copy,
    DatabaseZap,
    Edit,
    Gauge,
    Hourglass,
    RefreshCw,
    Trash2,
    WholeWord,
    Zap
  } from '@lucide/svelte';
  import MessageAttachments from '$lib/components/chat/MessageAttachments.svelte';
  import { env as publicEnv } from '$env/dynamic/public';
  import ActionHistory from '$lib/components/chat/ActionHistory.svelte';
  import type { ChatMessage, MessageAttachment } from '$lib/types-legacy';
  import { readTimingSummary, resolveTtftMs } from '$lib/utils/chat-timings';
  import { isHermesSystemStatusContent } from '$lib/utils/hermes-system-status';
  import { renderMarkdown } from '$lib/utils/markdown';

  interface MessageStats {
    promptTokens: number | null;
    promptSeconds: number | null;
    promptTokensPerSecond: number | null;
    cacheTokens: number | null;
    ttftSeconds: number | null;
    generatedTokens: number;
    generatedSeconds: number;
    generatedTokensPerSecond: number;
  }

  interface Props {
    messages: ChatMessage[];
    conversationId?: string | null;
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
    conversationId = null,
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
  let expandedStatsByMessageId = $state<Record<string, boolean>>({});
  let copiedConversationIdForMessageId = $state<string | null>(null);

  // Local-day boundary markers ("Today" / "Yesterday" / weekday / date) shown
  // between message rows whenever the calendar day changes. Computed in the
  // viewer's local timezone from each message's createdAt, considering only
  // visible (non hidden-transcript) rows so the divider lines up with what the
  // user actually sees.
  const dayLabelFormatterFull = new Intl.DateTimeFormat([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const dayLabelFormatterWeekday = new Intl.DateTimeFormat([], { weekday: 'long' });
  const dayLabelFormatterSameYear = new Intl.DateTimeFormat([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
  const dayLabelFormatterOtherYear = new Intl.DateTimeFormat([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  function localDayKey(value: string): string | null {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function relativeDayLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.round((startOfToday.getTime() - startOfMessageDay.getTime()) / dayMs);

    if (diffDays === 0) {
      return 'Today';
    }
    if (diffDays === 1) {
      return 'Yesterday';
    }
    if (diffDays > 1 && diffDays < 7) {
      return dayLabelFormatterWeekday.format(date);
    }
    if (date.getFullYear() === now.getFullYear()) {
      return dayLabelFormatterSameYear.format(date);
    }

    return dayLabelFormatterOtherYear.format(date);
  }

  interface DaySeparatorInfo {
    label: string;
    ariaLabel: string;
  }

  const daySeparatorByMessageId = $derived.by(() => {
    const result: Record<string, DaySeparatorInfo> = {};
    let previousDayKey: string | null = null;

    for (const message of messages) {
      if (isHiddenTranscriptMessage(message)) {
        continue;
      }

      const timestamp = message.createdAt;
      const dayKey = localDayKey(timestamp);
      if (!dayKey) {
        continue;
      }

      if (dayKey !== previousDayKey) {
        result[message.id] = {
          label: relativeDayLabel(timestamp),
          ariaLabel: dayLabelFormatterFull.format(new Date(timestamp))
        };
        previousDayKey = dayKey;
      }
    }

    return result;
  });

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

  function isHiddenTranscriptMessage(message: ChatMessage) {
    return (message as unknown as { role?: string }).role === 'tool';
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

  function isAssistantMessageFullyRendered(message: ChatMessage) {
    return (
      message.role === 'assistant' &&
      message.status === 'complete' &&
      hasVisibleContent(message)
    );
  }

  function shouldHideBlankAssistantMessage(message: ChatMessage) {
    if (message.role !== 'assistant') {
      return false;
    }

    if (hasVisibleContent(message) || message.attachments.length > 0) {
      return false;
    }

    return !isStreamingAssistant(message);
  }

  function isBusyMessage(messageId: string) {
    return busyMessageIds?.has(messageId) ?? false;
  }

  function latestUserDeleteMessageId() {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.role === 'user') {
        return candidate.id;
      }
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
    const ttftMs = resolveTtftMs(summary);
    const ttftSeconds = ttftMs != null && ttftMs > 0 ? ttftMs / 1000 : null;

    return {
      promptTokens,
      promptSeconds,
      promptTokensPerSecond: summary.promptTokensPerSecond,
      cacheTokens: summary.cacheTokens,
      ttftSeconds,
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

  function formatCompactNumber(value: number) {
    if (!Number.isFinite(value)) {
      return '0';
    }

    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (abs >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(1);
  }

  function isStatsExpanded(messageId: string) {
    return expandedStatsByMessageId[messageId] ?? false;
  }

  function toggleStatsExpanded(messageId: string) {
    expandedStatsByMessageId = {
      ...expandedStatsByMessageId,
      [messageId]: !isStatsExpanded(messageId)
    };
  }

  function formatMessageTime(value: string) {
    return new Date(value).toLocaleTimeString([], {
      hour: use24HourTime ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !use24HourTime
    });
  }

  function formatMessageDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const dateLabel = date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const timeLabel = formatMessageTime(value);

    return `${dateLabel} · ${timeLabel}`;
  }

  function completedMessageDateTime(message: ChatMessage) {
    if (message.status !== 'complete') {
      return null;
    }

    return formatMessageDateTime(message.updatedAt ?? message.createdAt);
  }

  async function copyConversationId(messageId: string) {
    if (!conversationId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(conversationId);
      copiedConversationIdForMessageId = messageId;
      setTimeout(() => {
        if (copiedConversationIdForMessageId === messageId) {
          copiedConversationIdForMessageId = null;
        }
      }, 1500);
    } catch {
      // Clipboard access may be denied in some contexts.
    }
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
      {#if !isHiddenTranscriptMessage(message) && !shouldHideBlankAssistantMessage(message)}
      {@const daySeparator = daySeparatorByMessageId[message.id]}
      {#if daySeparator}
        <div
          class="llama-day-separator"
          role="separator"
          aria-label={daySeparator.ariaLabel}
        >
          <span class="llama-day-separator-pill">{daySeparator.label}</span>
        </div>
      {/if}
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

          {#if isAssistantMessageFullyRendered(message)}
            {@const stats = buildMessageStats(message, index)}
            <div class="assistant-meta-row">
              <div class="assistant-meta-cluster assistant-model-badges">
                {#each modelBadges as badge}
                  <div class="assistant-model-badge assistant-model-tag">{badge}</div>
                {/each}
              </div>

              {#if stats}
                {@const completedAt = completedMessageDateTime(message)}
                {@const statsExpanded = isStatsExpanded(message.id)}
                <div class="assistant-meta-cluster assistant-stats-row">
                  <div class="assistant-message-toolbar" aria-label="Message actions">
                    <button
                      type="button"
                      class="assistant-stats-toggle-button"
                      class:active={statsExpanded}
                      aria-expanded={statsExpanded}
                      title={statsExpanded ? 'Hide message stats' : 'Show message stats'}
                      onclick={() => toggleStatsExpanded(message.id)}
                    >
                      <BarChart2 class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class={`assistant-stats-toggle-button ${copiedMessageId === message.id ? 'active' : ''}`}
                      title={copiedMessageId === message.id ? 'Copied' : 'Copy'}
                      onclick={() => onCopy?.(message)}
                    >
                      <Copy class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class="assistant-stats-toggle-button"
                      title={isBusyMessage(message.id) ? 'Regenerating…' : 'Regenerate'}
                      disabled={isBusyMessage(message.id) || !onRegenerate}
                      onclick={() => onRegenerate?.(message)}
                    >
                      <RefreshCw class="h-3 w-3" />
                    </button>
                  </div>

                  {#if statsExpanded}
                    <div class="assistant-stats-card">
                      {#if completedAt}
                        <div class="assistant-stats-card-header">
                          <span class="assistant-stats-datetime" title="Completed in your local time">
                            <CalendarClock class="h-3 w-3" />
                            {completedAt}
                          </span>
                        </div>
                      {/if}

                      <div class="assistant-stats-card-body">
                        <div class="assistant-stats-section-label assistant-stats-section-label--reading">
                          Reading
                        </div>
                        <div class="assistant-stats-metric-cell">
                          {#if stats.promptTokens != null}
                            <div class="assistant-stat-chip" title="Prompt tokens">
                              <WholeWord class="h-3 w-3" />
                              <span>
                                {formatCompactNumber(stats.promptTokens)}
                                <span class="assistant-stat-unit">tokens</span>
                              </span>
                            </div>
                          {/if}
                        </div>
                        <div class="assistant-stats-metric-cell">
                          {#if stats.promptSeconds != null}
                            <div
                              class="assistant-stat-chip"
                              title={stats.ttftSeconds != null
                                ? 'Total prompt processing time'
                                : 'Prompt processing time'}
                            >
                              <Hourglass class="h-3 w-3" />
                              <span>{formatDuration(stats.promptSeconds)}</span>
                            </div>
                          {/if}
                        </div>
                        <div class="assistant-stats-metric-cell">
                          {#if stats.promptTokensPerSecond != null}
                            <div
                              class="assistant-stat-chip"
                              title="Uncached prefill throughput (KV cache hits excluded)"
                            >
                              <Gauge class="h-3 w-3" />
                              <span>
                                {formatCompactNumber(stats.promptTokensPerSecond)}
                                <span class="assistant-stat-unit">t/s</span>
                              </span>
                            </div>
                          {/if}
                        </div>
                        <div class="assistant-stats-metric-cell">
                          {#if stats.cacheTokens != null && stats.cacheTokens > 0}
                            <div
                              class="assistant-stat-chip"
                              title="Prompt tokens restored from the KV cache instead of recomputed"
                            >
                              <DatabaseZap class="h-3 w-3" />
                              <span>
                                {formatCompactNumber(stats.cacheTokens)}
                                <span class="assistant-stat-unit"
                                  >cached{stats.promptTokens
                                    ? ` (${Math.round((stats.cacheTokens / stats.promptTokens) * 100)}%)`
                                    : ''}</span
                                >
                              </span>
                            </div>
                          {/if}
                        </div>

                        <div class="assistant-stats-section-label assistant-stats-section-label--generation">
                          Generation
                        </div>
                        <div class="assistant-stats-metric-cell">
                          <div class="assistant-stat-chip" title="Generated tokens">
                            <WholeWord class="h-3 w-3" />
                            <span>
                              {formatCompactNumber(stats.generatedTokens)}
                              <span class="assistant-stat-unit">tokens</span>
                            </span>
                          </div>
                        </div>
                        <div class="assistant-stats-metric-cell">
                          <div class="assistant-stat-chip" title="Decode time after first token">
                            <Hourglass class="h-3 w-3" />
                            <span>{formatDuration(stats.generatedSeconds)}</span>
                          </div>
                        </div>
                        <div class="assistant-stats-metric-cell">
                          <div class="assistant-stat-chip" title="Decode throughput after first token">
                            <Gauge class="h-3 w-3" />
                            <span>
                              {formatCompactNumber(stats.generatedTokensPerSecond)}
                              <span class="assistant-stat-unit">t/s</span>
                            </span>
                          </div>
                        </div>
                        <div class="assistant-stats-metric-cell">
                          {#if stats.ttftSeconds != null}
                            <div
                              class="assistant-stat-chip"
                              title="Engine prompt prefill time (not end-to-end time to first token)"
                            >
                              <Zap class="h-3 w-3" />
                              <span>Prefill {formatDuration(stats.ttftSeconds)}</span>
                            </div>
                          {/if}
                        </div>
                      </div>

                      {#if conversationId}
                        <button
                          type="button"
                          class="assistant-stats-card-footer"
                          title={copiedConversationIdForMessageId === message.id
                            ? 'Copied'
                            : 'Copy conversation ID'}
                          onclick={() => copyConversationId(message.id)}
                        >
                          <span class="assistant-stats-conv-id" title={conversationId}>{conversationId}</span>
                          {#if copiedConversationIdForMessageId === message.id}
                            <Check class="h-3 w-3 assistant-stats-conv-copy-icon" />
                          {:else}
                            <Copy class="h-3 w-3 assistant-stats-conv-copy-icon" />
                          {/if}
                        </button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="assistant-meta-cluster assistant-stats-row">
                  <div class="assistant-message-toolbar" aria-label="Message actions">
                    <button
                      type="button"
                      class={`assistant-stats-toggle-button ${copiedMessageId === message.id ? 'active' : ''}`}
                      title={copiedMessageId === message.id ? 'Copied' : 'Copy'}
                      onclick={() => onCopy?.(message)}
                    >
                      <Copy class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class="assistant-stats-toggle-button"
                      title={isBusyMessage(message.id) ? 'Regenerating…' : 'Regenerate'}
                      disabled={isBusyMessage(message.id) || !onRegenerate}
                      onclick={() => onRegenerate?.(message)}
                    >
                      <RefreshCw class="h-3 w-3" />
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/if}

        </div>
        {#if (displayRole !== 'assistant' || isAssistantMessageFullyRendered(message)) && editingMessageId !== message.id}
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
                {#if latestUserDeleteMessageId() === message.id}
                  <button
                    class="message-action-icon"
                    type="button"
                    title={isBusyMessage(message.id) ? 'Deleting latest turn…' : 'Delete latest prompt and response'}
                    disabled={isBusyMessage(message.id) || !onDelete}
                    onclick={() => onDelete?.(message)}
                  >
                    <Trash2 class="h-3 w-3" />
                  </button>
                {/if}
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
      {/if}
    {/each}

    <div bind:this={bottomSentinel} aria-hidden="true" style="height: 1px;"></div>
  </div>
</div>
