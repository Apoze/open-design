# @open-design/dsh-runtime

Profile bundle that lets OpenDesign drive a user-installed DeepSeek Harness
through a strict JSONL stdio protocol. It does not ship the `dsh` executable,
Node.js, credentials, or provider configuration.

Install DeepSeek Harness first. Packaged OpenDesign builds carry an exact,
integrity-checked tarball of this component. When the DeepSeek Harness card
reports that the connection component is required, selecting the card asks for
confirmation and then invokes the user's own `dsh` to install that tarball into
the `open-design` profile. OpenDesign does not download or install `dsh`.

Repository developers can perform the equivalent operation manually:

```sh
pnpm --filter @open-design/dsh-runtime build
pnpm -C packages/dsh-runtime pack --pack-destination <temporary-directory>
dsh plugin --profile open-design add <temporary-directory>/open-design-dsh-runtime-0.1.1.tgz
dsh --profile open-design --probe
dsh --profile open-design --models
```

The daemon and `od agent setup deepseek-harness --json` use the same setup
endpoint as the UI. Setup is always explicit on the first incompatible
selection; cancelling does not select the agent or mutate the Harness profile.

The probe prints exactly one JSON object. OpenDesign starts one short-lived
`dsh --profile open-design --stdio` process per run; Harness session storage
provides cold resume across later processes.

The models command prints the provider-qualified catalog assembled by the
user's Harness profile. OpenDesign refreshes this read-only catalog during
agent detection; credentials and secret values are never included.

A turn that reaches its output-token limit emits `status: "failed"`,
`stop_reason: "max-tokens"`, and `DSH_PROFILE_OUTPUT_INCOMPLETE`. It must not
be recorded as completed. The Harness session remains available for resume.

Text is published after each model response finishes with `stop` or `tool-calls`.
Text from interrupted responses stays in the Harness session and is excluded
from OpenDesign's displayed answer and terminal output. Committed reasoning blocks are emitted as thinking frames, separately from
answer text. Executed tool events stream as they arrive.

The embedded runtime accepts both historical `text` deltas and current DSH `text` blocks with `value` chunks. Completed runs return their accepted final text; incomplete or cancelled tool generations remain failures instead of successful empty results.

The `durable_turn_instructions` capability accepts `turn_instructions` on execute.
The runtime registers these instructions as Harness runtime context, preserving
the current turn protocol when conversation history is compacted.

## Compatibilité DSH 0.2.0-rc.1

Cette version cible les contrats V4 de DSH et Cordis 4.0.4. L’installation locale utilise le fork natif NInfer basé sur le tag officiel `dsh-v0.2.0-rc.1`. Les anciens plugins de récupération finale ne doivent pas être activés en parallèle avec `dsh-generation-recovery`.

Pour développer contre le fork natif : installer les dépendances, puis exécuter `DSH_NATIVE_ROOT=/chemin/du/fork node scripts/link-native-core.mjs` avant la compilation. Les liens restent locaux dans `node_modules` ; les manifests et fichiers de verrouillage restent portables.
