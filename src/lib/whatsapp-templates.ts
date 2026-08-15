export type TemplateComponent = Record<string, unknown>;

export type TemplateVariable = {
  /** Index into the template's components array. */
  componentIndex: number;
  componentType: string;
  /** For a "buttons" component, which button within its `buttons` array (0-based). */
  buttonIndex?: number;
  /** Which {{n}} placeholder this is within the text (1-based, WhatsApp convention). */
  placeholderIndex: number;
  /** Stable key for form state. */
  key: string;
  /** Short label for the input, e.g. "Body variable 1" or "Button 1 (Pay Now) link". */
  label: string;
};

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;

function variablesInText(text: string): number[] {
  const found: number[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const n = Number(match[1]);
    if (!seen.has(n)) {
      seen.add(n);
      found.push(n);
    }
  }
  return found;
}

/** Scan a synced template's components for {{n}} placeholders, in component/button order. */
export function extractTemplateVariables(components: TemplateComponent[]): TemplateVariable[] {
  const vars: TemplateVariable[] = [];

  components.forEach((component, componentIndex) => {
    const type = String(component.type ?? "body");

    if (type === "buttons" && Array.isArray(component.buttons)) {
      (component.buttons as Record<string, unknown>[]).forEach((button, buttonIndex) => {
        const url = typeof button.url === "string" ? button.url : "";
        for (const placeholderIndex of variablesInText(url)) {
          vars.push({
            componentIndex,
            componentType: type,
            buttonIndex,
            placeholderIndex,
            key: `button:${componentIndex}:${buttonIndex}:${placeholderIndex}`,
            label: `Button "${typeof button.text === "string" ? button.text : buttonIndex + 1}" link`,
          });
        }
      });
      return;
    }

    const text = typeof component.text === "string" ? component.text : "";
    for (const placeholderIndex of variablesInText(text)) {
      vars.push({
        componentIndex,
        componentType: type,
        placeholderIndex,
        key: `${type}:${componentIndex}:${placeholderIndex}`,
        label: `${type.charAt(0).toUpperCase()}${type.slice(1)} variable ${placeholderIndex}`,
      });
    }
  });

  return vars;
}

export type TemplateSendComponent = {
  type: string;
  sub_type?: string;
  index?: string;
  parameters: { type: "text"; text: string }[];
};

/**
 * Build the `components` array for the "Send a message" API's whatsapp_template
 * payload — one entry per component/button that has variables, each with a
 * `parameters` array in placeholder order. Button variables get their own entry
 * with `type: "button"`, `sub_type: "url"` and the button's 0-based `index`,
 * per WhatsApp's template component convention.
 */
export function buildTemplateSendComponents(
  variables: TemplateVariable[],
  values: Record<string, string>,
): TemplateSendComponent[] {
  const bodyLike = new Map<number, TemplateVariable[]>();
  const buttons: TemplateVariable[] = [];

  for (const v of variables) {
    if (v.componentType === "buttons") {
      buttons.push(v);
    } else {
      const list = bodyLike.get(v.componentIndex) ?? [];
      list.push(v);
      bodyLike.set(v.componentIndex, list);
    }
  }

  const result: TemplateSendComponent[] = [];

  for (const componentIndex of [...bodyLike.keys()].sort((a, b) => a - b)) {
    const ordered = [...bodyLike.get(componentIndex)!].sort((a, b) => a.placeholderIndex - b.placeholderIndex);
    result.push({
      type: ordered[0].componentType,
      parameters: ordered.map((v) => ({ type: "text", text: values[v.key] ?? "" })),
    });
  }

  const byButtonIndex = new Map<number, TemplateVariable[]>();
  for (const v of buttons) {
    const list = byButtonIndex.get(v.buttonIndex!) ?? [];
    list.push(v);
    byButtonIndex.set(v.buttonIndex!, list);
  }
  for (const buttonIndex of [...byButtonIndex.keys()].sort((a, b) => a - b)) {
    const ordered = [...byButtonIndex.get(buttonIndex)!].sort((a, b) => a.placeholderIndex - b.placeholderIndex);
    result.push({
      type: "button",
      sub_type: "url",
      index: String(buttonIndex),
      parameters: ordered.map((v) => ({ type: "text", text: values[v.key] ?? "" })),
    });
  }

  return result;
}
