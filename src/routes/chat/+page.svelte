<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArrowUp,
    Database,
    File as FileIcon,
    FileText,
    Image,
    MessageSquareText,
    Mic,
    PanelLeft,
    PlugZap,
    Search,
    Settings2,
    Sparkles,
    Square,
    SquarePen
  } from '@lucide/svelte';
  import ConversationList from '$components/chat/ConversationList.svelte';
  import MessagePane from '$components/chat/MessagePane.svelte';
  import type { ChatMessage, ConversationSummary } from '$lib/types-legacy';

  type PendingAttachment = {
    id: string;
    file: File;
    previewUrl: string;
  };

  let { data, form } = $props();
  let currentConversationId = $state<string | null>(null);
  let messages = $state<ChatMessage[]>([]);
  let conversations = $state<ConversationSummary[]>([]);
  let pendingFiles = $state<PendingAttachment[]>([]);
  let attachmentMenuOpen = $state(false);
  let searchQuery = $state('');
  let draftMessage = $state('');
  let isSending = $state(false);
  let isRefreshing = $state(false);
  let copiedMessageId = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let isDragActive = $state(false);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let messageScrollElement = $state<HTMLDivElement | null>(null);
  let attachmentInput = $state<HTMLInputElement | null>(null);
  let shouldAutoScroll = $state(true);
  let sidebarCollapsed = $state(false);

  const AUTO_SCROLL_AT_BOTTOM_THRESHOLD = 10;

  $effect(() => {
    currentConversationId = data.currentConversationId;
    messages = data.messages;
    conversations = data.conversations;
  });

  const filteredConversations = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(query));
  });

  function activeConversationTitle() {
    return conversations.find((conversation) => conversation.id === currentConversationId)?.title ?? 'New chat';
  }

  function isNearBottom() {
    if (!messageScrollElement) {
      return true;
    }

    const distanceFromBottom =
      messageScrollElement.scrollHeight - messageScrollElement.clientHeight - messageScrollElement.scrollTop;

    return distanceFromBottom < AUTO_SCROLL_AT_BOTTOM_THRESHOLD;
  }

  function handleMessageScroll() {
    shouldAutoScroll = isNearBottom();
  }

  async function scrollMessagesToBottom(behavior: ScrollBehavior = 'auto') {
    await tick();
    if (!messageScrollElement) {
      return;
    }

    messageScrollElement.scrollTo({
      top: messageScrollElement.scrollHeight,
      behavior
    });
    shouldAutoScroll = true;
  }

  function setChatUrl(conversationId: string | null) {
    const nextUrl = conversationId ? `/chat?conversation=${conversationId}` : '/chat';
    window.history.pushState({}, '', nextUrl);
  }

  function focusComposer() {
    composerElement?.focus();
  }

  function resetComposerHeight() {
    if (!composerElement) {
      return;
    }

    composerElement.style.height = '0px';
    composerElement.style.height = `${Math.min(composerElement.scrollHeight, 320)}px`;
  }

  function autoResizeComposer() {
    resetComposerHeight();
  }

  function createClientId(prefix = '') {
    const webCrypto = globalThis.crypto;

    if (webCrypto?.randomUUID) {
      return `${prefix}${webCrypto.randomUUID()}`;
    }

    if (webCrypto?.getRandomValues) {
      const buffer = new Uint32Array(4);
      webCrypto.getRandomValues(buffer);
      const randomPart = Array.from(buffer, (value) => value.toString(16).padStart(8, '0')).join('');
      return `${prefix}${randomPart}`;
    }

    return `${prefix}${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  function createPendingAttachment(file: File): PendingAttachment {
    return {
      id: createClientId(),
      file,
      previewUrl: URL.createObjectURL(file)
    };
  }

  function revokePendingFiles(files: PendingAttachment[]) {
    for (const pendingFile of files) {
      URL.revokeObjectURL(pendingFile.previewUrl);
    }
  }

  function appendFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    pendingFiles = [...pendingFiles, ...files.map(createPendingAttachment)];
    errorMessage = null;
  }

  function clearPendingFiles() {
    revokePendingFiles(pendingFiles);
    pendingFiles = [];
    if (attachmentInput) {
      attachmentInput.value = '';
    }
  }

  function removePendingFile(fileId: string) {
    const match = pendingFiles.find((file) => file.id === fileId);
    if (match) {
      URL.revokeObjectURL(match.previewUrl);
    }
    pendingFiles = pendingFiles.filter((file) => file.id !== fileId);
  }

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
    appendFiles(files);
    input.value = '';
  }

  function formatFileSize(bytes: number) {
    const kilobytes = Math.max(1, Math.round(bytes / 1024));
    return `${kilobytes} KB`;
  }

  async function refreshConversations() {
    const response = await fetch('/api/conversations');
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    conversations = payload.conversations;
  }

  async function loadMessages(conversationId: string | null, options: { forceScroll?: boolean } = {}) {
    const previousScrollTop = messageScrollElement?.scrollTop ?? 0;
    const shouldStickToBottom = options.forceScroll ?? isNearBottom();

    if (!conversationId) {
      messages = [];
      return;
    }

    const response = await fetch(`/api/conversations/${conversationId}/messages`);
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    messages = payload.messages;
    await tick();
    if (messageScrollElement) {
      if (shouldStickToBottom) {
        messageScrollElement.scrollTop = messageScrollElement.scrollHeight;
        shouldAutoScroll = true;
      } else {
        messageScrollElement.scrollTop = previousScrollTop;
        shouldAutoScroll = false;
      }
    }
  }

  async function selectConversation(conversationId: string) {
    if (conversationId === currentConversationId) {
      return;
    }

    currentConversationId = conversationId;
    errorMessage = null;
    setChatUrl(conversationId);
    await loadMessages(conversationId, { forceScroll: true });
    focusComposer();
  }

  function startNewChat() {
    currentConversationId = null;
    messages = [];
    draftMessage = '';
    clearPendingFiles();
    errorMessage = null;
    setChatUrl(null);
    tick().then(() => {
      resetComposerHeight();
      focusComposer();
    });
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      copiedMessageId = message.id;
      window.setTimeout(() => {
        if (copiedMessageId === message.id) {
          copiedMessageId = null;
        }
      }, 1200);
    } catch {
      errorMessage = 'Copy is not available in this browser context.';
    }
  }

  async function sendMessage() {
    const text = draftMessage.trim();
    if (!text && pendingFiles.length === 0) {
      errorMessage = 'Message content or at least one attachment is required.';
      return;
    }

    isSending = true;
    errorMessage = null;

    const optimisticAttachments = pendingFiles.map((pendingFile) => ({
      id: pendingFile.id,
      fileName: pendingFile.file.name,
      contentType: pendingFile.file.type || 'application/octet-stream',
      sizeBytes: pendingFile.file.size,
      downloadUrl: pendingFile.previewUrl,
      isImage: pendingFile.file.type.startsWith('image/')
    }));

    const optimisticMessage: ChatMessage = {
      id: createClientId('pending-'),
      role: 'user',
      content: draftMessage,
      createdAt: new Date().toISOString(),
      status: 'complete',
      attachments: optimisticAttachments
    };

    messages = [...messages, optimisticMessage];
    await scrollMessagesToBottom();

    const filesToSend = [...pendingFiles];
    const originalDraft = draftMessage;

    draftMessage = '';
    pendingFiles = [];
    if (attachmentInput) {
      attachmentInput.value = '';
    }
    await tick();
    resetComposerHeight();

    try {
      let conversationId = currentConversationId;
      if (!conversationId) {
        const conversationResponse = await fetch('/api/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ title: text.slice(0, 48) || 'New conversation' })
        });

        if (!conversationResponse.ok) {
          throw new Error('Unable to create conversation.');
        }

        const conversationPayload = await conversationResponse.json();
        conversationId = conversationPayload.conversationId;
        currentConversationId = conversationId;
        setChatUrl(conversationId);
      }

      const formData = new FormData();
      formData.set('content', originalDraft);
      for (const pendingFile of filesToSend) {
        formData.append('attachments', pendingFile.file);
      }

      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to send message.');
      }

      await refreshConversations();
      await loadMessages(conversationId, { forceScroll: true });
      revokePendingFiles(filesToSend);
      focusComposer();
    } catch (error) {
      messages = messages.filter((message) => message.id !== optimisticMessage.id);
      draftMessage = originalDraft;
      pendingFiles = filesToSend;
      errorMessage = error instanceof Error ? error.message : 'Unable to send message.';
      await tick();
      resetComposerHeight();
    } finally {
      isSending = false;
    }
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    void sendMessage();
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isSending) {
        sendMessage();
      }
    }
  }

  function handleComposerPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      appendFiles(files);
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    isDragActive = true;
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    isDragActive = false;
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragActive = false;
    appendFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  onMount(() => {
    const refresh = async () => {
      if (isRefreshing) {
        return;
      }

      isRefreshing = true;
      try {
        const tasks = [refreshConversations()];
        if (currentConversationId) {
          tasks.push(loadMessages(currentConversationId));
        }
        await Promise.all(tasks);
      } finally {
        isRefreshing = false;
      }
    };

    const handlePopState = async () => {
      const url = new URL(window.location.href);
      currentConversationId = url.searchParams.get('conversation');
      await loadMessages(currentConversationId, { forceScroll: true });
    };

    tick().then(() => {
      resetComposerHeight();
      focusComposer();
    });

    const interval = window.setInterval(refresh, 2000);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('popstate', handlePopState);
      clearPendingFiles();
    };
  });
</script>

<div class="shell">
  <div class="llama-frame" class:sidebar-collapsed={sidebarCollapsed}>
    <aside class="llama-sidebar">
      <div class="llama-brand">llama.cpp</div>

      <div class="llama-nav">
        <button class="llama-nav-item" type="button" onclick={startNewChat}>
          <span class="llama-nav-icon"><SquarePen class="h-4 w-4" /></span>
          <span>New chat</span>
        </button>

        <label class="llama-search-input">
          <span class="llama-nav-icon"><Search class="h-4 w-4" /></span>
          <input bind:value={searchQuery} placeholder="Search" />
        </label>

        <div class="llama-nav-item disabled" aria-disabled="true">
          <span class="llama-nav-icon"><PlugZap class="h-4 w-4" /></span>
          <span>MCP Servers</span>
        </div>
      </div>

      <div class="llama-sidebar-section-title">Conversations</div>
      <ConversationList
        conversations={filteredConversations}
        currentConversationId={currentConversationId}
        onSelect={selectConversation}
      />

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
        <button
          class="llama-toolbar-button"
          type="button"
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
        >
          <PanelLeft class="h-4 w-4" />
        </button>

        <div class="llama-header-copy">
          <div class="llama-header-title">{activeConversationTitle()}</div>
          <div class="llama-header-subtitle">
            Current backend preserved: session auth, MySQL conversations, Hermes queue, attachment uploads.
          </div>
        </div>

        <button class="llama-toolbar-button" type="button" disabled aria-label="Settings unavailable">
          <Settings2 class="h-4 w-4" />
        </button>
      </div>

      <div class="llama-chat-stage">
        <div
          class="llama-stage-scroll"
          role="region"
          aria-label="Chat conversation"
          ondragover={handleDragOver}
          ondragleave={handleDragLeave}
          ondrop={handleDrop}
        >
          {#if messages.length === 0}
            <div class="llama-empty-state">
              <h1>llama.cpp</h1>
              <p>Type a message or upload files to get started.</p>
            </div>
          {:else}
            <MessagePane
              bind:scrollContainer={messageScrollElement}
              messages={messages}
              copiedMessageId={copiedMessageId}
              onCopy={copyMessage}
              onScroll={handleMessageScroll}
            />
          {/if}

          {#if isDragActive}
            <div class="llama-drag-overlay">Drop files to attach them</div>
          {/if}
        </div>

        <div class="llama-composer-wrap">
          <div class="llama-composer-shell">
            <form class="llama-composer-form" onsubmit={handleSubmit}>
              <input type="hidden" name="conversationId" value={currentConversationId ?? ''} />

              <div class="llama-composer">
                <textarea
                  bind:this={composerElement}
                  class="llama-textarea"
                  bind:value={draftMessage}
                  placeholder="Type a message..."
                  oninput={autoResizeComposer}
                  onkeydown={handleComposerKeydown}
                  onpaste={handleComposerPaste}
                ></textarea>

                {#if pendingFiles.length > 0}
                  <div class="pending-files">
                    {#each pendingFiles as file}
                      <div class="pending-file-pill">
                        <span>{file.file.name}</span>
                        <span>{formatFileSize(file.file.size)}</span>
                        <button type="button" class="pending-file-remove" onclick={() => removePendingFile(file.id)}>
                          ×
                        </button>
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
                            <span class="menu-item-icon"><Image class="h-4 w-4" /></span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">Images</span>
                            </span>
                          </button>

                          <div class="disabled-menu-item" aria-disabled="true">
                            <span class="menu-item-icon"><Mic class="h-4 w-4" /></span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">Audio Files</span>
                              <span class="menu-item-note">Current backend does not support capture or audio workflows yet.</span>
                            </span>
                          </div>

                          <button class="attachment-menu-item" type="button" onclick={() => openAttachmentPicker('.txt,.md,.json,.csv,.xml,.yaml,.yml,.js,.ts,.py,.rb,.go,.java,.c,.cpp,.rs')}>
                            <span class="menu-item-icon"><FileText class="h-4 w-4" /></span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">Text Files</span>
                            </span>
                          </button>

                          <button class="attachment-menu-item" type="button" onclick={() => openAttachmentPicker('.pdf,application/pdf')}>
                            <span class="menu-item-icon"><FileIcon class="h-4 w-4" /></span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">PDF Files</span>
                            </span>
                          </button>

                          <div class="disabled-menu-item" aria-disabled="true">
                            <span class="menu-item-icon"><MessageSquareText class="h-4 w-4" /></span>
                            <span class="menu-item-copy">
                              <span class="menu-item-label">System Message</span>
                              <span class="menu-item-note">Visible for parity, not wired to Hermes yet.</span>
                            </span>
                          </div>

                          <div class="menu-divider"></div>

                          <div class="disabled-menu-item" aria-disabled="true">
                            <span class="menu-item-icon"><PlugZap class="h-4 w-4" /></span>
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
                      multiple
                      onchange={handleAttachmentChange}
                    />
                  </div>

                  <div class="llama-status-chips">
                    <div class="llama-chip">
                      <span class="chip-icon"><Sparkles class="h-3.5 w-3.5" /></span>
                      <span>Hermes queue</span>
                    </div>
                    <div class="llama-chip">
                      <span class="chip-icon"><Database class="h-3.5 w-3.5" /></span>
                      <span>Server stored</span>
                    </div>
                    <div class="llama-chip disabled">
                      <span class="chip-icon"><Settings2 class="h-3.5 w-3.5" /></span>
                      <span>Model controls unavailable</span>
                    </div>
                    <button class="send-button" type="submit" aria-label="Send message" disabled={isSending}>
                      {#if isSending}
                        <Square class="h-3.5 w-3.5" />
                      {:else}
                        <ArrowUp class="h-3.5 w-3.5" />
                      {/if}
                    </button>
                  </div>
                </div>
              </div>

              <div class="llama-footnote">Press Enter to send, Shift + Enter for new line.</div>

              {#if errorMessage || form?.error}
                <div class="error-banner">{errorMessage ?? form?.error}</div>
              {/if}
            </form>
          </div>
        </div>
      </div>
    </section>
  </div>
</div>
