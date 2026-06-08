import MousePosition from "ol/control/MousePosition";
import { createStringXY } from "ol/coordinate";
import TileLayer from "ol/layer/Tile";
import OLMap from "ol/Map";
import XYZ from "ol/source/XYZ";
import View from "ol/View";
import "ol/ol.css";
import { WmtsHelper } from "./wmts-helper";

const TDT_TK = "333d6f9105e836b0b09bb84ff56a58aa";

const helper = new WmtsHelper();
helper.registerProjections();

async function initMap() {
  try {
    const gdParams = {
      layer: "永久基本农田保护",
      matrixSet: "永久基本农田保护_Matrix_1",
      format: "image/png",
    };
    const tdtImgParams = {
      layer: "img",
      matrixSet: "c",
    };
    const tdiImgWParams = {
      layer: "img",
      matrixSet: "w",
    };

    const gdCapabilities = await helper.loadCapabilities(
      "https://guangdong.tianditu.gov.cn/server/GDJBNTBHTB/wmts?service=WMTS&request=GetCapabilities",
      gdParams
    );

    const tdtImgCapabilities = await helper.loadCapabilities(
      `https://t0.tianditu.gov.cn/img_c/wmts?service=WMTS&request=GetCapabilities&tk=${TDT_TK}`,
      tdtImgParams
    );

    const tdtImgWCapabilities = await helper.loadCapabilities(
      `https://t0.tianditu.gov.cn/img_w/wmts?service=WMTS&request=GetCapabilities&tk=${TDT_TK}`,
      tdiImgWParams
    );

    const tdtImgSource = helper.createSource({
      capabilities: tdtImgCapabilities,
      ...tdtImgParams,
      queryParams: { tk: TDT_TK },
      initialResolution: 0.703_125,
    });
    const tdtImgWSource = helper.createSource({
      capabilities: tdtImgWCapabilities,
      ...tdiImgWParams,
      queryParams: { tk: TDT_TK },
    });

    const gdWmtsSource = helper.createSource({
      capabilities: gdCapabilities,
      ...gdParams,
    });
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
        new TileLayer({ source: tdtImgWSource, visible: false }),
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
