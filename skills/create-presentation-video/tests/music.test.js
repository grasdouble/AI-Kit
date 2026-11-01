"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { MUSIC_STYLES, validateMusic, writeBackgroundMusic, musicWavHeader, soundtrackFilter } = require("../scripts/background-music.js");
const { validateStoryboard, wavDuration, scriptMarkdown } = require("../scripts/video-utils.js");
const storyboard = require("./fixtures/storyboard.json");
const music = storyboard.music;

test("music settings are validated and disabling music preserves narration-only exports", () => {
  validateStoryboard(storyboard);
  assert.equal(music.enabled, true);
  assert.match(scriptMarkdown(storyboard), /Original light electronic instrumental/);
  for (const settings of [undefined, { ...music, enabled: false }]) {
    validateStoryboard({ ...storyboard, music: settings });
    assert.match(scriptMarkdown({ ...storyboard, music: settings }), /Disabled; narration only/);
  }
  for (const invalid of [
    null, {}, { ...music, enabled: "true" }, { ...music, beatsPerMinute: 0 },
    { ...music, beatsPerMinute: 141 }, { ...music, beatsPerMinute: 104.5 },
    { ...music, volumeDb: NaN }, { ...music, volumeDb: -40 }, { ...music, volumeDb: -5 },
  ]) assert.throws(() => validateMusic(invalid), /Music requires/);
  assert.throws(() => soundtrackFilter({ ...music, enabled: false }), /Enable music/);
  for (const seconds of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    assert.throws(() => writeBackgroundMusic("unused.wav", seconds, music), /duration/);
  }
  for (const style of ["jazz", "", null, 42, ["electronic"], "toString"]) {
    assert.throws(() => validateMusic({ ...music, style }), /Music style/);
  }
});

test("every musical style produces a distinct, deterministic, audible arrangement", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "music-styles-test-"));
  try {
    const outputs = [];
    for (const [style, settings] of Object.entries(MUSIC_STYLES)) {
      const first = path.join(directory, `${style}.wav`);
      const second = path.join(directory, `${style}-repeat.wav`);
      const configured = { ...music, style, beatsPerMinute: settings.beatsPerMinute };
      validateStoryboard({ ...storyboard, music: configured });
      assert.ok(scriptMarkdown({ ...storyboard, music: configured }).includes(settings.label));
      const record = writeBackgroundMusic(first, 4, configured);
      writeBackgroundMusic(second, 4, configured);
      const wav = fs.readFileSync(first);
      assert.deepEqual(wav, fs.readFileSync(second), `Non-deterministic style: ${style}`);
      assert.equal(wavDuration(wav), 4);
      assert.equal(record.style, style);
      assert.equal(record.arrangementBars, 16);
      let peak = 0;
      for (let offset = 44; offset < wav.length; offset += 2) {
        peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
      }
      assert.ok(peak > 1000 && peak <= 26214, `Empty or clipped style: ${style}`);
      for (const previous of outputs) assert.notDeepEqual(wav, previous, `Duplicate arrangement: ${style}`);
      outputs.push(wav);
    }
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("music headers use RF64 beyond the RIFF format's size limit", () => {
  const short = musicWavHeader(48000);
  assert.equal(short.length, 44);
  assert.equal(short.toString("ascii", 0, 4), "RIFF");
  assert.equal(short.readUInt32LE(40), 48000 * 4);
  const count = 2 ** 30;
  const long = musicWavHeader(count);
  assert.equal(long.length, 80);
  assert.equal(long.toString("ascii", 0, 4), "RF64");
  assert.equal(long.toString("ascii", 12, 16), "ds64");
  assert.equal(long.readBigUInt64LE(20), BigInt(count) * 4n + 72n);
  assert.equal(long.readBigUInt64LE(28), BigInt(count) * 4n);
  assert.equal(long.readBigUInt64LE(36), BigInt(count));
  assert.equal(long.readUInt32LE(44), 0);
  assert.equal(long.toString("ascii", 48, 52), "fmt ");
  assert.equal(long.toString("ascii", 72, 76), "data");
  assert.equal(long.readUInt32LE(76), 0xffffffff);
  for (const invalid of [0, -1, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => musicWavHeader(invalid), /sample-count/);
  }
});

test("a complete 30-minute soundtrack is streamed with bounded memory and decodes to the end", {
  timeout: 120000,
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "long-music-test-"));
  try {
    const file = path.join(directory, "thirty-minutes.wav");
    const child = spawnSync(process.execPath, [
      "--max-old-space-size=64", "-e",
      `const { writeBackgroundMusic } = require(process.argv[1]);
       const record = writeBackgroundMusic(process.argv[2], 1800, ${JSON.stringify(music)});
       console.log(JSON.stringify({ record, memory: process.memoryUsage(), peakRssKb: process.resourceUsage().maxRSS }));`,
      path.resolve(__dirname, "../scripts/background-music.js"), file,
    ], { encoding: "utf8", timeout: 90000, maxBuffer: 8192 });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.record.style, "electronic");
    assert.ok(result.memory.arrayBuffers < 32 * 1024 * 1024, "Music buffers must not grow with track length.");
    assert.ok(result.peakRssKb < 256 * 1024, "A long soundtrack must not allocate the full PCM track.");
    assert.equal(fs.statSync(file).size, 44 + 1800 * 48000 * 4);
    const descriptor = fs.openSync(file, "r");
    try {
      const header = Buffer.alloc(44);
      fs.readSync(descriptor, header, 0, header.length, 0);
      assert.equal(header.readUInt32LE(40), 1800 * 48000 * 4);
      const boundary = Math.round(16 * 4 * 60 / music.beatsPerMinute * 48000);
      const samples = Buffer.alloc(8);
      fs.readSync(descriptor, samples, 0, samples.length, 44 + (boundary - 1) * 4);
      assert.ok(Math.abs(samples.readInt16LE(4) - samples.readInt16LE(0)) < 2000, "Loop seam must not click.");
      fs.readSync(descriptor, samples, 0, samples.length, fs.statSync(file).size - samples.length);
      assert.equal(samples.readInt16LE(4), 0);
      assert.equal(samples.readInt16LE(6), 0);
    } finally {
      fs.closeSync(descriptor);
    }
    const decoded = spawnSync(require("ffmpeg-static"), [
      "-hide_banner", "-i", file, "-f", "null", "-",
    ], { encoding: "utf8", timeout: 30000, maxBuffer: 65536 });
    assert.ifError(decoded.error);
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.match(decoded.stderr, /Duration: 00:30:00\.00/);
    assert.match(decoded.stderr, /48000 Hz, stereo/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("the original stereo bed is reproducible, unclipped, faded, and exactly timed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kiti-music-test-"));
  try {
    const first = path.join(directory, "first.wav");
    const second = path.join(directory, "second.wav");
    const record = writeBackgroundMusic(first, 8, music);
    writeBackgroundMusic(second, 8, music);
    const wav = fs.readFileSync(first);
    assert.deepEqual(wav, fs.readFileSync(second));
    assert.equal(wavDuration(wav), 8);
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.match(record.source, /no external recording/);
    const rms = (start, end) => {
      let sum = 0;
      for (let index = start * 48000; index < end * 48000; index += 1) {
        sum += (wav.readInt16LE(44 + index * 4) / 32768) ** 2;
      }
      return Math.sqrt(sum / ((end - start) * 48000));
    };
    assert.ok(rms(2, 4) > 0.05);
    assert.ok(rms(0, 0.1) < rms(2, 4) / 4);
    assert.ok(rms(7.9, 8) < rms(2, 4) / 4);
    let differences = 0;
    for (let offset = 44; offset < wav.length; offset += 4) {
      const left = wav.readInt16LE(offset);
      const right = wav.readInt16LE(offset + 2);
      assert.ok(Math.abs(left) <= 26214 && Math.abs(right) <= 26214);
      if (left !== right) differences += 1;
    }
    assert.ok(differences > 48000);
    assert.equal(wav.readInt16LE(44), 0);
    assert.equal(wav.readInt16LE(wav.length - 2), 0);
    assert.throws(() => writeBackgroundMusic(first, 8, music), /EEXIST/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("the real FFmpeg mix ducks music under narration and preserves voice level and timing", () => {
  const result = spawnSync(require("ffmpeg-static"), [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=6",
    "-f", "lavfi", "-i", "aevalsrc=if(between(t\\,2\\,4)\\,0.3*sin(2*PI*220*t)\\,0):s=48000:d=6",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=6",
    "-filter_complex", soundtrackFilter(music), "-map", "[soundtrack]",
    "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1",
  ], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr.toString());
  const samples = result.stdout;
  assert.equal(samples.length, 6 * 48000 * 2 * 4);
  const amplitude = (frequency, start, end) => {
    let sine = 0;
    let cosine = 0;
    for (let index = start * 48000; index < end * 48000; index += 1) {
      const value = samples.readFloatLE(index * 8);
      const phase = 2 * Math.PI * frequency * index / 48000;
      sine += value * Math.sin(phase);
      cosine += value * Math.cos(phase);
    }
    return 2 * Math.hypot(sine, cosine) / ((end - start) * 48000);
  };
  const quiet = amplitude(880, 0.75, 1.75);
  const talking = amplitude(880, 3, 3.75);
  const recovered = amplitude(880, 5.25, 5.75);
  assert.ok(quiet > 0.01, "Music must remain audible between spoken sections.");
  assert.ok(talking < quiet / 2, "Narration must attenuate music by at least 6 dB.");
  assert.ok(recovered > talking * 1.5, "Music must recover after narration.");
  assert.ok(Math.abs(amplitude(220, 3, 3.75) - 0.3 / Math.SQRT2) < 0.002,
    "The mix must not lower or normalize the voice.");
  for (let offset = 0; offset < samples.length; offset += 4) {
    assert.ok(Math.abs(samples.readFloatLE(offset)) <= 0.951, "The mix must not clip.");
  }
});
