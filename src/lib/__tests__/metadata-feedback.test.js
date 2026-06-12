/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildMetadataFeedbackMessage } from '$lib/helpers/metadata-feedback.js';

describe('buildMetadataFeedbackMessage', () => {
  it('builds the templated feedback body with all fields', () => {
    const body = buildMetadataFeedbackMessage({
      title: 'Intro to Algebra',
      url: 'https://app.edufeed.org/naddr1abc',
      fieldLabel: 'License',
      comment: 'The license should be CC-BY-SA, not CC-BY.'
    });

    expect(body).toBe(
      '[Metadata feedback via edufeed]\n' +
        'Resource: Intro to Algebra — https://app.edufeed.org/naddr1abc\n' +
        'Field flagged: License\n' +
        'Comment: The license should be CC-BY-SA, not CC-BY.'
    );
  });

  it('omits the title segment when title is empty', () => {
    const body = buildMetadataFeedbackMessage({
      title: '',
      url: 'https://app.edufeed.org/naddr1abc',
      fieldLabel: 'Title',
      comment: 'Typo in the heading.'
    });

    expect(body).toBe(
      '[Metadata feedback via edufeed]\n' +
        'Resource: https://app.edufeed.org/naddr1abc\n' +
        'Field flagged: Title\n' +
        'Comment: Typo in the heading.'
    );
  });

  it('trims surrounding whitespace from the comment', () => {
    const body = buildMetadataFeedbackMessage({
      title: 'X',
      url: 'https://app.edufeed.org/x',
      fieldLabel: 'Other',
      comment: '   needs a source link   '
    });

    expect(body.endsWith('Comment: needs a source link')).toBe(true);
  });
});
