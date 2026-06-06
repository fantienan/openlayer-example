/**
 * === WMTS 中 EPSG:4490 / 4326 的轴序(axis orientation)问题 ===
 *
 * 1. OGC 标准中 EPSG:4326 和 EPSG:4490 的轴序定义为 neu (纬度在前，即 lat, lon 北-东-上顺序)
 *    但 EPSG:4326 在实际中常被当作 enu (经度在前，即 lon, lat) 使用
 *
 * 2. OpenLayers 中 EPSG:4326 注册为 axisOrientation='neu'，
 *    当 optionsFromCapabilities 检测到投影轴序为 'ne' 时，会交换 TopLeftCorner 的两个值
 *    即 switchXY = projection.getAxisOrientation().substr(0, 2) === 'ne'
 *    如果 TopLeftCorner 原始值是 [-180, 90] (lon, lat)，交换后变成 [90, -180] (lat, lon)
 *
 * 3. 两个 WMTS 服务器的 TopLeftCornert 实际轴序不同：
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

import MousePosition from "ol/control/MousePosition";
import { createStringXY } from "ol/coordinate";
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import TileLayer from "ol/layer/Tile";
import OLMap from "ol/Map";
import { register } from "ol/proj/proj4";
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS";
import XYZ from "ol/source/XYZ";
import View from "ol/View";
import proj4 from "proj4";
import "ol/ol.css";

const TDT_TK = "333d6f9105e836b0b09bb84ff56a58aa";

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
proj4.defs("EPSG:4490", "+proj=longlat +ellps=GRS80 +no_defs +type=crs"); // 默认 enu
register(proj4);

async function loadWmtsCapabilities(parser: WMTSCapabilities, url: string, replace?: boolean) {
  const response = await fetch(url);
  const text = await response.text();
  return parser.read(replace ? text.replaceAll("4490", "4326") : text);
}

function createWmtsSource(
  capabilities: any,
  params: { layer: string; matrixSet: string; format?: string },
  urlParams?: Record<string, string>
) {
  const wmtsOptions = optionsFromCapabilities(capabilities, params);
  if (!wmtsOptions) {
    throw new Error(`无法从 GetCapabilities 创建 WMTS 选项, layer: ${params.layer}`);
  }
  if (urlParams) {
    const qs = Object.entries(urlParams)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    wmtsOptions.urls = wmtsOptions.urls!.map((url: string) => `${url}&${qs}`);
  }
  return new WMTS(wmtsOptions);
}

async function initMap() {
  try {
    const parser = new WMTSCapabilities();

    const gdCapabilities = await loadWmtsCapabilities(
      parser,
      "https://guangdong.tianditu.gov.cn/server/GDJBNTBHTB/wmts?service=WMTS&request=GetCapabilities"
    );

    const tdtImgCapabilities = await loadWmtsCapabilities(
      parser,
      `https://t0.tianditu.gov.cn/img_c/wmts?service=WMTS&request=GetCapabilities&tk=${TDT_TK}`,
      true
    );

    const tdtImgSource = createWmtsSource(
      tdtImgCapabilities,
      {
        layer: "img",
        matrixSet: "c",
      },
      { tk: TDT_TK }
    );

    const gdParams = {
      layer: "永久基本农田保护",
      matrixSet: "永久基本农田保护_Matrix_1",
      format: "image/png",
    };
    const gdWmtsSource = createWmtsSource(gdCapabilities, gdParams);
    const gdLayer = gdCapabilities.Contents.Layer.find((l: any) => l.Identifier === gdParams.layer);
    const wgs84BBox = gdLayer?.WGS84BoundingBox;

    const tdtImgXyzSource = new XYZ({
      projection: "EPSG:4326",
      url: `https://t{0-7}.tianditu.gov.cn/DataServer?T=img_c&x={x}&y={y}&l={z}&tk=${TDT_TK}`,
    });

    const tdtCiaXyzSource = new XYZ({
      projection: "EPSG:4326",
      url: `https://t{0-7}.tianditu.gov.cn/DataServer?T=cia_c&x={x}&y={y}&l={z}&tk=${TDT_TK}`,
    });

    const map = new OLMap({
      target: "map",
      layers: [
        new TileLayer({ source: tdtImgXyzSource, visible: false }),
        new TileLayer({ source: tdtImgSource, visible: true }),
        new TileLayer({ source: gdWmtsSource, visible: true }),
        new TileLayer({ source: tdtCiaXyzSource, visible: true }),
      ],
      controls: [
        new MousePosition({
          coordinateFormat: createStringXY(6),
          projection: "EPSG:4326",
          className: "ol-mouse-position",
        }),
      ],
      view: new View({
        projection: "EPSG:4326",
        center: [113.26, 23.13],
        zoom: 10,
      }),
    });

    if (wgs84BBox) {
      map.getView().fit(wgs84BBox, { padding: [50, 50, 50, 50] });
    }
    (window as any).map = map;
  } catch (error) {
    console.error("初始化地图失败:", error);
  }
}

initMap();
