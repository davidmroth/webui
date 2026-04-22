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
    Settings,
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

  type SlashCommand = {
    command: '/new' | '/retry' | '/undo';
    description: string;
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
  let isClearingStalled = $state(false);
  let isRefreshing = $state(false);
  let copiedMessageId = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let busyMessageIds = $state<Set<string>>(new Set());
  let isDragActive = $state(false);
  let settingsOpen = $state(false);
  let use24HourTime = $state(false);
  let notificationsEnabled = $state(false);
  let notificationPermission = $state<NotificationPermission>('default');
  let seenAssistantMessageIds = $state<Set<string>>(new Set());
  let lastKnownConversationUpdatedAtById = $state<Record<string, string>>({});
  let lastKnownAssistantBusyById = $state<Record<string, boolean>>({});
  let selectedSlashCommandIndex = $state(0);
  let isRunningSlashCommand = $state(false);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let messageScrollElement = $state<HTMLDivElement | null>(null);
  let attachmentInput = $state<HTMLInputElement | null>(null);
  let shouldAutoScroll = $state(true);
  // Initial sidebar / mobile state is seeded from the boot-time class set by
  // app.html so hydration matches the final layout (no visible "ghost"
  // sidebar collapse on mobile load).
  const initialIsMobile =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('mobile-viewport');
  let sidebarCollapsed = $state(initialIsMobile);
  let isMobileViewport = $state(initialIsMobile);
  const appName = $derived(data.appName || 'Hermes WebUI');
  const userDisplayName = $derived(data.session?.displayName?.trim() || 'You');
  const sidebarBuildLabel = $derived.by(() => {
    const buildInfo = data.buildInfo;
    const version = String(buildInfo?.frontend ?? '0.0.0');
    const branch = buildInfo?.gitBranch ? String(buildInfo.gitBranch) : 'n/a';
    const commit = buildInfo?.gitCommitShort
      ? String(buildInfo.gitCommitShort)
      : buildInfo?.gitCommit
        ? String(buildInfo.gitCommit).slice(0, 7)
        : 'n/a';

    return `v${version} · ${branch} · ${commit}`;
  });

  const AUTO_SCROLL_AT_BOTTOM_THRESHOLD = 10;
  const TIME_FORMAT_24H_LOCALSTORAGE_KEY = 'LlamaCppWebui.timeFormat24Hour';
  const NOTIFICATIONS_ENABLED_LOCALSTORAGE_KEY = 'LlamaCppWebui.notificationsEnabled';
  const NOTIFICATION_BODY_MAX_LENGTH = 180;
  const SLASH_COMMANDS: SlashCommand[] = [
    {
      command: '/new',
      description: 'Start a new session (fresh session ID + history).'
    },
    {
      command: '/retry',
      description: 'Retry the last user message in this conversation.'
    },
    {
      command: '/undo',
      description: 'Remove the last user and assistant exchange.'
    }
  ];
  const notificationsSupported = $derived(
    typeof window !== 'undefined' && typeof Notification !== 'undefined'
  );

  function loadTimeFormatPreference() {
    if (typeof window === 'undefined') {
      return;
    }

    use24HourTime = window.localStorage.getItem(TIME_FORMAT_24H_LOCALSTORAGE_KEY) === '1';
  }

  function setTimeFormatPreference(nextValue: boolean) {
    use24HourTime = nextValue;
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(TIME_FORMAT_24H_LOCALSTORAGE_KEY, nextValue ? '1' : '0');
  }

  function loadNotificationsPreference() {
    if (typeof window === 'undefined') {
      return;
    }

    if (typeof Notification === 'undefined') {
      notificationPermission = 'denied';
      notificationsEnabled = false;
      return;
    }

    notificationPermission = Notification.permission;
    notificationsEnabled =
      window.localStorage.getItem(NOTIFICATIONS_ENABLED_LOCALSTORAGE_KEY) === '1' &&
      notificationPermission === 'granted';
  }

  function setNotificationsPreference(nextValue: boolean) {
    notificationsEnabled = nextValue;
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(NOTIFICATIONS_ENABLED_LOCALSTORAGE_KEY, nextValue ? '1' : '0');
  }

  function rememberAssistantMessages(nextMessages: ChatMessage[]) {
    const nextSeen = new Set(seenAssistantMessageIds);
    for (const message of nextMessages) {
      if (
        message.role === 'assistant' &&
        message.status === 'complete' &&
        !message.id.startsWith('pending-')
      ) {
        nextSeen.add(message.id);
      }
    }
    seenAssistantMessageIds = nextSeen;
  }

  function indexConversationUpdatedAt(nextConversations: ConversationSummary[]) {
    return Object.fromEntries(nextConversations.map((conversation) => [conversation.id, conversation.updatedAt]));
  }

  function indexConversationAssistantBusy(nextConversations: ConversationSummary[]) {
    return Object.fromEntries(
      nextConversations.map((conversation) => [conversation.id, Boolean(conversation.assistantBusy)])
    );
  }

  function conversationTitle(conversationId: string) {
    return conversations.find((conversation) => conversation.id === conversationId)?.title ?? 'New chat';
  }

  function formatNotificationBody(message: ChatMessage) {
    const normalized = message.content.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return 'Assistant sent a new message.';
    }

    if (normalized.length <= NOTIFICATION_BODY_MAX_LENGTH) {
      return normalized;
    }

    return `${normalized.slice(0, NOTIFICATION_BODY_MAX_LENGTH - 3)}...`;
  }

  async function getServiceWorkerNotificationRegistration() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    try {
      const existing = await navigator.serviceWorker.getRegistration();
      if (existing && typeof existing.showNotification === 'function') {
        return existing;
      }

      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1200))
      ]);
      if (registration && typeof registration.showNotification === 'function') {
        return registration;
      }
    } catch {
      // Ignore and fall back to the page Notification API.
    }

    return null;
  }

  async function showAssistantReplyNotification(conversationId: string, message: ChatMessage) {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return;
    }

    const chatUrl = `/chat?conversation=${conversationId}`;
    const title = `Hermes: ${conversationTitle(conversationId)}`;
    const body = formatNotificationBody(message);
    const tag = `assistant-${message.id}`;

    const registration = await getServiceWorkerNotificationRegistration();
    if (registration) {
      await registration.showNotification(title, {
        body,
        tag,
        data: { url: chatUrl }
      });
      return;
    }

    const notification = new Notification(title, { body, tag });
    notification.onclick = () => {
      notification.close();
      window.focus();
      window.location.assign(chatUrl);
    };
  }

  async function maybeNotifyAssistantReply(conversationId: string, nextMessages: ChatMessage[]) {
    const assistantMessages = nextMessages.filter(
      (message) =>
        message.role === 'assistant' &&
        message.status === 'complete' &&
        !message.id.startsWith('pending-')
    );
    const unseen = assistantMessages.filter((message) => !seenAssistantMessageIds.has(message.id));

    const isInBackgroundOrUnfocused =
      typeof document !== 'undefined' &&
      (document.visibilityState !== 'visible' || !document.hasFocus());

    const shouldNotify =
      notificationsEnabled &&
      notificationPermission === 'granted' &&
      (isInBackgroundOrUnfocused || conversationId !== currentConversationId);

    if (shouldNotify && unseen.length > 0) {
      const latest = unseen[unseen.length - 1];
      await showAssistantReplyNotification(conversationId, latest);
    }

    rememberAssistantMessages(nextMessages);
  }

  async function maybeNotifyOtherConversationReplies(nextConversations: ConversationSummary[]) {
    const previousUpdatedAtById = lastKnownConversationUpdatedAtById;
    const previousBusyById = lastKnownAssistantBusyById;

    const changedConversationIds = nextConversations
      .filter((conversation) => {
        if (conversation.id === currentConversationId) {
          return false;
        }

        const previousUpdatedAt = previousUpdatedAtById[conversation.id];
        const updatedAtChanged = Boolean(
          previousUpdatedAt && previousUpdatedAt !== conversation.updatedAt
        );

        // Fallback signal: if the assistant was previously busy on this
        // conversation and is no longer busy, treat that as a completion
        // event even if updated_at didn't change. Protects against any
        // server-side path that finalizes a streaming message without
        // bumping the parent conversation's updated_at.
        const wasBusy = previousBusyById[conversation.id] === true;
        const isBusy = Boolean(conversation.assistantBusy);
        const becameIdle = wasBusy && !isBusy;

        return updatedAtChanged || becameIdle;
      })
      .map((conversation) => conversation.id);

    for (const conversationId of changedConversationIds) {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/messages`);
        if (!response.ok) {
          continue;
        }

        const payload = await response.json();
        await maybeNotifyAssistantReply(conversationId, payload.messages);
      } catch {
        // Ignore notification checks for conversations that fail to load.
      }
    }

    lastKnownConversationUpdatedAtById = indexConversationUpdatedAt(nextConversations);
    lastKnownAssistantBusyById = indexConversationAssistantBusy(nextConversations);
  }

  async function handleNotificationsToggle(event: Event) {
    const checkbox = event.currentTarget as HTMLInputElement;
    const nextValue = checkbox.checked;

    if (!nextValue) {
      setNotificationsPreference(false);
      return;
    }

    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      checkbox.checked = false;
      setNotificationsPreference(false);
      errorMessage = 'Notifications are not available in this browser.';
      return;
    }

    if (!window.isSecureContext) {
      checkbox.checked = false;
      setNotificationsPreference(false);
      errorMessage = 'Notifications require HTTPS (or localhost).';
      return;
    }

    let permission = Notification.permission;
    if (permission !== 'granted') {
      permission = await Notification.requestPermission();
    }

    notificationPermission = permission;

    if (permission !== 'granted') {
      checkbox.checked = false;
      setNotificationsPreference(false);
      errorMessage =
        permission === 'denied'
          ? 'Notifications are blocked. Enable them in browser site settings.'
          : 'Notification permission was not granted.';
      return;
    }

    setNotificationsPreference(true);
    rememberAssistantMessages(messages);
    errorMessage = null;
  }

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
    lastKnownConversationUpdatedAtById = indexConversationUpdatedAt(data.conversations);
    lastKnownAssistantBusyById = indexConversationAssistantBusy(data.conversations);
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
  const currentConversationSummary = $derived.by(() =>
    conversations.find((conversation) => conversation.id === currentConversationId) ?? null
  );
  const showStalledWarning = $derived(
    Boolean(currentConversationSummary?.assistantStalled)
  );
  const slashQuery = $derived.by(() => {
    const normalized = draftMessage.trim();
    if (!normalized.startsWith('/') || normalized.includes('\n')) {
      return '';
    }

    const firstToken = normalized.split(/\s+/, 1)[0] ?? '';
    return firstToken.toLowerCase();
  });
  const filteredSlashCommands = $derived.by(() => {
    if (!slashQuery) {
      return [] as SlashCommand[];
    }

    const query = slashQuery.slice(1);
    return SLASH_COMMANDS.filter((entry) => entry.command.slice(1).startsWith(query));
  });
  const slashMenuVisible = $derived(filteredSlashCommands.length > 0);

  $effect(() => {
    if (!slashMenuVisible) {
      selectedSlashCommandIndex = 0;
      return;
    }

    selectedSlashCommandIndex = Math.max(
      0,
      Math.min(selectedSlashCommandIndex, filteredSlashCommands.length - 1)
    );
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

  function scrollMessagesToBottomSync() {
    if (!messageScrollElement) {
      return;
    }

    messageScrollElement.scrollTop = messageScrollElement.scrollHeight;
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

  function handleComposerInput(event: Event) {
    const inputEvent = event as InputEvent;
    // Fallback path for environments where onpaste is not fired consistently.
    if (inputEvent.inputType === 'insertFromPaste' && composerElement) {
      const normalized = normalizePastedText(composerElement.value);
      if (normalized !== composerElement.value) {
        draftMessage = normalized;
      }
    }

    autoResizeComposer();
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
    await maybeNotifyOtherConversationReplies(payload.conversations);
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
    await maybeNotifyAssistantReply(conversationId, payload.messages);
    serverAssistantBusyByConversation = {
      ...serverAssistantBusyByConversation,
      [conversationId]: Boolean(payload.assistantBusy)
    };
    await tick();
    if (messageScrollElement) {
      if (shouldStickToBottom) {
        scrollMessagesToBottomSync();
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

  async function clearStalledAssistantTurn() {
    if (!currentConversationId || isClearingStalled) {
      return;
    }

    isClearingStalled = true;
    errorMessage = null;
    try {
      const response = await fetch(`/api/conversations/${currentConversationId}/messages/active`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to clear stalled assistant turn.');
      }

      clearPendingAssistant(currentConversationId);
      await refreshConversations();
      await loadMessages(currentConversationId);
      focusComposer();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to clear stalled assistant turn.';
    } finally {
      isClearingStalled = false;
    }
  }

  async function retryLastUserMessage() {
    const previousUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user' && !message.id.startsWith('pending-') && message.content.trim());

    if (!previousUserMessage) {
      throw new Error('There is no previous user message to retry.');
    }

    draftMessage = previousUserMessage.content;
    await tick();
    resetComposerHeight();
    await sendMessage();
  }

  async function undoLastExchange() {
    if (!currentConversationId) {
      throw new Error('No active conversation to undo.');
    }

    const stableMessages = messages.filter((message) => !message.id.startsWith('pending-'));
    let lastUserIndex = -1;
    for (let index = stableMessages.length - 1; index >= 0; index -= 1) {
      if (stableMessages[index].role === 'user') {
        lastUserIndex = index;
        break;
      }
    }

    if (lastUserIndex < 0) {
      throw new Error('No user exchange found to undo.');
    }

    const messageIdsToDelete = [stableMessages[lastUserIndex].id];
    for (let index = lastUserIndex + 1; index < stableMessages.length; index += 1) {
      const message = stableMessages[index];
      if (message.role !== 'assistant') {
        break;
      }
      messageIdsToDelete.push(message.id);
    }

    for (const messageId of messageIdsToDelete.reverse()) {
      const response = await fetch(
        `/api/conversations/${currentConversationId}/messages/${messageId}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to undo the last exchange.');
      }
    }

    await refreshConversations();
    await loadMessages(currentConversationId, { forceScroll: true });
    focusComposer();
  }

  async function handleSlashCommand() {
    const normalized = draftMessage.trim();
    if (!normalized.startsWith('/')) {
      return false;
    }

    const [command] = normalized.split(/\s+/, 1);
    if (!command) {
      return false;
    }

    isRunningSlashCommand = true;
    errorMessage = null;

    try {
      if (command === '/new') {
        startNewChat();
      } else if (command === '/retry') {
        await retryLastUserMessage();
      } else if (command === '/undo') {
        await undoLastExchange();
      } else {
        return false;
      }

      draftMessage = '';
      await tick();
      resetComposerHeight();
      focusComposer();
      return true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to run slash command.';
      return true;
    } finally {
      isRunningSlashCommand = false;
    }
  }

  async function submitComposer() {
    if (isSending || isRunningSlashCommand) {
      return;
    }

    if (await handleSlashCommand()) {
      return;
    }

    await sendMessage();
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    void submitComposer();
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if (slashMenuVisible) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedSlashCommandIndex =
          (selectedSlashCommandIndex + 1) % filteredSlashCommands.length;
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedSlashCommandIndex =
          (selectedSlashCommandIndex - 1 + filteredSlashCommands.length) %
          filteredSlashCommands.length;
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault();
        const selected = filteredSlashCommands[selectedSlashCommandIndex];
        if (selected) {
          draftMessage = selected.command;
          void submitComposer();
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        draftMessage = '';
        return;
      }
    }

    // On mobile, Enter inserts a newline; users send via the button.
    if (isMobileViewport) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isSending) {
        void submitComposer();
      }
    }
  }

  function normalizePastedText(text: string) {
    // Keep user formatting intact while trimming accidental outer/trailing whitespace.
    return text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '');
  }

  function handleComposerPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      appendFiles(files);
      return;
    }

    if (!composerElement) {
      return;
    }

    const pastedText =
      event.clipboardData?.getData('text/plain') ??
      event.clipboardData?.getData('text') ??
      event.clipboardData?.getData('Text') ??
      '';
    const normalized = normalizePastedText(pastedText);
    event.preventDefault();
    if (!normalized) {
      return;
    }

    const start = composerElement.selectionStart ?? draftMessage.length;
    const end = composerElement.selectionEnd ?? draftMessage.length;
    composerElement.setRangeText(normalized, start, end, 'end');
    draftMessage = composerElement.value;
    resetComposerHeight();
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
    let resizeObserver: ResizeObserver | null = null;

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
      // Jump scroll container to the bottom synchronously so the SSR'd
      // transcript appears already-scrolled when the boot overlay fades out.
      if (messageScrollElement) {
        scrollMessagesToBottomSync();
        shouldAutoScroll = true;

        const scrollContentElement = messageScrollElement.firstElementChild;
        if (scrollContentElement instanceof HTMLElement && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (shouldAutoScroll) {
              scrollMessagesToBottomSync();
            }
          });
          resizeObserver.observe(scrollContentElement);
        }
      }
    });
    loadTimeFormatPreference();
    loadNotificationsPreference();
    rememberAssistantMessages(messages);

    syncMobileViewport();
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const onMediaChange = () => syncMobileViewport();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', onMediaChange);
    } else {
      mediaQuery.addListener(onMediaChange);
    }

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (settingsOpen) {
          settingsOpen = false;
          return;
        }

        if (isMobileViewport && !sidebarCollapsed) {
          sidebarCollapsed = true;
        }
      }
    };
    window.addEventListener('keydown', onKeydown);

    const onVisibilityChange = () => {
      if (typeof Notification === 'undefined') {
        return;
      }

      notificationPermission = Notification.permission;
      if (notificationPermission !== 'granted' && notificationsEnabled) {
        setNotificationsPreference(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const interval = window.setInterval(refresh, 2000);
    window.addEventListener('popstate', handlePopState);

    return () => {
      resizeObserver?.disconnect();
      window.clearInterval(interval);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
        <div class="llama-brand">{appName}</div>
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
        use24HourTime={use24HourTime}
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

        <div class="llama-build-meta" title="Frontend version, branch, and commit">{sidebarBuildLabel}</div>
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

        <div class="llama-topbar-actions">
          <button
            class="llama-toolbar-button"
            type="button"
            aria-label="Open settings"
            title="Settings"
            onclick={() => (settingsOpen = true)}
          >
            <Settings class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div class="llama-chat-stage">
        {#if showStalledWarning}
          <div
            class="llama-stalled-banner"
            role="status"
          >
            <strong class="llama-stalled-banner-title">Hermes worker appears stalled.</strong>
            <p class="llama-stalled-banner-body">
              Your message is queued, but the webchat worker heartbeat is stale. Check
              <span class="llama-stalled-banner-emphasis">WEBCHAT_URL / WEBCHAT_SERVICE_TOKEN</span>
              on Hermes and
              <span class="llama-stalled-banner-emphasis">HERMES_WEBCHAT_SERVICE_TOKEN</span>
              on WebUI, then restart the Hermes gateway webchat adapter.
            </p>
            <div class="llama-stalled-banner-actions">
              <button
                class="llama-stalled-banner-action"
                type="button"
                onclick={clearStalledAssistantTurn}
                disabled={isClearingStalled}
              >
                {isClearingStalled ? 'Clearing queued turn...' : 'Clear queued turn'}
              </button>
            </div>
          </div>
        {/if}

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
              <h1>{appName}</h1>
              <p>Type a message or upload files to get started.</p>
            </div>
          {:else}
            <MessagePane
              bind:scrollContainer={messageScrollElement}
              messages={displayMessages}
              userDisplayName={userDisplayName}
              use24HourTime={use24HourTime}
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
                    {#if attachmentMenuOpen}
                      <button
                        class="attachment-menu-backdrop"
                        type="button"
                        aria-label="Close attachments menu"
                        onclick={() => (attachmentMenuOpen = false)}
                      ></button>
                    {/if}

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

                  <div class="llama-composer-input-stack">
                    {#if slashMenuVisible}
                      <div class="llama-slash-menu" role="listbox" aria-label="Slash commands">
                        {#each filteredSlashCommands as slashCommand, index (slashCommand.command)}
                          <button
                            type="button"
                            class="llama-slash-command"
                            class:active={index === selectedSlashCommandIndex}
                            role="option"
                            aria-selected={index === selectedSlashCommandIndex}
                            onmousedown={(event) => event.preventDefault()}
                            onclick={() => {
                              draftMessage = slashCommand.command;
                              void submitComposer();
                            }}
                          >
                            <div class="llama-slash-command-name">{slashCommand.command}</div>
                            <div class="llama-slash-command-description">{slashCommand.description}</div>
                          </button>
                        {/each}
                      </div>
                    {/if}

                    <textarea
                      bind:this={composerElement}
                      class="llama-textarea"
                      bind:value={draftMessage}
                      placeholder="Type a message..."
                      oninput={handleComposerInput}
                      onkeydown={handleComposerKeydown}
                      onpaste={handleComposerPaste}
                    ></textarea>
                  </div>

                  <div class="llama-composer-actions llama-composer-actions-right">
                    <button
                      class="send-button"
                      type="submit"
                      aria-label="Send message"
                      disabled={isSending || isRunningSlashCommand}
                    >
                      {#if isSending || isRunningSlashCommand}
                        <Square class="h-3.5 w-3.5" />
                      {:else}
                        <ArrowUp class="h-3.5 w-3.5" />
                      {/if}
                    </button>
                  </div>
                </div>
              </div>

              {#if !isMobileViewport}
                <div class="llama-footnote">Press Enter to send, Shift + Enter for new line.</div>
              {/if}

              {#if errorMessage || form?.error}
                <div class="error-banner">{errorMessage ?? form?.error}</div>
              {/if}
            </form>
          </div>
        </div>
      </div>
    </section>
  </div>

  {#if settingsOpen}
    <div
      class="llama-settings-modal-layer"
      role="presentation"
      onclick={(event: MouseEvent) => {
        if (event.currentTarget === event.target) {
          settingsOpen = false;
        }
      }}
    >
      <div
        class="llama-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <header class="llama-settings-modal-header">
          <h2>Settings</h2>
        </header>

        <div class="llama-settings-modal-body">
          <div class="llama-settings-row">
            <div class="llama-settings-copy">
              <div class="llama-settings-title">24-hour time</div>
              <div class="llama-settings-description">Use military time for message and conversation timestamps.</div>
            </div>

            <label class="llama-settings-toggle">
              <input
                type="checkbox"
                checked={use24HourTime}
                onchange={(event) => setTimeFormatPreference((event.currentTarget as HTMLInputElement).checked)}
              />
              <span>{use24HourTime ? 'On' : 'Off'}</span>
            </label>
          </div>

          <div class="llama-settings-row">
            <div class="llama-settings-copy">
              <div class="llama-settings-title">Notifications</div>
              <div class="llama-settings-description">
                Notify when an assistant reply arrives while this chat is in the background.
                {#if !notificationsSupported}
                  Notifications are not supported in this browser.
                {:else if notificationPermission === 'denied'}
                  Permission is blocked; allow notifications in site settings.
                {/if}
              </div>
            </div>

            <label class="llama-settings-toggle">
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onchange={handleNotificationsToggle}
                disabled={!notificationsSupported}
              />
              <span>{notificationsEnabled ? 'On' : 'Off'}</span>
            </label>
          </div>
        </div>

        <footer class="llama-settings-modal-footer">
          <button class="secondary-button" type="button" onclick={() => (settingsOpen = false)}>Done</button>
        </footer>
      </div>
    </div>
  {/if}
</div>
