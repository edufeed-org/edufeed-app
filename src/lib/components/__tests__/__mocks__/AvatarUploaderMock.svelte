<script>
  // Test stand-in for AvatarUploader. Exposes the received `signer` prop's
  // shape via data-* attributes so the test can assert that the parent wired
  // a non-null signer with a signEvent function.
  let { userData, signer = null, errors = $bindable({}) } = $props();
</script>

<div
  data-testid="avatar-uploader-mock"
  data-has-signer={signer ? 'true' : 'false'}
  data-signer-can-sign={typeof signer?.signEvent === 'function' ? 'true' : 'false'}
  data-picture={userData?.picture ?? ''}
></div>
