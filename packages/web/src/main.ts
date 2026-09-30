import type { Trace } from 'traces/src/schema.js';
import { brandMark, el } from './dom.js';
import { loadFile } from './load.js';
import { renderTrace } from './render.js';
import './style.css';

const app = document.querySelector('main') as HTMLElement;
const errors = el('div', 'errors');
errors.setAttribute('role', 'alert');
const output = el('div', 'output');

async function show(loading: Promise<Trace>[]) {
  errors.replaceChildren();
  output.replaceChildren();
  for (const result of await Promise.allSettled(loading)) {
    if (result.status === 'fulfilled') output.append(renderTrace(result.value));
    else errors.append(el('p', 'error', String(result.reason.message)));
  }
}

const showFiles = (files: File[]) => show(files.map(loadFile));

function filePicker(): HTMLElement {
  const input = el('input', '') as HTMLInputElement;
  input.type = 'file';
  input.accept = '.json,application/json';
  input.multiple = true;
  input.addEventListener('change', () => showFiles([...(input.files ?? [])]));
  return el('label', 'picker', 'Open trace files: ', input);
}

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  showFiles([...(event.dataTransfer?.files ?? [])]);
});

const controls = el('div', 'controls panel upload-panel', filePicker());
app.append(
  el(
    'header',
    'page-header',
    el('div', 'brand', brandMark(), el('h1', '', 'Supplier Line trace viewer')),
    el('p', 'muted', 'Drop trace JSON files anywhere on this page, or use a picker.')
  ),
  controls,
  errors,
  output
);
