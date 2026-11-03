import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { NumberField } from "@base-ui/react/number-field";

export function mountImprovementControls(container, { state, onChange }) {
  const root = createRoot(container);
  const h = React.createElement;
  const subscribe = callback => {
    window.addEventListener("improvement-settings-change", callback);
    return () => window.removeEventListener("improvement-settings-change", callback);
  };
  function Control({ index }) {
    const value = useSyncExternalStore(subscribe, () => state.improvementPercentages[index]);
    const label = index === 0 ? "First scenario" : "Second scenario";
    return h("div", { className: "improvement-control" },
      h("span", { className: "improvement-label" }, label),
      h(NumberField.Root, { value, min: 1, max: 99, step: 1, onValueChange: next => {
        if (Number.isInteger(next) && next >= 1 && next <= 99 && next !== value) onChange(index, next);
      } },
      h(NumberField.Group, { className: "improvement-number" },
        h(NumberField.Decrement, { className: "improvement-step", "aria-label": `Decrease ${label.toLowerCase()}` }, h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", "aria-hidden": true }, h("path", { d: "M5 12h14" }))),
        h("span", { className: "improvement-value" },
          h(NumberField.Input, { "aria-label": `${label} percentage`, className: "improvement-input" }),
          h("span", { className: "improvement-unit", "aria-hidden": true }, "%")),
        h(NumberField.Increment, { className: "improvement-step", "aria-label": `Increase ${label.toLowerCase()}` }, h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", "aria-hidden": true }, h("path", { d: "M5 12h14M12 5v14" }))))));
  }
  root.render(h(React.Fragment, null, h(Control, { index: 0 }), h(Control, { index: 1 })));
  return () => root.unmount();
}
