// ToolInputForm — render a typed form for any MCP tool's input_schema.
//
// Pure presentational. Parent owns the values + setter. Submit + cancel
// stay on the parent — this component only renders the fields.
//
// Pair with lib/toolSchema.ts which derives FieldSpec[] from a tool
// record and coerces form values back to the JSON shape the MCP server
// expects.
//
// Usage:
//   const fields = useMemo(() => fieldsForTool(tool), [tool]);
//   const [values, setValues] = useState(() => initialValuesFor(fields));
//   ...
//   <ToolInputForm fields={fields} values={values} onChange={setValues} />
//   <button onClick={() => {
//     const inputs = coerceFormValues(fields, values);    // throws on invalid
//     await runTool(tool.name, inputs);
//   }}>Run</button>
//
// Theming follows the project's CSS variables (--bg0, --border, --text,
// --accent, --bad). Drop-in for either the dark or light Figma theme.

import type { FieldSpec } from "../lib/toolSchema";

export interface ToolInputFormProps {
  fields: FieldSpec[];
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  /** Optional disabled flag — disables every field at once (e.g. while submitting). */
  disabled?: boolean;
}

export function ToolInputForm({ fields, values, onChange, disabled }: ToolInputFormProps) {
  if (fields.length === 0) {
    return (
      <div className="text-xs" style={{ opacity: 0.6, fontStyle: "italic" }}>
        This tool takes no inputs.
      </div>
    );
  }

  const update = (key: string, value: any) =>
    onChange({ ...values, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <label className="text-xs" style={{ opacity: 0.85, fontWeight: 600 }}>
            {f.label}
            {f.required && <span style={{ color: "var(--bad, #ff8888)", marginLeft: 4 }}>*</span>}
            <span className="ml-1" style={{ opacity: 0.5, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
              {f.kind}{f.kind === "array" ? `<${f.itemKind ?? "string"}>` : ""}
            </span>
          </label>
          {f.description && (
            <div className="text-xs" style={{ opacity: 0.7, lineHeight: 1.4 }}>
              {f.description}
            </div>
          )}
          <FieldInput field={f} value={values[f.key]} onChange={(v) => update(f.key, v)} disabled={disabled} />
        </div>
      ))}
    </div>
  );
}

interface FieldInputProps {
  field: FieldSpec;
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
}

function FieldInput({ field, value, onChange, disabled }: FieldInputProps) {
  const baseStyle: React.CSSProperties = {
    background: "var(--bg0)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    width: "100%",
    fontFamily: field.kind === "object" ? "ui-monospace, monospace" : undefined,
  };

  if (field.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-xs" style={{ opacity: 0.9 }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span>{value ? "true" : "false"}</span>
      </label>
    );
  }

  if (field.kind === "enum") {
    return (
      <select
        style={baseStyle}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {!field.required && <option value="">(unset)</option>}
        {(field.enumValues ?? []).map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    );
  }

  if (field.kind === "object") {
    return (
      <textarea
        style={{ ...baseStyle, minHeight: 80 }}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder='{"key": "value"}'
      />
    );
  }

  if (field.kind === "integer" || field.kind === "number") {
    return (
      <input
        type="number"
        step={field.kind === "integer" ? 1 : "any"}
        min={field.minimum}
        max={field.maximum}
        style={baseStyle}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={field.default !== undefined ? String(field.default) : ""}
      />
    );
  }

  if (field.kind === "array") {
    return (
      <input
        type="text"
        style={baseStyle}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={`comma-separated ${field.itemKind ?? "string"}s — e.g. a, b, c`}
      />
    );
  }

  // string + default
  return (
    <input
      type="text"
      style={baseStyle}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={field.default !== undefined ? String(field.default) : ""}
    />
  );
}
