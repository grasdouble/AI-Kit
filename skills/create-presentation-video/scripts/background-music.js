"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SAMPLE_RATE = 48000;
const FADE_IN = 1.2;
const FADE_OUT = 2.8;
const MUSIC_STYLES = {
  electronic: { label: "light electronic", beatsPerMinute: 104 },
  ambient: { label: "ambient", beatsPerMinute: 80 },
  piano: { label: "soft piano", beatsPerMinute: 88 },
  acoustic: { label: "acoustic-inspired", beatsPerMinute: 96 },
};

function validateMusic(music) {
  if (music === undefined) return;
  if (!music || typeof music.enabled !== "boolean" ||
      !Number.isInteger(music.beatsPerMinute) || music.beatsPerMinute < 80 || music.beatsPerMinute > 140 ||
      !Number.isFinite(music.volumeDb) || music.volumeDb < -36 || music.volumeDb > -12) {
    throw new Error("Music requires enabled (boolean), beatsPerMinute (80-140), and volumeDb (-36 to -12).");
  }
  if (music.style !== undefined &&
      (typeof music.style !== "string" || !Object.hasOwn(MUSIC_STYLES, music.style))) {
    throw new Error("Music style must be electronic, ambient, piano, or acoustic.");
  }
}

function synthesizeLoop(music) {
  const style = music.style ?? "electronic";
  const beat = 60 / music.beatsPerMinute;
  const count = Math.round(16 * 4 * beat * SAMPLE_RATE);
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  const chords = [[62, 66, 69, 76], [59, 62, 66, 69], [59, 62, 66, 67], [61, 64, 69, 71]];
  const roots = [38, 35, 43, 45];
  const pattern = [0, 2, 1, 3, 2, 1, 3, 1];
  let seed = 20261016;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const add = (start, duration, gain, pan, sample) => {
    const first = Math.round(start * SAMPLE_RATE);
    const end = first + Math.ceil(duration * SAMPLE_RATE);
    const l = Math.cos((pan + 1) * Math.PI / 4) * gain;
    const r = Math.sin((pan + 1) * Math.PI / 4) * gain;
    for (let index = first; index < end; index += 1) {
      const value = sample((index - first) / SAMPLE_RATE);
      // Wrap release tails into the next cycle to keep loop boundaries continuous.
      left[index % count] += value * l;
      right[index % count] += value * r;
    }
  };
  const tone = (start, duration, note, gain, pan, instrument) => {
    const frequency = 440 * 2 ** ((note - 69) / 12);
    add(start, duration, gain, pan, (t) => {
      const phase = 2 * Math.PI * frequency * t;
      if (instrument === "pad") {
        const envelope = Math.max(0, Math.min(1, t / 0.45, (duration - t) / 0.8));
        return envelope * (0.5 * Math.sin(phase) + 0.5 * Math.sin(phase * 1.0015) +
          0.12 * Math.sin(phase * 2));
      }
      if (instrument === "piano" || instrument === "guitar") {
        const decay = instrument === "piano" ? 2.4 : 3.8;
        const envelope = Math.max(0, Math.min(1, t / 0.006, (duration - t) / 0.1)) *
          Math.exp(-t * decay);
        const harmonics = instrument === "piano" ? [0.32, 0.12, 0.04] : [0.5, 0.22, 0.1];
        return envelope * (Math.sin(phase) + harmonics[0] * Math.sin(phase * 2) +
          harmonics[1] * Math.sin(phase * 3) + harmonics[2] * Math.sin(phase * 4));
      }
      const envelope = Math.min(1, t / 0.008, (duration - t) / 0.04) *
        Math.exp(-t * (instrument === "bass" ? 4 : 6));
      return envelope * (Math.sin(phase) + 0.18 * Math.sin(phase * 2));
    });
  };
  for (let bar = 0; bar < 16; bar += 1) {
    const start = bar * 4 * beat;
    const chordIndex = Math.floor(bar / 2) % chords.length;
    const chord = chords[chordIndex];
    if (style === "ambient") {
      if (bar % 2 === 0) {
        chord.forEach((note, index) => tone(start, beat * 8 + 0.6, note, 0.085,
          [-0.7, -0.25, 0.25, 0.7][index], "pad"));
      }
      tone(start + beat, beat * 3, chord[bar % chord.length] + 12, 0.035, 0.35, "piano");
      continue;
    }
    if (style === "piano") {
      for (let step = 0; step < 4; step += 1) {
        tone(start + step * beat, beat * 3, chord[step], 0.16, (step - 1.5) / 4, "piano");
      }
      tone(start, beat * 4, roots[chordIndex] + 12, 0.12, -0.3, "piano");
      continue;
    }
    if (style === "acoustic") {
      for (const offset of [0, 2]) {
        chord.forEach((note, index) => tone(start + offset * beat + index * 0.035,
          beat * 2, note, 0.105, (index - 1.5) / 4, "guitar"));
      }
      tone(start + beat, beat * 2, roots[chordIndex] + 12, 0.16, 0, "guitar");
      tone(start + beat * 3, beat * 2, chord[2], 0.09, 0.25, "guitar");
      continue;
    }
    if (bar % 2 === 0) {
      chord.forEach((note, index) => tone(start, beat * 8 + 0.6, note, 0.065,
        [-0.65, -0.2, 0.2, 0.65][index], "pad"));
    }
    for (const offset of [0, 2]) tone(start + offset * beat, beat * 0.9, roots[chordIndex], 0.13, 0, "bass");
    for (let step = 0; step < 8; step += 1) {
      if (step === 7 && bar % 2) continue;
      const time = start + step * beat / 2;
      const pan = step % 2 ? 0.35 : -0.35;
      tone(time, beat * 1.4, chord[pattern[step]], 0.085, pan, "pluck");
      tone(time + beat * 0.75, beat, chord[pattern[step]], 0.018, -pan, "pluck");
    }
    if (bar === 0 || bar % 16 === 12 || bar % 16 === 13) continue;
    for (let offset = 0; offset < 4; offset += 1) {
      add(start + offset * beat, 0.28, 0.16, 0, (t) => {
        const phase = 2 * Math.PI * (52 * t + 1.6 * (1 - Math.exp(-t / 0.02)));
        return Math.min(1, t / 0.003) * Math.exp(-t / 0.07) * Math.sin(phase);
      });
      let previous = 0;
      add(start + (offset + 0.5) * beat, 0.09, 0.025, 0.25, (t) => {
        const current = noise();
        const value = (current - previous) * Math.min(1, t / 0.002) * Math.exp(-t / 0.018);
        previous = current;
        return value;
      });
    }
  }
  return { left, right };
}

function musicWavHeader(count) {
  const dataBytes = count * 4;
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(dataBytes + 80)) {
    throw new Error("Music duration exceeds the exact sample-count range supported by this runtime.");
  }
  const rf64 = dataBytes + 36 > 0xffffffff;
  const header = Buffer.alloc(rf64 ? 80 : 44);
  header.write(rf64 ? "RF64" : "RIFF", 0);
  header.writeUInt32LE(rf64 ? 0xffffffff : dataBytes + 36, 4);
  header.write("WAVE", 8);
  let offset = 12;
  if (rf64) {
    header.write("ds64", offset);
    header.writeUInt32LE(28, offset + 4);
    header.writeBigUInt64LE(BigInt(dataBytes) + 72n, offset + 8);
    header.writeBigUInt64LE(BigInt(dataBytes), offset + 16);
    header.writeBigUInt64LE(BigInt(count), offset + 24);
    offset += 36;
  }
  header.write("fmt ", offset);
  header.writeUInt32LE(16, offset + 4);
  header.writeUInt16LE(1, offset + 8);
  header.writeUInt16LE(2, offset + 10);
  header.writeUInt32LE(SAMPLE_RATE, offset + 12);
  header.writeUInt32LE(SAMPLE_RATE * 4, offset + 16);
  header.writeUInt16LE(4, offset + 20);
  header.writeUInt16LE(16, offset + 22);
  header.write("data", offset + 24);
  header.writeUInt32LE(rf64 ? 0xffffffff : dataBytes, offset + 28);
  return header;
}

function writeBackgroundMusic(file, seconds, music) {
  validateMusic(music);
  if (!music?.enabled || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Enable music and provide a finite duration greater than zero.");
  }
  const count = Math.round(seconds * SAMPLE_RATE);
  const header = musicWavHeader(count);
  const descriptor = fs.openSync(file, "wx");
  try {
    const { left, right } = synthesizeLoop(music);
    let peak = 0;
    for (let index = 0; index < left.length; index += 1) {
      peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
    }
    if (!peak) throw new Error("The synthesized background music is empty.");
    fs.writeFileSync(descriptor, header);
    const block = Buffer.alloc(SAMPLE_RATE * 4);
    for (let start = 0; start < count; start += SAMPLE_RATE) {
      const samples = Math.min(SAMPLE_RATE, count - start);
      for (let offset = 0; offset < samples; offset += 1) {
        const index = start + offset;
        const t = index / SAMPLE_RATE;
        const fade = Math.max(0, Math.min(1, t / FADE_IN, (seconds - t) / FADE_OUT));
        const gain = 0.8 / peak * fade * 32767;
        block.writeInt16LE(Math.round(left[index % left.length] * gain), offset * 4);
        block.writeInt16LE(Math.round(right[index % right.length] * gain), offset * 4 + 2);
      }
      fs.writeFileSync(descriptor, block.subarray(0, samples * 4));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const style = music.style ?? "electronic";
  return {
    enabled: true,
    file: path.basename(file),
    style,
    source: `Original ${MUSIC_STYLES[style].label} instrumental arrangement synthesized locally; no external recording.`,
    arrangementBars: 16,
    beatsPerMinute: music.beatsPerMinute,
    volumeDb: music.volumeDb,
    fadeInSeconds: FADE_IN,
    fadeOutSeconds: FADE_OUT,
    ducking: "Automatically attenuated by the narration using sidechain compression.",
    sampleRate: SAMPLE_RATE,
    channels: 2,
  };
}

function soundtrackFilter(music) {
  validateMusic(music);
  if (!music?.enabled) throw new Error("Enable music before building the soundtrack mix.");
  return "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][sidechain];" +
    `[2:a]volume=${music.volumeDb}dB[bed];` +
    "[bed][sidechain]sidechaincompress=threshold=0.05:ratio=4:attack=30:release=450[ducked];" +
    "[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0," +
    "alimiter=limit=0.95:level=0:latency=1[soundtrack]";
}

module.exports = { MUSIC_STYLES, validateMusic, writeBackgroundMusic, musicWavHeader, soundtrackFilter };
