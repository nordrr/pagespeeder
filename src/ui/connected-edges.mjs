export function createConnectedEdgeShadow(container, id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("connected-edge-shadow");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<defs><filter id="${id}-filter" filterUnits="userSpaceOnUse" x="-160" y="-40" width="400"><feGaussianBlur in="SourceAlpha" stdDeviation="2.5" result="blur1"/><feOffset in="blur1" dy="2" result="offset1"/><feFlood flood-color="#101828" flood-opacity=".06" result="color1"/><feComposite in="color1" in2="offset1" operator="in" result="shadow1"/><feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blur2"/><feOffset in="blur2" dy="1" result="offset2"/><feFlood flood-color="#101828" flood-opacity=".04" result="color2"/><feComposite in="color2" in2="offset2" operator="in" result="shadow2"/><feMerge><feMergeNode in="shadow1"/><feMergeNode in="shadow2"/></feMerge></filter><mask id="${id}-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="32"><rect x="0" y="0" width="32" fill="white"/><path fill="black"/></mask></defs><path fill="white" filter="url(#${id}-filter)" mask="url(#${id}-mask)"/>`;
  if (id === "run-edge") {
    const outline = svg.lastElementChild;
    const cover = document.createElementNS("http://www.w3.org/2000/svg", "path");
    cover.classList.add("run-scrollbar-cover");
    cover.setAttribute("fill", "var(--canvas)");
    svg.insertBefore(cover, outline);
    outline.removeAttribute("filter");
    outline.removeAttribute("mask");
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "var(--run-outline)");
    outline.setAttribute("stroke-width", "4");
  }
  container.append(svg);
}

export function updateConnectedEdgeShadow(container, top, bottom, tabLeft = null) {
  const svg = container.querySelector(".connected-edge-shadow");
  if (!svg) return;
  const height = container.clientHeight;
  if (!height) return;
  const runOutline = !container.classList.contains("site-library");
  const width = runOutline ? container.clientWidth + 16 : container.clientWidth;
  if (runOutline && tabLeft !== null) tabLeft += 8;
  const seamX = runOutline ? width - 6 : width;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.querySelector("filter").setAttribute("height", height + 80);
  svg.querySelector("filter").setAttribute("width", width + 320);
  svg.querySelector("mask").setAttribute("height", height);
  svg.querySelector("mask").setAttribute("width", width);
  svg.querySelector("mask rect").setAttribute("height", height);
  svg.querySelector("mask rect").setAttribute("width", width);
  const hasTab = bottom > 18 && top < height && top >= 18;
  const edge = hasTab && runOutline
    ? `V ${bottom + 18} Q ${width} ${bottom} ${width - 18} ${bottom} H ${tabLeft + 16} Q ${tabLeft} ${bottom} ${tabLeft} ${bottom - 16} V ${top + 16} Q ${tabLeft} ${top} ${tabLeft + 16} ${top} H ${width - 18} Q ${width} ${top} ${width} ${top - 18}`
    : hasTab
      ? `V ${bottom + 18} Q ${width} ${bottom} ${width - 18} ${bottom} H ${tabLeft + 18} Q ${tabLeft} ${bottom} ${tabLeft} ${bottom - 18} V ${top + 18} Q ${tabLeft} ${top} ${tabLeft + 18} ${top} H ${width - 18} Q ${width} ${top} ${width} ${top - 18}`
      : "";
  const bottomEdge = runOutline ? `V ${height} H ${width + 18} Q ${width} ${height} ${width} ${height - 18}` : `V ${height + 20} H ${width}`;
  const path = `M ${width + 18} 0 H ${width + 168} ${bottomEdge} ${edge} V 18 Q ${width} 0 ${width + 18} 0 Z`;
  svg.querySelector("mask path").setAttribute("d", path);
  const tabOutline = hasTab && runOutline
    ? `M ${seamX} ${top - 22} V ${top - 18} Q ${seamX} ${top} ${seamX - 18} ${top} H ${tabLeft + 16} Q ${tabLeft} ${top} ${tabLeft} ${top + 16} V ${bottom - 16} Q ${tabLeft} ${bottom} ${tabLeft + 16} ${bottom} H ${seamX - 18} Q ${seamX} ${bottom} ${seamX} ${bottom + 18} V ${bottom + 22}`
    : "";
  if (runOutline) {
    const cover = hasTab
      ? `M ${seamX - 16} ${top - 18} H ${seamX} V ${bottom + 18} H ${seamX - 16} Z`
      : "";
    svg.querySelector(".run-scrollbar-cover").setAttribute("d", cover);
  }
  svg.lastElementChild.setAttribute("d", runOutline ? tabOutline : path);
}

