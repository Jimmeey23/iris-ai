import { describe, expect, it } from "vitest";
import { buildTemplateSendComponents, extractTemplateVariables } from "./whatsapp-templates";

describe("extractTemplateVariables", () => {
  it("finds a single body placeholder", () => {
    const vars = extractTemplateVariables([
      { type: "body", text: "Here's your {{1}} schedule for the week." },
    ]);
    expect(vars).toEqual([
      {
        componentIndex: 0,
        componentType: "body",
        placeholderIndex: 1,
        key: "body:0:1",
        label: "Body variable 1",
      },
    ]);
  });

  it("finds a button URL placeholder with its button index", () => {
    const vars = extractTemplateVariables([
      { type: "body", text: "To complete your transaction, click below." },
      {
        type: "buttons",
        buttons: [{ type: "url", text: "Pay Now", url: "https://buy.stripe.com/{{1}}" }],
      },
    ]);
    expect(vars).toEqual([
      {
        componentIndex: 1,
        componentType: "buttons",
        buttonIndex: 0,
        placeholderIndex: 1,
        key: "button:1:0:1",
        label: 'Button "Pay Now" link',
      },
    ]);
  });

  it("returns no variables for a template with no placeholders", () => {
    const vars = extractTemplateVariables([{ type: "body", text: "No variables here." }]);
    expect(vars).toEqual([]);
  });

  it("handles multiple buttons, only assigning variables to the one that has them", () => {
    const vars = extractTemplateVariables([
      {
        type: "buttons",
        buttons: [
          { type: "url", text: "Download Pdf", url: "https://static.example.com/schedule.pdf" },
          { type: "url", text: "View Schedule", url: "https://example.com/schedule/{{1}}" },
        ],
      },
    ]);
    expect(vars).toEqual([
      {
        componentIndex: 0,
        componentType: "buttons",
        buttonIndex: 1,
        placeholderIndex: 1,
        key: "button:0:1:1",
        label: 'Button "View Schedule" link',
      },
    ]);
  });
});

describe("buildTemplateSendComponents", () => {
  it("builds a body component with parameters in placeholder order", () => {
    const vars = extractTemplateVariables([
      { type: "body", text: "Hi {{1}}, your {{2}} is ready." },
    ]);
    const result = buildTemplateSendComponents(vars, { "body:0:1": "Jimmy", "body:0:2": "order" });
    expect(result).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Jimmy" }, { type: "text", text: "order" }] },
    ]);
  });

  it("builds a button component with sub_type url and its index", () => {
    const vars = extractTemplateVariables([
      { type: "body", text: "Pay now." },
      { type: "buttons", buttons: [{ type: "url", text: "Pay", url: "https://pay.example.com/{{1}}" }] },
    ]);
    const result = buildTemplateSendComponents(vars, { "button:1:0:1": "abc123" });
    expect(result).toEqual([
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc123" }] },
    ]);
  });

  it("fills missing values with empty string rather than throwing", () => {
    const vars = extractTemplateVariables([{ type: "body", text: "Hi {{1}}." }]);
    const result = buildTemplateSendComponents(vars, {});
    expect(result).toEqual([{ type: "body", parameters: [{ type: "text", text: "" }] }]);
  });
});
