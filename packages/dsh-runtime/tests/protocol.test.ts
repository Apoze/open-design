import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, test } from 'vitest';
import { identityFrame, modelsFrame, parseHostCommand } from '../src/protocol.js';
import { internals } from '../src/index.js';

describe('@open-design/dsh-runtime protocol', () => {
  test('declares a dsh profile bundle patch', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } };
    };
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
    assert.match(readFileSync(resolve('cordis.patch.yml'), 'utf8'), /@open-design\/dsh-runtime/);
  });

  test('emits the strict probe identity', () => {
    assert.deepEqual(identityFrame('probe', 'test'), {
      v: 1,
      type: 'probe',
      runtime: 'open-design',
      protocol_version: 1,
      plugin_version: 'test',
      capabilities: {
        session_resume: true,
        session_cancel: true,
        structured_events: true,
        durable_turn_instructions: true,
      },
    });
  });

  test('parses execute and cancel without retaining unknown fields', () => {
    assert.deepEqual(parseHostCommand({
      v: 1,
      type: 'execute',
      request_id: 'run-1',
      cwd: '/project',
      prompt: 'create',
      mcp_servers: [],
      ignored: 'value',
    }), {
      v: 1,
      type: 'execute',
      request_id: 'run-1',
      cwd: '/project',
      prompt: 'create',
      mcp_servers: [],
    });
    assert.deepEqual(parseHostCommand({ v: 1, type: 'cancel', request_id: 'run-1' }), {
      v: 1,
      type: 'cancel',
      request_id: 'run-1',
    });
  });

  test('validates durable turn instructions without changing their bytes', () => {
    const base = { v: 1, type: 'execute', request_id: 'run', cwd: '/project', prompt: 'build', mcp_servers: [] };
    const instructions = 'Delivery key: 123.\nUse the current key after compaction.';
    const command = parseHostCommand({ ...base, turn_instructions: instructions });
    assert.equal(command.type === 'execute' && command.turn_instructions, instructions);
    for (const invalid of ['', '   ', 42, null, {}]) {
      assert.throws(() => parseHostCommand({ ...base, turn_instructions: invalid }), /invalid turn instructions/);
    }
  });

  test('emits a namespaced Harness model catalog', () => {
    assert.deepEqual(modelsFrame([{
      provider: 'deepseek-official',
      provider_name: 'DeepSeek',
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
    }]), {
      v: 1,
      type: 'models',
      runtime: 'open-design',
      models: [{
        provider: 'deepseek-official',
        provider_name: 'DeepSeek',
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
      }],
    });
  });

  test('keeps per-model reasoning metadata in the catalog', () => {
    assert.deepEqual(modelsFrame([{
      provider: 'deepseek-official',
      provider_name: 'DeepSeek',
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      reasoning_options: [
        { id: 'low', name: 'Low' },
        { id: 'high', name: 'High', default: true },
      ],
    }]).models[0]?.reasoning_options, [
      { id: 'low', name: 'Low' },
      { id: 'high', name: 'High', default: true },
    ]);
  });

  test('maps terminal reasons and flat V4 tool output', () => {
    assert.equal(internals.resultStatus({ kind: 'completed' }), 'completed');
    assert.equal(internals.resultStatus({ kind: 'aborted', reason: { kind: 'user' } }), 'cancelled');
    assert.equal(internals.resultStatus({ kind: 'blocked' }), 'failed');
    assert.equal(internals.contentText([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ]), 'onetwo');
    assert.deepEqual(internals.terminalOutput(''), {});
    assert.deepEqual(internals.terminalOutput('done'), { output: 'done' });
  });

  test('normalizes every failed terminal reason to a wire error', () => {
    assert.equal(internals.resultStatus({ kind: 'max-tokens' }), 'failed');
    assert.deepEqual(internals.resultError({ kind: 'max-tokens' }), {
      code: 'DSH_PROFILE_OUTPUT_INCOMPLETE',
      message: 'DeepSeek Harness reached the output limit before completing the turn. The session is preserved; incomplete tool calls were not executed.',
    });
    assert.deepEqual(internals.resultError({ kind: 'blocked' }), {
      code: 'DSH_PROFILE_TURN_BLOCKED',
      message: 'DeepSeek Harness blocked the turn before it completed.',
    });
    assert.deepEqual(internals.resultError({
      kind: 'error',
      error: new Error('provider unavailable') as never,
    }), {
      code: 'DSH_PROFILE_TURN_FAILED',
      message: 'provider unavailable',
    });
    assert.deepEqual(internals.resultError(undefined), {
      code: 'DSH_PROFILE_MISSING_TURN_END',
      message: 'DeepSeek Harness became idle without reporting how the turn ended.',
    });
    assert.equal(internals.resultError({ kind: 'completed' }), undefined);
    assert.equal(internals.resultError({ kind: 'aborted', reason: { kind: 'user' } }), undefined);
  });

  test('preserves structured Harness error facts without object coercion', () => {
    assert.deepEqual(internals.errorFacts({
      code: 'MISSING_CREDENTIAL',
      message: 'Configure a DeepSeek API key in Harness.',
    }, 'DSH_PROFILE_TURN_FAILED'), {
      code: 'MISSING_CREDENTIAL',
      message: 'Configure a DeepSeek API key in Harness.',
    });
    assert.deepEqual(internals.errorFacts({ code: 'UNKNOWN', detail: 'private provider data' }, 'fallback'), {
      code: 'UNKNOWN',
      message: 'DeepSeek Harness reported an execution error.',
    });
    assert.doesNotMatch(
      internals.errorFacts({ code: 'UNKNOWN' }, 'fallback').message,
      /\[object Object\]/,
    );
  });

  test('keeps a bounded process-exit fallback after managed profile shutdown', () => {
    const calls: string[] = [];
    let scheduled: (() => void) | undefined;
    internals.requestProfileExit(
      (code) => calls.push(`managed:${code}`),
      () => calls.push('forced'),
      (callback, delayMs) => {
        calls.push(`scheduled:${delayMs}`);
        scheduled = callback;
        return { unref: () => calls.push('unref') };
      },
    );

    assert.deepEqual(calls, ['managed:0', 'scheduled:1000', 'unref']);
    scheduled?.();
    assert.deepEqual(calls, ['managed:0', 'scheduled:1000', 'unref', 'forced']);
  });

  test('projects V4 tool result identity and output', () => {
    const frames: string[] = [];
    internals.emitSessionEvent({ write: (text: string) => frames.push(text) }, {
      v: 1, type: 'execute', request_id: 'run', cwd: '/project', prompt: 'build', mcp_servers: [],
    }, 'provider', 'model', {
      type: 'tool/result', seq: 1, time: 0, data: { turn: 1, step: 1,
        message: { role: 'tool', toolCallId: 'call-1', isError: true,
          content: [{ type: 'text', text: 'permission denied' }] },
      },
    } as unknown as Parameters<typeof internals.emitSessionEvent>[4]);
    assert.deepEqual(JSON.parse(frames[0] ?? '{}'), {
      v: 1, type: 'tool_result', request_id: 'run', call_id: 'call-1', name: 'tool',
      output: 'permission denied', is_error: true,
    });
  });

  test('publishes settled embedded-stream messages and ignores rejected attempts', () => {
    const frames: string[] = [];
    const writer = internals.createSessionEventWriter({ write: (text: string) => { frames.push(text); return true; } }, {
      v: 1, type: 'execute', request_id: 'run', cwd: '/project', prompt: 'build', mcp_servers: [],
    }, 'provider', 'model');
    const accept = (type: string, text: string, reason: string) => writer.accept({
      type, seq: 1, time: 0, data: {
        turn: 1, step: 1, message: { content: [{ type: 'text', text }] },
        stream: [{ type: 'chunk', index: 0, time: 0, chunk: { type: 'finish', reason: { kind: reason } } }],
      },
    } as unknown as Parameters<typeof writer.accept>[0]);
    accept('assistant/attempt', 'unfinished file', 'max-tokens');
    assert.equal(writer.text, '');
    accept('assistant/message', 'Fichier vérifié.', 'stop');
    assert.equal(writer.text, 'Fichier vérifié.');
    assert.equal(JSON.parse(frames[0] ?? '{}').content, 'Fichier vérifié.');
    accept('assistant/message', 'truncated legacy output', 'max-tokens');
    assert.equal(frames.length, 1);
  });

  test('keeps settled reasoning separate from visible text and terminal output', () => {
    const frames: string[] = [];
    const writer = internals.createSessionEventWriter({ write: (text: string) => frames.push(text) }, {
      v: 1, type: 'execute', request_id: 'run', cwd: '/project', prompt: 'build', mcp_servers: [],
    }, 'provider', 'model');
    writer.accept({
      type: 'assistant/message', seq: 2, time: 0, data: {
        turn: 1, step: 1, message: { content: [
          { type: 'reasoning', text: 'Internal plan with <od-next> example.' },
          { type: 'text', text: 'File saved. ' },
          { type: 'reasoning', text: 'Check delivery.' },
          { type: 'text', text: 'Verified.' },
        ] },
        stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }],
      },
    } as unknown as Parameters<typeof writer.accept>[0]);
    assert.deepEqual(frames.map((frame) => {
      const { type, content } = JSON.parse(frame);
      return { type, content };
    }), [
      { type: 'thinking', content: 'Internal plan with <od-next> example.' },
      { type: 'text', content: 'File saved. ' },
      { type: 'thinking', content: 'Check delivery.' },
      { type: 'text', content: 'Verified.' },
    ]);
    assert.equal(writer.text, 'File saved. Verified.');
  });

  test('replays cancellation received before execute initializes its AbortController', async () => {
    let createSignal: AbortSignal | undefined;
    let disposeCalls = 0;
    const handle = {
      agent: {
        session: { seq: 0 },
        whenIdle: async () => {},
        followup: async () => {},
        cancel: () => {},
      },
      dispose: async () => { disposeCalls += 1; },
    };
    const ctx = {
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      },
      agents: {
        create: async ({ signal }: { signal: AbortSignal }) => {
          createSignal = signal;
          return handle;
        },
      },
      on: () => () => {},
      sessions: { flush: async () => {} },
    };
    const input = new PassThrough();
    const chunks: string[] = [];
    const exitCodes: number[] = [];
    const serving = internals.serve(
      ctx as never,
      { write: (chunk: string) => chunks.push(chunk) },
      (code) => exitCodes.push(code),
      input,
      (exit) => exit(0),
    );

    input.write(`${JSON.stringify({
      v: 1,
      type: 'cancel',
      request_id: 'run-handshake-cancel',
    })}\n`);
    input.write(`${JSON.stringify({
      v: 1,
      type: 'execute',
      request_id: 'run-handshake-cancel',
      cwd: '/project',
      prompt: 'do not start',
      mcp_servers: [],
    })}\n`);
    await serving;

    assert.equal(createSignal?.aborted, true);
    assert.equal(disposeCalls, 1);
    assert.deepEqual(exitCodes, [0]);
    const frames = chunks.map((chunk) => JSON.parse(chunk) as { type: string; status?: string });
    assert.equal(frames.at(-1)?.type, 'result');
    assert.equal(frames.at(-1)?.status, 'cancelled');
  });

  test('cancels a resumed request during restore without starting its follow-up turn', async () => {
    let finishRestore!: () => void;
    const restoring = new Promise<void>((resolveRestore) => { finishRestore = resolveRestore; });
    let followupCalls = 0;
    let disposeCalls = 0;
    const handle = {
      agent: {
        session: { seq: 7 },
        whenIdle: () => restoring,
        followup: async () => { followupCalls += 1; },
      },
      dispose: async () => { disposeCalls += 1; },
    };
    const ctx = {
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      },
      agents: {
        resume: async () => handle,
      },
      on: () => () => {},
      sessions: { flush: async () => {} },
    };
    const chunks: string[] = [];
    const abort = new AbortController();
    const execution = internals.execute(ctx as never, {
      v: 1,
      type: 'execute',
      request_id: 'run-restore-cancel',
      cwd: '/project',
      prompt: 'do not start',
      mcp_servers: [],
      resume_session_id: 'session-1',
    }, { write: (chunk: string) => chunks.push(chunk) }, () => {}, abort.signal);

    await Promise.resolve();
    abort.abort();
    finishRestore();
    await execution;

    assert.equal(followupCalls, 0);
    assert.equal(disposeCalls, 1);
    assert.deepEqual(chunks.map((chunk) => JSON.parse(chunk) as unknown), [
      {
        v: 1,
        type: 'session',
        request_id: 'run-restore-cancel',
        session_id: 'session-1',
        resumed: true,
      },
      {
        v: 1,
        type: 'result',
        request_id: 'run-restore-cancel',
        status: 'cancelled',
        session_id: 'session-1',
        resume_rejected: false,
      },
    ]);
  });

  test('cancellation remains authoritative while the active turn is being flushed', async () => {
    let selectedModel: unknown;
    let idleCalls = 0;
    let notifyFlushStarted!: () => void;
    const flushStarted = new Promise<void>((resolveFlush) => { notifyFlushStarted = resolveFlush; });
    let finishFlush!: () => void;
    const flushFinished = new Promise<void>((resolveFlush) => { finishFlush = resolveFlush; });
    let disposeCalls = 0;
    const handle = {
      agent: {
        session: { seq: 0 },
        model: { select: (selection: unknown) => { selectedModel = selection; } },
        whenIdle: async () => { idleCalls += 1; },
        followup: async () => {},
      },
      dispose: async () => { disposeCalls += 1; },
    };
    const ctx = {
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      },
      agents: {
        create: async () => handle,
      },
      on: () => () => {},
      sessions: {
        flush: async () => {
          notifyFlushStarted();
          await flushFinished;
        },
      },
    };
    const chunks: string[] = [];
    const abort = new AbortController();
    const execution = internals.execute(ctx as never, {
      v: 1,
      type: 'execute',
      request_id: 'run-active-cancel',
      cwd: '/project',
      prompt: 'keep working',
      mcp_servers: [],
    }, { write: (chunk: string) => chunks.push(chunk) }, () => {}, abort.signal);

    await flushStarted;
    abort.abort();
    finishFlush();
    await execution;

    assert.deepEqual(selectedModel, { provider: 'deepseek-official', model: 'deepseek-chat' });
    assert.equal(idleCalls, 2);
    assert.equal(disposeCalls, 1);
    const frames = chunks.map((chunk) => JSON.parse(chunk) as { type: string; status?: string; error?: unknown });
    assert.equal(frames.filter((frame) => frame.type === 'result').length, 1);
    assert.equal(frames.at(-1)?.status, 'cancelled');
    assert.equal(frames.at(-1)?.error, undefined);
  });
});
