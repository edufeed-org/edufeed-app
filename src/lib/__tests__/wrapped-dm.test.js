/**
 * sendWrappedDm — the two relay-list prerequisites a NIP-17 DM needs, in one
 * place.
 *
 * Every send site had to remember both: `ensureDmRelayList()` so the *sender*
 * advertises an inbox for the reply, and `ensureRecipientDmRelays()` so the
 * action can resolve the *recipient's* kind 10050 (it reads the EventStore only
 * and never hits the network). Three of the four sites forgot the second one,
 * and their gift wraps fell through to the public fallback relays.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureDmRelayList = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const ensureRecipientDmRelays = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const run = vi.hoisted(() => vi.fn().mockResolvedValue('sent'));
const SendWrappedMessage = vi.hoisted(() => ({ __action: 'SendWrappedMessage' }));

vi.mock('$lib/services/dm-relay-backfill.js', () => ({ ensureDmRelayList }));
vi.mock('$lib/services/dm-recipient-relays.js', () => ({ ensureRecipientDmRelays }));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run }
}));
vi.mock('applesauce-actions/actions', () => ({ SendWrappedMessage }));

const { sendWrappedDm } = await import('$lib/services/wrapped-dm.js');

describe('sendWrappedDm', () => {
  beforeEach(() => {
    ensureDmRelayList.mockClear();
    ensureRecipientDmRelays.mockClear();
    run.mockClear();
  });

  it('loads the recipients DM relay lists before running the action', async () => {
    await sendWrappedDm(['peer1', 'peer2'], 'hi');

    expect(ensureRecipientDmRelays).toHaveBeenCalledWith(['peer1', 'peer2']);
    expect(ensureRecipientDmRelays.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0]
    );
  });

  it('backfills the sender own DM relay list so a reply can reach them', async () => {
    await sendWrappedDm('peer1', 'hi');

    expect(ensureDmRelayList).toHaveBeenCalledTimes(1);
    expect(ensureDmRelayList.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0]
    );
  });

  it('accepts a bare pubkey and passes it to the action unchanged', async () => {
    // Applesauce accepts either shape; normalising would change what the
    // existing call sites hand the action.
    await sendWrappedDm('peer1', 'hi');

    expect(ensureRecipientDmRelays).toHaveBeenCalledWith(['peer1']);
    expect(run).toHaveBeenCalledWith(SendWrappedMessage, 'peer1', 'hi');
  });

  it('runs the action the caller asked for, e.g. a threaded reply', async () => {
    const ReplyToWrappedMessage = { __action: 'ReplyToWrappedMessage' };
    await sendWrappedDm(['peer1'], 'hi', {
      action: ReplyToWrappedMessage,
      args: [{ id: 'parent' }, 'hi']
    });

    expect(run).toHaveBeenCalledWith(ReplyToWrappedMessage, { id: 'parent' }, 'hi');
    expect(ensureRecipientDmRelays).toHaveBeenCalledWith(['peer1']);
  });

  it('drops empty recipients rather than asking for a relay list for undefined', async () => {
    // Deliberately the shape a caller with a sparse list hands us, which the
    // declared string[] does not admit.
    await sendWrappedDm(/** @type {any} */ (['peer1', '', null, undefined]), 'hi');

    expect(ensureRecipientDmRelays).toHaveBeenCalledWith(['peer1']);
  });

  it('still sends when the relay-list prep fails', async () => {
    // Bookkeeping is best-effort: a dead lookup relay must not swallow the
    // message the user actually asked to send.
    ensureRecipientDmRelays.mockRejectedValueOnce(new Error('timeout'));
    ensureDmRelayList.mockRejectedValueOnce(new Error('declined'));

    await expect(sendWrappedDm('peer1', 'hi')).resolves.toBe('sent');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('propagates a send failure to the caller', async () => {
    // The prep is best-effort; the send is not — callers show an error toast.
    run.mockRejectedValueOnce(new Error('no relay took it'));

    await expect(sendWrappedDm('peer1', 'hi')).rejects.toThrow('no relay took it');
  });
});
