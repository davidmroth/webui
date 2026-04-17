<script lang="ts">
  import type { ConversationSummary } from '$lib/types';

  interface Props {
    conversations: ConversationSummary[];
    currentConversationId: string | null;
  }

  let { conversations, currentConversationId }: Props = $props();
</script>

<div class="conversation-list">
  {#if conversations.length === 0}
    <div class="card muted">No conversations yet. Start one from the compose box.</div>
  {:else}
    {#each conversations as conversation}
      <a
        class:active={conversation.id === currentConversationId}
        class="conversation-item"
        href={`/chat?conversation=${conversation.id}`}
      >
        <div>{conversation.title}</div>
        <div class="message-meta">{new Date(conversation.updatedAt).toLocaleString()}</div>
      </a>
    {/each}
  {/if}
</div>
