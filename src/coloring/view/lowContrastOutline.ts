import { Filter, GlProgram, UniformGroup } from 'pixi.js';
import { LOW_CONTRAST_DISTANCE, PAPER_RGB } from '../contrast';

const vertex = `in vec2 aPosition;
out vec2 vTextureCoord;
// 한 픽셀의 크기 (텍스처 좌표). 조각 셰이더에서 uInputSize 를 다시 선언하면 정밀도가 달라 연결이 실패하므로 넘겨 준다
out vec2 vTexel;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vTexel = uInputSize.zw;
}
`;

// 칠하지 않은 픽셀 가운데, 둘레에 "종이와 비슷한 색으로 칠한 픽셀" 이 있으면 테두리 색을 칠한다.
const fragment = `in vec2 vTextureCoord;
in vec2 vTexel;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uOutline;
uniform vec3 uPaper;
uniform float uThickness;
uniform float uNear;

float paleAt(vec2 uv)
{
    vec4 c = texture(uTexture, uv);
    if (c.a < 0.5) return 0.0;
    vec3 rgb = c.rgb / c.a;
    return step(distance(rgb, uPaper), uNear);
}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    if (c.a >= 0.5) {
        finalColor = c;
        return;
    }
    vec2 px = vTexel * uThickness;
    float m = 0.0;
    for (int i = 0; i < 8; i++) {
        float a = 6.2831853 * float(i) / 8.0;
        m = max(m, paleAt(vTextureCoord + vec2(cos(a), sin(a)) * px));
    }
    float o = m * uOutline.a;
    finalColor = vec4(uOutline.rgb * o, o) + c * (1.0 - o);
}
`;

/**
 * 흰색처럼 종이와 거의 같은 색으로 칠할 때, 칠한 곳의 둘레에 테두리를 그려 칠하고 있는 곳을 보여 준다.
 * 칠한 색에는 손대지 않고, 칠하지 않은 바깥쪽에만 그린다. WebGL 에서만 쓴다.
 */
export function createLowContrastOutline(): Filter {
  const glProgram = GlProgram.from({ vertex, fragment, name: 'low-contrast-outline' });
  const f = PAPER_RGB.map((v) => v / 255);
  return new Filter({
    glProgram,
    padding: 4,
    resources: {
      outlineUniforms: new UniformGroup({
        // 따뜻한 갈색 테두리 (선화보다 옅게)
        uOutline: { value: new Float32Array([0.55, 0.42, 0.3, 0.85]), type: 'vec4<f32>' },
        uPaper: { value: new Float32Array(f), type: 'vec3<f32>' },
        uThickness: { value: 2, type: 'f32' },
        uNear: { value: LOW_CONTRAST_DISTANCE / 255, type: 'f32' },
      }),
    },
  });
}
