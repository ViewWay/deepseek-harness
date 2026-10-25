/**
 * The fixed system-prompt section positioning the debug tools. The text is
 * pinned verbatim; tests freeze it against drift.
 * @module @deepseek-ai/dsh-tool-debug/prompt
 */

/** The stable system-prompt guidance for the four debug tools. */
export const DEBUG_PROMPT_TEXT = [
  'Use the debug tools when a failure depends on runtime state that reading code and tests cannot explain.',
  'Set breakpoints before launching; after a stop, inspect threads, the stack, and scopes before stepping or continuing.',
  'Evaluate only the minimal necessary expressions; memory writes need an explicit justification and approval.',
  'Terminate every debug session you started before finishing; do not leave background debug processes running.',
  'Use file and language-server tools for ordinary code navigation; do not substitute the debugger for search.',
].join(' ')

/** The system-prompt section's stable identity. */
export const DEBUG_PROMPT_SECTION = 'TOOL_DEBUG'
