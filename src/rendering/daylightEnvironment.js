import {
  DataTexture, EquirectangularReflectionMapping, HalfFloatType, LinearFilter,
  LinearSRGBColorSpace, RGBAFormat,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { assetUrl } from '../assetUrl.js';

// The same credited HDR photograph lights metals/glass and supplies the view
// through the windows. Data URI parsing also supports the standalone export.
export async function loadDaylightEnvironment(url = '/environment/courtyard.hdr') {
  const loader = new RGBELoader();
  let texture;
  if (url.startsWith('data:')) {
    const binary = atob(url.slice(url.indexOf(',') + 1));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const data = loader.parse(bytes.buffer);
    texture = new DataTexture(data.data, data.width, data.height, RGBAFormat, HalfFloatType);
    texture.colorSpace = LinearSRGBColorSpace;
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = true;
    texture.needsUpdate = true;
  } else texture = await loader.loadAsync(assetUrl(url));
  texture.mapping = EquirectangularReflectionMapping;
  texture.userData.vibeShared = true;
  return texture;
}
