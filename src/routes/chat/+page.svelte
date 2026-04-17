<script lang="ts">
  import ConversationList from '$components/chat/ConversationList.svelte';
  import MessagePane from '$components/chat/MessagePane.svelte';

  let { data, form } = $props();
</script>

<div class="shell">
  <div class="app-frame">
    <aside class="sidebar">
      <div>
        <div class="pill">Webchat</div>
        <h1 style="margin: 0.8rem 0 0.35rem;">Hermes Browser Channel</h1>
        <div class="muted">Signed in as {data.session.displayName}</div>
      </div>

      <form method="POST" action="?/createConversation" style="display: grid; gap: 0.65rem;">
        <input class="field" name="title" placeholder="Conversation title" />
        <button class="primary-button" type="submit">New conversation</button>
      </form>

      <ConversationList conversations={data.conversations} currentConversationId={data.currentConversationId} />

      <form method="POST" action="/logout">
        <button class="secondary-button" type="submit">Sign out</button>
      </form>
    </aside>

    <section class="chat-area">
      <div class="card" style="margin: 1rem 1.25rem 0; border-radius: 1.2rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
        <div>
          <div style="font-size: 1.1rem; font-weight: 700;">{data.currentConversationId ? 'Conversation active' : 'No conversation selected'}</div>
          <div class="muted">
            The browser stores durable state in MySQL and Hermes receives turns through the trusted webchat adapter.
          </div>
        </div>
        <div class="pill">Initial vertical slice</div>
      </div>

      <MessagePane messages={data.messages} />

      <div class="composer">
        <form method="POST" action="?/sendMessage">
          <input type="hidden" name="conversationId" value={data.currentConversationId ?? ''} />
          <textarea class="textarea" name="content" placeholder="Write a message to Hermes"></textarea>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
            <div class="muted">Messages are queued in MySQL, then delivered to Hermes through the internal inbox API.</div>
            <button class="primary-button" type="submit">Send</button>
          </div>
          {#if form?.error}
            <div class="card" style="border-color: rgba(173, 60, 50, 0.28); color: #8a3027;">{form.error}</div>
          {/if}
        </form>
      </div>
    </section>
  </div>
</div>
