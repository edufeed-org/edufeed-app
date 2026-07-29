<script>
  import { page } from '$app/stores';
  import TemplateResourceForm from '$lib/components/forms/TemplateResourceForm.svelte';

  /** @type {{ data: { naddr: string } }} */
  let { data } = $props();

  const editNaddr = $derived($page.url.searchParams.get('edit') || '');
</script>

<TemplateResourceForm templateNaddr={data.naddr} {editNaddr} />
