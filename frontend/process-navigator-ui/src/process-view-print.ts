/** Expand only this view, then restore each original state even if print is cancelled. */
export function prepareProcessViewPrint(root: ParentNode) {
  const details = [...root.querySelectorAll<HTMLDetailsElement>('details')];
  const states = details.map(element => element.open);
  details.forEach(element => { element.open = true; });
  return () => details.forEach((element, index) => { element.open = states[index]; });
}
