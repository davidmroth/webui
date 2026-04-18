<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArrowDown,
    ArrowUp,
    ChevronsLeft,
    File as FileIcon,
    FileText,
    Image,
    MessageSquareText,
    Mic,
    Moon,
    PanelLeft,
    Paperclip,
    PlugZap,
    Search,
    Square,
    SquarePen,
    Sun
  } from '@lucide/svelte';
  import { mode, toggleMode } from 'mode-watcher';
  import ConversationList from '$components/chat/ConversationList.svelte';
  import MessagePane from '$components/chat/MessagePane.svelte';
  import type { ChatMessage, ConversationSummary } from '$lib/types-legacy';

  type PendingAttachment = {
    id: string;
    file: File;
    previewUrl: string;
  };

  type PendingAssistantState = {
    conversationId: string;
    userMessageId: string;
    placeholderId: string;
  };

  let { data, form } = $props();
  let currentConversationId = $state<string | null>(null);
  let messages = $state<ChatMessage[]>([]);
  let conversations = $state<ConversationSummary[]>([]);
  let pendingFiles = $state<PendingAttachment[]>([]);
  let pendingAssistantByConversation = $state<Record<string, PendingAssistantState>>({});
  let serverAssistantBusyByConversation = $state<Record<string, boolean>>({});
  let attachmentMenuOpen = $state(false);
  let searchQuery = $state('');
  let draftMessage = $state('');
  let isSending = $state(false);
  let isRefreshing = $state(false);
  let copiedMessageId = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let busyMessageIds = $state<Set<string>>(new Set());
  let isDragActive = $state(false);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let messageScrollElement = $state<HTMLDivElement | null>(null);
  let attachmentInput = $state<HTMLInputElement | null>(null);
  let shouldAutoScroll = $state(true);
  let sidebarCollapsed = $state(false);
  let isMobileViewport = $state(false);

  const AUTO_SCROLL_AT_BOTTOM_THRESHOLD = 10;

  function syncMobileViewport() {
    if (typeof window === 'undefined') return;
    const next = window.matchMedia('(max-width: 768px)').matches;
    if (next !== isMobileViewport) {
      isMobileViewport = next;
      // On switching INTO mobile, default the drawer to closed.
      if (next) {
        sidebarCollapsed = true;
      }
    }
  }

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

  const displayMessages = $derived.by(() => {
    const pendingAssistant = currentConversationId ? pendingAssistantByConversation[currentConversationId] : null;
    if (!pendingAssistant) {
      return messages;
    }

    if (messages.some((message) => message.id === pendingAssistant.placeholderId)) {
      return messages;
    }

    return [...messages, createPendingAssistantMessage(pendingAssistant.placeholderId)];
  });

  const isAssistantBusy = $derived(
    displayMessages.some((message) => message.role === 'assistant' && message.status === 'streaming') ||
      (currentConversationId
        ? serverAssistantBusyByConversation[currentConversationId] ??
          (currentConversationId === data.currentConversationId ? Boolean(data.assistantBusy) : false)
        : false)
  );

  const showJumpToBottom = $derived(displayMessages.length > 0 && !shouldAutoScroll);

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
    shouldAutoScroll = true;
    await tick();
    if (!messageScrollElement) {
      return;
    }

    messageScrollElement.scrollTo({
      top: messageScrollElement.scrollHeight,
      behavior
    });
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

  function createPendingAssistantMessage(id: string): ChatMessage {
    return {
      id,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      status: 'streaming',
      attachments: []
    };
  }

  function setPendingAssistant(conversationId: string, userMessageId: string, placeholderId: string) {
    pendingAssistantByConversation = {
      ...pendingAssistantByConversation,
      [conversationId]: {
        conversationId,
        userMessageId,
        placeholderId
      }
    };
  }

  function clearPendingAssistant(conversationId: string) {
    if (!pendingAssistantByConversation[conversationId]) {
      return;
    }

    const nextPending = { ...pendingAssistantByConversation };
    delete nextPending[conversationId];
    pendingAssistantByConversation = nextPending;
  }

  function syncPendingAssistant(conversationId: string, nextMessages: ChatMessage[]) {
    const pendingAssistant = pendingAssistantByConversation[conversationId];
    if (!pendingAssistant) {
      return;
    }

    const userIndex = nextMessages.findIndex((message) => message.id === pendingAssistant.userMessageId);
    if (userIndex === -1) {
      return;
    }

    const hasAssistantReply = nextMessages.slice(userIndex + 1).some((message) => message.role === 'assistant');
    if (hasAssistantReply) {
      clearPendingAssistant(conversationId);
    }
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
    const shouldStickToBottom = options.forceScroll ?? (shouldAutoScroll || isNearBottom());

    if (!conversationId) {
      messages = [];
      return;
    }

    const response = await fetch(`/api/conversations/${conversationId}/messages`);
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    syncPendingAssistant(conversationId, payload.messages);
    messages = payload.messages;
    serverAssistantBusyByConversation = {
      ...serverAssistantBusyByConversation,
      [conversationId]: Boolean(payload.assistantBusy)
    };
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
      if (isMobileViewport) sidebarCollapsed = true;
      return;
    }

    currentConversationId = conversationId;
    errorMessage = null;
    setChatUrl(conversationId);
    if (isMobileViewport) sidebarCollapsed = true;
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
    if (isMobileViewport) sidebarCollapsed = true;
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

  function markBusy(messageId: string, busy: boolean) {
    const next = new Set(busyMessageIds);
    if (busy) next.add(messageId);
    else next.delete(messageId);
    busyMessageIds = next;
  }

  async function deleteMessage(message: ChatMessage) {
    if (!currentConversationId || message.id.startsWith('pending-')) return;
    if (typeof window !== 'undefined' && !window.confirm('Delete this message?')) return;
    markBusy(message.id, true);
    try {
      const response = await fetch(
        `/api/conversations/${currentConversationId}/messages/${message.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to delete message.');
      }
      await loadMessages(currentConversationId);
      await refreshConversations();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to delete message.';
    } finally {
      markBusy(message.id, false);
    }
  }

  async function regenerateMessage(message: ChatMessage) {
    if (!currentConversationId || message.role !== 'assistant' || message.id.startsWith('pending-')) {
      return;
    }
    markBusy(message.id, true);
    try {
      const response = await fetch(
        `/api/conversations/${currentConversationId}/messages/${message.id}/regenerate`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to regenerate message.');
      }
      const payload = await response.json();
      // Drop the assistant message and stage a placeholder so the UI shows the
      // typing indicator until the polling loop picks up the new reply.
      const placeholderId = createClientId('pending-assistant-');
      messages = messages
        .filter((entry) => entry.id !== message.id)
        .concat(createPendingAssistantMessage(placeholderId));
      setPendingAssistant(currentConversationId, payload.userMessageId, placeholderId);
      await refreshConversations();
      await loadMessages(currentConversationId);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to regenerate message.';
    } finally {
      markBusy(message.id, false);
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

    const optimisticAssistantMessage = createPendingAssistantMessage(createClientId('pending-assistant-'));

    messages = [...messages, optimisticMessage, optimisticAssistantMessage];
    await scrollMessagesToBottom();

    const filesToSend = [...pendingFiles];
    const originalDraft = draftMessage;
    let conversationId = currentConversationId;

    draftMessage = '';
    pendingFiles = [];
    if (attachmentInput) {
      attachmentInput.value = '';
    }
    await tick();
    resetComposerHeight();

    try {
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

      if (!conversationId) {
        throw new Error('Unable to resolve conversation.');
      }

      setPendingAssistant(conversationId, optimisticMessage.id, optimisticAssistantMessage.id);

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

      const payload = await response.json();
      setPendingAssistant(conversationId, payload.messageId, optimisticAssistantMessage.id);

      await refreshConversations();
      await loadMessages(conversationId, { forceScroll: true });
      revokePendingFiles(filesToSend);
      focusComposer();
    } catch (error) {
      messages = messages.filter(
        (message) => message.id !== optimisticMessage.id && message.id !== optimisticAssistantMessage.id
      );
      if (conversationId) {
        clearPendingAssistant(conversationId);
      }
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

    syncMobileViewport();
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const onMediaChange = () => syncMobileViewport();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', onMediaChange);
    } else {
      mediaQuery.addListener(onMediaChange);
    }

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isMobileViewport && !sidebarCollapsed) {
        sidebarCollapsed = true;
      }
    };
    window.addEventListener('keydown', onKeydown);

    const interval = window.setInterval(refresh, 2000);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', onKeydown);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', onMediaChange);
      } else {
        mediaQuery.removeListener(onMediaChange);
      }
      clearPendingFiles();
    };
  });
</script>

<div class="shell">
  <div class="llama-frame" class:sidebar-collapsed={sidebarCollapsed}>
    {#if isMobileViewport && !sidebarCollapsed}
      <button
        type="button"
        class="llama-mobile-backdrop"
        aria-label="Close sidebar"
        onclick={() => (sidebarCollapsed = true)}
      ></button>
    {/if}
    <aside class="llama-sidebar">
      <div class="llama-sidebar-header">
        <div class="llama-brand">llama.cpp</div>
        <button
          type="button"
          class="llama-toolbar-button llama-sidebar-collapse"
          aria-label="Hide sidebar"
          title="Hide sidebar"
          onclick={() => (sidebarCollapsed = true)}
        >
          <ChevronsLeft class="h-4 w-4" />
        </button>
      </div>

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

        <div class="llama-footer-actions">
          <button
            type="button"
            class="llama-toolbar-button llama-theme-toggle"
            aria-label={mode.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={mode.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onclick={toggleMode}
          >
            {#if mode.current === 'dark'}
              <Sun class="h-4 w-4" />
            {:else}
              <Moon class="h-4 w-4" />
            {/if}
          </button>

          <form method="POST" action="/logout" style="flex: 1;">
            <button class="secondary-button" type="submit" style="width: 100%;">Sign out</button>
          </form>
        </div>
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
        </div>

        <div class="llama-topbar-spacer" aria-hidden="true"></div>
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
          {#if displayMessages.length === 0}
            <div class="llama-empty-state">
              <h1>llama.cpp</h1>
              <p>Type a message or upload files to get started.</p>
            </div>
          {:else}
            <MessagePane
              bind:scrollContainer={messageScrollElement}
              messages={displayMessages}
              copiedMessageId={copiedMessageId}
              busyMessageIds={busyMessageIds}
              onCopy={copyMessage}
              onRegenerate={regenerateMessage}
              onDelete={deleteMessage}
              onScroll={handleMessageScroll}
            />
          {/if}

          {#if isDragActive}
            <div class="llama-drag-overlay">Drop files to attach them</div>
          {/if}
        </div>

        <div class="llama-composer-wrap">
          <div class="llama-composer-shell">
            {#if showJumpToBottom}
              <button
                class="llama-jump-to-bottom"
                type="button"
                aria-label="Jump to latest message"
                title="Jump to latest message"
                onclick={() => scrollMessagesToBottom('smooth')}
              >
                <ArrowDown class="h-4 w-4" />
              </button>
            {/if}

            <form class="llama-composer-form" onsubmit={handleSubmit}>
              <input type="hidden" name="conversationId" value={currentConversationId ?? ''} />

              <div class="llama-composer">
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

                <div class="llama-composer-row">
                  <div class="llama-composer-actions llama-composer-actions-left">
                    <details class="attachment-menu" bind:open={attachmentMenuOpen}>
                      <summary class="compose-icon-button" aria-label="Open attachments menu">
                        <Paperclip class="h-4 w-4" />
                      </summary>
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

                  <textarea
                    bind:this={composerElement}
                    class="llama-textarea"
                    bind:value={draftMessage}
                    placeholder="Type a message..."
                    oninput={autoResizeComposer}
                    onkeydown={handleComposerKeydown}
                    onpaste={handleComposerPaste}
                  ></textarea>

                  <div class="llama-composer-actions llama-composer-actions-right">
                    {#if isAssistantBusy}
                      <div class="llama-chip busy" role="status" aria-live="polite">
                        <span class="chip-loader" aria-hidden="true">
                          <span></span>
                          <span></span>
                          <span></span>
                        </span>
                        <span>Assistant busy</span>
                      </div>
                    {/if}
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
