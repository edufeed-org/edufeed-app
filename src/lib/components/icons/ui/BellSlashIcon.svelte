<!--
  BellSlashIcon Component
  Bootstrap "bell-slash" — notifications muted
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  // Decorative by default — a non-empty default leaks an English SVG
  // <title> tooltip OVER the caller's translated wrapper title.
  export let title = '';
</script>

<Icon {class_} {title} viewBox="0 0 16 16" fill="currentColor" stroke="none" strokeWidth={0}>
  <path
    d="M5.164 14H15c-.299-.199-.557-.553-.78-1-.9-1.8-1.22-5.12-1.22-6 0-.264-.02-.523-.06-.776l-.938.938c.02.708.157 2.154.457 3.58.161.767.377 1.566.663 2.258.037.09.08.182.129.276H6.164zm5.581-9.91a3.99 3.99 0 0 0-1.948-1.01L8 2.917l-.797.161A4 4 0 0 0 4 7c0 .628-.134 2.197-.459 3.742q-.075.358-.166.732l-1.653 1.653q.03-.055.059-.113C2.679 11.2 2.999 7.88 2.999 7c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0c.942.19 1.788.644 2.457 1.284zM10 15a2 2 0 1 1-4 0zm-9.375.625a.53.53 0 0 0 .75.75l14.75-14.75a.53.53 0 0 0-.75-.75z"
  />
</Icon>
