<script>
  import { onMount } from 'svelte';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils';
  import { showToast } from '$lib/helpers/toast.js';
  import { calendarStore } from '$lib/stores/calendar-events.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import DownloadIcon from '../icons/actions/DownloadIcon.svelte';
  import * as m from '$lib/paraglide/messages';

  // Props for explicit calendar ID (for community calendars)
  let { calendarId = null, calendarTitle = null } = $props();

  let selectedCalendar = $state(calendarStore.selectedCalendar);
  /** @type {import('rxjs').Subscription | undefined} */
  let calendarSubscription;

  onMount(() => {
    calendarSubscription = calendarStore.selectedCalendar$.subscribe((cal) => {
      selectedCalendar = cal;
    });

    return () => {
      calendarSubscription?.unsubscribe();
    };
  });

  // Get calendar ID (from prop or selectedCalendar)
  const getCalendarId = () => {
    if (calendarId) return calendarId;
    if (selectedCalendar?.originalEvent) {
      return encodeEventToNaddr(selectedCalendar.originalEvent);
    }
    return selectedCalendar?.id || '';
  };

  // Get calendar title (from prop or selectedCalendar)
  // Note: Currently unused but kept for future webcal title display
  const _getCalendarTitle = () => {
    if (calendarTitle) return calendarTitle;
    return selectedCalendar?.title || m.add_to_calendar_fallback_title();
  };

  // Generate webcal URL for calendar subscription
  // Uses webcals:// for HTTPS (production) and webcal:// for HTTP (local dev)
  // This ensures Thunderbird can subscribe without hitting Traefik's HTTP->HTTPS redirect
  const generateWebcalUrl = () => {
    const baseUrl = window.location.origin;
    const id = getCalendarId();
    const isSecure = baseUrl.startsWith('https://');
    const protocol = isSecure ? 'webcals://' : 'webcal://';
    return `${protocol}${baseUrl.replace(/^https?:\/\//, '')}/api/calendar/${id}/ics`;
  };

  // Generate ICS download URL
  const generateIcsUrl = () => {
    const baseUrl = window.location.origin;
    const id = getCalendarId();
    return `${baseUrl}/api/calendar/${id}/ics`;
  };

  const handleCopyWebcalLink = async () => {
    try {
      const webcalUrl = generateWebcalUrl();
      await navigator.clipboard.writeText(webcalUrl);
      showToast(m.toast_calendar_link_copied(), 'success');
    } catch (error) {
      console.error('Error copying webcal link:', error);
      showToast(m.toast_calendar_link_error(), 'error');
    }
  };

  const handleSubscribeToCalendar = () => {
    try {
      const webcalUrl = generateWebcalUrl();
      window.open(webcalUrl, '_blank');
      showToast(m.add_to_calendar_toast_subscription_added(), 'success');
    } catch (error) {
      console.error('Error opening webcal link:', error);
      showToast(m.toast_calendar_link_error(), 'error');
    }
  };

  const handleDownloadIcs = () => {
    try {
      const icsUrl = generateIcsUrl();
      const link = document.createElement('a');
      link.href = icsUrl;
      link.download = `${selectedCalendar?.title || 'calendar'}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast(m.add_to_calendar_toast_download_success(), 'success');
    } catch (error) {
      console.error('Error downloading ICS:', error);
      showToast(m.toast_calendar_link_error(), 'error');
    }
  };

  const handleShowQRCode = () => {
    try {
      const webcalUrl = generateWebcalUrl();
      const calendarTitle = selectedCalendar?.title || m.add_to_calendar_fallback_title();
      modalStore.openModal('webcalQRCode', { webcalUrl, calendarTitle });
    } catch (error) {
      console.error('Error opening QR code modal:', error);
      showToast(m.add_to_calendar_toast_qr_failed(), 'error');
    }
  };

  const actions = [
    {
      icon: '📅',
      name: m.add_to_calendar_action_subscribe(),
      tooltip: m.add_to_calendar_action_subscribe_tooltip(),
      onClick: handleSubscribeToCalendar
    },
    {
      icon: '⬇️',
      name: m.add_to_calendar_action_download(),
      tooltip: m.add_to_calendar_action_download_tooltip(),
      onClick: handleDownloadIcs
    },
    {
      icon: '🔗',
      name: m.add_to_calendar_action_copy_link(),
      tooltip: m.add_to_calendar_action_copy_link_tooltip(),
      onClick: handleCopyWebcalLink
    },
    {
      icon: '📱',
      name: m.add_to_calendar_action_qr_code(),
      tooltip: m.add_to_calendar_action_qr_code_tooltip(),
      onClick: handleShowQRCode
    }
  ];
</script>

<div class="z-10">
  <div class="dropdown dropdown-end dropdown-bottom">
    <div tabindex="0" role="button" class="btn btn-circle btn-primary">
      <DownloadIcon class_="w-4 h-4" />
    </div>
    <ul class="dropdown-content menu z-[1] mb-2 rounded-box p-2 shadow">
      {#each actions as action (action.name)}
        <li>
          <button class="btn btn-circle btn-lg" onclick={action.onClick} title={action.tooltip}>
            <span class="text-lg">{action.icon}</span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
</div>
