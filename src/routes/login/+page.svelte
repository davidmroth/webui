<script lang="ts">
  let { form } = $props();
</script>

<div class="login-shell">
  <div class="login-card">
    <div class="pill">Hermes WebUI</div>
    <h1>Enter your access key</h1>
    <p class="muted">
      This UI is key-gated. Your key is checked server-side against the MySQL user store,
      then exchanged for a secure session cookie.
    </p>

    <form method="POST" style="display: grid; gap: 0.85rem; margin-top: 1rem;">
      <label>
        <div style="margin-bottom: 0.45rem; font-weight: 700;">Access key</div>
        <input class="field" name="apiKey" type="password" autocomplete="current-password" />
      </label>
      {#if form?.error}
        <div class="card" style="border-color: rgba(173, 60, 50, 0.28); color: #8a3027;">{form.error}</div>
      {/if}
      <button class="primary-button" type="submit">Open chat</button>
    </form>
  </div>
</div>
