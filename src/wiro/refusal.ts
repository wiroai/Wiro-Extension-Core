// Wiro refuses work that the account's Controls stop, before anything runs:
//   code 92  a Model Access rule blocks the model
//   code 93  a spend limit has no room for the work
// The Wiro MCP server passes Wiro's own sentence on, which names the rule or the
// limit (and when a limit resets), and adds a note for AI assistants after it:
// what to try next and which tools to call. People read the panel, so they get
// Wiro's sentence and the extension's own line instead of that note.
//
// The tool error carries no code, so a refusal is known by its text. The note's
// first words cut it off (Wiro-MCP 1.7.0 and later). Without them, Wiro's own
// sentence is enough: a Model Access refusal ends with "Model Access rules decide
// which models can run.", a spend-limit refusal with when the limit resets. Any
// other text stays as it came.

export const MODEL_ACCESS_CODE = 92;
export const SPEND_LIMIT_CODE = 93;

export const MODEL_ACCESS_PATH = '/panel/controls/model-access';
export const SPEND_LIMITS_PATH = '/panel/controls/spend-limits';

export interface ControlsRefusal {
  code: typeof MODEL_ACCESS_CODE | typeof SPEND_LIMIT_CODE;
  /** Wiro's own sentence: the rule or the limit that stopped the work. */
  message: string;
  /** The extension's line for people: who can change it, and where. */
  help: string;
  /** The wiro.ai page that shows the rule or the limit. */
  path: typeof MODEL_ACCESS_PATH | typeof SPEND_LIMITS_PATH;
  /** The label of the button that opens that page. */
  label: string;
}

// The first words of the MCP server's note after Wiro's sentence.
const NOTE_START = /\s*\bA (Model Access rule|spend limit) of this workspace\b/;
// How Wiro's own sentences end when the note is not there.
const MODEL_ACCESS_END = /\bModel Access rules decide which models can run\./;
const SPEND_LIMIT_END = /\bspend limit\b[\s\S]*?\bIt resets (?:at|on)\b[^.]*\bUTC\./;
// What run_model puts before Wiro's sentence.
const RUN_PREFIX = /^Failed to run model:\s*/i;
// Work with a known price that does not fit what is left: "has $3.10 left of $5.00, and this run costs $4.00."
const LEFT_OF = /\bhas \$\d[\d,]*(?:\.\d+)? left of\b/;

const CHANGERS = 'The account owner, a team admin or the organization owner';

/** The refusal in a tool error's text, or undefined when the text is not one. */
export function readRefusal(text: string): ControlsRefusal | undefined {
  const body = text.trim().replace(RUN_PREFIX, '');
  const note = NOTE_START.exec(body);
  if (note) {
    const code = note[1] === 'Model Access rule' ? MODEL_ACCESS_CODE : SPEND_LIMIT_CODE;
    return refusal(code, body.slice(0, note.index));
  }
  const ruleEnd = MODEL_ACCESS_END.exec(body);
  if (ruleEnd) return refusal(MODEL_ACCESS_CODE, body.slice(0, ruleEnd.index + ruleEnd[0].length));
  const limitEnd = SPEND_LIMIT_END.exec(body);
  if (limitEnd) return refusal(SPEND_LIMIT_CODE, body.slice(0, limitEnd.index + limitEnd[0].length));
  return undefined;
}

function refusal(code: ControlsRefusal['code'], wiroText: string): ControlsRefusal {
  const rule = code === MODEL_ACCESS_CODE;
  const message = wiroText.trim()
    || (rule ? 'A Model Access rule blocks this model.' : 'A spend limit has no room for this.');
  const lines: string[] = [];
  // The panel signs in without an API key, but its runs use the key of the project picked at sign-in.
  if (/\bAPI key\b/.test(message)) lines.push('This extension runs with the API key of the project you chose when you signed in.');
  lines.push('Nothing was charged.');
  if (rule) lines.push(`${CHANGERS} can change this rule on the Model Access page.`);
  else if (LEFT_OF.test(message)) lines.push(`A cheaper setting may fit what is left, or ${CHANGERS.toLowerCase()} can raise this limit on the Spend Limits page.`);
  else lines.push(`${CHANGERS} can raise this limit on the Spend Limits page.`);
  return {
    code,
    message,
    help: lines.join(' '),
    path: rule ? MODEL_ACCESS_PATH : SPEND_LIMITS_PATH,
    label: rule ? 'Open Model Access' : 'Open Spend Limits',
  };
}
