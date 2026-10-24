export function normalizeClaimCode(code: string): string
export function claimUrl(code: string, site?: string): string
export function claimUrlOk(url: string, code: string): boolean
export function drawQrModules(
  canvas: { getContext: (id: "2d") => CanvasRenderingContext2D | null; width: number; height: number },
  modules: string,
  size: number
): boolean
