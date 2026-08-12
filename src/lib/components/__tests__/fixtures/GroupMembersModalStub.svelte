<!--
  Stub for GroupMembersModal — lets MembershipPane tests assert the props it
  wires up (pointer/admins/members/myPubkey/isAdmin/roleOptions) and drive
  onRosterChanged/onClose without exercising the modal's own relay-facing
  put-user/remove-user internals (covered by GroupMembersModal.test.js).
-->
<script>
  let { pointer, admins, members, myPubkey, isAdmin, roleOptions, onRosterChanged, onClose } =
    $props();
</script>

<div
  data-testid="stub-group-members-modal"
  data-pointer={JSON.stringify(pointer ?? null)}
  data-admins={JSON.stringify(admins ?? [])}
  data-members={JSON.stringify([...(members ?? [])])}
  data-mypubkey={myPubkey ?? ''}
  data-isadmin={String(!!isAdmin)}
  data-roleoptions={JSON.stringify(roleOptions ?? [])}
></div>
<button data-testid="stub-group-members-refresh" onclick={() => onRosterChanged?.()}>refresh</button
>
<button data-testid="stub-group-members-close" onclick={() => onClose?.()}>close</button>
