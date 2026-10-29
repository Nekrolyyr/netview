/**
 * GLSL for the layers. three.js (r163+) compiles every ShaderMaterial as GLSL ES 3.00, so integer bit tests work; it maps
 * attribute / varying / gl_FragColor onto the GLSL3 keywords. Colours are sRGB values written as-is.
 */

/** Shared: inactive (not yet activated / not reached) nodes are drawn in dimmed grayscale. */
const GRAY = /* glsl */ `
vec3 inactiveColour(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(l * 0.35 + 0.06);
}
`;

export const nodeVertex = /* glsl */ `
attribute float aRadius;
attribute vec3 aColour;
attribute float aRole;
attribute float aTeff;
attribute float aVisFrom;
attribute float aVisTo;
attribute float aHighlight;
uniform float uTime;
uniform float uMix;
uniform float uProjScale;
uniform float uSizeScale;
uniform float uFocus;
uniform float uDim;
uniform float uLod;
uniform vec3 uRingWhitelist;
uniform vec3 uRingInfluencer;
varying vec3 vColour;
varying vec3 vRing;
varying float vRole;
varying float vAlpha;
varying float vHighlight;
${GRAY}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float vis = mix(aVisFrom, aVisTo, uMix);
  bool isActive = aTeff <= uTime;
  vColour = isActive ? aColour : inactiveColour(aColour);
  vec3 ring = aRole > 1.5 ? uRingWhitelist : uRingInfluencer;
  vRing = isActive ? ring : inactiveColour(ring);
  vRole = aRole;
  float focus = uFocus > 0.5 && aHighlight < 0.5 ? uDim : 1.0;
  // zoomed out: accounts without a role recede behind the clouds (level of detail)
  float lod = aRole > 0.5 || aHighlight > 0.5 ? 1.0 : mix(0.18, 1.0, uLod);
  vAlpha = vis * focus * lod;
  vHighlight = aHighlight;
  float px = 2.0 * aRadius * uSizeScale * uProjScale / max(-mv.z, 0.001);
  gl_PointSize = vis > 0.001 ? clamp(px, 1.6, 512.0) * (aHighlight > 1.5 ? 1.35 : 1.0) : 0.0;
}
`;

/** Fill = community colour; source accounts and influencers wear an outer ring (red / pink). */
export const nodeFragment = /* glsl */ `
varying vec3 vColour;
varying vec3 vRing;
varying float vRole;
varying float vAlpha;
varying float vHighlight;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || vAlpha < 0.01) discard;
  float edge = 1.0 - smoothstep(0.86, 1.0, r);
  vec3 c = vColour * mix(1.0, 0.62, smoothstep(0.62, 0.95, r));
  if (vRole > 0.5) c = mix(c, vRing, smoothstep(0.6, 0.68, r));
  if (vHighlight > 1.5) {
    // selected: bright ring inside the disc
    float ring = smoothstep(0.36, 0.42, r) * (1.0 - smoothstep(0.5, 0.56, r));
    c = mix(c * 0.85, vec3(1.0), ring);
  }
  gl_FragColor = vec4(c, vAlpha * edge);
}
`;

export const pickVertex = /* glsl */ `
attribute float aRadius;
attribute float aVisFrom;
attribute float aVisTo;
attribute float aId;
uniform float uMix;
uniform float uProjScale;
uniform float uSizeScale;
varying vec3 vId;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float vis = mix(aVisFrom, aVisTo, uMix);
  float id = aId + 1.0;
  vId = vec3(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0)) / 255.0;
  float px = 2.0 * aRadius * uSizeScale * uProjScale / max(-mv.z, 0.001);
  gl_PointSize = vis > 0.5 ? clamp(px, 3.0, 512.0) : 0.0;
}
`;

export const pickFragment = /* glsl */ `
varying vec3 vId;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  if (dot(p, p) > 1.0) discard;
  gl_FragColor = vec4(vId, 1.0);
}
`;

export const edgeVertex = /* glsl */ `
attribute vec3 aColour;
attribute float aTeff;
attribute float aTypes;
attribute float aHighlight;
uniform float uTime;
varying vec3 vColour;
varying float vActive;
varying float vTypes;
varying float vHighlight;
${GRAY}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vActive = aTeff <= uTime ? 1.0 : 0.0;
  vColour = vActive > 0.5 ? aColour : inactiveColour(aColour);
  vTypes = aTypes;
  vHighlight = aHighlight;
}
`;

export const edgeFragment = /* glsl */ `
uniform int uTypeMask;
uniform float uOpacity;
uniform float uFocus;
uniform float uLod;
varying vec3 vColour;
varying float vActive;
varying float vTypes;
varying float vHighlight;
void main() {
  if ((int(vTypes + 0.5) & uTypeMask) == 0) discard;
  float a = (vActive > 0.5 ? 0.11 : 0.04) * uLod * uOpacity;
  // the links of a selection stay readable at a low link intensity
  if (uFocus > 0.5) a = vHighlight > 0.5 ? 0.75 * min(1.0, uOpacity * 5.0) : a * 0.25;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColour, a);
}
`;

export const cloudVertex = /* glsl */ `
attribute vec3 iCentre;
attribute float iRadius;
attribute vec3 iColour;
attribute float iActivity;
attribute float iWeight;
varying vec2 vUv;
varying vec3 vColour;
varying float vWeight;
${GRAY}
void main() {
  vec4 mv = modelViewMatrix * vec4(iCentre, 1.0);
  mv.xy += position.xy * iRadius;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vec3 gray = inactiveColour(iColour);
  vColour = mix(gray, iColour, iActivity);
  vWeight = iWeight * (0.35 + 0.65 * iActivity);
}
`;

/**
 * Clouds are accumulated into an offscreen buffer (additive): rgb = Σ colour·a, alpha = Σ a.
 * The composite pass turns that into the weighted average colour with a coverage of 1 − e^(−k·Σa),
 * so overlapping clouds mix their hues instead of adding up to white.
 */
export const cloudFragment = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vColour;
varying float vWeight;
void main() {
  float d2 = dot(vUv, vUv);
  if (d2 > 1.0) discard;
  float a = exp(-d2 * 3.2) * (1.0 - d2) * vWeight * uOpacity;
  gl_FragColor = vec4(vColour * a, a);
}
`;

export const compositeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const compositeFragment = /* glsl */ `
uniform sampler2D tCloud;
uniform float uDensity;
varying vec2 vUv;
void main() {
  vec4 acc = texture2D(tCloud, vUv);
  if (acc.a < 1e-4) discard;
  vec3 colour = acc.rgb / acc.a;
  float coverage = 1.0 - exp(-acc.a * uDensity);
  gl_FragColor = vec4(colour * coverage, coverage);   // premultiplied
}
`;

/**
 * The ball of the sphere layout. Every community is a Gaussian cap around its direction (weight 0.2 at its
 * angular radius); the caps' colours are averaged by weight and cover the ball by 1 - exp(-2 sum w), so
 * overlapping caps mix instead of adding up to white. Lit from the camera, with a faint rim.
 */
export const ballVertex = /* glsl */ `
varying vec3 vDir;
varying vec3 vViewNormal;
void main() {
  vDir = normalize(position);
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ballFragment = /* glsl */ `
uniform vec4 uCapDir[96];      // direction, angular radius (MAX_CAPS in layers.ts)
uniform vec4 uCapColour[96];   // colour, weight
uniform int uCount;
uniform vec3 uBase;
varying vec3 vDir;
varying vec3 vViewNormal;
void main() {
  vec3 n = normalize(vDir);
  vec3 acc = vec3(0.0);
  float w = 0.0;
  // outline of every cap at its angular radius, so grey and overlapping communities stay apart; the pixel
  // size (radians) is taken outside the loop: derivatives inside it are undefined on some GPUs
  float pixel = max(length(fwidth(n)), 1e-5);
  vec3 edgeColour = vec3(0.0);
  float edge = 0.0;
  for (int i = 0; i < 96; i++) {
    if (i >= uCount) break;
    vec4 cap = uCapDir[i];
    vec4 col = uCapColour[i];
    float angle = acos(clamp(dot(n, cap.xyz), -1.0, 1.0));
    float radius = max(cap.w, 1e-4);
    float k = exp(-1.6 * (angle * angle) / (radius * radius)) * col.w;
    acc += col.rgb * k;
    w += k;
    float line = (1.0 - smoothstep(0.0, 1.5 * pixel, abs(angle - radius))) * col.w;
    if (line > edge) {
      edge = line;
      edgeColour = col.rgb;
    }
  }
  vec3 colour = w > 1e-4 ? acc / w : uBase;
  // caps stay a little muted, so nodes filled with the same colour still stand out on them
  float coverage = (1.0 - exp(-2.0 * w)) * 0.85;
  float facing = max(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)), 0.0);
  vec3 c = mix(uBase, colour, coverage);
  c = mix(c, edgeColour * 0.6 + 0.35, 0.7 * edge);
  c *= 0.55 + 0.45 * facing;
  c += vec3(0.16, 0.13, 0.24) * pow(1.0 - facing, 3.0);
  gl_FragColor = vec4(c, 1.0);
}
`;
