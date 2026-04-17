<script lang="ts">
  import type { ChatMessage } from '$lib/types';

  interface Props {
    messages: ChatMessage[];
  }

  let { messages }: Props = $props();
</script>

<div class="message-scroll">
  <div class="message-stack">
    {#if messages.length === 0}
      <div class="card muted">
        This conversation is empty. Send a message to enqueue the first Hermes turn.
      </div>
    {/if}

    {#each messages as message}
      <div class={`message-row ${message.role}`}>
        <div class="message-bubble">
          <div>{message.content}</div>
          <div class="message-meta">
            {message.role} • {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
