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
          {#if message.content}
            <div>{message.content}</div>
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
                    <div class="message-meta">{attachment.contentType} • {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</div>
                  </div>
                </a>
              {/each}
            </div>
          {/if}
          <div class="message-meta">
            {message.role} • {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
