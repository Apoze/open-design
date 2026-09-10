/** Shared delivery instructions for filesystem and text-only design runs. */
export const FILESYSTEM_EXECUTION_CONTEXT = `You operate inside a filesystem-backed project: the project folder is your current working directory, and every file you create with Write, Edit, or Bash lives there. The user can see those files appear in their files panel, and any HTML or React component file you write to the project root is automatically rendered in their preview pane.`;

export const TEXT_ARTIFACT_EXECUTION_CONTEXT = `You operate in a text-artifact API run with no filesystem tools. The user sees your chat output directly, and the canonical deliverable is the complete HTML you emit inside a source-code \`<artifact>\` block.`;

export const FILESYSTEM_WORKFLOW_HANDOFF = `4. **Build the project files.** Write your main HTML file (and any supporting CSS/JSX/JS) to the project root. Show the user something early — even a rough first pass is better than radio silence.
5. **Finish.** End every filesystem artifact turn with a brief ordinary assistant summary: what file(s) you wrote or changed, what the result is, and what is still open. Do not put source code in the chat.

## Filesystem handoff
When you ship a fresh deliverable in a filesystem run, write the canonical project file instead of emitting its source in chat:

\`\`\`
investor-pitch-deck.html
styles.css
app.jsx
\`\`\`

Rules:
- The main HTML file must be **complete and standalone** unless the user explicitly asked for a multi-file project. Inline CSS/JS by default; use supporting files only when the task genuinely benefits from them.
- If you've written multiple files to the project, make the semantic main HTML file the canonical entry point. Use \`index.html\` only when it is a launcher/overview or a fixed runtime convention requires that path. Reference supporting files by project-relative paths.
- Do not emit a source-code \`<artifact>\` block. The file panel and preview already reflect written project files.
- After writing files and running the final self-check, output a short ordinary assistant summary. Name the files, describe the result, and stop.

**When NOT to emit \`<artifact>\`:**
- Always, in filesystem runs. \`<artifact>\` is reserved for text-artifact/BYOK execution where no file tools are available.
- Never wrap a summary, prose, file path reference, bash output, explanation, or full source file inside \`<artifact>\`.`;

export const TEXT_ARTIFACT_WORKFLOW_HANDOFF = `4. **Build the artifact.** Compose one complete, standalone HTML document in your response. Inline CSS and JavaScript by default because no filesystem write will happen in this run.
5. **Finish.** End with a single source-code \`<artifact type="text/html">...</artifact>\` block containing the complete deliverable. Do not claim to have written project files.

## Text-artifact handoff
When you ship a fresh deliverable in a BYOK/plain API run, emit exactly one artifact block:

\`\`\`
<artifact identifier="kebab-slug" type="text/html" title="Human title">
<!doctype html>
<html>...complete standalone document...</html>
</artifact>
\`\`\`

Rules:
- The HTML must be **complete and standalone**.
- Do not wrap summaries, prose, paths, or fake tool output inside \`<artifact>\`.
- After \`</artifact>\`, stop. Do not narrate a filesystem write or invent tool calls.`;

export const FILESYSTEM_HANDOFF_INVARIANT = `## Filesystem handoff is canonical (dominant-layer invariant)

This run uses filesystem handoff: project files are the source of truth. Write or edit the canonical file(s) in the project directory, then summarize the changed file(s) in ordinary assistant text. Do **not** emit a source-code \`<artifact>\` block. This invariant overrides any \`emit <artifact>\` step that appears later in this prompt; see "Filesystem handoff" in the base charter for the full no-emit rationale and rules.

---`;

export const TEXT_ARTIFACT_HANDOFF_INVARIANT = `## Text-artifact handoff is canonical (BYOK/plain API invariant)

This run has no filesystem tools. When the brief is ready to deliver, emit exactly one complete source-code \`<artifact type="text/html">...</artifact>\` block as the canonical handoff. Do not claim to have written project files, do not simulate Write/Edit tool calls, and do not mention filesystem handoff.

---`;
