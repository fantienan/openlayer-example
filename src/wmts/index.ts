import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS";
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import XYZ from "ol/source/XYZ";
import MousePosition from "ol/control/MousePosition";
import { createStringXY } from "ol/coordinate";
import { addEquivalentProjections, get as getProj } from "ol/proj";
import Projection from "ol/proj/Projection";
import "ol/ol.css"

const TDT_TK = "333d6f9105e836b0b09bb84ff56a58aa";

// EPSG:4490 (CGCS2000 Geographic) is effectively identical to EPSG:4326 but Chinese WMTS
// servers provide coordinates in lon/lat order, so we register it with 'enu' axis orientation
// to prevent OpenLayers from incorrectly swapping TopLeftCorner values.
const proj4490 = new Projection({
  code: "EPSG:4490",
  units: "degrees",
  extent: [-180, -90, 180, 90],
  global: true,
  metersPerUnit: (Math.PI * 6378137) / 180,
  worldExtent: [-180, -90, 180, 90],
});
addEquivalentProjections([proj4490, getProj("EPSG:4326")!, getProj("CRS:84")!]);

async function loadWmtsCapabilities(parser: WMTSCapabilities, url: string) {
  const response = await fetch(url);
  const text = await response.text();
  return parser.read(text);
}

function createWmtsSource(capabilities: any, params: { layer: string; matrixSet: string, format?: string }) {
  const wmtsOptions = optionsFromCapabilities(capabilities, params);
  if (!wmtsOptions) {
    throw new Error(`无法从 GetCapabilities 创建 WMTS 选项, layer: ${params.layer}`);
  }
  return new WMTS(wmtsOptions);
}

async function initMap() {
  try {
    const parser = new WMTSCapabilities();

    const gdCapabilities = await loadWmtsCapabilities(parser, "https://guangdong.tianditu.gov.cn/server/GDJBNTBHTB/wmts?service=WMTS&request=GetCapabilities");

    const tdtImgSource = new XYZ({
      url: `https://t{0-7}.tianditu.gov.cn/DataServer?T=img_c&x={x}&y={y}&l={z}&tk=${TDT_TK}`,
      projection: "EPSG:4326",
    });

    const gdParams = {
      layer: "永久基本农田保护",
      matrixSet: "永久基本农田保护_Matrix_1",
      format: "image/png",
    };
    const gdWmtsSource = createWmtsSource(gdCapabilities, gdParams);
    const gdLayer = gdCapabilities.Contents.Layer.find((l: any) => l.Identifier === gdParams.layer);
    const wgs84BBox = gdLayer?.WGS84BoundingBox;

    const map = new Map({
      target: "map",
      layers: [
        new TileLayer({ source: tdtImgSource,  }),
        new TileLayer({ source: gdWmtsSource }),
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
    (window as any).map = map
  } catch (error) {
    console.error("初始化地图失败:", error);
  }
}

initMap();
