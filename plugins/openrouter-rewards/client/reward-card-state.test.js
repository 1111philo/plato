import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRenderCompletionRewardCard } from './reward-card-state.js';

describe('completion reward card state', () => {
  it('renders when a reward error exists without a result', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: null, error: 'Reward request failed' }), true);
  });

  it('hides when there is no result and no error', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: null, error: '' }), false);
  });

  it('hides no-claim results without an error', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'no-claim' }, error: '' }), false);
  });

  it('renders no-claim results when an error is also present', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'no-claim' }, error: 'Retry failed' }), true);
  });

  it('renders active reward results', () => {
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'minted' }, error: '' }), true);
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'processing' }, error: '' }), true);
    assert.equal(shouldRenderCompletionRewardCard({ result: { status: 'topped-up' }, error: '' }), true);
  });
});
