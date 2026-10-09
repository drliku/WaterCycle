import * as THREE from 'three'

// Soft round particles with per-particle size and alpha.
export function makePointsMaterial({ color = '#ffffff', blending = THREE.NormalBlending } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uScale: { value: 400 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      uniform float uScale;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.15, d) * vAlpha * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending,
  })
}

export function makePointsGeometry(count) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3).fill(-999), 3))
  g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count).fill(0.2), 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 60)
  return g
}
