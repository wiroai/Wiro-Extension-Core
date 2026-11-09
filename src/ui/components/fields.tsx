import type { ModelParameter } from '../../types.js';
import type { CommonValues, ModelSlots, SlotName } from '../../gateway/gateway.js';

// Form fields. Common slots (prompt, duration, quality...) keep their values
// across models; model-specific fields are generic, built from the schema.

const SLOT_LABELS: Partial<Record<SlotName, string>> = {
  duration: 'Length',
  resolution: 'Quality',
  ratio: 'Shape',
  count: 'How many',
  voice: 'Voice',
  language: 'Language',
  sourceLanguage: 'From language',
  negativePrompt: 'Avoid',
};

function Choice({ param, value, onChange }: { param: ModelParameter; value: string | undefined; onChange: (value: string) => void }) {
  const current = value ?? param.default ?? '';
  if (param.options.length > 0 && param.options.length <= 6) {
    return (
      <div class="chips">
        {param.options.map(option => (
          <button type="button" class="chip" aria-pressed={current === option.value} onClick={() => onChange(option.value)}>
            {option.label || option.value}
          </button>
        ))}
      </div>
    );
  }
  if (param.options.length > 0) {
    return (
      <select value={current} onChange={event => onChange((event.currentTarget as HTMLSelectElement).value)}>
        {!current && <option value="">Default</option>}
        {param.options.map(option => <option value={option.value}>{option.label || option.value}</option>)}
      </select>
    );
  }
  const type = param.type.toLowerCase();
  if (type === 'number' || type === 'float') {
    return (
      <input type="number" value={current} min={param.min} max={param.max} step={param.step ?? (type === 'float' ? 0.1 : 1)}
        onInput={event => onChange((event.currentTarget as HTMLInputElement).value)} />
    );
  }
  if (type === 'textarea') {
    return <textarea value={current} placeholder={param.placeholder} onInput={event => onChange((event.currentTarget as HTMLTextAreaElement).value)} />;
  }
  return <input type="text" value={current} placeholder={param.placeholder} onInput={event => onChange((event.currentTarget as HTMLInputElement).value)} />;
}

export function CommonFields(props: {
  slots: ModelSlots;
  values: CommonValues;
  onChange: (values: CommonValues) => void;
  promptMode: 'required' | 'optional' | 'hidden';
  promptHint?: string;
}) {
  const { slots, values, onChange } = props;
  const prompt = slots.named.prompt;
  const showPrompt = prompt && (props.promptMode !== 'hidden' || prompt.required);
  const keys: SlotName[] = ['duration', 'resolution', 'ratio', 'count', 'voice', 'sourceLanguage', 'language'];
  return (
    <>
      {showPrompt && (
        <div class="fld">
          <div class="l">{prompt.required || props.promptMode === 'required' ? 'Prompt' : 'Prompt'} <em>{prompt.required ? 'required' : 'optional'}</em></div>
          <textarea value={values.prompt ?? ''} placeholder={props.promptHint ?? prompt.placeholder}
            onInput={event => onChange({ ...values, prompt: (event.currentTarget as HTMLTextAreaElement).value })} />
        </div>
      )}
      {keys.map(name => {
        const param = slots.named[name];
        if (!param) return null;
        return (
          <div class="fld">
            <div class="l">{SLOT_LABELS[name] ?? param.label}{param.note && <em title={param.note}>?</em>}</div>
            <Choice param={param} value={values[name] as string | undefined} onChange={value => onChange({ ...values, [name]: value })} />
          </div>
        );
      })}
    </>
  );
}

export function SpecificFields(props: { params: ModelParameter[]; values: Record<string, string | boolean>; onChange: (values: Record<string, string | boolean>) => void }) {
  const { params, values, onChange } = props;
  if (params.length === 0) return null;
  return (
    <details class="more-settings">
      <summary><span>More settings</span><span class="mono">{params.length}</span></summary>
      <div class="fields">
        {params.map(param => {
          if (param.type.toLowerCase() === 'checkbox') {
            const checked = values[param.id] ?? Boolean(param.default);
            return (
              <label class="check">
                <input type="checkbox" checked={Boolean(checked)} onChange={event => onChange({ ...values, [param.id]: (event.currentTarget as HTMLInputElement).checked })} />
                {param.label}
              </label>
            );
          }
          return (
            <div class="fld">
              <div class="l">{param.label}{param.required ? <em>required</em> : null}</div>
              <Choice param={param} value={values[param.id] as string | undefined} onChange={value => onChange({ ...values, [param.id]: value })} />
              {param.note && <div class="help">{param.note}</div>}
            </div>
          );
        })}
      </div>
    </details>
  );
}
