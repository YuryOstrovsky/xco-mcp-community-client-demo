// toolSchema — derive form fields + input coercion from an MCP tool's
// JSON Schema (`input_schema`). The reference-design pattern: any
// operator UI that wants to invoke an arbitrary MCP tool can use this
// to render a typed input form WITHOUT hand-curating per tool.
//
// MCP tool catalog entry shape:
//   { name, description, input_schema: { type, properties, required? } }
//
// Each property has a JSON Schema like:
//   { type: "string", description: "..." }
//   { type: "integer", default: 5, minimum: 1, maximum: 100 }
//   { type: "boolean", default: false }
//   { type: "array", items: { type: "string" }, description: "Switch IPs" }
//   { type: "object", properties: {...} }
//
// We project to the smallest set of UI field types that cover the MCP
// tool catalog as it exists today:
//   string  → text input
//   integer → numeric input (clamped to min/max if present)
//   number  → numeric input (allows decimals)
//   boolean → checkbox
//   array   → comma-separated text (split + trim per item)
//   object  → JSON textarea (rare — most tools take flat objects)
//   enum    → select dropdown (any type with .enum array)
//
// The companion <ToolInputForm> component in components/ToolInputForm.tsx
// renders these field defs. coerceFormValues() converts the form's raw
// string/bool/number values back into the JSON shape the MCP server
// expects (e.g. comma-separated list → array of trimmed strings).

export type FieldKind =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "enum";

/** JSON Schema's `default` can be any JSON value; we don't constrain it
 *  here because the schema authors don't constrain it either. Callers
 *  narrow when rendering. */
export type SchemaDefault = string | number | boolean | null | unknown[] | Record<string, unknown>;

/** Shape of a single property in an MCP tool's JSON Schema. Each
 *  property is itself a JSON Schema object — the canonical fields we
 *  consume are listed; everything else is allowed via the index signature. */
export interface SchemaProp {
  type?: string;
  description?: string;
  default?: SchemaDefault;
  enum?: unknown[];
  items?: { type?: string };
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  required: boolean;
  label: string;
  description?: string;
  default?: SchemaDefault;
  /** For arrays: the item type (defaults to "string"). */
  itemKind?: "string" | "integer" | "number";
  /** For enums: the allowed values. */
  enumValues?: string[];
  /** For numerics: clamping bounds. */
  minimum?: number;
  maximum?: number;
}

export interface ToolRecord {
  name: string;
  description?: string;
  input_schema?: {
    type?: string;
    properties?: Record<string, SchemaProp>;
    required?: string[];
  };
}

/** Turn an MCP tool record into ordered form-field definitions. */
export function fieldsForTool(tool: ToolRecord): FieldSpec[] {
  const schema = tool.input_schema ?? {};
  const props = (schema.properties ?? {}) as Record<string, SchemaProp>;
  const required = new Set(schema.required ?? []);
  const out: FieldSpec[] = [];
  for (const [key, p] of Object.entries(props)) {
    out.push(propToField(key, p, required.has(key)));
  }
  return out;
}

function propToField(key: string, p: SchemaProp, required: boolean): FieldSpec {
  const description = typeof p?.description === "string" ? p.description : undefined;
  const label = humanLabel(key);
  const dflt = p?.default;

  // Enum is independent of type — recognize it first.
  if (Array.isArray(p?.enum)) {
    return {
      key, kind: "enum", required, label, description,
      default: dflt, enumValues: p.enum.map(String),
    };
  }

  const t = p?.type;
  if (t === "boolean") {
    return { key, kind: "boolean", required, label, description, default: dflt };
  }
  if (t === "integer") {
    return {
      key, kind: "integer", required, label, description,
      default: dflt, minimum: numOrUndef(p?.minimum), maximum: numOrUndef(p?.maximum),
    };
  }
  if (t === "number") {
    return {
      key, kind: "number", required, label, description,
      default: dflt, minimum: numOrUndef(p?.minimum), maximum: numOrUndef(p?.maximum),
    };
  }
  if (t === "array") {
    const itemType = p?.items?.type;
    const itemKind: FieldSpec["itemKind"] =
      itemType === "integer" ? "integer"
      : itemType === "number" ? "number"
      : "string";
    return { key, kind: "array", required, label, description, default: dflt, itemKind };
  }
  if (t === "object") {
    return { key, kind: "object", required, label, description, default: dflt };
  }
  // Fallback: string
  return { key, kind: "string", required, label, description, default: dflt };
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function humanLabel(key: string): string {
  // switch_ip → "Switch ip"  · switch_ips → "Switch ips" · max_items → "Max items"
  // Good enough for ops UI; tools with awkward keys can be overridden by the
  // caller before rendering.
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bIp\b/g, "IP")        // common ops terms
    .replace(/\bUrl\b/g, "URL")
    .replace(/\bId\b/g, "ID");
}

/** Build initial form-state values from the field defs, honoring defaults.
 *  Return type is `Record<string, unknown>` because form values are a
 *  mix of strings (raw text inputs), booleans (checkboxes), and other
 *  shapes; the caller's form state hook narrows as needed. */
export function initialValuesFor(fields: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) {
      // Special case: arrays default → join with comma so the user sees a
      // CSV in the text field.
      if (f.kind === "array" && Array.isArray(f.default)) {
        out[f.key] = f.default.join(", ");
      } else if (f.kind === "object") {
        out[f.key] = typeof f.default === "object" ? JSON.stringify(f.default, null, 2) : String(f.default);
      } else {
        out[f.key] = f.default;
      }
    } else if (f.kind === "boolean") {
      out[f.key] = false;
    } else {
      out[f.key] = "";   // string / integer / number / array as raw text
    }
  }
  return out;
}

/** Coerce form values back into the JSON shape MCP expects.
 *
 *  Omits empty optional fields entirely so the server's tool defaults
 *  kick in. Numeric/array fields get parsed; invalid values throw with
 *  the key in the message so the caller can highlight the bad field. */
export function coerceFormValues(
  fields: FieldSpec[],
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = raw[f.key];
    const isEmpty =
      v === undefined ||
      v === null ||
      (typeof v === "string" && v.trim() === "");
    if (isEmpty) {
      if (f.required) throw new Error(`Field "${f.key}" is required`);
      continue;
    }
    out[f.key] = coerceOne(f, v);
  }
  return out;
}

function coerceOne(f: FieldSpec, v: unknown): unknown {
  switch (f.kind) {
    case "boolean":
      return Boolean(v);
    case "integer": {
      const n = parseInt(String(v).trim(), 10);
      if (!Number.isFinite(n)) throw new Error(`Field "${f.key}" must be an integer`);
      if (f.minimum !== undefined && n < f.minimum) throw new Error(`Field "${f.key}" must be >= ${f.minimum}`);
      if (f.maximum !== undefined && n > f.maximum) throw new Error(`Field "${f.key}" must be <= ${f.maximum}`);
      return n;
    }
    case "number": {
      const n = parseFloat(String(v).trim());
      if (!Number.isFinite(n)) throw new Error(`Field "${f.key}" must be a number`);
      if (f.minimum !== undefined && n < f.minimum) throw new Error(`Field "${f.key}" must be >= ${f.minimum}`);
      if (f.maximum !== undefined && n > f.maximum) throw new Error(`Field "${f.key}" must be <= ${f.maximum}`);
      return n;
    }
    case "array": {
      const parts = String(v).split(",").map((s) => s.trim()).filter(Boolean);
      if (f.itemKind === "integer") {
        return parts.map((p) => {
          const n = parseInt(p, 10);
          if (!Number.isFinite(n)) throw new Error(`Field "${f.key}" item "${p}" must be an integer`);
          return n;
        });
      }
      if (f.itemKind === "number") {
        return parts.map((p) => {
          const n = parseFloat(p);
          if (!Number.isFinite(n)) throw new Error(`Field "${f.key}" item "${p}" must be a number`);
          return n;
        });
      }
      return parts;   // strings
    }
    case "object": {
      try {
        const parsed = JSON.parse(String(v));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("not a JSON object");
        }
        return parsed;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Field "${f.key}" must be a JSON object (${msg})`);
      }
    }
    case "enum":
    case "string":
    default:
      return String(v);
  }
}
