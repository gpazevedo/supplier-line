const PO_DATA = [
  /\bpurchase order (P O dash )?[a-z -]+ from [A-Z]/i,
  /\b(has shipped|is delayed|was delivered|was cancelled)\b/i,
  /\b(euros|dollars|pounds)\b/i,
  /\b(January|February|March|April|May|June|July|August|September|October|November|December) [a-z-]+(st|nd|rd|th)\b/,
];

/**
 * True when agent text speaks PO data: a code with its supplier, a status, an amount or a date.
 * The grounded-po-data check and the host's answer guard share it.
 */
export function speaksPoData(text: string): boolean {
  return PO_DATA.some((pattern) => pattern.test(text));
}
