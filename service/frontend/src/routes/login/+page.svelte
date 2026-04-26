<script lang="ts">
  import ThemeModeToggle from '$lib/components/ThemeModeToggle.svelte';

  let { form } = $props();
</script>

<div class="login-shell">
  <div class="login-card">
    <div class="login-card-top">
      <div class="pill">llama.cpp style shell</div>
      <ThemeModeToggle compact={true} label="Login color theme" />
    </div>

    <h1 class="login-title">Sign in</h1>
    <p class="login-copy">
      This frontend now follows the llama.cpp web UI shape, but authentication still runs through the
      existing Hermes key and session flow.
    </p>

    <form method="POST" class="login-form">
      <label class="login-label">
        <span class="login-label-text">Access key</span>
        <input class="field" name="apiKey" type="password" autocomplete="current-password" />
      </label>
      {#if form?.error}
        <div class="error-banner">{form.error}</div>
      {/if}
      <button class="primary-button" type="submit">Open chat</button>
    </form>
  </div>
</div>
