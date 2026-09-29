import { expect, it } from 'vitest';
import { speaksPoData } from './po-data.js';

it('spots PO data: code with supplier, status, amount or date', () => {
  expect(speaksPoData('Purchase order one zero four eight two from Summit Fasteners')).toBe(true);
  expect(speaksPoData('It has shipped.')).toBe(true);
  expect(speaksPoData('forty-five thousand euros')).toBe(true);
  expect(speaksPoData('due on October twenty-fourth, twenty twenty-six')).toBe(true);
});

it('ignores acknowledgements and questions', () => {
  expect(speaksPoData('Let me check that.')).toBe(false);
  expect(speaksPoData('Sure.')).toBe(false);
  expect(speaksPoData("Sorry, I didn't catch a purchase order code.")).toBe(false);
});
