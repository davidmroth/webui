<script lang="ts">
  let { form } = $props();
</script>

<div class="login-shell">
  <div class="login-card">
    <div class="pill">llama.cpp style shell</div>
    <h1 class="login-title">Sign in</h1>
    <p class="login-copy">
      This frontend now follows the llama.cpp web UI shape, but authentication still runs through the
      existing Hermes key and session flow.
    </p>

    <form method="POST" class="login-form">
      <label>
        <div style="margin-bottom: 0.45rem; font-weight: 700;">Access key</div>
        <input class="field" name="apiKey" type="password" autocomplete="current-password" />
      </label>
      {#if form?.error}
        <div class="error-banner">{form.error}</div>
      {/if}
      <button class="primary-button" type="submit">Open chat</button>
    </form>
  </div>
</div>
