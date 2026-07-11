<script lang="ts">
  import { env as publicEnv } from '$env/dynamic/public';
  import { onMount, tick, untrack } from 'svelte';
  import {
    ArrowDown,
    ArrowUp,
    ChevronsLeft,
    ExternalLink,
    File as FileIcon,
    FileText,
    Image,
    MessageSquareText,
    Mic,
    PanelLeft,
    Paperclip,
    Pen,
    PlugZap,
    Search,
    Settings,
    SquarePen
  } from '@lucide/svelte';
  import ThemeModeToggle from '$lib/components/ThemeModeToggle.svelte';
  import ConversationList from '$components/chat/ConversationList.svelte';
  import MessagePane from '$components/chat/MessagePane.svelte';
  import { CHAT_INPUT_HISTORY_LOCALSTORAGE_KEY } from '$lib/constants';
  import type { MaintenanceHermesConnectionStatus } from '$lib/services/maintenance-hermes-status';
  import { startConversationStatusPolling, type ConversationStatusSnapshot } from '$lib/services/conversation-status';
  import {
    deleteConversation as deleteConversationRequest,
    exportConversation as exportConversationRequest,
    renameConversation as renameConversationRequest
  } from '$lib/services/conversation-actions';
  import type { ChatMessage, ConversationRunState, ConversationSummary, HermesRunStatus } from '$lib/types-legacy';
  import {
    deliverBrowserNotification,
    ensureBrowserPushSubscription,
    getBrowserPushSubscription,
    getNotificationPermission,
    isNotificationApiSupported,
    isPushManagerSupported,
    readNotificationsEnabledPreference,
    requestNotificationPermission,
    writeNotificationsEnabledPreference
  } from '$lib/utils/notifications';
  import {
    getChangedConversationIdsForReplyChecks,
    getLatestTerminalAssistantMessageId,
    getLatestUnseenAssistantReply,
    indexConversationAssistantBusy,
    indexConversationUpdatedAt,
    rememberSeenAssistantMessages,
    shouldNotifyAssistantReply
  } from '$lib/utils/chat-notification-policy';
  import { getAuthHeaders } from '$lib/utils/api-headers';
  import {
    appendInputHistory,
    loadInputHistory,
    navigateInputHistory,
    saveInputHistory,
    type InputHistoryDirection
  } from '$lib/utils/input-history';
  import { readTimingSummary, resolveTtftMs } from '$lib/utils/chat-timings';
  import { isCurrentConversationRequest } from '$lib/utils/current-conversation-request';
  import { getAttachmentContentFlags, resolveAttachmentContentType } from '$lib/utils/attachment-content-type';
  import type { AgentLensTestingRun } from '$lib/server/agentlens-testing';

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
    command: string;
    description: string;
    argsHint?: string;
    aliases?: string[];
    requiresConfirmation?: boolean;
  };

  type ComposerStatsStrip = {
    contextLabel: string | null;
    outputLabel: string | null;
    ttftLabel: string | null;
    speedLabel: string | null;
    isFading: boolean;
  };

  const CHAT_BACK_SENTINEL_KEY = 'hermesChatBackSentinel';

  type PushRegistrationState = 'unknown' | 'active' | 'inactive' | 'unavailable' | 'error';

  type ChatHistoryState = {
    [CHAT_BACK_SENTINEL_KEY]?: true;
    conversationId?: string | null;
  };

  let { data, form } = $props();
  let currentConversationId = $state<string | null>(
    untrack(() => data.currentConversationId ?? null)
  );
  let messages = $state<ChatMessage[]>(untrack(() => data.messages ?? []));
  let conversations = $state<ConversationSummary[]>(untrack(() => data.conversations ?? []));
  let currentRunState = $state<ConversationRunState>(untrack(() => normalizeConversationRunState(data.runState)));
  let hermesConnection = $state<MaintenanceHermesConnectionStatus | null>(
    untrack(() => data.hermesConnection ?? null)
  );
  let agentLensTesting = $state<AgentLensTestingRun | null>(untrack(() => data.agentLensTesting ?? null));
  let agentLensTestingError = $state<string | null>(null);
  let pendingFiles = $state<PendingAttachment[]>([]);
  let pendingAssistantByConversation = $state<Record<string, PendingAssistantState>>({});
  let hermesTypingPlaceholderByConversation = $state<Record<string, string>>({});
  let serverAssistantBusyByConversation = $state<Record<string, boolean>>({});
  let attachmentMenuOpen = $state(false);
  let searchQuery = $state('');
  let draftMessage = $state('');
  let composerInputHistory = $state<string[]>([]);
  let composerInputHistoryIndex = $state<number | null>(null);
  let composerHistoryDraft = $state<string | null>(null);
  let isSending = $state(false);
  let isClearingStalled = $state(false);
  let copiedMessageId = $state<string | null>(null);
  let editingMessageId = $state<string | null>(null);
  let editingDraft = $state('');
  let errorMessage = $state<string | null>(null);
  let conversationActionError = $state<string | null>(null);
  let conversationActionBusyId = $state<string | null>(null);
  let renameConversationOpen = $state(false);
  let deleteConversationOpen = $state(false);
  let conversationBeingRenamed = $state<ConversationSummary | null>(null);
  let conversationBeingDeleted = $state<ConversationSummary | null>(null);
  let conversationTitleDraft = $state('');
  let isRemovingConversationView = $state(false);
  let busyMessageIds = $state<Set<string>>(new Set());
  let isDragActive = $state(false);
  let settingsOpen = $state(false);
  let use24HourTime = $state(false);
  let notificationsEnabled = $state(false);
  let notificationPermission = $state<NotificationPermission>('default');
  let pushRegistrationState = $state<PushRegistrationState>('unknown');
  let pushSubscriptionEndpoint = $state<string | null>(null);
  let seenAssistantMessageIds = $state<Set<string>>(new Set());
  let loadedMessagesConversationId = $state<string | null>(null);
  let lastKnownConversationUpdatedAtById = $state<Record<string, string>>({});
  let lastKnownAssistantBusyById = $state<Record<string, boolean>>({});
  let ignoreNextChatBackPopstate = false;
  let slashCommands = $state<SlashCommand[]>(untrack(() => data.slashCommands ?? []));
  let selectedSlashCommandIndex = $state(0);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let messageScrollElement = $state<HTMLDivElement | null>(null);
  let messageBottomSentinel = $state<HTMLDivElement | null>(null);
  let attachmentInput = $state<HTMLInputElement | null>(null);
  let renameConversationInput = $state<HTMLInputElement | null>(null);
  let shouldAutoScroll = $state(true);
  let isAtBottom = $state(true);
  let composerStatsContextTotal = $state<number | null>(null);
  let composerStatsOutputMax = $state<number | null>(null);
  let composerStatsMessageId = $state<string | null>(null);
  let composerStatsPhase = $state<'hidden' | 'visible' | 'fading'>('hidden');
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
    const versionLabel = version.startsWith('v') ? version : `v${version}`;
    const branch = buildInfo?.gitBranch ? String(buildInfo.gitBranch) : 'n/a';
    const commit = buildInfo?.gitCommitShort
      ? String(buildInfo.gitCommitShort)
      : buildInfo?.gitCommit
        ? String(buildInfo.gitCommit).slice(0, 7)
        : 'n/a';

    return `${versionLabel} · ${branch} · ${commit}`;
  });

  const AUTO_SCROLL_AT_BOTTOM_THRESHOLD = 10;
  const TIME_FORMAT_24H_LOCALSTORAGE_KEY = 'LlamaCppWebui.timeFormat24Hour';
  const NOTIFICATION_BODY_MAX_LENGTH = 180;
  const SLASH_COMMANDS_REFRESH_INTERVAL_MS = 5 * 60_000;
  const CONVERSATION_DELETE_EXIT_MS = 220;
  const COMPOSER_STATS_VISIBLE_MS = 1_500;
  const COMPOSER_STATS_FADE_MS = 450;
  const COMPOSER_STATS_CAPS_REFRESH_INTERVAL_MS = 30_000;
  const notificationsSupported = $derived(isNotificationApiSupported());
  const pushNotificationsSupported = $derived(
    notificationsSupported &&
      isPushManagerSupported() &&
      Boolean(publicEnv.PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim())
  );
  const usesServerPushNotifications = $derived(pushRegistrationState === 'active');
  let latestTerminalAssistantMessageIdByConversation: Record<string, string | null> = {};
  let streamedAssistantSeqByMessageId: Record<string, number> = {};
  let lastSlashCommandsLoadAt = 0;
  let slashCommandsLoadInFlight: Promise<void> | null = null;
  let composerStatsFadeTimer: number | null = null;
  let composerStatsHideTimer: number | null = null;
  let composerStatsCapsLoadInFlight: Promise<void> | null = null;
  let lastComposerStatsCapsLoadAt = 0;
  let pendingLayoutAutoScroll = false;
  let isConversationLoading = $state(false);
  let streamHealthState = $state<'connected' | 'degraded' | 'disconnected'>('disconnected');
  let activePollerStopFn: (() => void) | null = null;
  let agentLensTestingPollTimer: number | null = null;
  let refreshCoalesceTimer: number | null = null;
  let pendingRefreshConversations = false;
  let pendingRefreshMessages = false;
  let conversationsEtag: string | null = null;
  let messagesEtagByConversation = $state<Record<string, string>>({});
  let dismissedStalledNoticeByConversation = $state<Record<string, true>>({});

  function scheduleRefreshCoalesce() {
    if (refreshCoalesceTimer !== null) {
      // Already scheduled; mark what we want and let the pending timer handle it.
      return;
    }

    refreshCoalesceTimer = window.setTimeout(() => {
      refreshCoalesceTimer = null;
      const conv = pendingRefreshConversations;
      const msgs = pendingRefreshMessages;
      pendingRefreshConversations = false;
      pendingRefreshMessages = false;

      if (conv) {
        void refreshConversations();
      }

      if (msgs && currentConversationId) {
        void loadMessages(currentConversationId);
      }
    }, 150);
  }

  function coalescedRefreshConversations() {
    pendingRefreshConversations = true;
    scheduleRefreshCoalesce();
  }

  function coalescedLoadMessages(conversationId: string) {
    if (conversationId === currentConversationId) {
      pendingRefreshMessages = true;
      scheduleRefreshCoalesce();
    }
  }

  function loadTimeFormatPreference() {
    if (typeof window === 'undefined') {
      return;
    }

    use24HourTime = window.localStorage.getItem(TIME_FORMAT_24H_LOCALSTORAGE_KEY) === '1';
  }

  function loadComposerInputHistory() {
    if (typeof window === 'undefined') {
      return;
    }

    composerInputHistory = loadInputHistory(
      window.localStorage,
      CHAT_INPUT_HISTORY_LOCALSTORAGE_KEY
    );
  }

  function saveComposerInputHistory(nextHistory: string[]) {
    composerInputHistory = nextHistory;
    if (typeof window === 'undefined') {
      return;
    }

    saveInputHistory(window.localStorage, CHAT_INPUT_HISTORY_LOCALSTORAGE_KEY, nextHistory);
  }

  function runWhenBrowserIdle(task: () => void) {
    if (typeof window === 'undefined') {
      return;
    }

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(task, { timeout: 1000 });
      return;
    }

    window.setTimeout(task, 0);
  }

  function resetComposerInputHistoryNavigation() {
    composerInputHistoryIndex = null;
    composerHistoryDraft = null;
  }

  async function applyComposerHistoryNavigation(direction: InputHistoryDirection) {
    const nextState = navigateInputHistory({
      entries: composerInputHistory,
      currentDraft: draftMessage,
      direction,
      index: composerInputHistoryIndex,
      pendingDraft: composerHistoryDraft
    });

    if (!nextState) {
      return;
    }

    draftMessage = nextState.nextDraft;
    composerInputHistoryIndex = nextState.nextIndex;
    composerHistoryDraft = nextState.nextPendingDraft;

    await tick();
    resetComposerHeight();
    focusComposer();
    if (composerElement) {
      const cursor = composerElement.value.length;
      composerElement.setSelectionRange(cursor, cursor);
    }
  }

  function shouldNavigateComposerHistory(event: KeyboardEvent) {
    if (slashMenuVisible) {
      return false;
    }

    if (isMobileViewport || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }

    if (event.key === 'ArrowUp') {
      return composerInputHistoryIndex !== null || draftMessage.length === 0;
    }

    if (event.key === 'ArrowDown') {
      return composerInputHistoryIndex !== null;
    }

    return false;
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

    const permission = getNotificationPermission();
    notificationPermission = permission ?? 'denied';
    notificationsEnabled = permission === 'granted' && readNotificationsEnabledPreference();
    pushRegistrationState = notificationsEnabled
      ? pushNotificationsSupported
        ? 'inactive'
        : 'unavailable'
      : 'inactive';
    pushSubscriptionEndpoint = null;
  }

  function setNotificationsPreference(nextValue: boolean) {
    notificationsEnabled = nextValue;
    writeNotificationsEnabledPreference(nextValue);
  }

  async function registerPushSubscriptionOnServer(subscription: PushSubscription) {
    const response = await fetch('/api/notifications/push-subscription', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        subscription: subscription.toJSON()
      })
    });

    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    const reason =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : 'Failed to register background push notifications.';
    throw new Error(reason);
  }

  async function removePushSubscriptionFromServer(endpoint: string) {
    const response = await fetch('/api/notifications/push-subscription', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ endpoint })
    });

    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    const reason =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : 'Failed to remove background push registration.';
    throw new Error(reason);
  }

  async function syncPushSubscription(options: { subscribe?: boolean; silenceErrors?: boolean } = {}) {
    const subscribe = options.subscribe ?? false;
    if (typeof window === 'undefined' || !notificationsEnabled || notificationPermission !== 'granted') {
      pushRegistrationState = 'inactive';
      pushSubscriptionEndpoint = null;
      return false;
    }

    const vapidPublicKey = publicEnv.PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? '';
    if (!isPushManagerSupported() || !vapidPublicKey) {
      pushRegistrationState = 'unavailable';
      pushSubscriptionEndpoint = null;
      return false;
    }

    try {
      const subscription = subscribe
        ? await ensureBrowserPushSubscription(vapidPublicKey, { timeoutMs: 2000 })
        : await getBrowserPushSubscription(2000);
      if (!subscription) {
        pushRegistrationState = 'inactive';
        pushSubscriptionEndpoint = null;
        if (subscribe && !options.silenceErrors) {
          errorMessage =
            'Background push is unavailable right now. Notifications still depend on this tab staying alive.';
        }
        return false;
      }

      await registerPushSubscriptionOnServer(subscription);
      pushRegistrationState = 'active';
      pushSubscriptionEndpoint = subscription.endpoint;
      if (!options.silenceErrors) {
        errorMessage = null;
      }
      return true;
    } catch (error) {
      pushRegistrationState = 'error';
      pushSubscriptionEndpoint = null;
      if (!options.silenceErrors) {
        errorMessage =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Failed to register background push notifications.';
      }
      return false;
    }
  }

  async function disablePushSubscription(options: { silenceErrors?: boolean } = {}) {
    try {
      const subscription = await getBrowserPushSubscription(1500);
      const endpoint = subscription?.endpoint ?? pushSubscriptionEndpoint;
      if (endpoint) {
        await removePushSubscriptionFromServer(endpoint);
      }
      if (subscription) {
        await subscription.unsubscribe();
      }
    } catch (error) {
      if (!options.silenceErrors) {
        console.warn('Failed to disable background push notifications', error);
      }
    } finally {
      pushRegistrationState = 'inactive';
      pushSubscriptionEndpoint = null;
    }
  }

  function rememberAssistantMessages(nextMessages: ChatMessage[]) {
    seenAssistantMessageIds = rememberSeenAssistantMessages(seenAssistantMessageIds, nextMessages);
  }

  function rememberConversationStreamCursor(conversationId: string, nextMessages: ChatMessage[]) {
    latestTerminalAssistantMessageIdByConversation = {
      ...latestTerminalAssistantMessageIdByConversation,
      [conversationId]: getLatestTerminalAssistantMessageId(nextMessages)
    };
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

  async function showAssistantReplyNotification(conversationId: string, message: ChatMessage) {
    if (typeof window === 'undefined') {
      return;
    }

    const chatUrl = `/chat?conversation=${conversationId}`;
    const title = `Hermes: ${conversationTitle(conversationId)}`;
    const body = formatNotificationBody(message);
    const tag = `assistant-${message.id}`;

    await deliverBrowserNotification(
      { title, body, tag, url: chatUrl },
      { strategy: 'service-worker-first', timeoutMs: 1200 }
    );
  }

  async function maybeNotifyAssistantReply(conversationId: string, nextMessages: ChatMessage[]) {
    const latest = getLatestUnseenAssistantReply(seenAssistantMessageIds, nextMessages);
    const shouldNotify =
      !usesServerPushNotifications &&
      shouldNotifyAssistantReply({
        notificationsEnabled,
        notificationPermission,
        conversationId,
        currentConversationId,
        documentVisibility: typeof document === 'undefined' ? 'visible' : document.visibilityState,
        documentHasFocus: typeof document === 'undefined' ? true : document.hasFocus()
      });

    if (shouldNotify && latest) {
      await showAssistantReplyNotification(conversationId, latest);
    }

    rememberAssistantMessages(nextMessages);
  }

  async function maybeNotifyOtherConversationReplies(nextConversations: ConversationSummary[]) {
    const changedConversationIds = getChangedConversationIdsForReplyChecks({
      currentConversationId,
      nextConversations,
      previousUpdatedAtById: lastKnownConversationUpdatedAtById,
      previousBusyById: lastKnownAssistantBusyById
    });

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
      void disablePushSubscription({ silenceErrors: true });
      return;
    }

    if (typeof window === 'undefined' || !isNotificationApiSupported()) {
      checkbox.checked = false;
      setNotificationsPreference(false);
      void disablePushSubscription({ silenceErrors: true });
      errorMessage = 'Notifications are not available in this browser.';
      return;
    }

    if (!window.isSecureContext) {
      checkbox.checked = false;
      setNotificationsPreference(false);
      void disablePushSubscription({ silenceErrors: true });
      errorMessage = 'Notifications require HTTPS (or localhost).';
      return;
    }

    let permission = getNotificationPermission();
    if (permission !== 'granted') {
      permission = await requestNotificationPermission();
    }

    notificationPermission = permission ?? 'denied';

    if (permission !== 'granted') {
      checkbox.checked = false;
      setNotificationsPreference(false);
      void disablePushSubscription({ silenceErrors: true });
      errorMessage =
        permission === 'denied'
          ? 'Notifications are blocked. Enable them in browser site settings.'
          : 'Notification permission was not granted.';
      return;
    }

    setNotificationsPreference(true);
    rememberAssistantMessages(messages);
    errorMessage = null;
    if (pushNotificationsSupported) {
      await syncPushSubscription({ subscribe: true, silenceErrors: true });
      if (pushRegistrationState !== 'active') {
        errorMessage =
          'Background push could not be enabled, so notifications still depend on this tab staying alive.';
      }
    }
  }

  function syncMobileViewport() {
    if (typeof window === 'undefined') return;
    const next = window.matchMedia('(max-width: 768px)').matches;
    if (next !== isMobileViewport) {
      isMobileViewport = next;
      // On switching INTO mobile, default the drawer to closed.
      if (next) {
        setSidebarCollapsed(true);
      }
    }
    syncChatBackSentinel();
  }

  function currentHistoryState(): ChatHistoryState | null {
    return typeof window === 'undefined' ? null : ((window.history.state ?? null) as ChatHistoryState | null);
  }

  function shouldInstallChatBackSentinel() {
    return isMobileViewport && Boolean(currentConversationId) && sidebarCollapsed;
  }

  function syncChatBackSentinel() {
    if (typeof window === 'undefined' || !shouldInstallChatBackSentinel()) {
      return;
    }

    if (currentHistoryState()?.[CHAT_BACK_SENTINEL_KEY]) {
      return;
    }

    window.history.pushState(
      { [CHAT_BACK_SENTINEL_KEY]: true, conversationId: currentConversationId },
      '',
      window.location.href
    );
  }

  function replaceChatHistoryState(conversationId: string | null, url: string) {
    window.history.replaceState({ conversationId }, '', url);
    syncChatBackSentinel();
  }

  function removeChatBackSentinel() {
    if (typeof window === 'undefined' || !currentHistoryState()?.[CHAT_BACK_SENTINEL_KEY]) {
      return;
    }

    ignoreNextChatBackPopstate = true;
    window.history.back();
  }

  function setSidebarCollapsed(collapsed: boolean) {
    sidebarCollapsed = collapsed;
    if (collapsed) {
      syncChatBackSentinel();
    } else {
      removeChatBackSentinel();
    }
  }

  function createIdleRunState(): ConversationRunState {
    return {
      status: 'idle',
      active: false,
      stalled: false
    };
  }

  function normalizeConversationRunState(value: unknown): ConversationRunState {
    if (!value || typeof value !== 'object') {
      return createIdleRunState();
    }

    const candidate = value as Partial<ConversationRunState>;
    const status = normalizeHermesRunStatus(candidate.status);
    if (!status) {
      return createIdleRunState();
    }

    return {
      ...candidate,
      status,
      active: Boolean(candidate.active),
      stalled: Boolean(candidate.stalled)
    };
  }

  function buildRunStateFromStatusPayload(
    payload: Record<string, unknown>,
    messageId: string,
    runStatus: HermesRunStatus
  ): ConversationRunState {
    const eventId = typeof payload.eventId === 'string' ? payload.eventId : undefined;
    const errorCode = typeof payload.errorCode === 'string' ? payload.errorCode : null;
    const errorMessage = typeof payload.errorMessage === 'string' ? payload.errorMessage : null;

    return {
      status: runStatus,
      active: runStatus === 'queued' || runStatus === 'processing',
      stalled: runStatus === 'stale',
      eventId,
      messageId,
      errorCode,
      errorMessage,
      lastActivityAt: new Date().toISOString()
    };
  }

  $effect(() => {
    currentConversationId = data.currentConversationId;
    messages = data.messages;
    conversations = data.conversations;
    currentRunState = normalizeConversationRunState(data.runState);
    hermesConnection = data.hermesConnection ?? null;
    loadedMessagesConversationId = data.currentConversationId;
    if (data.currentConversationId) {
      rememberConversationStreamCursor(data.currentConversationId, data.messages);
    }
    lastKnownConversationUpdatedAtById = indexConversationUpdatedAt(data.conversations);
    lastKnownAssistantBusyById = indexConversationAssistantBusy(data.conversations);
  });

  // Polling fallback: only active when stream is unhealthy or unavailable.
  // Decoupled from mutable state so polling callbacks do NOT retrigger this effect.
  $effect(() => {
    const conversationId = currentConversationId;
    const streamHealth = streamHealthState;

    // Stop any existing poller.
    if (activePollerStopFn) {
      activePollerStopFn();
      activePollerStopFn = null;
    }

    // Only enable polling fallback when stream is unhealthy AND there's an active conversation.
    if (!conversationId || streamHealth === 'connected') {
      return;
    }

    // Use longer intervals for degraded/disconnected state to reduce load during stream recovery.
    const intervalMs = streamHealth === 'degraded' ? 10_000 : 5_000;

    const stopPolling = startConversationStatusPolling({
      conversationId,
      intervalMs,
      onUpdate(status) {
        if (!isCurrentConversationRequest(conversationId, currentConversationId)) {
          return;
        }

        // Use untrack to prevent this state update from retriggering the polling effect.
        untrack(() => {
          applyConversationStatusSnapshot(conversationId, status);
        });
      }
    });

    activePollerStopFn = stopPolling;
    return () => {
      if (activePollerStopFn === stopPolling) {
        stopPolling();
        activePollerStopFn = null;
      }
    };
  });

  $effect(() => {
    const shouldInstallSentinel = isMobileViewport && Boolean(currentConversationId) && sidebarCollapsed;
    if (!shouldInstallSentinel) return;

    untrack(() => syncChatBackSentinel());
  });

  $effect(() => {
    if (
      typeof EventSource === 'undefined' ||
      !currentConversationId ||
      loadedMessagesConversationId !== currentConversationId
    ) {
      return;
    }

    const conversationId = currentConversationId;
    const streamSearchParams = new URLSearchParams();
    const lastAssistantMessageId = latestTerminalAssistantMessageIdByConversation[conversationId];
    if (lastAssistantMessageId) {
      streamSearchParams.set('lastAssistantMessageId', lastAssistantMessageId);
    }

    const streamPath = streamSearchParams.size > 0
      ? `/api/conversations/${conversationId}/messages/stream?${streamSearchParams.toString()}`
      : `/api/conversations/${conversationId}/messages/stream`;
    const stream = new EventSource(streamPath);

    // Track stream health to manage polling fallback lifecycle.
    streamHealthState = 'connected';

    const handleTypingEvent = (_event: Event) => {
      if (currentConversationId !== conversationId) {
        return;
      }

      showHermesTypingIndicator(conversationId);
      if (shouldFollowLatestMessages()) {
        void scrollMessagesToBottom();
      }
    };

    const handleTypingStopEvent = (_event: Event) => {
      if (currentConversationId !== conversationId) {
        return;
      }

      clearHermesTypingIndicator(conversationId);
    };

    const handleMessageEvent = (event: Event) => {
      if (currentConversationId !== conversationId) {
        return;
      }

      const payload = parseStreamPayload(event);
      const messageId = typeof payload?.messageId === 'string' ? payload.messageId : null;
      if (!messageId) {
        return;
      }

      resetComposerStatsCycle();
      void loadComposerStatsCaps();
      clearHermesTypingIndicator(conversationId, { updateBusy: false });
      ensureStreamingAssistantMessage(conversationId, messageId);
      coalescedRefreshConversations();
    };

    const handleDeltaEvent = (event: Event) => {
      if (currentConversationId !== conversationId) {
        return;
      }

      const payload = parseStreamPayload(event);
      const messageId = typeof payload?.messageId === 'string' ? payload.messageId : null;
      const seq = typeof payload?.seq === 'number' ? payload.seq : Number(payload?.seq);
      const delta = typeof payload?.delta === 'string' ? payload.delta : '';
      if (!messageId || !Number.isFinite(seq) || !delta) {
        return;
      }

      clearHermesTypingIndicator(conversationId, { updateBusy: false });
      applyStreamingAssistantDelta(conversationId, messageId, seq, delta);
      if (shouldFollowLatestMessages()) {
        void scrollMessagesToBottom();
      }
    };

    const handleDoneEvent = (event: Event) => {
      if (currentConversationId !== conversationId) {
        return;
      }

      const payload = parseStreamPayload(event);
      const messageId = typeof payload?.messageId === 'string' ? payload.messageId : null;
      const status: ChatMessage['status'] = payload?.status === 'error' ? 'error' : 'complete';

      clearHermesTypingIndicator(conversationId, { updateBusy: false });
      if (messageId) {
        messages = messages.map((message): ChatMessage =>
          message.id === messageId ? { ...message, status } : message
        );
        delete streamedAssistantSeqByMessageId[messageId];
      }

      clearPendingAssistant(conversationId);
      setConversationBusyState(conversationId, false);

      const needsComposerStats = status === 'complete' && messageId;
      if (needsComposerStats) {
        // For completion, do an immediate refresh to show final state quickly.
        void Promise.all([refreshConversations(), loadMessages(conversationId)]).then(() => {
          if (currentConversationId !== conversationId) {
            return;
          }
          revealComposerStats(messageId);
        });
      } else {
        // Coalesce interim reloads to reduce fetch spam.
        coalescedRefreshConversations();
        coalescedLoadMessages(conversationId);
      }
    };

    const handleStatusEvent = (event: Event) => {
      if (currentConversationId !== conversationId) {
        return;
      }

      const payload = parseStreamPayload(event);
      if (!payload) {
        return;
      }

      const messageId = typeof payload?.messageId === 'string' ? payload.messageId : null;
      const runStatus = normalizeHermesRunStatus(payload?.runStatus);
      if (!messageId || !runStatus) {
        return;
      }

      if (runStatus === 'queued' || runStatus === 'processing') {
        currentRunState = buildRunStateFromStatusPayload(payload, messageId, runStatus);
        setConversationBusyState(conversationId, true);
        return;
      }

      currentRunState = buildRunStateFromStatusPayload(payload, messageId, runStatus);
      clearHermesTypingIndicator(conversationId, { updateBusy: false });
      clearPendingAssistant(conversationId);
      setConversationBusyState(conversationId, false);
      coalescedRefreshConversations();
      coalescedLoadMessages(conversationId);
    };

    stream.addEventListener('typing', handleTypingEvent);
    stream.addEventListener('typing-stop', handleTypingStopEvent);
    stream.addEventListener('status', handleStatusEvent);
    stream.addEventListener('message', handleMessageEvent);
    stream.addEventListener('delta', handleDeltaEvent);
    stream.addEventListener('done', handleDoneEvent);

    return () => {
      stream.removeEventListener('typing', handleTypingEvent);
      stream.removeEventListener('typing-stop', handleTypingStopEvent);
      stream.removeEventListener('status', handleStatusEvent);
      stream.removeEventListener('message', handleMessageEvent);
      stream.removeEventListener('delta', handleDeltaEvent);
      stream.removeEventListener('done', handleDoneEvent);
      stream.close();
      // Mark stream as disconnected to activate polling fallback.
      if (streamHealthState === 'connected') {
        streamHealthState = 'disconnected';
      }
    };
  });

  const filteredConversations = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(query));
  });
  const shouldUseProgressiveSidebarLoad = $derived(searchQuery.trim().length === 0);

  const displayMessages = $derived.by(() => {
    const pendingAssistant = currentConversationId ? pendingAssistantByConversation[currentConversationId] : null;
    const typingPlaceholderId = currentConversationId
      ? hermesTypingPlaceholderByConversation[currentConversationId]
      : null;

    if (!pendingAssistant && !typingPlaceholderId) {
      return messages;
    }

    const placeholderId = pendingAssistant?.placeholderId ?? typingPlaceholderId;
    if (!placeholderId || messages.some((message) => message.id === placeholderId)) {
      return messages;
    }

    return [...messages, createPendingAssistantMessage(placeholderId)];
  });

  const isAssistantBusy = $derived(
    displayMessages.some((message) => message.role === 'assistant' && message.status === 'streaming') ||
      (currentConversationId
        ? currentRunState.active ||
          (serverAssistantBusyByConversation[currentConversationId] ??
            (currentConversationId === data.currentConversationId ? Boolean(data.assistantBusy) : false))
        : false)
  );

  const showJumpToBottom = $derived(displayMessages.length > 0 && !shouldFollowLatestMessages());

  const composerStatsMessage = $derived.by(() => {
    if (!composerStatsMessageId) {
      return null;
    }

    return (
      messages.find(
        (message) =>
          message.id === composerStatsMessageId &&
          message.role === 'assistant' &&
          message.status === 'complete' &&
          message.timings
      ) ?? null
    );
  });
  const composerStatsStrip = $derived.by((): ComposerStatsStrip | null => {
    if (composerStatsPhase === 'hidden' || !composerStatsMessage?.timings) {
      return null;
    }

    const summary = readTimingSummary(composerStatsMessage.timings);
    const contextLabel = formatContextStatsLabel(
      summary.contextUsed,
      composerStatsContextTotal ?? summary.contextTotal
    );
    const outputLabel = formatOutputStatsLabel(
      summary.generatedTokens,
      composerStatsOutputMax ?? summary.outputMax
    );
    const speedLabel = formatSpeedStatsLabel(summary.generatedTokensPerSecond);
    const ttftLabel = formatTtftStatsLabel(resolveTtftMs(summary));

    if (!contextLabel && !outputLabel && !ttftLabel && !speedLabel) {
      return null;
    }

    return {
      contextLabel,
      outputLabel,
      ttftLabel,
      speedLabel,
      isFading: composerStatsPhase === 'fading'
    };
  });
  const currentConversationSummary = $derived.by(() =>
    conversations.find((conversation) => conversation.id === currentConversationId) ?? null
  );
  const hasPendingWorkInConversation = $derived.by(() => {
    if (!currentConversationId) {
      return false;
    }

    return Boolean(
      currentConversationSummary?.assistantBusy ||
        pendingAssistantByConversation[currentConversationId] ||
        currentRunState.active ||
        currentRunState.status === 'queued' ||
        currentRunState.status === 'processing'
    );
  });
  const showStalledWarning = $derived.by(() => {
    if (!currentConversationId) {
      return false;
    }

    const dismissed = Boolean(dismissedStalledNoticeByConversation[currentConversationId]);
    const stalled = Boolean(currentConversationSummary?.assistantStalled || currentRunState.status === 'stale');
    return stalled && hasPendingWorkInConversation && !dismissed;
  });
  const isReconnectingWarning = $derived(hermesConnection?.state === 'reconnecting');
  function formatStalledAge(seconds: number | null | undefined) {
    if (seconds == null) {
      return 'recently';
    }
    if (seconds < 60) {
      return `${seconds}s ago`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainderSeconds = seconds % 60;
    if (minutes < 60) {
      return `${minutes}m ${remainderSeconds}s ago`;
    }

    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;
    return `${hours}h ${remainderMinutes}m ago`;
  }
  const stalledWarningContent = $derived.by(() => {
    const authFailure = hermesConnection?.workerHeartbeat.authFailure;
    if (authFailure?.seen && typeof authFailure.ageSeconds === 'number' && authFailure.ageSeconds <= 600) {
      return {
        title: 'Hermes cannot authenticate to WebUI.',
        body: 'The AI box is reaching WebUI, but WebUI is rejecting the connection. Check that the shared Hermes service token matches on both sides.',
        actionLabel: 'Remove stuck turn'
      };
    }

    if (hermesConnection?.state === 'reconnecting') {
      return {
        title: 'Hermes lost connection to WebUI.',
        body: `Your message is still queued, but the AI box last checked in ${formatStalledAge(hermesConnection.workerHeartbeat.ageSeconds)}. It may be offline, restarting, or unable to reach this site from its network. Hermes should resume automatically when the connection returns.`,
        actionLabel: 'Remove stuck turn'
      };
    }

    if (hermesConnection?.state === 'degraded' || hermesConnection?.state === 'offline') {
      return {
        title: 'Hermes worker is not connected.',
        body: hermesConnection.pendingEvent.exists
          ? `This turn is queued, but no active worker connection is checking WebUI right now. The queued event has been waiting ${formatStalledAge(hermesConnection.pendingEvent.ageSeconds)}.`
          : 'WebUI is waiting for the Hermes worker to reconnect before this turn can continue.',
        actionLabel: 'Remove stuck turn'
      };
    }

    return {
      title: 'This turn is stuck waiting for Hermes.',
      body: 'WebUI has not seen the Hermes worker finish this reply. You can wait a bit longer or remove the stuck turn and resend.',
      actionLabel: 'Remove stuck turn'
    };
  });
  const runStateNotice = $derived.by(() => {
    if (!currentConversationId) {
      return null;
    }

    if (currentRunState.status === 'queued') {
      return { tone: 'active', label: 'Hermes queued' };
    }

    if (currentRunState.status === 'processing') {
      return { tone: 'active', label: 'Hermes running' };
    }

    if (currentRunState.status === 'failed') {
      return { tone: 'error', label: currentRunState.errorMessage ?? 'Hermes failed' };
    }

    if (currentRunState.status === 'stale') {
      return { tone: 'warning', label: 'Hermes stopped before completing' };
    }

    if (currentRunState.status === 'cancelled') {
      return { tone: 'muted', label: 'Turn cancelled' };
    }

    return null;
  });
  const composerBusy = $derived.by(
    () => isSending || isAssistantBusy || isConversationLoading
  );
  const composerHasDraft = $derived(
    draftMessage.trim().length > 0 || pendingFiles.length > 0
  );
  const composerShowsStop = $derived(!composerHasDraft && isAssistantBusy);
  const passiveRunStateNotice = $derived.by(() => {
    if (!runStateNotice || runStateNotice.tone === 'active') {
      return null;
    }

    return runStateNotice;
  });

  const agentLensTestingEnabled = $derived(Boolean(data.agentlensTestingEnabled));

  const agentLensTestingNotice = $derived.by(() => {
    if (!agentLensTestingEnabled || !currentConversationId) {
      return null;
    }

    if (!agentLensTesting) {
      return {
        tone: 'muted' as const,
        title: 'AgentLens testing',
        body: 'No testing run is linked to this conversation yet.'
      };
    }

    const status = agentLensTesting.status;
    const passCount = Object.values(agentLensTesting.pass_criteria ?? {}).filter(Boolean).length;
    return {
      tone:
        status === 'queued' || status === 'running'
          ? ('active' as const)
          : status === 'completed'
            ? ('success' as const)
            : ('error' as const),
      title: `AgentLens testing ${status}`,
      body:
        status === 'queued'
          ? 'The validation run is waiting to start.'
          : status === 'running'
            ? 'The validation run is in progress and polling for results.'
            : status === 'completed'
              ? `Completed with ${passCount} passing checks.`
              : agentLensTesting.error ?? 'The validation run failed.'
    };
  });
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
    return slashCommands.filter((entry) => entry.command.slice(1).startsWith(query));
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

  $effect(() => {
    currentConversationId;
    resetComposerStatsCycle();
  });

  function activeConversationTitle() {
    return currentConversationSummary?.title ?? 'New chat';
  }

  function formatStatsCount(value: number) {
    return Math.max(0, Math.round(value)).toLocaleString();
  }

  function formatStatsPercent(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      return '0%';
    }

    if (value < 1) {
      return `${value.toFixed(1)}%`;
    }

    return `${Math.round(value)}%`;
  }

  function formatContextStatsLabel(contextUsed: number | null, contextTotal: number | null) {
    if (contextUsed == null || contextUsed <= 0) {
      return null;
    }

    if (contextTotal != null && contextTotal > 0) {
      return `${formatStatsCount(contextUsed)}/${formatStatsCount(contextTotal)} (${formatStatsPercent((contextUsed / contextTotal) * 100)})`;
    }

    return `${formatStatsCount(contextUsed)} tokens`;
  }

  function formatOutputStatsLabel(outputUsed: number | null, outputMax: number | null) {
    if (outputUsed == null || outputUsed <= 0) {
      return null;
    }

    if (outputMax != null) {
      const normalizedMax = outputMax < 0 ? '∞' : formatStatsCount(outputMax);
      return `${formatStatsCount(outputUsed)}/${normalizedMax}`;
    }

    return `${formatStatsCount(outputUsed)} tokens`;
  }

  function formatSpeedStatsLabel(tokensPerSecond: number | null) {
    if (tokensPerSecond == null || !Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
      return null;
    }

    return `${tokensPerSecond.toFixed(1)} decode t/s`;
  }

  function formatTtftStatsLabel(ttftMs: number | null) {
    if (ttftMs == null || !Number.isFinite(ttftMs) || ttftMs <= 0) {
      return null;
    }

    const seconds = ttftMs / 1000;
    if (seconds >= 60) {
      return `TTFT ${(seconds / 60).toFixed(1)}m`;
    }

    return `TTFT ${seconds.toFixed(1)}s`;
  }

  function clearComposerStatsTimers() {
    if (composerStatsFadeTimer) {
      clearTimeout(composerStatsFadeTimer);
      composerStatsFadeTimer = null;
    }

    if (composerStatsHideTimer) {
      clearTimeout(composerStatsHideTimer);
      composerStatsHideTimer = null;
    }
  }

  function resetComposerStatsCycle() {
    clearComposerStatsTimers();
    composerStatsPhase = 'hidden';
    composerStatsMessageId = null;
  }

  async function loadComposerStatsCaps(options: { force?: boolean } = {}) {
    if (typeof window === 'undefined') {
      return;
    }

    const force = options.force ?? false;
    const now = Date.now();
    if (
      !force &&
      now - lastComposerStatsCapsLoadAt < COMPOSER_STATS_CAPS_REFRESH_INTERVAL_MS &&
      (composerStatsContextTotal != null || composerStatsOutputMax != null)
    ) {
      return;
    }

    if (composerStatsCapsLoadInFlight) {
      return composerStatsCapsLoadInFlight;
    }

    composerStatsCapsLoadInFlight = (async () => {
      try {
        const response = await fetch('/props', {
          headers: getAuthHeaders()
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as ApiLlamaCppServerProps;
        const nextContextTotal = Number(payload?.default_generation_settings?.n_ctx ?? NaN);
        const nextOutputMax = Number(payload?.default_generation_settings?.params?.max_tokens ?? NaN);

        if (Number.isFinite(nextContextTotal) && nextContextTotal > 0) {
          composerStatsContextTotal = nextContextTotal;
        }

        if (Number.isFinite(nextOutputMax)) {
          composerStatsOutputMax = nextOutputMax;
        }

        lastComposerStatsCapsLoadAt = Date.now();
      } catch {
        // Fall back to any totals embedded in stored timings when /props is unavailable.
      } finally {
        composerStatsCapsLoadInFlight = null;
      }
    })();

    return composerStatsCapsLoadInFlight;
  }

  function revealComposerStats(messageId: string) {
    if (typeof window === 'undefined') {
      return;
    }

    clearComposerStatsTimers();
    composerStatsMessageId = messageId;
    composerStatsPhase = 'visible';

    composerStatsFadeTimer = window.setTimeout(() => {
      composerStatsPhase = 'fading';
    }, COMPOSER_STATS_VISIBLE_MS);

    composerStatsHideTimer = window.setTimeout(() => {
      composerStatsPhase = 'hidden';
      composerStatsMessageId = null;
    }, COMPOSER_STATS_VISIBLE_MS + COMPOSER_STATS_FADE_MS);
  }

  function isNearBottom() {
    if (!messageScrollElement) {
      return true;
    }

    const distanceFromBottom =
      messageScrollElement.scrollHeight - messageScrollElement.clientHeight - messageScrollElement.scrollTop;

    return distanceFromBottom < AUTO_SCROLL_AT_BOTTOM_THRESHOLD;
  }

  function syncBottomTrackingState() {
    const nextIsAtBottom = isNearBottom();
    isAtBottom = nextIsAtBottom;

    return nextIsAtBottom;
  }

  function shouldFollowLatestMessages() {
    return shouldAutoScroll || isAtBottom;
  }

  $effect(() => {
    if (
      typeof IntersectionObserver === 'undefined' ||
      !messageScrollElement ||
      !messageBottomSentinel
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }

        isAtBottom = entry.isIntersecting;
        if (entry.isIntersecting) {
          shouldAutoScroll = true;
        }
      },
      {
        root: messageScrollElement,
        threshold: 0,
        rootMargin: `0px 0px ${AUTO_SCROLL_AT_BOTTOM_THRESHOLD}px 0px`
      }
    );

    observer.observe(messageBottomSentinel);
    untrack(() => {
      syncBottomTrackingState();
    });

    return () => {
      observer.disconnect();
    };
  });

  function handleMessageScroll() {
    shouldAutoScroll = syncBottomTrackingState();
  }

  function scrollMessagesToBottomSync() {
    if (!messageScrollElement) {
      isAtBottom = true;
      return;
    }

    messageScrollElement.scrollTop = messageScrollElement.scrollHeight;
    isAtBottom = true;
  }

  async function scrollMessagesToBottom(behavior: ScrollBehavior = 'auto') {
    shouldAutoScroll = true;
    await tick();
    if (!messageScrollElement) {
      isAtBottom = true;
      return;
    }

    messageScrollElement.scrollTo({
      top: messageScrollElement.scrollHeight,
      behavior
    });
    isAtBottom = true;
  }

  function queueAutoScrollAfterLayoutChange() {
    const followLatestMessages = shouldFollowLatestMessages();
    if (!followLatestMessages || pendingLayoutAutoScroll) {
      return;
    }

    pendingLayoutAutoScroll = true;
    void tick().then(() => {
      pendingLayoutAutoScroll = false;
      if (shouldFollowLatestMessages()) {
        shouldAutoScroll = true;
        scrollMessagesToBottomSync();
      } else {
        syncBottomTrackingState();
      }
    });
  }

  function setChatUrl(conversationId: string | null) {
    const nextUrl = conversationId ? `/chat?conversation=${conversationId}` : '/chat';
    replaceChatHistoryState(conversationId, nextUrl);
  }

  function focusComposer() {
    composerElement?.focus();
  }

  function resetComposerHeight() {
    if (!composerElement) {
      return;
    }

    const shouldStickToBottom = shouldFollowLatestMessages() || isNearBottom();
    const previousHeight = composerElement.offsetHeight;
    composerElement.style.height = '0px';
    composerElement.style.height = `${Math.min(composerElement.scrollHeight, 320)}px`;

    if (shouldStickToBottom && composerElement.offsetHeight !== previousHeight) {
      shouldAutoScroll = true;
      queueAutoScrollAfterLayoutChange();
    }
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

    const nextDismissed = { ...dismissedStalledNoticeByConversation };
    delete nextDismissed[conversationId];
    dismissedStalledNoticeByConversation = nextDismissed;
  }

  function clearPendingAssistant(conversationId: string) {
    if (!pendingAssistantByConversation[conversationId]) {
      return;
    }

    const nextPending = { ...pendingAssistantByConversation };
    delete nextPending[conversationId];
    pendingAssistantByConversation = nextPending;

    const nextDismissed = { ...dismissedStalledNoticeByConversation };
    delete nextDismissed[conversationId];
    dismissedStalledNoticeByConversation = nextDismissed;
  }

  function hasStreamingAssistantMessage() {
    return messages.some((message) => message.role === 'assistant' && message.status === 'streaming');
  }

  function showHermesTypingIndicator(conversationId: string) {
    if (!hermesTypingPlaceholderByConversation[conversationId]) {
      hermesTypingPlaceholderByConversation = {
        ...hermesTypingPlaceholderByConversation,
        [conversationId]: createClientId('typing-assistant-')
      };
    }

    setConversationBusyState(conversationId, true);
  }

  function clearHermesTypingIndicator(
    conversationId: string,
    options: { updateBusy?: boolean } = {}
  ) {
    if (hermesTypingPlaceholderByConversation[conversationId]) {
      const nextTyping = { ...hermesTypingPlaceholderByConversation };
      delete nextTyping[conversationId];
      hermesTypingPlaceholderByConversation = nextTyping;
    }

    if (options.updateBusy === false) {
      return;
    }

    if (
      currentConversationId === conversationId &&
      !pendingAssistantByConversation[conversationId] &&
      !hasStreamingAssistantMessage()
    ) {
      setConversationBusyState(conversationId, false);
    }
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

  function setConversationBusyState(conversationId: string, busy: boolean) {
    serverAssistantBusyByConversation = {
      ...serverAssistantBusyByConversation,
      [conversationId]: busy
    };

    conversations = conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            assistantBusy: busy,
            assistantStalled: busy ? false : conversation.assistantStalled
          }
        : conversation
    );
  }

  function applyConversationStatusSnapshot(
    conversationId: string,
    snapshot: ConversationStatusSnapshot
  ) {
    currentRunState = normalizeConversationRunState(snapshot.runState);
    // Only update hermesConnection if it's provided (not from polling, only from page load).
    if (snapshot.hermesConnection) {
      hermesConnection = snapshot.hermesConnection;
    }
    serverAssistantBusyByConversation = {
      ...serverAssistantBusyByConversation,
      [conversationId]: snapshot.assistantBusy
    };

    conversations = conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            assistantBusy: snapshot.assistantBusy,
            assistantStalled: snapshot.assistantStalled
          }
        : conversation
    );

    if (!snapshot.assistantStalled && currentRunState.status !== 'stale') {
      const nextDismissed = { ...dismissedStalledNoticeByConversation };
      delete nextDismissed[conversationId];
      dismissedStalledNoticeByConversation = nextDismissed;
    }
  }

  function ensureStreamingAssistantMessage(conversationId: string, messageId: string) {
    const pendingAssistant = pendingAssistantByConversation[conversationId];
    const existingIndex = messages.findIndex((message) => message.id === messageId);
    const placeholderIndex = pendingAssistant
      ? messages.findIndex((message) => message.id === pendingAssistant.placeholderId)
      : -1;

    if (existingIndex !== -1) {
      messages = messages
        .map((message, index): ChatMessage =>
          index === existingIndex ? { ...message, status: 'streaming' } : message
        )
        .filter((_, index) => index !== placeholderIndex);
    } else if (placeholderIndex !== -1) {
      messages = messages.map((message, index): ChatMessage =>
        index === placeholderIndex ? { ...message, id: messageId, status: 'streaming' } : message
      );
    } else {
      messages = [...messages, createPendingAssistantMessage(messageId)];
    }

    clearPendingAssistant(conversationId);
    setConversationBusyState(conversationId, true);
  }

  function applyStreamingAssistantDelta(
    conversationId: string,
    messageId: string,
    seq: number,
    delta: string
  ) {
    const lastSeq = streamedAssistantSeqByMessageId[messageId] ?? -1;
    if (seq <= lastSeq) {
      return;
    }

    streamedAssistantSeqByMessageId[messageId] = seq;
    ensureStreamingAssistantMessage(conversationId, messageId);

    let updated = false;
    messages = messages.map((message): ChatMessage => {
      if (message.id !== messageId) {
        return message;
      }

      updated = true;
      return {
        ...message,
        status: 'streaming',
        content: `${message.content}${delta}`
      };
    });

    if (!updated) {
      messages = [
        ...messages,
        {
          ...createPendingAssistantMessage(messageId),
          content: delta
        }
      ];
    }
  }

  function parseStreamPayload(event: Event) {
    if (!(event instanceof MessageEvent) || typeof event.data !== 'string' || !event.data) {
      return null;
    }

    try {
      const payload = JSON.parse(event.data);
      return payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  function normalizeHermesRunStatus(value: unknown): HermesRunStatus | null {
    if (
      value === 'queued' ||
      value === 'processing' ||
      value === 'completed' ||
      value === 'failed' ||
      value === 'cancelled' ||
      value === 'stale'
    ) {
      return value;
    }

    return null;
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
    const headers: HeadersInit = {};
    if (conversationsEtag) {
      headers['if-none-match'] = conversationsEtag;
    }

    const response = await fetch('/api/conversations', { headers });
    if (response.status === 304) {
      return;
    }

    if (!response.ok) {
      return;
    }

    conversationsEtag = response.headers.get('etag');
    const payload = await response.json();
    await maybeNotifyOtherConversationReplies(payload.conversations);
    conversations = payload.conversations;
  }

  function resetConversationPageState(options: { clearComposer?: boolean } = {}) {
    const clearComposer = options.clearComposer ?? false;

    loadedMessagesConversationId = null;
    messages = [];
    copiedMessageId = null;
    editingMessageId = null;
    editingDraft = '';
    busyMessageIds = new Set();
    attachmentMenuOpen = false;
    errorMessage = null;
    shouldAutoScroll = true;
    isAtBottom = true;
    resetComposerStatsCycle();

    if (clearComposer) {
      draftMessage = '';
      resetComposerInputHistoryNavigation();
      clearPendingFiles();
    }
  }

  async function loadMessages(
    conversationId: string | null,
    options: { forceScroll?: boolean; showLoadingState?: boolean } = {}
  ) {
    const showLoadingState = options.showLoadingState ?? false;
    const previousScrollTop = messageScrollElement?.scrollTop ?? 0;
    const shouldStickToBottom = options.forceScroll ?? (shouldFollowLatestMessages() || isNearBottom());

    if (showLoadingState) {
      isConversationLoading = true;
    }

    try {
      if (!conversationId) {
        messages = [];
        loadedMessagesConversationId = null;
        currentRunState = createIdleRunState();
        agentLensTesting = null;
        agentLensTestingError = null;
        clearAgentLensPolling();
        isAtBottom = true;
        return;
      }

      const headers: HeadersInit = {};
      // Only send the ETag when we already have messages for this conversation displayed.
      // If loadedMessagesConversationId !== conversationId (e.g. after a conversation switch
      // cleared the message list), we must fetch a full response — a 304 would leave messages empty.
      const messagesEtag =
        loadedMessagesConversationId === conversationId
          ? messagesEtagByConversation[conversationId]
          : null;
      if (messagesEtag) {
        headers['if-none-match'] = messagesEtag;
      }

      const response = await fetch(`/api/conversations/${conversationId}/messages`, { headers });
      if (response.status === 304) {
        return;
      }

      if (!response.ok) {
        return;
      }

      const responseEtag = response.headers.get('etag');
      if (responseEtag) {
        messagesEtagByConversation = {
          ...messagesEtagByConversation,
          [conversationId]: responseEtag
        };
      }

      const payload = await response.json();
      if (!isCurrentConversationRequest(conversationId, currentConversationId)) {
        return;
      }

      syncPendingAssistant(conversationId, payload.messages);
      rememberConversationStreamCursor(conversationId, payload.messages);
      loadedMessagesConversationId = conversationId;
      messages = payload.messages;
      currentRunState = normalizeConversationRunState(payload.runState);
      void refreshAgentLensTesting();
      if (editingMessageId && !payload.messages.some((message: ChatMessage) => message.id === editingMessageId)) {
        editingMessageId = null;
        editingDraft = '';
      }
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
          shouldAutoScroll = syncBottomTrackingState();
        }
      }
    } finally {
      if (showLoadingState) {
        isConversationLoading = false;
      }
    }
  }

  function closeRenameConversationDialog() {
    if (conversationActionBusyId && conversationBeingRenamed?.id === conversationActionBusyId) {
      return;
    }

    renameConversationOpen = false;
    conversationBeingRenamed = null;
    conversationTitleDraft = '';
    conversationActionError = null;
  }

  function openRenameConversationDialog(conversation: ConversationSummary) {
    conversationBeingRenamed = conversation;
    conversationTitleDraft = conversation.title;
    renameConversationOpen = true;
    conversationActionError = null;
    errorMessage = null;

    void tick().then(() => {
      renameConversationInput?.focus();
      renameConversationInput?.select();
    });
  }

  async function saveConversationTitle() {
    if (!conversationBeingRenamed) {
      return;
    }

    const nextTitle = conversationTitleDraft.trim();
    if (!nextTitle) {
      conversationActionError = 'Conversation title is required.';
      return;
    }

    conversationActionBusyId = conversationBeingRenamed.id;
    conversationActionError = null;

    try {
      await renameConversationRequest(conversationBeingRenamed.id, nextTitle);
      await refreshConversations();
      conversationActionBusyId = null;
      closeRenameConversationDialog();
    } catch (error) {
      conversationActionError = error instanceof Error ? error.message : 'Unable to rename conversation.';
    } finally {
      conversationActionBusyId = null;
    }
  }

  function closeDeleteConversationDialog() {
    if (conversationActionBusyId && conversationBeingDeleted?.id === conversationActionBusyId) {
      return;
    }

    deleteConversationOpen = false;
    conversationBeingDeleted = null;
    conversationActionError = null;
  }

  function openDeleteConversationDialog(conversation: ConversationSummary) {
    conversationBeingDeleted = conversation;
    deleteConversationOpen = true;
    conversationActionError = null;
    errorMessage = null;
  }

  async function fadeOutDeletedConversationView() {
    isRemovingConversationView = true;
    await tick();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, CONVERSATION_DELETE_EXIT_MS);
    });
  }

  async function confirmConversationDelete() {
    if (!conversationBeingDeleted) {
      return;
    }

    conversationActionBusyId = conversationBeingDeleted.id;
    conversationActionError = null;

    try {
      await deleteConversationRequest(conversationBeingDeleted.id);
      const deletedCurrentConversation = currentConversationId === conversationBeingDeleted.id;
      conversationActionBusyId = null;
      closeDeleteConversationDialog();
      if (deletedCurrentConversation) {
        await fadeOutDeletedConversationView();
        startNewChat();
      }
      await refreshConversations();
    } catch (error) {
      conversationActionError = error instanceof Error ? error.message : 'Unable to delete conversation.';
    } finally {
      conversationActionBusyId = null;
    }
  }

  async function exportConversation(conversation: ConversationSummary) {
    conversationActionBusyId = conversation.id;
    errorMessage = null;

    try {
      await exportConversationRequest(conversation);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to export conversation.';
    } finally {
      conversationActionBusyId = null;
    }
  }

  async function selectConversation(conversationId: string) {
    isRemovingConversationView = false;

    if (conversationId === currentConversationId) {
      if (isMobileViewport) setSidebarCollapsed(true);
      return;
    }

    currentConversationId = conversationId;
    resetConversationPageState({ clearComposer: true });
    closeRenameConversationDialog();
    closeDeleteConversationDialog();
    setChatUrl(conversationId);
    if (isMobileViewport) setSidebarCollapsed(true);
    await loadMessages(conversationId, { forceScroll: true, showLoadingState: true });
    focusComposer();
  }

  function startNewChat() {
    isRemovingConversationView = false;
    currentConversationId = null;
    resetConversationPageState({ clearComposer: true });
    closeRenameConversationDialog();
    closeDeleteConversationDialog();
    setChatUrl(null);
    if (isMobileViewport) setSidebarCollapsed(true);
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

  function startEditingMessage(message: ChatMessage) {
    if (message.role !== 'user' || message.id.startsWith('pending-')) {
      return;
    }

    editingMessageId = message.id;
    editingDraft = message.content;
    errorMessage = null;
  }

  function cancelEditingMessage() {
    editingMessageId = null;
    editingDraft = '';
  }

  async function saveEditedMessage(message: ChatMessage) {
    if (!currentConversationId || editingMessageId !== message.id) {
      return;
    }

    const nextContent = editingDraft.trim();
    if (!nextContent) {
      errorMessage = 'Message content is required.';
      return;
    }

    markBusy(message.id, true);
    try {
      const response = await fetch(
        `/api/conversations/${currentConversationId}/messages/${message.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ content: nextContent })
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to update message.');
      }

      const payload = await response.json();
      const placeholderId = createClientId('pending-assistant-');
      cancelEditingMessage();
      clearPendingAssistant(currentConversationId);
      setPendingAssistant(currentConversationId, payload.messageId, placeholderId);
      await refreshConversations();
      await loadMessages(currentConversationId, { forceScroll: true, showLoadingState: true });
      focusComposer();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to update message.';
    } finally {
      markBusy(message.id, false);
    }
  }

  async function selectMessageRevision(message: ChatMessage, targetMessageId: string) {
    if (!currentConversationId || message.id.startsWith('pending-') || !targetMessageId) {
      return;
    }

    markBusy(message.id, true);
    try {
      const response = await fetch(
        `/api/conversations/${currentConversationId}/messages/${targetMessageId}/select`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to switch revisions.');
      }

      cancelEditingMessage();
      clearPendingAssistant(currentConversationId);
      await refreshConversations();
      await loadMessages(currentConversationId);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to switch revisions.';
    } finally {
      markBusy(message.id, false);
    }
  }

  async function deleteMessage(message: ChatMessage) {
    if (
      !currentConversationId ||
      message.id.startsWith('pending-') ||
      message.role !== 'user'
    ) {
      return;
    }
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Delete your latest prompt and its response?')
    ) {
      return;
    }
    markBusy(message.id, true);
    try {
      const response = await fetch(
        `/api/conversations/${currentConversationId}/messages/${message.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to delete latest prompt.');
      }
      if (editingMessageId === message.id) {
        cancelEditingMessage();
      }
      await loadMessages(currentConversationId);
      await refreshConversations();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to delete latest prompt.';
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
      // typing indicator until the assistant stream starts sending deltas.
      const placeholderId = createClientId('pending-assistant-');
      cancelEditingMessage();
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

    const optimisticAttachments = pendingFiles.map((pendingFile) => {
      const contentType = resolveAttachmentContentType(
        pendingFile.file.name,
        pendingFile.file.type || 'application/octet-stream'
      );
      const { isAudio, isHtml, isImage, isMarkdown, isPreviewable } =
        getAttachmentContentFlags(contentType);

      return {
        id: pendingFile.id,
        fileName: pendingFile.file.name,
        contentType,
        sizeBytes: pendingFile.file.size,
        downloadUrl: pendingFile.previewUrl,
        previewUrl: isPreviewable ? pendingFile.previewUrl : undefined,
        isImage,
        isHtml,
        isMarkdown,
        isAudio
      };
    });

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
      if (text) {
        saveComposerInputHistory(appendInputHistory(composerInputHistory, originalDraft));
      }
      resetComposerInputHistoryNavigation();

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

  async function stopActiveAssistantTurn() {
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
        throw new Error(payload.error || 'Unable to stop the active assistant turn.');
      }

      clearPendingAssistant(currentConversationId);
      await refreshConversations();
      await loadMessages(currentConversationId);
      focusComposer();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to stop the active assistant turn.';
    } finally {
      isClearingStalled = false;
    }
  }

  async function clearStalledAssistantTurn() {
    await stopActiveAssistantTurn();
  }

  function dismissStalledWarning() {
    if (!currentConversationId) {
      return;
    }

    dismissedStalledNoticeByConversation = {
      ...dismissedStalledNoticeByConversation,
      [currentConversationId]: true
    };
  }

  async function submitComposer() {
    if (isSending || isClearingStalled) {
      return;
    }

    if (composerShowsStop) {
      await stopActiveAssistantTurn();
      return;
    }

    if (!composerHasDraft) {
      return;
    }

    await sendMessage();
  }

  function getSlashCommandConfirmationMessage(slashCommand: SlashCommand) {
    return `${slashCommand.command} will start a fresh Hermes session for this conversation. Continue?`;
  }

  async function applySlashCommandSelection(slashCommand: SlashCommand) {
    const needsArgs = Boolean(slashCommand.argsHint?.trim());
    draftMessage = needsArgs ? `${slashCommand.command} ` : slashCommand.command;
    await tick();
    focusComposer();
    if (!needsArgs) {
      if (
        slashCommand.requiresConfirmation &&
        typeof window !== 'undefined' &&
        !window.confirm(getSlashCommandConfirmationMessage(slashCommand))
      ) {
        return;
      }
      void submitComposer();
    }
  }

  async function loadSlashCommands(options: { force?: boolean } = {}) {
    const force = options.force ?? false;
    const now = Date.now();
    if (!force && now - lastSlashCommandsLoadAt < SLASH_COMMANDS_REFRESH_INTERVAL_MS) {
      return;
    }

    if (slashCommandsLoadInFlight) {
      return slashCommandsLoadInFlight;
    }

    slashCommandsLoadInFlight = (async () => {
      try {
        const response = await fetch('/api/slash-commands');
        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        const commands: Array<{
          command: string;
          description?: string;
          argsHint?: string;
          aliases?: string[];
          requiresConfirmation?: boolean;
        }> = Array.isArray(payload?.commands) ? payload.commands : [];

        const normalized = commands
          .filter(
            (entry): entry is {
              command: string;
              description?: string;
              argsHint?: string;
              aliases?: string[];
              requiresConfirmation?: boolean;
            } => Boolean(entry) && typeof entry.command === 'string' && entry.command.startsWith('/')
          )
          .map((entry) => ({
            command: entry.command,
            description:
              typeof entry.description === 'string' && entry.description.trim()
                ? entry.description.trim()
                : 'Hermes command',
            argsHint:
              typeof entry.argsHint === 'string' && entry.argsHint.trim()
                ? entry.argsHint.trim()
                : undefined,
            aliases: Array.isArray(entry.aliases)
              ? entry.aliases.filter(
                  (alias): alias is string => typeof alias === 'string' && alias.startsWith('/')
                )
              : undefined,
            requiresConfirmation: entry.requiresConfirmation === true
          }));

        const expanded: SlashCommand[] = [];
        for (const command of normalized) {
          expanded.push(command);
          for (const alias of command.aliases ?? []) {
            expanded.push({
              command: alias,
              description: `${command.description} (alias for ${command.command})`,
              argsHint: command.argsHint,
              requiresConfirmation: command.requiresConfirmation
            });
          }
        }

        const deduped: SlashCommand[] = [];
        const seen = new Set<string>();
        for (const command of expanded) {
          if (seen.has(command.command)) {
            continue;
          }
          seen.add(command.command);
          deduped.push(command);
        }

        if (deduped.length > 0) {
          slashCommands = deduped;
        }
        lastSlashCommandsLoadAt = Date.now();
      } catch {
        // Keep the last known shared command cache when metadata refresh fails.
      } finally {
        slashCommandsLoadInFlight = null;
      }
    })();

    return slashCommandsLoadInFlight;
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    void submitComposer();
  }

  function handleComposerPrimaryAction() {
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
          void applySlashCommandSelection(selected);
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        draftMessage = '';
        resetComposerInputHistoryNavigation();
        return;
      }
    }

    if (shouldNavigateComposerHistory(event)) {
      event.preventDefault();
      void applyComposerHistoryNavigation(event.key === 'ArrowUp' ? 'backward' : 'forward');
      return;
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

  function clearAgentLensPolling() {
    if (agentLensTestingPollTimer !== null) {
      window.clearInterval(agentLensTestingPollTimer);
      agentLensTestingPollTimer = null;
    }
  }

  function scheduleAgentLensPolling() {
    clearAgentLensPolling();
    if (!agentLensTestingEnabled || !currentConversationId) {
      return;
    }

    const status = agentLensTesting?.status;
    if (status !== 'queued' && status !== 'running') {
      return;
    }

    agentLensTestingPollTimer = window.setInterval(() => {
      void refreshAgentLensTesting();
    }, 5000);
  }

  async function refreshAgentLensTesting() {
    if (!agentLensTestingEnabled || !currentConversationId) {
      agentLensTesting = null;
      agentLensTestingError = null;
      clearAgentLensPolling();
      return;
    }

    try {
      const response = await fetch(
        `/api/internal/agentlens/testing?conversation_id=${encodeURIComponent(currentConversationId)}`,
        { credentials: 'same-origin' }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object') {
        throw new Error(
          payload && typeof payload === 'object' && 'error_message' in payload && typeof payload.error_message === 'string'
            ? payload.error_message
            : `AgentLens progress request failed (${response.status}).`
        );
      }
      agentLensTesting = (payload as { run: AgentLensTestingRun | null }).run ?? null;
      agentLensTestingError = null;
    } catch (error) {
      agentLensTestingError = error instanceof Error ? error.message : 'Unable to load AgentLens testing progress.';
    } finally {
      scheduleAgentLensPolling();
    }
  }

  onMount(() => {
    // Handle share target: pre-fill composer with content shared from another app.
    const shareParam = typeof window !== 'undefined'
      ? new URL(window.location.href).searchParams.get('share')
      : null;
    if (shareParam) {
      try {
        // searchParams.get() already URL-decodes the value; no further
        // decoding is needed (double-decoding corrupts URLs with %XX in them).
        if (shareParam.trim()) {
          draftMessage = shareParam.trim();
        }
        // Clean the URL so the pre-filled text doesn't re-appear on reload.
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('share');
        window.history.replaceState({}, '', cleanUrl.toString());
      } catch {
        // Ignore decode failures from malformed share data.
      }
    }

    const rootElement = document.documentElement;
    const bodyElement = document.body;
    const syncChatViewport = () => {
      const shouldStickToBottom = shouldFollowLatestMessages();
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportOffsetTop = viewport?.offsetTop ?? 0;

      rootElement.style.setProperty('--chat-viewport-height', `${Math.round(viewportHeight)}px`);
      rootElement.style.setProperty('--chat-viewport-offset-top', `${Math.round(viewportOffsetTop)}px`);

      if (shouldStickToBottom) {
        shouldAutoScroll = true;
        queueAutoScrollAfterLayoutChange();
      } else {
        syncBottomTrackingState();
      }
    };

    rootElement.classList.add('chat-route');
    bodyElement.classList.add('chat-route');
    syncChatViewport();

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener('resize', syncChatViewport);
      visualViewport.addEventListener('scroll', syncChatViewport);
    }
    window.addEventListener('resize', syncChatViewport);

    let resizeObserver: ResizeObserver | null = null;

    const consumeAppBackNavigation = () => {
      if (settingsOpen) {
        settingsOpen = false;
        return true;
      }

      if (attachmentMenuOpen) {
        attachmentMenuOpen = false;
        return true;
      }

      if (renameConversationOpen) {
        closeRenameConversationDialog();
        return true;
      }

      if (deleteConversationOpen) {
        closeDeleteConversationDialog();
        return true;
      }

      if (isMobileViewport && currentConversationId && sidebarCollapsed) {
        setSidebarCollapsed(false);
        return true;
      }

      return false;
    };

    const handlePopState = async () => {
      if (ignoreNextChatBackPopstate) {
        ignoreNextChatBackPopstate = false;
        return;
      }

      if (consumeAppBackNavigation()) {
        syncChatBackSentinel();
        return;
      }

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
        isAtBottom = true;

        const scrollContentElement = messageScrollElement.firstElementChild;
        if (scrollContentElement instanceof HTMLElement && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (shouldFollowLatestMessages()) {
              shouldAutoScroll = true;
              scrollMessagesToBottomSync();
            } else {
              syncBottomTrackingState();
            }
          });
          resizeObserver.observe(scrollContentElement);
        }
      }
    });
    loadTimeFormatPreference();
    loadComposerInputHistory();
    loadNotificationsPreference();
    rememberAssistantMessages(messages);
    if (notificationsEnabled) {
      void syncPushSubscription({ subscribe: true, silenceErrors: true });
    } else {
      void disablePushSubscription({ silenceErrors: true });
    }
    runWhenBrowserIdle(() => {
      void loadComposerStatsCaps({ force: true });
    });
    runWhenBrowserIdle(() => {
      void loadSlashCommands({ force: true });
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
      if (event.key === 'Escape') {
        if (settingsOpen) {
          settingsOpen = false;
          return;
        }

        if (isMobileViewport && !sidebarCollapsed) {
          setSidebarCollapsed(true);
        }
      }
    };
    window.addEventListener('keydown', onKeydown);

    const onVisibilityChange = () => {
      const permission = getNotificationPermission();
      if (permission == null) {
        notificationPermission = 'denied';
        if (notificationsEnabled) {
          setNotificationsPreference(false);
          void disablePushSubscription({ silenceErrors: true });
        }
        if (document.visibilityState === 'visible') {
          void loadSlashCommands();
        }
        return;
      }

      notificationPermission = permission;
      if (notificationPermission !== 'granted' && notificationsEnabled) {
        setNotificationsPreference(false);
        void disablePushSubscription({ silenceErrors: true });
      } else if (notificationPermission === 'granted' && notificationsEnabled) {
        void syncPushSubscription({ subscribe: true, silenceErrors: true });
      }

      if (document.visibilityState === 'visible') {
        void loadSlashCommands();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    window.addEventListener('popstate', handlePopState);
    if (agentLensTestingEnabled) {
      void refreshAgentLensTesting();
    }

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncChatViewport);
      if (visualViewport) {
        visualViewport.removeEventListener('resize', syncChatViewport);
        visualViewport.removeEventListener('scroll', syncChatViewport);
      }
      rootElement.classList.remove('chat-route');
      bodyElement.classList.remove('chat-route');
      rootElement.style.removeProperty('--chat-viewport-height');
      rootElement.style.removeProperty('--chat-viewport-offset-top');
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', onMediaChange);
      } else {
        mediaQuery.removeListener(onMediaChange);
      }
      clearAgentLensPolling();
      clearComposerStatsTimers();
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
        onclick={() => setSidebarCollapsed(true)}
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
          onclick={() => setSidebarCollapsed(true)}
        >
          <ChevronsLeft class="h-4 w-4" />
        </button>
      </div>

      <div class="llama-nav">
        <button class="llama-nav-item" type="button" onclick={startNewChat}>
          <span class="llama-nav-icon"><SquarePen class="h-4 w-4" /></span>
          <span>New chat</span>
        </button>

        <a
          class="llama-nav-item"
          href="/briefings"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="llama-nav-icon"><FileText class="h-4 w-4" /></span>
          <span>Briefings</span>
          <ExternalLink class="ml-auto h-3 w-3 shrink-0 opacity-50" />
        </a>

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
        progressiveLoad={shouldUseProgressiveSidebarLoad}
        onSelect={selectConversation}
        onEdit={openRenameConversationDialog}
        onExport={exportConversation}
        onDelete={openDeleteConversationDialog}
        busyConversationId={conversationActionBusyId}
      />

      {#if currentConversationId && agentLensTestingEnabled}
        <div class="llama-sidebar-section-title">Testing progress</div>
        <div class={`mx-3 rounded-lg border p-3 text-sm ${agentLensTestingNotice?.tone === 'active' ? 'border-amber-500/30 bg-amber-500/10' : agentLensTestingNotice?.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10' : agentLensTestingNotice?.tone === 'error' ? 'border-destructive/30 bg-destructive/10' : 'border-border bg-muted/30'}`}>
          <div class="font-medium">{agentLensTestingNotice?.title ?? 'AgentLens testing'}</div>
          <p class="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {agentLensTestingNotice?.body ?? 'No testing run available.'}
          </p>

          {#if agentLensTesting}
            <div class="mt-3 space-y-1 text-xs [overflow-wrap:anywhere]">
              <div>Run: {agentLensTesting.run_id.slice(0, 8)}</div>
              <div>Status: {agentLensTesting.status}</div>
              <div>Conversation: {agentLensTesting.conversation_id}</div>
              <div>Created: {agentLensTesting.created_at}</div>
              {#if agentLensTesting.started_at}
                <div>Started: {agentLensTesting.started_at}</div>
              {/if}
              {#if agentLensTesting.completed_at}
                <div>Completed: {agentLensTesting.completed_at}</div>
              {/if}
              <div>Turns: {(agentLensTesting.turns ?? []).length}</div>
            </div>
          {/if}

          {#if agentLensTestingError}
            <div class="mt-2 text-xs text-destructive">{agentLensTestingError}</div>
          {/if}
        </div>
      {/if}

      <div class="llama-sidebar-footer">
        <div class="llama-user-card">
          <div style="font-size: 0.86rem; color: var(--text-muted);">Signed in as</div>
          <div style="font-weight: 600; margin-top: 0.2rem;">{data.session.displayName}</div>
        </div>

        <div class="llama-footer-actions">
          <ThemeModeToggle compact={true} label="Chat color theme" />

          <form method="POST" action="/logout" style="flex: 1;">
            <button class="secondary-button" type="submit" style="width: 100%;">Sign out</button>
          </form>
        </div>

        <div class="llama-build-meta" title="Frontend version, branch, and commit">{sidebarBuildLabel}</div>
      </div>
    </aside>

    <section class:is-removing-conversation={isRemovingConversationView} class="llama-main">
      <div class="llama-topbar">
        <button
          class="llama-toolbar-button"
          type="button"
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          onclick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <PanelLeft class="h-4 w-4" />
        </button>

        <div class="llama-header-copy">
          <div class="llama-header-title-row">
            <div class="llama-header-title">{activeConversationTitle()}</div>
            {#if currentConversationSummary}
              <button
                class="llama-header-edit-button"
                type="button"
                aria-label="Edit conversation title"
                title="Edit title"
                onclick={() => openRenameConversationDialog(currentConversationSummary)}
                disabled={conversationActionBusyId === currentConversationSummary.id}
              >
                <Pen class="h-4 w-4" />
              </button>
            {/if}
          </div>
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
            <strong class="llama-stalled-banner-title">
              {stalledWarningContent.title}
            </strong>
            <p class="llama-stalled-banner-body">
              {stalledWarningContent.body}
            </p>
            <div class="llama-stalled-banner-actions">
              <button
                class="llama-stalled-banner-action"
                type="button"
                onclick={clearStalledAssistantTurn}
                disabled={isClearingStalled}
              >
                {isClearingStalled ? 'Removing stuck turn...' : stalledWarningContent.actionLabel}
              </button>
              <button
                class="llama-stalled-banner-dismiss"
                type="button"
                onclick={dismissStalledWarning}
                disabled={isClearingStalled}
              >
                Dismiss
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
          {#if isConversationLoading}
            <div class="llama-chat-loading-overlay" role="status" aria-live="polite">
              <div class="llama-chat-loading-indicator">
                <div class="app-loading-spinner" aria-hidden="true"></div>
                <div class="llama-chat-loading-label">Loading conversation...</div>
              </div>
            </div>
          {/if}

          {#if displayMessages.length === 0}
            <div class="llama-empty-state">
              <h1>{appName}</h1>
              <p>Type a message or upload files to get started.</p>
            </div>
          {:else}
            <MessagePane
              bind:scrollContainer={messageScrollElement}
              bind:bottomSentinel={messageBottomSentinel}
              messages={displayMessages}
              conversationId={currentConversationId}
              userDisplayName={userDisplayName}
              use24HourTime={use24HourTime}
              copiedMessageId={copiedMessageId}
              editingMessageId={editingMessageId}
              editingDraft={editingDraft}
              busyMessageIds={busyMessageIds}
              onCopy={copyMessage}
              onEdit={startEditingMessage}
              onEditDraftChange={(value) => {
                editingDraft = value;
              }}
              onCancelEdit={cancelEditingMessage}
              onSaveEdit={saveEditedMessage}
              onRegenerate={regenerateMessage}
              onSelectRevision={selectMessageRevision}
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
              <div class="llama-jump-to-bottom-slot">
                <button
                  class="llama-jump-to-bottom"
                  type="button"
                  aria-label="Jump to latest message"
                  title="Jump to latest message"
                  onclick={() => scrollMessagesToBottom('smooth')}
                >
                  <ArrowDown class="h-4 w-4" />
                </button>
              </div>
            {/if}

            <form class="llama-composer-form" onsubmit={handleSubmit}>
              <input type="hidden" name="conversationId" value={currentConversationId ?? ''} />

              {#if composerStatsStrip}
                <div
                  class="llama-composer-stats"
                  class:is-fading={composerStatsStrip.isFading}
                  aria-label="Latest assistant generation stats"
                >
                  {#if composerStatsStrip.contextLabel}
                    <div class="llama-composer-stat">
                      <span class="llama-composer-stat-label">Context:</span>
                      <span class="llama-composer-stat-value">{composerStatsStrip.contextLabel}</span>
                    </div>
                  {/if}

                  {#if composerStatsStrip.outputLabel}
                    <div class="llama-composer-stat">
                      <span class="llama-composer-stat-label">Output:</span>
                      <span class="llama-composer-stat-value">{composerStatsStrip.outputLabel}</span>
                    </div>
                  {/if}

                  {#if composerStatsStrip.ttftLabel}
                    <div class="llama-composer-stat">
                      <span class="llama-composer-stat-value">{composerStatsStrip.ttftLabel}</span>
                    </div>
                  {/if}

                  {#if composerStatsStrip.speedLabel}
                    <div class="llama-composer-stat">
                      <span class="llama-composer-stat-value">{composerStatsStrip.speedLabel}</span>
                    </div>
                  {/if}
                </div>
              {/if}

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
                            onclick={() => void applySlashCommandSelection(slashCommand)}
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
                      class:send-button--working={composerBusy && !composerShowsStop}
                      class:send-button--stop={composerShowsStop}
                      type={composerShowsStop ? 'button' : 'submit'}
                      aria-label={composerShowsStop ? 'Stop Hermes' : 'Send message'}
                      aria-busy={isSending || isClearingStalled}
                      disabled={isSending || isClearingStalled || (!composerHasDraft && !composerShowsStop)}
                      onclick={composerShowsStop ? handleComposerPrimaryAction : undefined}
                    >
                      {#if isSending || isClearingStalled}
                        <span class="assistant-typing-loader assistant-typing-loader--compact send-button-loader" aria-hidden="true">
                          {#each [0, 1, 2, 3, 4, 5, 6, 7, 8] as delayStep}
                            <span class="assistant-typing-square" style={`--assistant-loader-delay: ${delayStep * 0.07}s`}></span>
                          {/each}
                        </span>
                      {:else if composerShowsStop}
                        <span class="send-button-stop-icon" aria-hidden="true"></span>
                      {:else}
                        <ArrowUp class="h-3.5 w-3.5" />
                      {/if}
                    </button>
                  </div>
                </div>
              </div>

              {#if !isMobileViewport}
                <div class="llama-footnote">
                  {composerHasDraft
                    ? 'Press Enter to send, Shift + Enter for new line.'
                    : isAssistantBusy
                      ? 'Type to steer Hermes, or use the stop button to cancel the current turn.'
                      : 'Press Enter to send, Shift + Enter for new line.'}
                </div>
              {/if}

              {#if passiveRunStateNotice}
                <div class={`run-state-strip run-state-strip--${passiveRunStateNotice.tone}`}>
                  {passiveRunStateNotice.label}
                </div>
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
                {:else if notificationsEnabled && usesServerPushNotifications}
                  Background Web Push is active on this device.
                {:else if notificationsEnabled && pushRegistrationState === 'error'}
                  Background Web Push could not be enabled, so notifications depend on this tab staying alive.
                {:else if notificationsEnabled && pushNotificationsSupported}
                  Background Web Push is still registering on this device.
                {:else if notificationsEnabled}
                  Background Web Push is unavailable here; notifications depend on this tab staying alive.
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

  {#if renameConversationOpen}
    <div
      class="llama-settings-modal-layer"
      role="presentation"
      onclick={(event: MouseEvent) => {
        if (event.currentTarget === event.target) {
          closeRenameConversationDialog();
        }
      }}
    >
      <div
        class="llama-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Rename conversation"
      >
        <header class="llama-settings-modal-header">
          <h2>Rename conversation</h2>
        </header>

        <div class="llama-settings-modal-body">
          <div class="llama-conversation-dialog-copy">
            Update the label shown in the sidebar for this conversation.
          </div>

          <input
            bind:this={renameConversationInput}
            class="llama-conversation-dialog-input"
            bind:value={conversationTitleDraft}
            maxlength="200"
            placeholder="Conversation title"
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveConversationTitle();
              }
            }}
          />

          {#if conversationActionError}
            <div class="error-banner">{conversationActionError}</div>
          {/if}
        </div>

        <footer class="llama-settings-modal-footer llama-conversation-dialog-footer">
          <button class="secondary-button" type="button" onclick={closeRenameConversationDialog}>
            Cancel
          </button>
          <button
            class="primary-button"
            type="button"
            disabled={conversationActionBusyId === conversationBeingRenamed?.id || !conversationTitleDraft.trim()}
            onclick={() => void saveConversationTitle()}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  {/if}

  {#if deleteConversationOpen}
    <div
      class="llama-settings-modal-layer"
      role="presentation"
      onclick={(event: MouseEvent) => {
        if (event.currentTarget === event.target) {
          closeDeleteConversationDialog();
        }
      }}
    >
      <div
        class="llama-settings-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="Delete conversation"
      >
        <header class="llama-settings-modal-header">
          <h2>Delete conversation?</h2>
        </header>

        <div class="llama-settings-modal-body">
          <div class="llama-conversation-dialog-copy">
            “{conversationBeingDeleted?.title ?? 'This conversation'}” and its messages will be removed from this workspace.
          </div>

          {#if conversationActionError}
            <div class="error-banner">{conversationActionError}</div>
          {/if}
        </div>

        <footer class="llama-settings-modal-footer llama-conversation-dialog-footer">
          <button class="secondary-button" type="button" onclick={closeDeleteConversationDialog}>
            Cancel
          </button>
          <button
            class="primary-button llama-danger-button"
            type="button"
            disabled={conversationActionBusyId === conversationBeingDeleted?.id}
            onclick={() => void confirmConversationDelete()}
          >
            Delete
          </button>
        </footer>
      </div>
    </div>
  {/if}
</div>
