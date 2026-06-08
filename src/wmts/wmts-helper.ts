/**
 * === WMTS 中 EPSG:4490 / 4326 的轴序(axis orientation)问题 ===
 *
 * 1. OGC 标准中 EPSG:4326 和 EPSG:4490 的轴序定义为 neu (纬度在前，即 lat, lon 北-东-上顺序)
 *    但 EPSG:4326 在实际中常被当作 enu (经度在前，即 lon, lat) 使用
 *
 * 2. OpenLayers 中 EPSG:4326 注册为 axisOrientation='neu'， EPSG:3857 注册为 axisOrientation='enu'，
 *    当 optionsFromCapabilities 检测到投影轴序为 'ne' 时，会交换 TopLeftCorner 的两个值
 *    即 switchXY = projection.getAxisOrientation().substr(0, 2) === 'ne'
 *    如果 TopLeftCorner 原始值是 [-180, 90] (lon, lat)，交换后变成 [90, -180] (lat, lon)
 *
 * 3. 两个 WMTS 服务器的 TopLeftCorner 实际轴序不同：
 *
 *    广东天地图 (guangdong.tianditu.gov.cn):
 *      <TopLeftCorner>-180.0 90.0</TopLeftCorner>
 *      值为 (经度, 纬度) → 实际是 enu 顺序，不应交换
 *
 *    国家天地图 (t0.tianditu.gov.cn):
 *      <TopLeftCorner>90.0 -180.0</TopLeftCorner>
 *      值为 (纬度, 经度) → 实际是 neu 顺序，符合 OGC 标准定义
 *
 * 4. 原来的代码用 replaceAll('4490', '4326') 将 CRS 替换后，
 *    EPSG:4326 的 axisOrientation='neu' 导致 switchXY=true
 *    对广东服务器：TopLeftCorner 本来就是 (lon, lat)，被错误交换为 (lat, lon) → 瓦片网格完全错位，不发请求
 *    对国家服务器：TopLeftCorner 本来就是 (lat, lon)，交换后变成 (lon, lat) → 反而正确
 *
 * 5. 当前方案：注册 EPSG:4490 为 axisOrientation='enu'（默认值），与 CRS:84 等价
 *    广东服务器 EPSG:4490 → switchXY=false → 不交换 → 正确 ✓
 *    国家服务器 EPSG:4326 → switchXY=true  → 交换 → 也正确 ✓
 *    两个服务器各自使用各自的 CRS 代码，各自匹配正确的轴序行为
 *
 * 6. 结论：不同服务器对同一 CRS 可能采用不同的轴序约定，
 *    注册投影时要与服务器实际输出坐标的轴序一致，而非严格按 OGC 标准定义
 */

import WMTSCapabilities from "ol/format/WMTSCapabilities";
import { register } from "ol/proj/proj4";
import WMTS, { optionsFromCapabilities, type Options as WmtsOptions } from "ol/source/WMTS";
import proj4 from "proj4";

/**
 * === proj4.defs 两种写法对比 ===
 *
 * 写法1: proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +units=degrees +to_meter=111319.49079327358 +no_defs')
 * 写法2: proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +no_defs +type=crs')  ← 当前使用
 *
 * 区别：
 *   +units=degrees       写法1 显式指定单位为度；写法2 省略，proj4 对 longlat 默认即为 degrees
 *   +to_meter=111319...  写法1 显式指定度→米转换系数；写法2 省略，proj4 从 GRS80 椭球体自动计算
 *                        π × 6378137 / 180 ≈ 111319.4908，结果一致
 *   +type=crs            写法2 加上了此参数，PROJ 6+ 推荐加上，标识为坐标参考系统，
 *                        避免被误解为坐标转换管线(pipeline)；PROJ 6 以下版本会忽略此参数
 *
 * 结论：写法2 更简洁且更兼容新版 PROJ，最终注册效果完全相同
 *       都产生 axisOrientation='enu'、units='degrees' 的投影
 */

const CRS4326ENU = "4326_enu";
const CRS4490NEU = "4490_neu";
const CRS3857NEU = "3857_neu";
const CRS900913NEU = "900913_neu";
const REGX_CRS_SEP = /::|:/;

const CRS_AXIS_EXPECTED_X: Record<string, { value: number; axis: "enu" | "neu" }[]> = {
  "4490": [
    { value: -180, axis: "enu" },
    { value: 90, axis: "neu" },
  ],
  "4326": [
    { value: -180, axis: "enu" },
    { value: 90, axis: "neu" },
  ],
  "3857": [
    { value: -20_037_508.342_789, axis: "enu" },
    { value: 20_037_508.342_789, axis: "neu" },
  ],
  "900913": [
    { value: -20_037_508.342_789, axis: "enu" },
    { value: 20_037_508.342_789, axis: "neu" },
  ],
};

const CRS_REPLACEMENT: Record<string, Record<"enu" | "neu", string>> = {
  "4490": { enu: "4490", neu: CRS4490NEU },
  "4326": { enu: CRS4326ENU, neu: "4326" },
  "3857": { enu: "3857", neu: CRS3857NEU },
  "900913": { enu: "900913", neu: CRS900913NEU },
};

function replaceCrsInXml(xmlText: string, from: string, to: string) {
  return xmlText.replace(new RegExp(`(EPSG[:/]+\\d*\\/?)${from}`, "g"), `$1${to}`);
}

function inferTileMatrixSetAxis({ xmlText, matrixSet, parser }: { xmlText: string; matrixSet: string; parser: WMTSCapabilities }) {
  const result: { TopLeftCorner: number[]; SupportedCRS: string; axis?: "enu" | "neu"; crs: string } = {
    TopLeftCorner: [],
    SupportedCRS: "",
    crs: "",
  };
  const capabilities = parser.read(xmlText);
  for (const item of capabilities.Contents.TileMatrixSet) {
    if (item.Identifier === matrixSet) {
      if (Array.isArray(item.TileMatrix) && Array.isArray(item.TileMatrix[0]?.TopLeftCorner)) {
        result.TopLeftCorner = item.TileMatrix[0].TopLeftCorner;
        result.SupportedCRS = item.SupportedCRS;
        result.crs = item.SupportedCRS.split(REGX_CRS_SEP).at(-1)!;
      }
      break;
    }
  }
  if (!result.crs) {
    throw new Error(`未找到 TileMatrixSet: ${matrixSet}`);
  }
  const [x] = result.TopLeftCorner;
  if (x === undefined) {
    throw new Error("未找到 TopLeftCorner");
  }

  const expectations = CRS_AXIS_EXPECTED_X[result.crs];
  if (expectations) {
    for (const { value, axis } of expectations) {
      if (result.crs === "3857" || result.crs === "900913" ? Math.abs(x - value) < 1 : x === value) {
        result.axis = axis;
        break;
      }
    }
  }

  return result;
}

function parseCapabilities({
  axis,
  crs,
  parser,
  xmlText,
}: {
  axis?: "enu" | "neu";
  crs: string;
  parser: WMTSCapabilities;
  xmlText: string;
}) {
  if (!axis) {
    return parser.read(xmlText);
  }
  const replacement = CRS_REPLACEMENT[crs]?.[axis];
  if (replacement && replacement !== crs) {
    return parser.read(replaceCrsInXml(xmlText, crs, replacement));
  }
  return parser.read(xmlText);
}

export class WmtsHelper {
  private readonly parser = new WMTSCapabilities();
  private registered = false;

  registerProjections() {
    if (this.registered) {
      return;
    }
    proj4.defs("EPSG:4490", "+proj=longlat +ellps=GRS80 +no_defs +type=crs");
    proj4.defs(`EPSG:${CRS4326ENU}`, "+proj=longlat +datum=WGS84 +no_defs +type=crs");
    proj4.defs(`EPSG:${CRS4490NEU}`, "+proj=longlat +ellps=GRS80 +axis=neu +no_defs +type=crs");
    proj4.defs(
      `EPSG:${CRS3857NEU}`,
      "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +axis=neu +no_defs +type=crs"
    );

    proj4.defs(
      `EPSG:${CRS900913NEU}`,
      "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +axis=neu +no_defs +type=crs"
    );
    register(proj4);
    this.registered = true;
  }

  async loadCapabilities(url: string, params: { layer: string; matrixSet: string }) {
    const response = await fetch(url);
    const xmlText = await response.text();
    const { axis, crs } = inferTileMatrixSetAxis({
      xmlText,
      matrixSet: params.matrixSet,
      parser: this.parser,
    });
    return parseCapabilities({ axis, crs, parser: this.parser, xmlText });
  }

  createWMTSSourceOptions(
    capabilities: Record<string, any>,
    params: { layer: string; matrixSet: string; format?: string },
    urlParams?: Record<string, string>
  ) {
    const wmtsOptions = optionsFromCapabilities(capabilities, params) as WmtsOptions;
    if (!wmtsOptions) {
      throw new Error(`无法从 GetCapabilities 创建 WMTS 选项, layer: ${params.layer}`);
    }
    if (urlParams) {
      const qs = Object.entries(urlParams)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
      wmtsOptions.urls = wmtsOptions.urls!.map((url: string) => `${url}${url.includes("?") ? "&" : "?"}${qs}`);
    }
    return wmtsOptions;
  }

  createSource(
    capabilities: Record<string, any>,
    params: { layer: string; matrixSet: string; format?: string },
    urlParams?: Record<string, string>
  ) {
    return new WMTS(this.createWMTSSourceOptions(capabilities, params, urlParams));
  }
}
