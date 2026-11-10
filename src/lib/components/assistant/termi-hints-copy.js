// Termi's hint cards: title, body and buttons per account hint. Plain copy,
// nothing to do with the LLM; moved verbatim out of TermiChatWindow.
import { getFirstPendingInvite } from '$lib/concord/pending-invites.svelte.js';
import * as m from '$lib/paraglide/messages';
import { modalStore } from '$lib/stores/modal.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

// Per-hint copy — titles/bodies/CTAs reuse the former banner keys so
// translations stay consistent; "doing" lines are Termi-specific.
/**
 * @param {{ isNsec: boolean }} opts the relays hint words its body for a local key
 */
export function hintCopy({ isNsec }) {
  return {
    backup: {
      title: m.auth_backup_banner_title(),
      body: m.auth_backup_banner_body(),
      action: m.auth_backup_banner_download_cta(),
      secondary: null,
      doing: null,
      link: null
    },
    relays: {
      title: m.relay_list_banner_title(),
      body: isNsec ? m.relay_list_banner_body_nsec() : m.relay_list_banner_body(),
      action: m.relay_list_banner_use_cta(),
      secondary: m.relay_list_banner_customize_cta(),
      doing: m.termi_hint_relays_doing(),
      link: null
    },
    dm: {
      title: m.dm_relay_banner_title(),
      body: m.dm_relay_banner_body(),
      action: m.dm_relay_banner_use_cta(),
      secondary: m.dm_relay_banner_customize_cta(),
      doing: m.termi_hint_dm_doing(),
      link: null
    },
    nip05: {
      title: m.termi_hint_nip05_title(),
      body: m.termi_hint_nip05_body({
        domain: `@${runtimeConfig.membership?.handleDomain || ''}`
      }),
      action: m.termi_hint_nip05_cta(),
      secondary: null,
      doing: null,
      link: null
    },
    profile: {
      title: m.termi_hint_profile_title(),
      body: m.termi_hint_profile_body(),
      action: m.termi_hint_profile_cta(),
      secondary: null,
      doing: null,
      link: null
    },
    signer: {
      title: m.termi_hint_signer_title(),
      body: m.termi_hint_signer_body(),
      action: m.termi_hint_signer_cta(),
      secondary: null,
      doing: null,
      link: null
    },
    invites: {
      // Enriched once the invite is decrypted (auto-decrypt makes that the
      // common case): name the area instead of a generic "private area".
      title: getFirstPendingInvite()?.areaName
        ? m.concord_invite_hint_title_known({
            area: /** @type {string} */ (getFirstPendingInvite()?.areaName)
          })
        : m.concord_invite_hint_title(),
      body: m.concord_invite_hint_body(),
      action: m.concord_invite_hint_action(),
      secondary: null,
      doing: null,
      link: null
    }
  };
}

// Host of the deployment's own Blossom server, for the storage hints' copy.
function deploymentBlossomHost() {
  try {
    return new URL(runtimeConfig.defaultBlossomServers?.[0] || '').host;
  } catch {
    return '';
  }
}

/**
 * The nip05 hint tracks the membership application: the copy depends on the
 * hint's variant ('apply' reminder, passive 'pending' note, celebratory
 * 'ready' card with one-click activation). Other hints use hintCopy as-is.
 * @param {{id: string, variant?: string, address?: string, count?: number, relay?: string, replacement?: string | null, days?: number}} hint
 * @param {{ isNsec: boolean }} opts
 */
export function copyFor(hint, { isNsec }) {
  if (hint.id === 'deadRelay') {
    const relay = (hint.relay || '').replace(/^wss?:\/\//, '');
    const replacement = (hint.replacement || '').replace(/^wss?:\/\//, '');
    const days = hint.days ?? 0;
    return {
      title: m.termi_hint_dead_relay_title(),
      body:
        hint.variant === 'remove'
          ? m.termi_hint_dead_relay_body_remove({ relay, days })
          : m.termi_hint_dead_relay_body({ relay, days, replacement }),
      action:
        hint.variant === 'remove'
          ? m.termi_hint_dead_relay_cta_remove()
          : m.termi_hint_dead_relay_cta(),
      secondary: m.relay_list_banner_customize_cta(),
      doing: m.termi_hint_dead_relay_doing(),
      link: null
    };
  }
  if (hint.id === 'groupAdded') {
    const count = hint.count ?? 0;
    return {
      title: m.termi_hint_group_added_title(),
      body:
        count === 1
          ? m.termi_hint_group_added_body_one()
          : m.termi_hint_group_added_body({ count }),
      action: m.termi_hint_group_added_cta(),
      secondary: null,
      doing: null,
      link: null
    };
  }
  if (hint.id === 'badgeAward') {
    const count = hint.count ?? 0;
    return {
      title: m.termi_hint_badge_award_title(),
      body:
        count === 1
          ? m.termi_hint_badge_award_body_one()
          : m.termi_hint_badge_award_body({ count }),
      action: m.termi_hint_badge_award_cta(),
      secondary: null,
      doing: null,
      link: null
    };
  }
  if (hint.id === 'joinRequests') {
    const count = hint.count ?? 0;
    return {
      title: m.termi_hint_join_requests_title(),
      // Singular/plural picked here — plain {count} interpolation cannot
      // bend the German noun.
      body:
        count === 1
          ? m.termi_hint_join_requests_body_one()
          : m.termi_hint_join_requests_body({ count }),
      action: m.termi_hint_join_requests_cta(),
      secondary: null,
      doing: null,
      link: null
    };
  }
  if (hint.id === 'nip05' && hint.variant === 'ready') {
    return {
      title: m.termi_hint_nip05_ready_title(),
      body: m.termi_hint_nip05_ready_body({ address: hint.address || '' }),
      action: m.termi_hint_nip05_ready_cta(),
      secondary: null,
      doing: m.termi_hint_nip05_ready_doing(),
      link: null
    };
  }
  if (hint.id === 'nip05' && hint.variant === 'pending') {
    return {
      title: m.termi_hint_nip05_pending_title(),
      body: m.termi_hint_nip05_pending_body(),
      action: null,
      secondary: null,
      doing: null,
      link: null
    };
  }
  if (hint.id === 'blossomUpgrade') {
    return {
      title: m.termi_hint_blossom_upgrade_title(),
      body: m.termi_hint_blossom_upgrade_body({ host: deploymentBlossomHost() }),
      action: m.termi_hint_blossom_upgrade_cta(),
      secondary: m.termi_hint_blossom_customize_cta(),
      doing: m.termi_hint_blossom_doing(),
      link: null
    };
  }
  if (hint.id === 'blossomPublic') {
    const member = hint.variant === 'member';
    return {
      title: m.termi_hint_blossom_public_title(),
      body: member
        ? m.termi_hint_blossom_public_body_member({
            domain: `@${runtimeConfig.membership?.handleDomain || ''}`
          })
        : m.termi_hint_blossom_public_body(),
      action: m.termi_hint_blossom_public_cta(),
      secondary: m.termi_hint_blossom_customize_cta(),
      doing: m.termi_hint_blossom_doing(),
      // Secondary path for non-members: apply for a handle right here.
      link: member
        ? {
            label: m.termi_hint_blossom_public_apply_link(),
            onClick: () => modalStore.openModal('membershipApply')
          }
        : null
    };
  }
  return hintCopy({ isNsec })[
    /** @type {'backup' | 'relays' | 'dm' | 'nip05' | 'profile' | 'signer' | 'invites'} */ (hint.id)
  ];
}
