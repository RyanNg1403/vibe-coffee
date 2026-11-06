// three-mesh-bvh is fetched as its own chunk after startup; nothing needs it
// before the first pointer pick. The single-file artifact replaces this module
// with a null loader (see tools/make-artifact.mjs) to stay within its budget.
export const loadBvh = () => import('three-mesh-bvh');
