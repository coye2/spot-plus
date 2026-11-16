// Real-time pitch shifter (two crossfaded delay taps, the classic "Doppler" method).
// ratio 1 = unchanged; 2 = one octave up; 0.5 = one octave down. Tempo is untouched.
class SpotPlusPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate'}]; }
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.06); // 60 ms window
    this.buffers = [new Float32Array(this.size * 4), new Float32Array(this.size * 4)];
    this.write = 0; this.phase = 0;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0], ratio = params.ratio[0], length = this.buffers[0].length, size = this.size;
    if (!input.length) return true;
    const frames = output[0].length;
    if (Math.abs(ratio - 1) < 1e-3) { // Bypass: copy straight through, keep the buffer fresh.
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0], buf = this.buffers[c] || this.buffers[0];
        for (let i = 0; i < frames; i++) { output[c][i] = src[i]; buf[(this.write + i) % length] = src[i]; }
      }
      this.write = (this.write + frames) % length;
      return true;
    }
    const step = (1 - ratio) / size;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < output.length; c++) (this.buffers[c] || this.buffers[0])[this.write] = (input[c] || input[0])[i];
      this.phase = (this.phase + step + 1) % 1;
      const p2 = (this.phase + 0.5) % 1;
      const g1 = Math.sin(Math.PI * this.phase) ** 2, g2 = Math.sin(Math.PI * p2) ** 2; // sums to 1: no volume wobble
      const d1 = this.phase * size + 2, d2 = p2 * size + 2;
      for (let c = 0; c < output.length; c++) {
        const buf = this.buffers[c] || this.buffers[0];
        output[c][i] = g1 * read(buf, this.write - d1, length) + g2 * read(buf, this.write - d2, length);
      }
      this.write = (this.write + 1) % length;
    }
    return true;
  }
}
function read(buf, pos, length) {
  const p = ((pos % length) + length) % length, i = Math.floor(p), f = p - i;
  return buf[i] * (1 - f) + buf[(i + 1) % length] * f;
}
registerProcessor('spotplus-pitch', SpotPlusPitch);
