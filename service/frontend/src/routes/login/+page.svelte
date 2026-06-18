<script lang="ts">
  import ThemeModeToggle from '$lib/components/ThemeModeToggle.svelte';

  let { form, data } = $props();
</script>

<div class="login-shell">
  <div class="login-card">
    <div class="login-card-top">
      <div class="pill">Web interface</div>
      <ThemeModeToggle compact={true} label="Login color theme" />
    </div>

    <h1 class="login-title">Sign in</h1>
    <p class="login-copy">
      Use your access key to continue.
    </p>

    <form method="POST" class="login-form">
      {#if data.returnTo}
        <input type="hidden" name="return_to" value={data.returnTo} />
      {/if}
      <label class="login-label">
        <span class="login-label-text">Access key</span>
        <input class="field" name="apiKey" type="password" autocomplete="current-password" />
      </label>
      {#if form?.error}
        <div class="error-banner">{form.error}</div>
      {/if}
      <button class="primary-button" type="submit">Continue</button>
    </form>
  </div>
</div>
