type Child = Node | string;

/** Creates an element with a class and children; strings become text nodes, so nothing is parsed as HTML. */
export function el(tag: string, className: string, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}
