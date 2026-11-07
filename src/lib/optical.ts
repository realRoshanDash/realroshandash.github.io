/**
 * Optical margin alignment, precomputed (design spec §2.3.5). Left side bearings of Inter at opsz 32, in em, for
 * weight 700 and weight 200, measured with fontTools on the shipped file. Display text shifts left by its first
 * glyph's bearing so the *ink* sits on the column line: emit `style={lsbStyle(text)}` and the .t-* classes apply
 * `margin-left: calc(-1em * var(--lsb))`. Nothing is measured at runtime, so nothing moves after first paint.
 */
const LSB: Record<string, readonly [bold: number, thin: number]> = {
  A: [0.004, 0.01], B: [0.054, 0.079], C: [0.031, 0.042], D: [0.054, 0.079], E: [0.054, 0.079], F: [0.054, 0.079],
  G: [0.031, 0.042], H: [0.054, 0.079], I: [0.054, 0.079], J: [0.029, 0.048], K: [0.054, 0.079], L: [0.054, 0.079],
  M: [0.054, 0.079], N: [0.054, 0.079], O: [0.031, 0.042], P: [0.054, 0.079], Q: [0.031, 0.042], R: [0.054, 0.079],
  S: [0.034, 0.043], T: [0.022, 0.028], U: [0.053, 0.068], V: [0.004, 0.01], W: [0.004, 0.01], X: [0.006, 0.012],
  Y: [0.004, 0.01], Z: [0.026, 0.034],
  '0': [0.031, 0.035], '1': [0.019, 0.035], '2': [0.036, 0.044], '3': [0.035, 0.038], '4': [0.029, 0.029],
  '5': [0.029, 0.034], '6': [0.031, 0.035], '7': [0.022, 0.028], '8': [0.031, 0.035], '9': [0.031, 0.035],
};

/** Left side bearing (em) of the first character of `text`; 0 when unknown or below 0.01em. */
export function opticalLsb(text: string, weight: 'bold' | 'thin' = 'bold'): number {
  const first = text.trim().charAt(0);
  const pair = LSB[first];
  if (!pair) return 0;
  const value = pair[weight === 'bold' ? 0 : 1];
  return value < 0.01 ? 0 : value;
}

/** Inline style that feeds the precomputed bearing to the .t-page / .t-display / .t-post / .t-numeral classes. */
export function lsbStyle(text: string, weight: 'bold' | 'thin' = 'bold'): string | undefined {
  const value = opticalLsb(text, weight);
  return value ? `--lsb:${value}` : undefined;
}
