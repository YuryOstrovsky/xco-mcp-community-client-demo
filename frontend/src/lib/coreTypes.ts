// Shared cross-module types — types that need to be referenced from
// both App.tsx and the extracted feature/view files. Lives in lib/ to
// avoid circular imports.

export type ToolDef = {
  name: string;
  description?: string;
  category?: string;
  method?: string;
  endpoint?: { host?: string; path?: string };
  input_schema?: any;
};
