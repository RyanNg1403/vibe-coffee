// Shader pre-compilation that tolerates the scene changing underneath it.
// Three's compileAsync() polls every material until its program links; if a
// material is disposed meanwhile (the café was switched), its poll throws in a
// timer and the promise never settles. This polls the same way but drops
// materials whose program is gone.
export async function compileScene(renderer, scene, camera, targetScene = null) {
  const materials = renderer.compile(scene, camera, targetScene);
  const parallel = renderer.extensions.get('KHR_parallel_shader_compile') !== null;
  // Yield once either way so the caller's frame is not extended.
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (!parallel) return;
  while (materials.size) {
    for (const material of materials) {
      const program = renderer.properties.get(material).currentProgram;
      if (!program || program.isReady()) materials.delete(material);
    }
    if (materials.size) await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
