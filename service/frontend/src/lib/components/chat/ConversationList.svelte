<script lang="ts">
  import type { ConversationSummary } from '$lib/types-legacy';

  interface Props {
    conversations: ConversationSummary[];
    currentConversationId: string | null;
    use24HourTime?: boolean;
    onSelect?: (conversationId: string) => void;
  }

  let { conversations, currentConversationId, use24HourTime = false, onSelect }: Props = $props();

  function formatConversationTime(value: string) {
    return new Date(value).toLocaleTimeString([], {
      hour: use24HourTime ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !use24HourTime
    });
  }
</script>

<div class="llama-conversation-list">
  {#if conversations.length === 0}
    <div class="card" style="padding: 0.95rem; color: var(--text-muted);">
      No conversations yet. Start one from the composer.
    </div>
  {:else}
    {#each conversations as conversation}
      <button
        type="button"
        class:active={conversation.id === currentConversationId}
        class="llama-conversation-link"
        onclick={() => onSelect?.(conversation.id)}
      >
        <div class="llama-conversation-title">
          {#if conversation.assistantBusy && !conversation.assistantStalled}
            <span class="llama-conversation-busy" aria-label="Agent working" title="Agent working"></span>
          {:else if conversation.assistantStalled}
            <span
              class="llama-conversation-stalled"
              aria-label="Agent stalled"
              title="Queued message is waiting for Hermes worker heartbeat"
            ></span>
          {/if}
          <span class="llama-conversation-title-text">{conversation.title}</span>
        </div>
        <div class="llama-conversation-meta">
          {new Date(conversation.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          ·
          {formatConversationTime(conversation.updatedAt)}
          {#if conversation.assistantStalled}
            · <span class="llama-conversation-stalled-label">stalled</span>
          {/if}
        </div>
      </button>
    {/each}
  {/if}
</div>
