<script lang="ts">
  import '../app.css';

  let { data, children } = $props();
</script>

<svelte:head>
  <title>Hermes WebUI</title>
</svelte:head>

{@render children()}
