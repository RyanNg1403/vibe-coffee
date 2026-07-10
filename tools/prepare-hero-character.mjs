import { Accessor, AnimationSampler, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample } from '@gltf-transform/functions';

const [inputPath, outputPath, idleSample = '0'] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node tools/prepare-hero-character.mjs input.glb output.glb [idle-sample-seconds]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(inputPath);
const root = document.getRoot();
const buffer = root.listBuffers()[0] ?? document.createBuffer();
const walk = root.listAnimations()[0];

if (!walk) throw new Error('Expected a locomotion clip in the source character.');
walk.setName('Walk');

// Meshy exports the colour atlas as an emissive texture too. That makes the
// character glow in the midnight café, so retain it only as physically lit
// base colour.
for (const material of root.listMaterials()) {
  material.setEmissiveTexture(null);
  material.setEmissiveFactor([0, 0, 0]);
  material.setRoughnessFactor(Math.max(0.72, material.getRoughnessFactor()));
  material.setMetallicFactor(Math.min(0.04, material.getMetallicFactor()));
}

// The source provides walking only. Add a one-frame, authored-skeleton idle
// sampled at a planted point in the stride so queueing patrons never snap back
// to the bind pose. A static clip also keeps its animation cost negligible.
const idle = document.createAnimation('Idle');
const sampleTime = Number.parseFloat(idleSample);
if (!Number.isFinite(sampleTime)) throw new Error(`Invalid idle sample time: ${idleSample}`);

for (const sourceChannel of walk.listChannels()) {
  const sourceSampler = sourceChannel.getSampler();
  const sourceInput = sourceSampler?.getInput();
  const sourceOutput = sourceSampler?.getOutput();
  if (!sourceSampler || !sourceInput || !sourceOutput) continue;

  const times = sourceInput.getArray();
  let frame = 0;
  for (let index = 1; index < times.length; index++) {
    if (Math.abs(times[index] - sampleTime) < Math.abs(times[frame] - sampleTime)) frame = index;
  }

  const elementSize = sourceOutput.getElementSize();
  const sourceValues = sourceOutput.getArray();
  const splineOffset = sourceSampler.getInterpolation() === AnimationSampler.Interpolation.CUBICSPLINE
    ? frame * elementSize * 3 + elementSize
    : frame * elementSize;
  const values = sourceValues.slice(splineOffset, splineOffset + elementSize);
  const outputArray = new sourceValues.constructor(values);

  const input = document.createAccessor()
    .setType(Accessor.Type.SCALAR)
    .setArray(new Float32Array([0]))
    .setBuffer(buffer);
  const output = document.createAccessor()
    .setType(sourceOutput.getType())
    .setArray(outputArray)
    .setBuffer(buffer);
  const sampler = document.createAnimationSampler()
    .setInterpolation(AnimationSampler.Interpolation.STEP)
    .setInput(input)
    .setOutput(output);
  const channel = document.createAnimationChannel()
    .setTargetNode(sourceChannel.getTargetNode())
    .setTargetPath(sourceChannel.getTargetPath())
    .setSampler(sampler);
  idle.addSampler(sampler).addChannel(channel);
}

await document.transform(resample(), prune());
await io.write(outputPath, document);
