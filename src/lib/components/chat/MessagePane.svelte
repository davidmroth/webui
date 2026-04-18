<script lang="ts">
  import type { ChatMessage } from '$lib/types';

  interface Props {
    messages: ChatMessage[];
  }

  let { messages }: Props = $props();

  function formatRole(role: ChatMessage['role']) {
    return role === 'assistant' ? 'Assistant' : role === 'system' ? 'System' : 'You';
  }
</script>

<div class="llama-message-scroll">
  <div class="llama-message-stack">
    {#if messages.length === 0}
      <div class="card" style="padding: 1rem; color: var(--text-muted);">
        This conversation is empty. Send a message to enqueue the first Hermes turn.
      </div>
    {/if}

    {#each messages as message}
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
                <a class="attachment-card" href={attachment.downloadUrl} target="_blank" rel="noreferrer">
                  {#if attachment.isImage}
                    <img class="attachment-preview" src={attachment.downloadUrl} alt={attachment.fileName} />
                  {/if}
                  <div>
                    <div>{attachment.fileName}</div>
                    <div class="message-meta">{attachment.contentType} · {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</div>
                  </div>
                </a>
              {/each}
            </div>
          {/if}
          <div class="message-meta">Status: {message.status}</div>
        </div>
      </div>
    {/each}
  </div>
</div>
