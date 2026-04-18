<script lang="ts">
  import { onMount } from 'svelte';
  import ConversationList from '$components/chat/ConversationList.svelte';
  import MessagePane from '$components/chat/MessagePane.svelte';
  import type { ChatMessage, ConversationSummary } from '$lib/types';

  let { data, form } = $props();
  let messages = $state<ChatMessage[]>([]);
  let conversations = $state<ConversationSummary[]>([]);
  let pendingFiles = $state<Array<{ name: string; size: number; type: string }>>([]);
  let attachmentMenuOpen = $state(false);
  let attachmentInput: HTMLInputElement | null = null;

  $effect(() => {
    messages = data.messages;
    conversations = data.conversations;
  });

  function openAttachmentPicker(accept: string) {
    if (!attachmentInput) {
      return;
    }

    attachmentInput.accept = accept;
    attachmentMenuOpen = false;
    attachmentInput.click();
  }

  function handleAttachmentChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    pendingFiles = files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream'
    }));
  }

  function formatFileSize(bytes: number) {
    const kilobytes = Math.max(1, Math.round(bytes / 1024));
    return `${kilobytes} KB`;
  }

  function activeConversationTitle() {
    return conversations.find((conversation) => conversation.id === data.currentConversationId)?.title ?? 'New chat';
  }

  onMount(() => {
    if (!data.currentConversationId) {
      return;
    }

    let cancelled = false;
    let refreshing = false;

    const refresh = async () => {
      if (refreshing || !data.currentConversationId) {
        return;
      }
      refreshing = true;
      try {
        const [messagesResponse, conversationsResponse] = await Promise.all([
          fetch(`/api/conversations/${data.currentConversationId}/messages`),
          fetch('/api/conversations')
        ]);
        if (!messagesResponse.ok || !conversationsResponse.ok) {
          return;
        }
        const messagePayload = await messagesResponse.json();
        const conversationPayload = await conversationsResponse.json();
        if (!cancelled) {
          messages = messagePayload.messages;
          conversations = conversationPayload.conversations;
        }
      } finally {
        refreshing = false;
      }
    };

    const interval = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  });
</script>

<div class="shell">
  <div class="llama-frame">
    <aside class="llama-sidebar">
      <div class="llama-brand">llama.cpp</div>

      <div class="llama-nav">
        <form method="POST" action="?/createConversation">
          <button class="llama-nav-item" type="submit">
            <span class="llama-nav-icon">✎</span>
            <span>New chat</span>
          </button>
        </form>

        <div class="llama-nav-item disabled" aria-disabled="true">
          <span class="llama-nav-icon">⌕</span>
          <span>Search</span>
        </div>

        <div class="llama-nav-item disabled" aria-disabled="true">
          <span class="llama-nav-icon">⛓</span>
          <span>MCP Servers</span>
        </div>
      </div>

      <div class="llama-sidebar-section-title">Conversations</div>
      <ConversationList conversations={conversations} currentConversationId={data.currentConversationId} />

      <div class="llama-sidebar-footer">
        <div class="llama-user-card">
          <div style="font-size: 0.86rem; color: var(--text-muted);">Signed in as</div>
          <div style="font-weight: 600; margin-top: 0.2rem;">{data.session.displayName}</div>
        </div>

        <form method="POST" action="/logout">
          <button class="secondary-button" type="submit" style="width: 100%;">Sign out</button>
        </form>
      </div>
    </aside>

    <section class="llama-main">
      <div class="llama-topbar">
        <button class="llama-toolbar-button" type="button" disabled aria-label="Sidebar controls unavailable">
          ◫
        </button>

        <div class="llama-header-copy">
          <div class="llama-header-title">{activeConversationTitle()}</div>
          <div class="llama-header-subtitle">
            Current backend preserved: session auth, MySQL conversations, Hermes queue, attachment uploads.
          </div>
        </div>

        <button class="llama-toolbar-button" type="button" disabled aria-label="Settings unavailable">
          ⚙
        </button>
      </div>

      <div class="llama-chat-stage">
        {#if messages.length === 0}
          <div class="llama-empty-state">
            <h1>llama.cpp</h1>
            <p>Type a message or upload files to get started.</p>
          </div>
        {:else}
          <MessagePane messages={messages} />
        {/if}

        <div class="llama-composer-wrap">
          <div class="llama-composer-shell">
            <form method="POST" action="?/sendMessage" enctype="multipart/form-data" class="llama-composer-form">
              <input type="hidden" name="conversationId" value={data.currentConversationId ?? ''} />

              <div class="llama-composer">
                <textarea
                  class="llama-textarea"
                  name="content"
                  placeholder="Type a message..."
                ></textarea>

                {#if pendingFiles.length > 0}
                  <div class="pending-files">
                    {#each pendingFiles as file}
                      <div class="pending-file-pill">
                        <span>{file.name}</span>
                        <span>{formatFileSize(file.size)}</span>
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="llama-composer-footer">
                  <div class="llama-composer-actions">
                    <details class="attachment-menu" bind:open={attachmentMenuOpen}>
                      <summary class="compose-icon-button" aria-label="Open attachments menu">+</summary>
                      <div class="attachment-menu-popover">
                        <div class="attachment-menu-list">
                          <button class="attachment-menu-item" type="button" onclick={() => openAttachmentPicker('image/*')}>
                            <span class="menu-item-icon">▣</span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">Images</span>
                            </span>
                          </button>

                          <div class="disabled-menu-item" aria-disabled="true">
                            <span class="menu-item-icon">◌</span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">Audio Files</span>
                              <span class="menu-item-note">Current backend does not support capture or audio workflows yet.</span>
                            </span>
                          </div>

                          <button class="attachment-menu-item" type="button" onclick={() => openAttachmentPicker('.txt,.md,.json,.csv,.xml,.yaml,.yml,.js,.ts,.py,.rb,.go,.java,.c,.cpp,.rs')}>
                            <span class="menu-item-icon">▤</span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">Text Files</span>
                            </span>
                          </button>

                          <button class="attachment-menu-item" type="button" onclick={() => openAttachmentPicker('.pdf,application/pdf')}>
                            <span class="menu-item-icon">◫</span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">PDF Files</span>
                            </span>
                          </button>

                          <div class="disabled-menu-item" aria-disabled="true">
                            <span class="menu-item-icon">☰</span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">System Message</span>
                              <span class="menu-item-note">Visible for parity, not wired to Hermes yet.</span>
                            </span>
                          </div>

                          <div class="menu-divider"></div>

                          <div class="disabled-menu-item" aria-disabled="true">
                            <span class="menu-item-icon">⛓</span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">MCP Servers</span>
                              <span class="menu-item-note">Greyed out until backend support exists.</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </details>

                    <input
                      bind:this={attachmentInput}
                      class="visually-hidden"
                      type="file"
                      name="attachments"
                      multiple
                      onchange={handleAttachmentChange}
                    />
                  </div>

                  <div class="llama-status-chips">
                    <div class="llama-chip">
                      <span class="chip-icon">◉</span>
                      <span>Hermes queue</span>
                    </div>
                    <div class="llama-chip">
                      <span class="chip-icon">⌁</span>
                      <span>Server stored</span>
                    </div>
                    <div class="llama-chip disabled">
                      <span class="chip-icon">⚙</span>
                      <span>Model controls unavailable</span>
                    </div>
                    <button class="send-button" type="submit" aria-label="Send message">↑</button>
                  </div>
                </div>
              </div>

              <div class="llama-footnote">Press Enter to send is not wired yet. Shift + Enter still adds a new line.</div>

              {#if form?.error}
                <div class="error-banner">{form.error}</div>
              {/if}
            </form>
          </div>
        </div>
      </div>
    </section>
  </div>
</div>
