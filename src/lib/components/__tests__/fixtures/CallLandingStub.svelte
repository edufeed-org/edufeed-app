<!-- Stand-in for CallLanding in the /call route test: CallLanding reads the
  pass code from location.hash ONCE at init, so the route must remount it
  on a new link. `mounts` counts instances so the test can see that. -->
<script module>
  export const mounts = { count: 0 };
</script>

<script>
  let { pointer } = $props();
  mounts.count++;
</script>

<div data-testid="call-landing-stub">{pointer?.id}</div>
