// Display-space color grading baked into a small 3D LUT. The composite pass
// does one 3D texture lookup per pixel, so a grade costs the same whether it
// is a simple contrast curve or a full split-tone. Pure functions: the LUT is
// built on the CPU (32^3 texels, ~1 ms) whenever the time of day changes.

export const LUT_SIZE = 32;

export const NEUTRAL_GRADE = Object.freeze({
  lift: [0, 0, 0],
  gamma: 1,
  gain: [1, 1, 1],
  contrast: 1,
  pivot: 0.43,
  saturation: 1,
  shadowTint: [0, 0, 0],
  shadowAmount: 0,
  highlightTint: [0, 0, 0],
  highlightAmount: 0,
  // Linear-light white balance applied before tone mapping.
  whiteBalance: [1, 1, 1],
});

const TIME_GRADES = {
  // cool, airy light; cream highlights from low eastern sun
  morning: {
    contrast: 1.04, saturation: 1.03, gamma: 1.01,
    shadowTint: [0.42, 0.55, 0.68], shadowAmount: 0.05,
    highlightTint: [1, 0.93, 0.8], highlightAmount: 0.04,
    whiteBalance: [0.99, 1, 1.02],
  },
  // neutral and crisp
  noon: {
    contrast: 1.06, saturation: 1.05,
    shadowTint: [0.48, 0.55, 0.62], shadowAmount: 0.025,
    highlightTint: [1, 0.96, 0.9], highlightAmount: 0.02,
    whiteBalance: [1, 1, 1],
  },
  // golden hour: amber highlights against slightly teal shadows
  sunset: {
    contrast: 1.08, saturation: 1.08, gamma: 1.02,
    gain: [1.02, 1, 0.97],
    shadowTint: [0.3, 0.5, 0.55], shadowAmount: 0.06,
    highlightTint: [1, 0.78, 0.5], highlightAmount: 0.08,
    whiteBalance: [1.03, 1, 0.95],
  },
  // blue night shadows, warm practical highlights, a little lift so dark
  // wood does not crush to black
  night: {
    contrast: 1.07, saturation: 0.98, gamma: 1.06,
    lift: [0.012, 0.014, 0.022],
    shadowTint: [0.25, 0.35, 0.62], shadowAmount: 0.09,
    highlightTint: [1, 0.76, 0.5], highlightAmount: 0.07,
    whiteBalance: [0.98, 1, 1.03],
  },
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const luma = ([r, g, b]) => r * 0.2126 + g * 0.7152 + b * 0.0722;

export function gradeForTheme(theme = {}) {
  const base = TIME_GRADES[theme.timeOfDay] ?? TIME_GRADES.noon;
  let grade = { ...NEUTRAL_GRADE, ...base };
  if (theme.rain) {
    // overcast/wet: flatter, cooler, less saturated
    grade = {
      ...grade,
      saturation: grade.saturation * 0.9,
      contrast: grade.contrast * 0.98,
      shadowTint: [0.32, 0.42, 0.58],
      shadowAmount: grade.shadowAmount + 0.03,
      whiteBalance: grade.whiteBalance.map((v, i) => v * [0.98, 1, 1.03][i]),
    };
  }
  return grade;
}

export function gradeColor(rgb, grade = NEUTRAL_GRADE) {
  let c = rgb.map((v, i) => {
    const lifted = v * grade.gain[i] + grade.lift[i] * (1 - v);
    return Math.pow(clamp01(lifted), 1 / grade.gamma);
  });
  c = c.map((v) => (v - grade.pivot) * grade.contrast + grade.pivot);
  const l = luma(c);
  c = c.map((v) => l + (v - l) * grade.saturation);
  if (grade.shadowAmount || grade.highlightAmount) {
    const lc = clamp01(luma(c));
    // fade out toward black so the tint never pushes a channel negative;
    // lift carries the colour of the deepest shadows instead
    const ws = (1 - lc) * (1 - lc) * grade.shadowAmount * Math.min(1, lc * 6);
    const wh = lc * lc * grade.highlightAmount;
    const sl = luma(grade.shadowTint);
    const hl = luma(grade.highlightTint);
    c = c.map((v, i) => v
      + (grade.shadowTint[i] - sl) * ws
      + (grade.highlightTint[i] - hl) * wh);
  }
  return c.map(clamp01);
}

// RGBA8 data for a Data3DTexture: red varies fastest, then green, then blue.
export function buildLutData(grade = NEUTRAL_GRADE, size = LUT_SIZE) {
  const data = new Uint8Array(size * size * size * 4);
  let offset = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const out = gradeColor([r / (size - 1), g / (size - 1), b / (size - 1)], grade);
        data[offset] = Math.round(out[0] * 255);
        data[offset + 1] = Math.round(out[1] * 255);
        data[offset + 2] = Math.round(out[2] * 255);
        data[offset + 3] = 255;
        offset += 4;
      }
    }
  }
  return data;
}
