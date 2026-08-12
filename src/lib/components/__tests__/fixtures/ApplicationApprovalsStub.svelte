<!--
  Stub for ApplicationApprovals — lets MembershipPane tests assert the props
  it wires up (communikeyEvent/communityId/communityName/roster) without
  exercising the queue's own loader/decrypt/approve/decline internals
  (covered by ApplicationApprovals.test.js).
-->
<script>
  let { communikeyEvent, communityId, communityName, roster } = $props();
</script>

<div
  data-testid="stub-application-approvals"
  data-communityid={communityId ?? ''}
  data-communityname={communityName ?? ''}
  data-application={JSON.stringify(
    communikeyEvent?.tags?.find((/** @type {string[]} */ t) => t[0] === 'application') ?? null
  )}
  data-rosterpointer={JSON.stringify(roster?.pointer ?? null)}
></div>
