<script lang="ts">
  import type { ConversationSummary } from '$lib/types-legacy';

  interface Props {
    conversations: ConversationSummary[];
    currentConversationId: string | null;
    onSelect?: (conversationId: string) => void;
  }

  let { conversations, currentConversationId, onSelect }: Props = $props();
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
          {#if conversation.assistantBusy}
            <span class="llama-conversation-busy" aria-label="Agent working" title="Agent working"></span>
          {/if}
          {conversation.title}
        </div>
        <div class="llama-conversation-meta">
          {new Date(conversation.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          ·
          {new Date(conversation.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {#if conversation.assistantBusy}
            · <span class="llama-conversation-busy-label">working</span>
          {/if}
        </div>
      </button>
    {/each}
  {/if}
</div>
