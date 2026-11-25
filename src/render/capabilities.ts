export interface WebGlCapabilities {
  available: boolean;
  contextType: 'webgl2' | 'webgl' | 'none';
  renderer: string;
  vendor: string;
  unmaskedRenderer: string | null;
  unmaskedVendor: string | null;
  maxTextureSize: number;
  maxRenderbufferSize: number;
  devicePixelRatio: number;
  hasWebCodecsVideoEncoder: boolean;
  hasWebCodecsVideoDecoder: boolean;
}

export function probeWebGlCapabilities(): WebGlCapabilities {
  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2');
  const gl = gl2 ?? canvas.getContext('webgl');
  const contextType: WebGlCapabilities['contextType'] = gl2 ? 'webgl2' : gl ? 'webgl' : 'none';

  let renderer = 'unavailable';
  let vendor = 'unavailable';
  let unmaskedRenderer: string | null = null;
  let unmaskedVendor: string | null = null;
  let maxTextureSize = 0;
  let maxRenderbufferSize = 0;

  if (gl) {
    renderer = String(gl.getParameter(gl.RENDERER) ?? 'unknown');
    vendor = String(gl.getParameter(gl.VENDOR) ?? 'unknown');
    maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) ?? 0);
    maxRenderbufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) ?? 0);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      unmaskedRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '');
      unmaskedVendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? '');
    }
  }

  return {
    available: gl !== null,
    contextType,
    renderer,
    vendor,
    unmaskedRenderer,
    unmaskedVendor,
    maxTextureSize,
    maxRenderbufferSize,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    hasWebCodecsVideoEncoder: typeof globalThis.VideoEncoder === 'function',
    hasWebCodecsVideoDecoder: typeof globalThis.VideoDecoder === 'function',
  };
}
