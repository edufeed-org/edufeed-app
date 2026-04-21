/**
 * Comment threading utilities for NIP-22 comments
 * Organizes flat comment lists into hierarchical tree structures
 */

/**
 * Builds a hierarchical comment tree from a flat list of comments
 *
 * @param {any[]} comments - Flat array of comment events (kind 1111)
 * @returns {any[]} Array of top-level comments with nested replies
 */
export function buildCommentTree(comments) {
  if (!comments || comments.length === 0) {
    return [];
  }

  // Create a map for quick lookup
  /** @type {Map<string, any>} */
  const commentMap = new Map();
  /** @type {any[]} */
  const topLevelComments = [];

  // First pass: Create map of all comments with empty replies arrays
  comments.forEach((comment) => {
    commentMap.set(comment.id, {
      ...comment,
      replies: []
    });
  });

  // Second pass: Build tree structure
  comments.forEach((comment) => {
    const parentId = getParentCommentId(comment);

    if (!parentId) {
      // This is a top-level comment (parent is the root event)
      topLevelComments.push(commentMap.get(comment.id));
    } else {
      // This is a reply to another comment
      const parent = commentMap.get(parentId);
      if (parent) {
        parent.replies.push(commentMap.get(comment.id));
      } else {
        // Parent not found (orphaned comment), treat as top-level
        topLevelComments.push(commentMap.get(comment.id));
      }
    }
  });

  // Sort top-level comments by timestamp (newest first)
  topLevelComments.sort((a, b) => b.created_at - a.created_at);

  // Recursively sort all reply threads
  sortRepliesRecursively(topLevelComments);

  return topLevelComments;
}

/**
 * Gets the parent comment ID from a comment event.
 * Returns null if the comment is a top-level comment (parent is root event).
 *
 * Handles both NIP-22 (kind 1111) and NIP-10 (kind 1) threading:
 * - Kind 1111: Uses k/e tags per NIP-22 spec
 * - Kind 1: Uses NIP-10 e-tag markers (root/reply) or legacy positional parsing
 *
 * Pure function — no applesauce caching helpers (those use getOrComputeCachedValue
 * which mutates the event, causing state_unsafe_mutation in $derived contexts).
 *
 * @param {any} comment - The comment event
 * @returns {string|null} Parent comment ID or null
 */
function getParentCommentId(comment) {
  if (comment.kind === 1111) {
    // NIP-22: lowercase 'k' tag = parent kind, lowercase 'e' tag = parent event id
    // If parent kind is 1111, this is a reply to another comment
    const parentKindTag = comment.tags.find((/** @type {any[]} */ t) => t[0] === 'k');
    const parentKind = parentKindTag ? parseInt(parentKindTag[1]) : null;

    if (parentKind === 1111) {
      // Explicit: k=1111 means parent is a comment
      const parentETag = comment.tags.find((/** @type {any[]} */ t) => t[0] === 'e');
      return parentETag ? parentETag[1] : null;
    }

    if (parentKind !== null) {
      // k exists but is not 1111 — top-level comment (parent is root event)
      return null;
    }

    // No k tag: fallback — compare lowercase e with uppercase E
    // If they differ, the lowercase e points to a parent comment
    const parentETag = comment.tags.find((/** @type {any[]} */ t) => t[0] === 'e');
    const rootETag = comment.tags.find((/** @type {any[]} */ t) => t[0] === 'E');
    if (parentETag && rootETag && parentETag[1] !== rootETag[1]) {
      return parentETag[1];
    }

    return null;
  }

  if (comment.kind === 1) {
    const eTags = comment.tags.filter((/** @type {any[]} */ t) => t[0] === 'e');
    if (eTags.length === 0) return null;

    // NIP-10 preferred: marked tags
    const replyTag = eTags.find((/** @type {any[]} */ t) => t[3] === 'reply');
    if (replyTag) return replyTag[1];

    // If there's a root marker but no reply marker, this is a direct reply to root
    const rootTag = eTags.find((/** @type {any[]} */ t) => t[3] === 'root');
    if (rootTag) return null;

    // Legacy (no markers): single e-tag = direct reply to root
    const hasMarkers = eTags.some((/** @type {any[]} */ t) => t[3]);
    if (!hasMarkers && eTags.length === 1) return null;

    // Legacy (no markers, multiple e-tags): last e-tag is reply-to parent
    if (!hasMarkers && eTags.length >= 2) return eTags[eTags.length - 1][1];

    return null;
  }

  return null;
}

/**
 * Recursively sorts replies in all comment threads
 *
 * @param {any[]} comments - Array of comments with replies
 */
function sortRepliesRecursively(comments) {
  comments.forEach((comment) => {
    if (comment.replies && comment.replies.length > 0) {
      // Sort replies (newest first)
      comment.replies.sort(
        (/** @type {any} */ a, /** @type {any} */ b) => b.created_at - a.created_at
      );
      // Recursively sort nested replies
      sortRepliesRecursively(comment.replies);
    }
  });
}

/**
 * Strips markdown formatting and truncates text to produce a plain-text excerpt.
 *
 * @param {string|null|undefined} text - Raw markdown text
 * @param {number} [maxLength=100] - Maximum character length before truncation
 * @returns {string} Plain-text excerpt, possibly truncated with '…'
 */
export function getPlainTextExcerpt(text, maxLength = 100) {
  if (!text) return '';
  const plain = text
    .replace(/[#*`[\]>~_\\-]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  return plain.length > maxLength ? plain.slice(0, maxLength) + '…' : plain;
}

/**
 * Counts total number of comments in a thread (including nested replies)
 *
 * @param {any[]} commentTree - Tree of comments with replies
 * @returns {number} Total comment count
 */
export function countComments(commentTree) {
  let count = 0;

  /**
   * @param {any[]} comments
   */
  function countRecursive(comments) {
    comments.forEach((comment) => {
      count++;
      if (comment.replies && comment.replies.length > 0) {
        countRecursive(comment.replies);
      }
    });
  }

  countRecursive(commentTree);
  return count;
}

/**
 * Gets the depth level of a comment in the tree
 *
 * @param {any[]} commentTree - Tree of comments
 * @param {string} commentId - ID of the comment to find
 * @param {number} currentDepth - Current recursion depth
 * @returns {number} Depth level (0 for top-level)
 */
export function getCommentDepth(commentTree, commentId, currentDepth = 0) {
  for (const comment of commentTree) {
    if (comment.id === commentId) {
      return currentDepth;
    }
    if (comment.replies && comment.replies.length > 0) {
      const depth = getCommentDepth(comment.replies, commentId, currentDepth + 1);
      if (depth !== -1) {
        return depth;
      }
    }
  }
  return -1;
}

/**
 * Gets the chain of parent comments from root to the target comment
 *
 * @param {any[]} commentTree - Tree of comments with replies
 * @param {string} commentId - ID of the target comment
 * @returns {any[]} Array of comments from root to target (inclusive)
 */
export function getParentChain(commentTree, commentId) {
  /** @type {any[]} */
  const path = [];

  /**
   * @param {any[]} comments
   * @returns {boolean}
   */
  function findPath(comments) {
    for (const comment of comments) {
      path.push(comment);
      if (comment.id === commentId) return true;
      if (comment.replies && comment.replies.length > 0) {
        if (findPath(comment.replies)) return true;
      }
      path.pop();
    }
    return false;
  }

  findPath(commentTree);
  return path;
}

/**
 * Gets a subtree rooted at the given comment ID
 *
 * @param {any[]} commentTree - Tree of comments with replies
 * @param {string} commentId - ID of the comment to use as root
 * @returns {any|null} The comment node with its replies, or null if not found
 */
export function getSubtree(commentTree, commentId) {
  for (const comment of commentTree) {
    if (comment.id === commentId) return comment;
    if (comment.replies && comment.replies.length > 0) {
      const found = getSubtree(comment.replies, commentId);
      if (found) return found;
    }
  }
  return null;
}
