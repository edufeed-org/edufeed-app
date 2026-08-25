// Shared NIP-92 imeta parsing moved to $lib/helpers/imeta.js so the NIP-29
// lane can use it without importing from the Concord namespace. This shim
// keeps the historical import path for ChannelChat + existing tests.
export {
  getMessageAttachments,
  classifyAttachment,
  stripAttachmentUrls
} from '$lib/helpers/imeta.js';
