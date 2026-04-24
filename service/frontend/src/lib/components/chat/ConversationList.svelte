<script lang="ts">
  import { Download, MoreHorizontal, SquarePen, Trash2 } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import type { ConversationSummary } from '$lib/types-legacy';

  interface Props {
    conversations: ConversationSummary[];
    currentConversationId: string | null;
    use24HourTime?: boolean;
    onSelect?: (conversationId: string) => void;
    onEdit?: (conversation: ConversationSummary) => void;
    onExport?: (conversation: ConversationSummary) => void;
    onDelete?: (conversation: ConversationSummary) => void;
    busyConversationId?: string | null;
  }

  let {
    conversations,
    currentConversationId,
    use24HourTime = false,
    onSelect,
    onEdit,
    onExport,
    onDelete,
    busyConversationId = null
  }: Props = $props();

  const hasRowActions = $derived(Boolean(onEdit || onExport || onDelete));

  function formatConversationTime(value: string) {
    return new Date(value).toLocaleTimeString([], {
      hour: use24HourTime ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !use24HourTime
    });
  }
</script>

<div class="llama-conversation-list">
  {#if conversations.length === 0}
    <div class="card" style="padding: 0.95rem; color: var(--text-muted);">
      No conversations yet. Start one from the composer.
    </div>
  {:else}
    {#each conversations as conversation}
      <div class:active={conversation.id === currentConversationId} class="llama-conversation-row">
        <button
          type="button"
          class:active={conversation.id === currentConversationId}
          class:llama-conversation-link--with-actions={hasRowActions}
          class="llama-conversation-link"
          onclick={() => onSelect?.(conversation.id)}
        >
          <div class="llama-conversation-title">
            {#if conversation.assistantBusy && !conversation.assistantStalled}
              <span class="llama-conversation-busy" aria-label="Agent working" title="Agent working"></span>
            {:else if conversation.assistantStalled}
              <span
                class="llama-conversation-stalled"
                aria-label="Agent stalled"
                title="Queued message is waiting for Hermes worker heartbeat"
              ></span>
            {/if}
            <span class="llama-conversation-title-text">{conversation.title}</span>
          </div>
          <div class="llama-conversation-meta">
            {new Date(conversation.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            ·
            {formatConversationTime(conversation.updatedAt)}
            {#if conversation.assistantStalled}
              · <span class="llama-conversation-stalled-label">stalled</span>
            {/if}
          </div>
        </button>

        {#if hasRowActions}
          <div class="llama-conversation-actions">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class="llama-conversation-menu-trigger"
                aria-label={`Open actions for ${conversation.title}`}
                title="Conversation actions"
                disabled={busyConversationId === conversation.id}
              >
                <MoreHorizontal class="h-4 w-4" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="llama-conversation-menu">
                {#if onEdit}
                  <DropdownMenu.Item
                    class="llama-conversation-menu-item"
                    disabled={busyConversationId === conversation.id}
                    onclick={() => onEdit?.(conversation)}
                  >
                    <SquarePen class="h-4 w-4" />
                    <span>Edit</span>
                  </DropdownMenu.Item>
                {/if}

                {#if onExport}
                  <DropdownMenu.Item
                    class="llama-conversation-menu-item"
                    disabled={busyConversationId === conversation.id}
                    onclick={() => onExport?.(conversation)}
                  >
                    <Download class="h-4 w-4" />
                    <span>Export</span>
                  </DropdownMenu.Item>
                {/if}

                {#if onDelete}
                  {#if onEdit || onExport}
                    <DropdownMenu.Separator />
                  {/if}
                  <DropdownMenu.Item
                    class="llama-conversation-menu-item llama-conversation-menu-item--danger"
                    disabled={busyConversationId === conversation.id}
                    onclick={() => onDelete?.(conversation)}
                  >
                    <Trash2 class="h-4 w-4" />
                    <span>Delete</span>
                  </DropdownMenu.Item>
                {/if}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
