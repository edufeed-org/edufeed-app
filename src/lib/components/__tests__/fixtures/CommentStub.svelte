<script>
  // Stand-in for Comment.svelte: exposes the props CommentThread hands down.
  let { comment, depth = 0, parentComment = undefined, repliesAction = undefined } = $props();
</script>

<div
  data-testid="comment-stub"
  data-id={comment.id}
  data-depth={depth}
  data-parent={parentComment?.id ?? ''}
  data-action={repliesAction?.testid ?? ''}
  data-expanded={repliesAction?.expanded ?? ''}
></div>
